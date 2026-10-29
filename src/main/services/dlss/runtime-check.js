import fs from 'node:fs'
import path from 'node:path'
import pe from './swapper/pe.js'
import { safePath } from './swapper/file-journal.js'
import {
  readTechnicalLog,
  logTime,
  apiFromRuntimeLog,
  apiFromFeederLog,
  apiSummary,
  reShadeSession,
  feederSession
} from './renderer-evidence.js'
import { getIni } from './swapper/feeder-config.js'
import { snapshotGameProcesses } from './processes.js'
import trustedFeeder from './swapper/feeder-release.js'
import { hashFile } from './files.js'
import { consumerVersion } from '../../../shared/dlss-swapper/consumer-versions.js'

const key = (file) => path.resolve(file).toLowerCase()
const binary = /\.(?:dll|addon(?:32|64)?|exe)$/i
const stamp = (file) => {
  const s = fs.statSync(file)
  return { size: s.size, modifiedAt: s.mtimeMs, changedAt: s.ctimeMs }
}
function readInstallation(root) {
  const file = safePath(root, '_DLSS5_Backup/manifest.json')
  if (!fs.existsSync(file)) return null
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('manifest_too_large')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (
    manifest.version !== 1 ||
    !manifest.game?.exe ||
    !Number.isFinite(Date.parse(manifest.date)) ||
    !Array.isArray(manifest.added) ||
    !Array.isArray(manifest.replaced)
  )
    throw new Error('invalid_manifest')
  const exe = safePath(root, manifest.game.exe)
  const history = [...new Set([...manifest.added, ...manifest.replaced.map((x) => x.rel)])]
  if (history.length > 4000) throw new Error('manifest_too_large')
  for (const rel of history) safePath(root, rel)
  let files = history
  if (manifest.deployedFiles != null) {
    if (
      !Array.isArray(manifest.deployedFiles) ||
      !manifest.deployedFiles.length ||
      manifest.deployedFiles.length > 4000
    )
      throw new Error('invalid_deployment_inventory')
    files = [...new Set(manifest.deployedFiles)]
    for (const rel of files) {
      safePath(root, rel)
      if (!history.includes(rel)) throw new Error('invalid_deployment_inventory')
    }
  } else {
    // Old manifests have no current inventory. Only infer a retired app-added
    // alternate proxy when the recorded active hook/API unambiguously differs.
    // Never discard the restore ledger or waive a missing active loader.
    const activeHook = manifest.reshade?.file?.toLowerCase()
    const obsoleteHook =
      manifest.game.api === 'dxgi' && activeHook === 'dxgi.dll'
        ? 'opengl32.dll'
        : manifest.game.api === 'opengl' && activeHook === 'opengl32.dll'
          ? 'dxgi.dll'
          : null
    if (obsoleteHook && manifest.route !== 'optiscaler') {
      files = history.filter(
        (rel) =>
          !(
            manifest.added.includes(rel) &&
            key(safePath(root, rel)) === key(path.join(path.dirname(exe), obsoleteHook))
          )
      )
    }
  }
  return { manifest, exe, files }
}

export function captureInstallation(root) {
  const install = readInstallation(root)
  if (!install) return null
  return {
    date: install.manifest.date,
    files: Object.fromEntries(
      [install.manifest.game.exe, ...install.files.filter((x) => binary.test(x))].map((rel) => [
        rel,
        stamp(safePath(root, rel))
      ])
    )
  }
}

export function initialRuntimeStatus(installed) {
  return {
    code: installed ? 'unverified' : 'not_installed',
    title: installed ? '文件已安装，生效尚未验证' : '尚未安装',
    message: installed ? '从原入口启动游戏后，点击检查生效。' : '安装组件后，从原入口启动游戏。',
    stages: ['文件安装', '加载器', '插件', '神经渲染', '画面交付'].map((label, i) => ({
      label,
      state: i === 0 && installed ? 'recorded' : 'unknown'
    }))
  }
}

// A last-write timestamp is not a session timestamp: an appended old success
// must never certify a new launch. Require a new, dated ReShade session header.
export function currentReShadeSession(log, startedAt, exe, bitness, now = Date.now()) {
  if (!log?.text || log.error || log.modifiedAt < startedAt) return ''
  return reShadeSession(log, { exe, bitness, startedAt, since: startedAt - 2000, now })?.text || ''
}

