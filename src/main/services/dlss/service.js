import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  canonical,
  fail,
  pathKey,
  isInside,
  hasControl,
  safeJoin,
  hashFile,
  atomicWrite
} from './files.js'
import { prepareFileInstall } from './file-install.js'
import { inspectGame } from './inspect.js'
import { buildDlssPlan, DLSS_RENDER_APIS } from './plan.js'
import { deployFiles, restoreFiles } from './deployment.js'
import { buildSessionEnvironment } from './processes.js'
import { sessionConfiguration } from './configuration.js'
import { withDeploymentScopeMutationLocks } from '../../ipc/game/deploymentScopeMutationLock.js'

const activeStates = [
  'installed',
  'deployed',
  'starting',
  'running',
  'pending-restore',
  'restore-failed',
  'deploying'
]
const cleanText = (s, max = 160) =>
  typeof s === 'string'
    ? [...s]
        .filter((c) => c.charCodeAt(0) >= 32)
        .join('')
        .slice(0, max)
    : ''
function coverUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return ''
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : ''
  } catch {
    return ''
  }
}

export function createDlssService({
  repository,
  assets,
  root,
  processes,
  spawn,
  hardware = [],
  inspect = inspectGame,
  now = () => Date.now()
}) {
  let catalog = []
  let timer,
    ticking = false
  const busy = new Set()
  const preparing = new Map()
  const need = (id) => repository.get(id) || fail('binding_not_found', '绑定不存在或已被移除')
  const active = (record) => record.sessions?.find((s) => activeStates.includes(s.state))
  const save = (record) => {
    record.updatedAt = new Date(now()).toISOString()
    return repository.save(record)
  }
  function log(record, code, message) {
    record.logs ||= []
    record.logs.push({ at: new Date(now()).toISOString(), code, message })
    record.logs = record.logs.slice(-150)
    save(record)
  }
  function attachIdentity(record, context) {
    if (busy.has(record.id)) return record
    const sourcePlatform = cleanText(context.sourcePlatform)
    const gameId = cleanText(String(context.gameId || ''))
    const steamAppId = /^\d+$/.test(String(context.steamAppId || ''))
      ? String(context.steamAppId)
      : ''
    record.identities ||= []
    if (
      (gameId || steamAppId) &&
      !record.identities.some(
        (i) =>
          i.sourcePlatform === sourcePlatform && i.gameId === gameId && i.steamAppId === steamAppId
      )
    ) {
      record.identities.push({ sourcePlatform, gameId, steamAppId })
    }
    record.gameId ||= gameId
    record.steamAppId ||= steamAppId
    record.sourcePlatform ||= sourcePlatform
    record.coverImage ||= coverUrl(context.coverImage)
    save(record)
    return record
  }
  const view = (record) => {
    const visible = { ...record }
    delete visible.profile
    return {
      ...visible,
      busy: busy.has(record.id),
      operation: preparing.get(record.id)?.progress || null,
      plan: buildDlssPlan(record, catalog, hardware),
      hardware
    }
  }
  async function exclusive(id, action) {
    if (busy.has(id)) fail('binding_busy', '此游戏正在执行操作，请稍后重试')
    busy.add(id)
    try {
      const record = id === 'bindings' ? null : need(id)
      return await withDeploymentScopeMutationLocks(
        [
          {
            gameId: 1,
            source: 'dlss',
            deployDomain: record ? pathKey(path.dirname(record.exePath)) : 'bindings'
          }
        ],
        action,
        { operation: 'dlss', ownerId: id }
      )
    } finally {
      busy.delete(id)
    }
  }
  const paths = (record, session) => ({
    root:
      session.mode === 'files'
        ? session.deploymentRoot
        : path.join(root, 'sessions', record.id, session.id),
    backupRoot: path.join(root, 'backups', record.id, session.id)
  })
  async function checkedPaths(record, session) {
    const folders = paths(record, session)
    if (session.mode === 'files') {
      if (
        !isInside(record.gameRoot, folders.root) ||
        pathKey(folders.root) !== pathKey(path.dirname(record.exePath)) ||
        pathKey(await canonical(folders.root, true)) !== pathKey(folders.root)
      )
        fail('deployment_path_changed', '安装目录已变化，请核实原目录后恢复')
    } else await safeJoin(root, path.relative(root, folders.root))
    await safeJoin(root, path.relative(root, folders.backupRoot))
    return folders
  }
  async function refreshAssets() {
    catalog = await assets.catalog()
  }
  async function inspectBinding(payload) {
    const found = await inspect(payload)
    if (!found.selected?.launchTarget) return found
    const actual = await inspect({ gameRoot: found.gameRoot, exePath: found.selected.launchTarget })
    actual.selectionReason = `已从启动器 ${found.selected.name} 识别实际游戏：${actual.selected.relativePath}`
    return actual
  }
  function rememberLocation(record, inspection) {
    if (!record.exePath || pathKey(record.exePath) === pathKey(inspection.exePath)) return
    record.previousLocations ||= []
    record.previousLocations.push({
      gameRoot: record.gameRoot,
      exePath: record.exePath,
      fingerprint: record.inspection?.fingerprint
    })
  }
  async function bind(payload) {
    return exclusive('bindings', async () => {
      const requested = payload.id ? need(payload.id) : null
      if (requested && (busy.has(requested.id) || active(requested)))
        fail('binding_busy', '请先结束会话并恢复组件，再修改绑定')
      const inspection = await inspectBinding(payload)
      if (!inspection.selected) fail('choose_executable', '请明确选择实际渲染 EXE')
      if (inspection.selected.role === 'utility')
        fail('utility_executable', '卸载或报告程序不能作为游戏绑定')
      const key = pathKey(inspection.exePath)
      const suppliedCwd = payload.cwd ? await canonical(payload.cwd, true) : null
      const records = repository.list()
      const existing = records.find((r) => r.instanceKey === key)
      if (existing && existing.id !== payload.id) return view(attachIdentity(existing, payload))
      const previous = requested || existing
      if (previous && (busy.has(previous.id) || active(previous)))
        fail('binding_busy', '请先结束会话并恢复组件，再修改绑定')
      const record = previous || {
        id: randomUUID(),
        config: {
          components: ['nr'],
          api: '',
          route: 'auto',
          runtimeVariant: 'auto',
          installMode: 'files'
        },
        sessions: [],
        logs: [],
        createdAt: new Date(now()).toISOString()
      }
      const cwd = suppliedCwd || path.dirname(inspection.exePath)
      if (!isInside(inspection.gameRoot, cwd)) fail('invalid_cwd', '工作目录必须位于游戏目录内')
      const args = payload.args ?? previous?.args ?? []
      if (
        !Array.isArray(args) ||
        args.length > 64 ||
        args.some((v) => typeof v !== 'string' || v.length > 4096 || hasControl(v))
      )
        fail('invalid_arguments', '启动参数必须为字符串列表')
      if (payload.launchMode && !['direct', 'steam', 'launcher'].includes(payload.launchMode))
        fail('invalid_launch_mode', '启动方式无效')
      rememberLocation(record, inspection)
      Object.assign(record, {
        instanceKey: key,
        name:
          cleanText(payload.name) || previous?.name || path.basename(inspection.exePath, '.exe'),
        coverImage: coverUrl(payload.coverImage) || previous?.coverImage || '',
        gameRoot: inspection.gameRoot,
        exePath: inspection.exePath,
        cwd,
        args,
        launchMode: payload.launchMode || previous?.launchMode || 'direct',
        source: previous?.source || (payload.source === 'mod-center' ? 'mod-center' : 'manual'),
        gameId: cleanText(String(payload.gameId || previous?.gameId || '')),
        sourcePlatform: cleanText(payload.sourcePlatform) || previous?.sourcePlatform || '',
        steamAppId: /^\d+$/.test(String(payload.steamAppId || ''))
          ? String(payload.steamAppId)
          : previous?.steamAppId || '',
        inspection,
        pathValid: true
      })
      log(record, 'bound', '游戏已绑定；尚未部署组件')
      return view(record)
    })
  }
  async function resolve(context = {}) {
    if (context.exePath) {
      try {
        const real = await canonical(context.exePath)
        const match = repository.list().find((r) => r.instanceKey === pathKey(real))
        if (match) return { binding: view(attachIdentity(match, context)) }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    if (context.gameRoot || context.exePath) {
      const inspection = await inspect(context)
      const matches = repository
        .list()
        .filter((r) => pathKey(r.gameRoot) === pathKey(inspection.gameRoot))
      // A root can contain several games. Never infer an instance from name/AppID alone.
      if (!context.exePath && matches.length === 1)
        return { binding: view(attachIdentity(matches[0], context)) }
      return { inspection }
    }
    return { needsLocation: true }
  }
  async function redetect(id) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('session_active', '请先结束会话并恢复，再重新检测')
      try {
        const inspection = await inspectBinding(record)
        const key = pathKey(inspection.exePath)
        if (repository.list().some((other) => other.id !== id && other.instanceKey === key))
          fail('binding_exists', '实际游戏程序已有绑定，请打开该游戏的现有记录')
        rememberLocation(record, inspection)
        if (key !== record.instanceKey) record.cwd = path.dirname(inspection.exePath)
        record.instanceKey = key
        record.exePath = inspection.exePath
        record.inspection = inspection
        record.pathValid = true
        log(record, 'inspected', '已更新游戏指纹与兼容性检测')
      } catch (error) {
        record.pathValid = false
        log(record, error.code || 'inspect_failed', '路径失效或无法读取，请重新定位')
        throw error
      }
      return view(record)
    })
  }
  async function configure(id, config) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('session_active', '会话尚未恢复，不能修改配置')
      const components = config?.components
      if (
        !Array.isArray(components) ||
        components.some((id) => !['sr', 'nr', 'feeder', 'mfg40', 'sm86'].includes(id))
      )
        fail('invalid_components', '组件选择不合法')
      if (!DLSS_RENDER_APIS.includes(config.api || '')) fail('invalid_api', '渲染 API 选择不合法')
      if (!['auto', 'native', 'feeder'].includes(config.route || 'auto'))
        fail('invalid_route', '组件路线不合法')
      if (!['auto', 'signed', 'community'].includes(config.runtimeVariant || 'auto'))
        fail('invalid_runtime', '运行库类型不合法')
      if (
        !['files', 'isolated'].includes(config.installMode || record.config.installMode || 'files')
      )
        fail('invalid_install_mode', '安装方式不合法')
      record.config = {
        components: [...new Set(components)],
        api: config.api || '',
        route: config.route || 'auto',
        runtimeVariant: config.runtimeVariant || 'auto',
        installMode: config.installMode || record.config.installMode || 'files'
      }
      log(record, 'configured', '已保存组件方案；未写入游戏目录')
      return view(record)
    })
  }
  async function prepare(id, sourceRoot) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('session_active', '请先结束会话并恢复')
      const ids = buildDlssPlan(record, catalog, hardware).components
      const controller = new AbortController()
      preparing.set(id, {
        controller,
        progress: {
          phase: sourceRoot ? 'importing' : 'downloading',
          component: '',
          received: 0,
          total: 0
        }
      })
      try {
        await withDeploymentScopeMutationLocks(
          [{ gameId: 1, source: 'dlss', deployDomain: 'asset-cache' }],
          () =>
            sourceRoot
              ? assets.prepare(ids, sourceRoot, { signal: controller.signal })
              : assets.download(ids, {
                  signal: controller.signal,
                  onProgress: (progress) => preparing.set(id, { controller, progress })
                })
        )
        await refreshAssets()
        record.versions = Object.fromEntries(
          catalog.filter((c) => ids.includes(c.id)).map((c) => [c.id, c.version])
        )
        const remaining = buildDlssPlan(record, catalog, hardware).missing
        log(
          record,
          remaining.length ? 'partially_prepared' : 'prepared',
          remaining.length
            ? `已缓存可用组件，仍缺少 ${remaining.map((id) => catalog.find((c) => c.id === id)?.name || id).join('、')}；可继续自动准备或导入对应发布包`
            : '所选组件已准备并通过 SHA-256 校验；未部署到游戏目录'
        )
      } catch (error) {
        await refreshAssets()
        if (controller.signal.aborted) {
          log(record, 'component_cancelled', '已取消组件准备，已验证的缓存保留')
          fail('component_cancelled', '已取消组件准备，已验证的缓存保留')
        }
        log(
          record,
          error.code || 'prepare_failed',
          '组件准备失败，请检查来源版本、网络、权限和剩余空间'
        )
        throw error
      } finally {
        preparing.delete(id)
      }
      return view(record)
    })
  }
  function cancelPrepare(id) {
    const task = preparing.get(id)
    if (task) task.controller.abort()
    return { cancelled: !!task }
  }
  async function refreshPlan(record) {
    const detected = await inspect(record)
    if (detected.fingerprint.sha256 !== record.inspection.fingerprint.sha256)
      fail('game_changed', '游戏 EXE 已变化，请重新检测后确认方案')
    record.inspection = detected
    save(record)
    await refreshAssets()
    const plan = buildDlssPlan(record, catalog, hardware)
    return plan
  }
  function checkDirectoryOwner(record) {
    if (
      repository
        .list()
        .some(
          (other) =>
            other.id !== record.id &&
            other.sessions?.some(
              (s) =>
                activeStates.includes(s.state) &&
                s.mode === 'files' &&
                pathKey(s.deploymentRoot) === pathKey(path.dirname(record.exePath))
            )
        )
    )
      fail('directory_managed', '此 EXE 目录已有其他绑定管理的安装，请先在原绑定中卸载')
  }
  function requirePlan(plan) {
    if (!plan.canDeploy)
      fail(
        'route_unavailable',
        [...plan.reasons, ...(plan.missing.length ? ['所需组件尚未准备或校验失败'] : [])].join('；')
      )
  }
  async function preview(id) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('session_active', '请先退出游戏并恢复旧会话或已安装组件')
      const plan = await refreshPlan(record)
      if (plan.installMode !== 'files') fail('invalid_install_mode', '请先保存文件安装方案')
      requirePlan(plan)
      checkDirectoryOwner(record)
      if ((await processes(record)).length) fail('game_running', '请先退出游戏再安装组件')
      return (await prepareFileInstall(record, plan, assets)).public
    })
  }
  async function stage(record, launchOptions = null) {
    const plan = await refreshPlan(record)
    const directoryInstall = plan.installMode === 'files'
    if (directoryInstall) launchOptions ||= {}
    if (
      launchOptions &&
      !plan.consentCodes.every((code) => launchOptions.acceptedRisks?.includes(code))
    )
      fail('launch_confirmation_required', '重新检测发现需要确认的安装条件，请重新查看清单')
    if (!plan.canDeploy)
      fail(
        'route_unavailable',
        [...plan.reasons, ...(plan.missing.length ? ['所需组件尚未准备或校验失败'] : [])].join('；')
      )
    if ((await processes(record)).length)
      fail('game_running', '目标游戏或同名未知进程正在运行，请先退出')
    let prepared
    if (directoryInstall) {
      checkDirectoryOwner(record)
      prepared = await prepareFileInstall(record, plan, assets)
      if (launchOptions.previewToken !== prepared.token)
        fail('preview_changed', '方案或目标文件已变化，请重新查看安装清单')
    }
    record.versions = Object.fromEntries(
      catalog.filter((c) => plan.components.includes(c.id)).map((c) => [c.id, c.version])
    )
    const files = prepared?.files || (await assets.files(plan.components))
    const session = {
      id: randomUUID(),
      state: 'deploying',
      createdAt: now(),
      pids: [],
      effect: 'unverified',
      loadedComponents: [],
      versions: record.versions,
      api: plan.api,
      backend: plan.backend,
      route: plan.route,
      mode: directoryInstall ? 'files' : 'isolated',
      ...(directoryInstall ? { deploymentRoot: prepared.root } : {}),
      journal: { files: [], directories: [], state: 'deploying' }
    }
    record.sessions.push(session)
    save(record)
    const folders = await checkedPaths(record, session)
    if (!directoryInstall)
      files.push(
        ...sessionConfiguration({
          feeder: plan.backend === 'feeder',
          api: plan.api,
          profile: record.profile
        })
      )
    try {
      await deployFiles({
        ...folders,
        files,
        journal: session.journal,
        persist: () => save(record)
      })
      session.state = directoryInstall ? 'installed' : 'deployed'
      log(
        record,
        session.state,
        directoryInstall
          ? '组件已安装到实际 EXE 目录，请自行从 Steam、快捷方式或游戏启动器启动；关闭 Vertex 不会卸载'
          : '配置已部署到独立会话目录，游戏目录保持不变'
      )
    } catch (error) {
      session.state = session.journal.state === 'restored' ? 'restored' : 'restore-failed'
      log(record, error.code || 'deploy_failed', '会话部署失败，已尝试回滚；请查看恢复状态')
      throw error
    }
    return session
  }
  async function apply(id, options) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('session_active', '存在尚未恢复的会话')
      await stage(record, options)
      return view(record)
    })
  }
  async function launch(id, options = {}) {
    return exclusive(id, async () => {
      const record = need(id)
      if ((record.config.installMode || 'files') === 'files')
        fail('manual_launch', '当前为文件安装模式，安装完成后请自行启动游戏')
      const preliminary = buildDlssPlan(record, catalog, hardware)
      if (
        preliminary.consentCodes.length &&
        !preliminary.consentCodes.every((code) => options.acceptedRisks?.includes(code))
      )
        fail('launch_confirmation_required', '请确认当前方案的风险提示后再增强启动')
      let session = active(record)
      if (session && session.state !== 'deployed')
        fail('session_active', '此绑定已有进行中或等待恢复的会话')
      if (session) {
        // Re-stage so files/config, conflict scan and game fingerprints are checked again.
        const restored = await restoreSession(record, session)
        if (!restored.restored) fail('restore_conflict', '先前部署发生变化，请先处理恢复冲突')
      }
      session = await stage(record, options)
      session.state = 'starting'
      session.startedAt = now()
      save(record)
      try {
        const result = await spawn(
          record,
          buildSessionEnvironment(
            process.env,
            paths(record, session).root,
            session.backend === 'feeder',
            session.api
          ),
          {
            directory: paths(record, session).root,
            route: session.route,
            onPrepared: (pid) => {
              session.pids = [pid]
              save(record)
            }
          }
        )
        session.pids = [result.pid]
        log(record, 'starting', '已请求增强启动，等待实际渲染进程加载证据')
      } catch (error) {
        session.state = 'pending-restore'
        log(record, error.code || 'launch_failed', '启动失败，正在恢复会话文件')
        await restoreSession(record, session)
        throw error
      }
      return view(record)
    })
  }
  async function restoreSession(record, session) {
    const running = await processes(record, session)
    if (running.length) {
      session.state = 'pending-restore'
      save(record)
      fail('game_running', '检测到目标游戏或关联进程，退出并解锁后再恢复')
    }
    const folders = await checkedPaths(record, session)
    for (const file of session.journal.files) {
      if (
        file.kind !== 'config' ||
        (file.beforeHash && session.mode !== 'files') ||
        !['ReShade.ini', 'VertexPreset.ini', 'dlss5-feed.cfg'].includes(file.path)
      )
        continue
      const target = await safeJoin(folders.root, file.path)
      try {
        const stat = await fs.stat(target)
        if (stat.size > 1024 * 1024) continue
        const current = await hashFile(target)
        if (current !== file.sha256) {
          record.profile ||= {}
          record.profile[file.path] = await fs.readFile(target, 'utf8')
          if (session.mode === 'files') {
            await fs.mkdir(folders.backupRoot, { recursive: true })
            const edited = await safeJoin(folders.backupRoot, `edited-${file.path}`)
            await atomicWrite(edited, record.profile[file.path])
            if ((await hashFile(edited)) !== current)
              fail('backup_failed', '调整后的配置备份校验失败，保留原文件')
            file.editedBackup = `edited-${file.path}`
            file.restoreHash = current
          } else file.state = 'preserved-config'
          file.preservedHash = current
          save(record)
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    const result = await restoreFiles({
      ...folders,
      journal: session.journal,
      persist: () => save(record)
    })
    session.state = result.restored ? 'restored' : 'restore-failed'
    log(
      record,
      session.state,
      result.restored
        ? '组件已恢复；调整后的配置与恢复记录已保留'
        : '部分文件被修改或无法恢复，已保留文件和备份'
    )
    return result
  }
  async function restore(id) {
    return exclusive(id, async () => {
      const record = need(id)
      const session = active(record)
      if (session) await restoreSession(record, session)
      return view(record)
    })
  }
  async function unbind(id) {
    return exclusive(id, async () => {
      const record = need(id)
      if (active(record)) fail('restore_required', '解绑前必须恢复所有会话，不能丢弃部署清单')
      repository.remove(id)
      return { removed: true }
    })
  }
  async function tick() {
    if (ticking) return
    ticking = true
    try {
      for (const stored of repository.list()) {
        const s = active(stored)
        if (
          !s ||
          busy.has(stored.id) ||
          ['installed', 'deployed', 'restore-failed'].includes(s.state)
        )
          continue
        await exclusive(stored.id, async () => {
          const record = need(stored.id),
            session = active(record)
          try {
            if (session.mode === 'files') {
              await restoreSession(record, session)
              return
            }
            const rows = await processes(record, session)
            const folder = paths(record, session).root
            const enhanced = rows.filter((row) => row.modules?.some((m) => isInside(folder, m)))
            if (enhanced.length) {
              session.state = 'running'
              session.pids = [...new Set([...session.pids, ...rows.map((row) => row.pid)])]
              session.loadedComponents = [
                ...new Set(
                  enhanced.flatMap((row) =>
                    row.modules.filter((m) => isInside(folder, m)).map((m) => path.basename(m))
                  )
                )
              ]
              session.effect = 'unverified'
              save(record)
            } else if (
              !rows.length &&
              (!session.startedAt ||
                session.loadedComponents.length ||
                now() - session.startedAt > 30000)
            ) {
              session.state = 'pending-restore'
              save(record)
              await restoreSession(record, session)
            } else if (session.state === 'running') {
              session.state = 'pending-restore'
              log(
                record,
                'processes_remaining',
                '暂未观察到增强模块，仍有目标或关联进程运行；保留会话等待退出后恢复'
              )
            } else if (now() - session.startedAt > 30000 && session.state === 'starting') {
              session.state = 'pending-restore'
              log(
                record,
                'loading_unverified',
                '未观察到会话组件加载，可能发生启动器转交或渲染 API 不匹配；请退出游戏后恢复'
              )
            }
          } catch (error) {
            session.state = 'pending-restore'
            if (session.lastError !== error.code) {
              session.lastError = error.code || 'process_inspection_failed'
              log(record, session.lastError, '无法确认进程与文件占用，保留会话等待安全恢复')
            }
          }
        })
      }
    } finally {
      ticking = false
    }
  }
  async function initialize({ monitor = true } = {}) {
    await fs.mkdir(root, { recursive: true })
    await refreshAssets()
    for (const record of repository.list()) {
      try {
        await fs.access(record.exePath)
        record.pathValid = true
      } catch {
        record.pathValid = false
      }
      save(record)
      const session = active(record)
      if (
        session &&
        session.state !== 'restore-failed' &&
        !(session.mode === 'files' && session.state === 'installed')
      ) {
        session.state = 'pending-restore'
        log(record, 'restart_recovery', '发现上次未完成会话，将核实进程后恢复')
      }
    }
    if (monitor) {
      timer = setInterval(() => {
        tick().catch(() => {})
      }, 3000)
      timer.unref?.()
      await tick()
    }
  }
  async function diagnostics(id) {
    const record = need(id)
    const session = record.sessions.at(-1)
    let lines = []
    if (session) {
      try {
        const folders = await checkedPaths(record, session)
        const handle = await fs.open(await safeJoin(folders.root, 'ReShade.log'), 'r')
        try {
          const stat = await handle.stat()
          const buffer = Buffer.alloc(Math.min(stat.size, 32768))
          await handle.read(buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length))
          lines = buffer
            .toString('utf8')
            .split('\n')
            .filter((line) => /Registered add-on|ERROR|WARN|Unregistered add-on/.test(line))
            .slice(-50)
        } finally {
          await handle.close()
        }
      } catch (error) {
        if (error.code !== 'ENOENT') lines = ['运行日志暂不可读取']
      }
    }
    const redact = (line) =>
      line
        .replace(/[A-Za-z]:[\\/][^\r\n'"<>|]*/g, '[本地路径]')
        .replace(/(?:token|password|secret|key)\s*[=:]\s*\S+/gi, '[敏感值已隐藏]')
    return {
      logs: record.logs,
      runtime: lines.map(redact),
      effect: 'unverified',
      loadedComponents: session?.loadedComponents || []
    }
  }
  return {
    initialize,
    dispose: () => clearInterval(timer),
    inspect,
    bind,
    resolve,
    redetect,
    configure,
    prepare,
    preview,
    cancelPrepare,
    apply,
    launch,
    restore,
    unbind,
    tick,
    diagnostics,
    list: () => repository.list().map(view),
    get: (id) => view(need(id)),
    catalog: () => catalog
  }
}