export async function checkRuntime(
  { gameRoot, baseline, exePath },
  { processes = snapshotGameProcesses, now = Date.now(), feederRelease = trustedFeeder } = {}
) {
  const result = initialRuntimeStatus(false)
  result.checkedAt = new Date(now).toISOString()
  const done = (code, title, message) => ({ ...result, code, title, message })
  let install
  try {
    install = readInstallation(gameRoot)
  } catch {
    return done(
      'invalid_manifest',
      '安装记录无法校验',
      '安装记录损坏或包含无效路径；未修改任何文件。'
    )
  }
  if (!install)
    return done('not_installed', '尚未安装', '没有活动安装记录；历史还原记录不代表当前已安装。')
  const { manifest, exe, files } = install
  if (exePath && key(exePath) !== key(exe))
    return done('different_target', '所选程序未安装', '请选择已安装 DLSS5 的程序后检查。')
  const exeDir = path.dirname(exe)
  if (manifest.game.dir && key(manifest.game.dir) !== key(gameRoot))
    return done(
      'moved_installation',
      '安装记录属于原目录',
      '游戏位置已变化，需要重新核对安装位置；未按旧路径操作。'
    )
  let bitness
  try {
    bitness = pe.getBitness(exe)
    if (!bitness)
      return done(
        'target_unreadable',
        '无法确认游戏程序',
        '游戏程序不存在、受保护或无法读取；这不代表游戏不支持。'
      )
    const missing = []
    for (const rel of files) {
      try {
        if (!fs.statSync(safePath(gameRoot, rel)).isFile()) throw new Error('not_a_file')
      } catch (error) {
        if (error.code === 'ENOENT') missing.push(rel)
        else throw error
      }
    }
    if (missing.length)
      return done(
        'missing_files',
        '安装文件不完整',
        `缺少 ${missing.length} 个已部署文件，请退出游戏后还原并重新安装。`
      )
    if (baseline?.date === manifest.date) {
      const changed = Object.entries(baseline.files).some(([rel, old]) => {
        const value = stamp(safePath(gameRoot, rel))
        return (
          value.size !== old.size ||
          value.modifiedAt !== old.modifiedAt ||
          (old.changedAt != null && value.changedAt !== old.changedAt)
        )
      })
      if (changed)
        return done(
          'files_changed',
          '程序或组件已变化',
          '游戏更新或文件替换使上次安装验证失效，请重新核对安装。'
        )
    }
    for (const rel of files.filter((rel) => binary.test(rel))) {
      const bits = pe.getBitness(safePath(gameRoot, rel))
      if (!bits)
        return done(
          'files_unreadable',
          '组件文件无法校验',
          '组件可能损坏或无法读取，请核对文件后重试。'
        )
      const expected = /(?:^|[\\/])(?:host64|x64)(?:[\\/])|addon64$/i.test(rel)
        ? 64
        : /(?:^|[\\/])x86(?:[\\/])|addon32$/i.test(rel)
          ? 32
          : bitness
      if (bits && bits !== expected && !/reshade(?:32|64)\.dll$/i.test(rel))
        return done(
          'architecture_mismatch',
          '组件位数不匹配',
          '当前程序和部署组件的 32/64 位不一致，请退出游戏后重新安装。'
        )
    }
  } catch {
    return done(
      'files_unreadable',
      '无法读取安装文件',
      '文件权限或占用阻止了检查，尚不能判断兼容性。'
    )
  }
  result.stages[0].state = 'verified'
  result.environment = {
    api: manifest.game.api,
    configuredApiLabel: manifest.game.apiLabel || null,
    bitness,
    route: manifest.route,
    feederVersion: manifest.feeder?.version || null
  }
  if (manifest.route === 'feeder' && manifest.feeder?.version === feederRelease.version) {
    const pair = [
      `dlss5-feed.addon${bitness}`,
      ...(bitness === 32 ? ['host64/dlss5-feed-host64.exe'] : [])
    ]
    for (const name of pair) {
      try {
        const file = safePath(gameRoot, path.relative(gameRoot, path.join(exeDir, name)))
        if ((await hashFile(file)) !== feederRelease.hashes[path.basename(name)])
          return done(
            'component_version_mismatch',
            'Feeder 组件版本不一致',
            '插件或辅助程序与安装记录的版本不匹配，请使用同一版本的一套组件。'
          )
      } catch {
        return done(
          'missing_files',
          'Feeder 组件无法读取',
          '请核对插件及辅助程序是否完整，退出游戏后重新安装。'
        )
      }
    }
    result.environment.feederVerified = true
  }
  const recordedConsumer = manifest.components?.consumer
  if (recordedConsumer) {
    const trusted = consumerVersion(recordedConsumer.version)
    const target = path.join(exeDir, bitness === 32 ? 'host64' : '', 'renodx-dlss5.addon64')
    const actualHash = await hashFile(safePath(gameRoot, path.relative(gameRoot, target))).catch(
      () => null
    )
    if (!trusted || recordedConsumer.sha256 !== trusted.sha256 || actualHash !== trusted.sha256)
      return done(
        'consumer_changed',
        '神经渲染插件版本已变化',
        '文件与安装记录不一致，请重新安装所选版本后再检查。'
      )
    result.environment.consumerVersion = trusted.version
  }
  // Independent of the route's name, two neural consumers cannot own the same
  // frame. Read filenames only; do not execute an arbitrary helper from a game.
  const consumerDir = bitness === 32 ? path.join(exeDir, 'host64') : exeDir
  try {
    const names = fs.readdirSync(consumerDir)
    const consumers = names.filter((name) =>
      /^(?:renodx-dlss.*|deep-fried-chicken)\.addon64$/i.test(name)
    )
    if (consumers.length > 1)
      return done(
        'consumer_conflict',
        '发现多个神经渲染插件',
        '多个消费者可能互相冲突，请只保留当前安装方式需要的一套。'
      )
  } catch {
    /* Missing required host files are caught by the installation inventory. */
  }
  let rows
  try {
    rows = await processes(gameRoot, exe)
  } catch {
    return done(
      'process_unavailable',
      '无法读取运行状态',
      '进程检查失败或权限不足；文件检查已完成，生效状态仍待确认。'
    )
  }
  const running = rows.filter((row) => row.exe && key(row.exe) === key(exe))
  if (!running.length) {
    const other = rows.find((row) => row.exe && !/dlss5-feed-host64\.exe$/i.test(row.exe))
    if (other)
      return done(
        'different_executable',
        '启动程序与安装目标不同',
        '游戏目录中有其他程序正在运行，请核对上方可执行文件；不会自动迁移组件。'
      )
    if (rows.some((row) => !row.readable))
      return done(
        'process_unavailable',
        '运行状态无法确认',
        '存在无法读取路径的同名进程，请检查权限后重试。'
      )
    return done(
      'not_running',
      '文件已安装，等待启动游戏',
      '请从原入口启动游戏，进入画面后再次检查。'
    )
  }
  if (running.length !== 1)
    return done(
      'multiple_instances',
      '游戏运行了多个实例',
      '暂时无法把日志对应到唯一实例，请保留一个游戏窗口后重试。'
    )
  const process = running[0]
  const gameStartedAt = Date.parse(process.startedAt)
  if (gameStartedAt < Date.parse(manifest.date))
    return done(
      'restart_required',
      '安装后需要重新启动游戏',
      '当前游戏进程早于这次安装，辅助进程重新启动不能证明游戏已使用新组件。'
    )
  if (!process.readable)
    return done(
      'process_unavailable',
      '无法读取游戏模块',
      '游戏已启动，但模块读取权限不足；这不代表加载失败。'
    )
  const loaded = new Set((process.modules || []).map(key))
  const route = manifest.route || 'native'
  const hook =
    route === 'optiscaler'
      ? manifest.optiscaler?.hook
      : manifest.reshade?.file || (manifest.game.api === 'opengl' ? 'opengl32.dll' : 'dxgi.dll')
  const layerLoaded =
    manifest.game.api === 'vulkan' &&
    [...loaded].some((file) => /[\\/]reshade(?:32|64)\.dll$/i.test(file))
  if (!layerLoaded && (!hook || !loaded.has(key(path.join(exeDir, hook)))))
    return done(
      'loader_missing',
      '游戏已启动，加载器未加载',
      '请核对实际渲染 API、目标 EXE 和已有加载器；复制文件成功不代表加载成功。'
    )
  result.stages[1].state = 'verified'
  if (route === 'feeder' && !loaded.has(key(path.join(exeDir, `dlss5-feed.addon${bitness}`))))
    return done(
      'plugin_missing',
      'ReShade 已加载，Feeder 未加载',
      '请确认 ReShade 支持插件且未禁用 Feeder，再重新启动游戏。'
    )
  const host =
    bitness === 32
      ? rows.find(
          (row) => row.exe && key(row.exe) === key(path.join(consumerDir, 'dlss5-feed-host64.exe'))
        )
      : process
  if (bitness === 32 && (!host || !host.readable))
    return done(
      'helper_missing',
      '32 位辅助进程尚未就绪',
      '请进入游戏画面后重试；需要同版本的 32 位插件和 64 位辅助组件。'
    )
  const hostModules = host?.modules || []
  const hasConsumer =
    route === 'optiscaler' ||
    hostModules.some(
      (file) =>
        key(path.dirname(file)) === key(consumerDir) &&
        /(?:renodx-dlss.*|deep-fried-chicken)\.addon64$/i.test(file)
    )
  if (!hasConsumer)
    return done(
      'consumer_missing',
      '加载器已加载，神经渲染插件未加载',
      '检查所选安装方式的插件是否启用，以及是否存在其他消费者冲突。'
    )
  result.stages[2].state = 'verified'
  const startedAt = Date.parse(host.startedAt)
  if (startedAt < Date.parse(manifest.date))
    return done(
      'restart_required',
      '安装后需要重新启动游戏',
      '当前进程早于这次安装，不能作为当前组件的生效证据。'
    )
  const since = Math.max(Date.parse(manifest.date), gameStartedAt)
  if (!Number.isFinite(since) || !Number.isFinite(startedAt))
    return done(
      'session_unknown',
      '插件已加载，启动时间无法确认',
      '不能将已有日志当作本次启动的生效证据。'
    )
  const logs = []
  for (const dir of [...new Set([exeDir, consumerDir])]) {
    let names = []
    try {
      names = fs
        .readdirSync(dir)
        .filter((name) => /^ReShade\d*\.log$/i.test(name))
        .slice(0, 8)
    } catch {
      /* no logs */
    }
    for (const name of names)
      logs.push(
        readTechnicalLog(gameRoot, path.relative(gameRoot, path.join(dir, name)), { since, now })
      )
  }
  const sessions = logs
    .map((log) =>
      currentReShadeSession(log, startedAt, host.exe, bitness === 32 ? 64 : bitness, now)
    )
    .filter(Boolean)
  const text = sessions.join('\n')
  const gameSessions =
    bitness === 64
      ? sessions
      : logs
          .map((log) => currentReShadeSession(log, gameStartedAt, exe, bitness, now))
          .filter(Boolean)
  const feedLog =
    route === 'feeder'
      ? readTechnicalLog(gameRoot, path.relative(gameRoot, path.join(exeDir, 'dlss5-feed.log')), {
          since,
          now
        })
      : null
  const feedText = feederSession(feedLog, exe, gameStartedAt, manifest.feeder?.version, now)
  const observedApi = apiSummary([
    ...gameSessions.flatMap((session) => apiFromRuntimeLog(session)?.candidates || []),
    ...(apiFromFeederLog(feedText)?.candidates || [])
  ])
  result.environment.observedApiLabel = observedApi?.label || null
  if (observedApi && !observedApi.api)
    return done(
      'multiple_renderers',
      '发现多个渲染上下文',
      '当前日志无法确认哪一个上下文负责游戏画面，暂不标记生效。'
    )
  const api = observedApi?.api
  const presentationApi =
    route === 'feeder' &&
    ['d3d9', 'd3d8', 'ddraw'].includes(manifest.game.api) &&
    hook === 'dxgi.dll'
      ? 'dxgi'
      : manifest.game.api
  if (api && api !== presentationApi)
    return done(
      'api_mismatch',
      '实际渲染 API 与安装配置不同',
      '请退出游戏后选择实际使用的 API，再切换 DLSS5。'
    )
  const lastSuccess = (value) =>
    [...value.matchAll(/inline feature 18 evaluation succeeded/gi)].at(-1)?.index ?? -1
  const success = lastSuccess(text)
  // A success in another runtime/log cannot cancel this runtime's later fault.
  if (
    sessions.some((session) =>
      [
        ...session.matchAll(
          /(?:feature 18|neural|NGX|DLSS).{0,100}(?:failed|fault|error 0x)|(?:failed|fault).{0,80}(?:feature 18|neural|NGX)/gi
        )
      ].some((match) => match.index > lastSuccess(session))
    )
  )
    return done(
      'runtime_failed',
      '插件已加载，神经渲染执行失败',
      '本次启动记录了运行库错误，需要核对插件、运行库和显卡驱动组合。'
    )
  // RenoDX can bypass NR after its first successful frame without logging a
  // failed evaluate. That fallback invalidates the earlier success evidence.
  if (
    sessions.some((session) => {
      const exhausted = [...session.matchAll(/NR workset pool exhausted/gi)].at(-1)?.index ?? -1
      return exhausted >= 0 && exhausted > lastSuccess(session)
    })
  )
    return done(
      'resource_pool_exhausted',
      '神经渲染资源池异常',
      '本次运行出现资源池耗尽，插件回退到游戏原画面；早先成功不能证明当前正常。需检查消费者的资源回收和互操作路径，不能直接归因为显存不足。'
    )
  if (route === 'feeder') {
    // Saved values describe configuration, not proof of the live chain's state.
    const readConfig = (name) => {
      try {
        const file = safePath(gameRoot, path.relative(gameRoot, path.join(exeDir, name)))
        return fs.statSync(file).size <= 256 * 1024 ? fs.readFileSync(file, 'utf8') : ''
      } catch {
        return ''
      }
    }
    const cfg = readConfig('dlss5-feed.cfg')
    const savedEnabled = getIni(cfg, '', 'enabled')
    const savedMode = getIni(cfg, '', 'mode')
    const configLine =
      [...feedText.matchAll(/^.*\[feed\] config: enabled=\d+.*$/gm)].at(-1)?.[0] || ''
    const enabled = configLine.match(/\benabled=(\d+)/)?.[1]
    const mode = configLine.match(/\bmode=(\d+)/)?.[1]
    result.controls = {
      savedEnabled,
      savedMode,
      loggedEnabled: enabled || null,
      loggedMode: mode || null
    }
    if (
      savedEnabled === '0' ||
      (savedMode != null && savedMode !== '2') ||
      enabled === '0' ||
      (mode != null && mode !== '2')
    )
      return done(
        'configuration_unverified',
        'Feeder 未配置为完整神经链路',
        '保存的 enabled/mode 或本次日志处于禁用、空闲或仅传输模式。效果勾选与插件开关不同；核对保存值及运行状态，必要时重启后检查。'
      )
  }
  if (success >= 0) result.stages[3].state = 'verified'
  if (success >= 0 && route === 'feeder') {
    const deliveries = [...feedText.matchAll(/^.*\bframe ([1-9]\d*) delivered.*$/gim)].map(
      (match) => ({ frame: Number(match[1]), time: logTime(match[0], now), index: match.index })
    )
    const last = deliveries.at(-1),
      previous = deliveries.at(-2)
    const stopped =
      [
        ...feedText.matchAll(
          /shutting the session down|\(0 runtimes left\)|failure:|\bdisabled\b/gi
        )
      ].at(-1)?.index ?? -1
    if (
      !last ||
      !previous ||
      last.frame <= previous.frame ||
      last.time <= previous.time ||
      now - last.time > 30000 ||
      last.time > now + 2000 ||
      !Number.isFinite(last.time) ||
      !Number.isFinite(previous.time) ||
      stopped > last.index
    )
      return done(
        'output_unverified',
        '神经渲染已执行，画面输出尚未确认',
        '已找到本次神经渲染成功记录，但缺少近期连续交付画面的证据。请在动态场景重查；早先单帧成功不代表持续输出。'
      )
    result.stages[4].state = 'verified'
  }
  if (success >= 0) {
    result.stages[3].state = 'verified'
    return done(
      'evaluating',
      '已确认神经渲染执行',
      `本次游戏进程已加载组件，日志记录了神经渲染成功${route === 'feeder' ? '与近期连续画面交付' : ''}；实际效果仍需游戏内对比。${observedApi?.label ? `游戏呈现：${observedApi.label}。` : ''}${api === 'dxgi' && manifest.game.apiLabel && observedApi?.label !== manifest.game.apiLabel ? 'DX11/DX12 共用 DXGI 加载入口，手动部署选择不改变实际 API。' : ''}`
    )
  }
  if (route === 'native') {
    const hasSyntheticInput = [...loaded].some((file) =>
      /[\\/]dlss5-feed\.addon(?:32|64)$/i.test(file)
    )
    const hasInput =
      !hasSyntheticInput && /feature 18 created .*after DLSS\/DLAA for NR input/i.test(text)
    result.nativeInput = hasInput ? 'observed' : 'unverified'
    return done(
      hasInput ? 'native_effect_unverified' : 'waiting_native_input',
      hasInput ? '已检测到 DLSS 输入，神经渲染尚未确认' : '插件已加载，等待原生 DLSS 输入',
      hasInput
        ? '本次会话已有游戏 DLSS 输入，但尚未找到成功的神经渲染记录，请检查插件状态。'
        : '尚未确认本次游戏的原生 DLSS 输入。请在游戏图形设置中开启 NVIDIA DLSS，并进入实际游戏画面后重查；无需为此强制开启帧生成。'
    )
  }
  return done(
    'evaluation_unverified',
    '插件已加载，神经渲染尚未确认',
    '未找到本次启动的成功执行记录，请确认深度、运动向量及效果开关；缺少日志不等于不支持。'
  )
}
