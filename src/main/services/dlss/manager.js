import { deploymentRevision } from '../../../shared/dlss-swapper/deployment-version.js'
import {
  validReShadeProxy,
  effectiveReShadeProxy
} from '../../../shared/dlss-swapper/reshade-proxy.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonical, fail, pathKey } from './files.js'
import { inferGameRoot } from './inspect.js'
import { scanGame, inspectReShade, selectPrimaryDlss } from './swapper/scan.js'
import { HistoryStore } from './swapper/history.js'
import { steam } from './swapper/library.js'
import { discoverLocalGames } from '../localGameLibrary.js'
import { look, artworkIsFresh } from './swapper/steamart.js'
import compatibility from './swapper/compatibility.js'
import journal from './swapper/file-journal.js'
import diagnostics from './swapper/diagnostics.js'
import optiscaler from './swapper/optiscaler.js'
import featureI18n from '../../../shared/dlss-swapper/feature-i18n.js'
import installRoutes from '../../../shared/dlss-swapper/install-routes.js'
import renderingApi from '../../../shared/dlss-swapper/rendering-api.js'
import { createSwapperInstaller } from './swapper-install.js'
import { captureInstallation, checkRuntime, initialRuntimeStatus } from './runtime-check.js'
import { withDeploymentScopeMutationLocks } from '../../ipc/game/deploymentScopeMutationLock.js'
import { preferenceFor, deploymentChoice } from './detection/preferences.js'
import { inspectConsumer, planConsumer } from './consumer-components.js'
import { validConsumerChoice } from '../../../shared/dlss-swapper/consumer-versions.js'
import { detectRenderer } from './detect-renderer.js'
import { observeRuntime } from './detection/observe.js'
import { initialProgress, updateProgress } from './progress.js'
import {
  rememberDetection,
  rememberScanDetections,
  applyDetectionHistory
} from './detection/history.js'
import { closeDetectedGame } from './detection/close-game.js'
import { createDetectionLauncher } from './detection/launch.js'

const activeLegacy = (record) => record.sessions?.some((s) => s.state !== 'restored')
const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, 500) : '')
const webImage = (value) => (/^https?:\/\//i.test(value || '') ? value : '')

export function createDlssManager({
  repository,
  root,
  payload,
  dialog,
  shell,
  legacy,
  scan = scanGame,
  runtimeCheck = checkRuntime,
  snapshot = captureInstallation,
  observe = observeRuntime,
  launch,
  closeDetected = closeDetectedGame,
  discoverSteam = steam,
  detectionOptions = {}
}) {
  const history = new HistoryStore(path.join(root, 'history.jsonl'))
  let operation = null
  let steamGames
  const steamIdentity = (gameRoot) => {
    steamGames ||= steam()
    return steamGames.find((game) => pathKey(game.dir) === pathKey(gameRoot))
  }
  const persist = (record) => {
    record.updatedAt = new Date().toISOString()
    return repository.save(record)
  }
  const need = (id) => repository.get(id) || fail('binding_not_found', '游戏记录不存在')
  const state = (id) => {
    const record = need(id)
    return { ...record, operation: operation?.id === id ? operation : null }
  }
  const scanRecord = async (record, options) => {
    const scanned = await scan(record.gameRoot, options)
    const current = repository.get(record.id)
    const target = current || record
    if (rememberScanDetections(target, scanned) && current) persist(current)
    return applyDetectionHistory(scanned, target)
  }
  const missingPath = (error) => ['ENOENT', 'ENOTDIR'].includes(error.code)
  // 记录里登记过的游戏程序（自定义入口优先）全部不存在时返回 true；没有登记过程序时返回 false。
  async function programMissing(record) {
    const known = [record.swapperOptions?.exePath, record.exePath].filter(
      (value) => typeof value === 'string' && path.isAbsolute(value)
    )
    if (!known.length) return false
    for (const exePath of known) {
      try {
        if ((await fs.stat(exePath)).isFile()) return false
      } catch (error) {
        if (!missingPath(error)) throw error
      }
    }
    return true
  }
  async function checkLocation({ id, gameRoot }) {
    const record = id ? need(id) : null
    const target = record ? record.gameRoot : gameRoot
    if (typeof target !== 'string' || !path.isAbsolute(target)) fail('invalid_path', '游戏路径无效')
    let exists
    try {
      exists = (await fs.stat(target)).isDirectory()
    } catch (error) {
      if (missingPath(error)) return { exists: false }
      throw error
    }
    // 目录还在不代表游戏还在：卸载后常留下存档、配置等残留文件。只读检查，不改记录。
    if (exists && record && (await programMissing(record))) return { exists, programMissing: true }
    return { exists }
  }
  async function locate(context) {
    if (context.id) return need(context.id)
    const gameRoot = context.gameRoot
      ? await canonical(context.gameRoot, true)
      : await inferGameRoot(await canonical(context.exePath))
    return (
      repository.list().find((r) => pathKey(r.gameRoot) === pathKey(gameRoot)) || {
        id: randomUUID(),
        name: clean(context.name) || path.basename(gameRoot),
        gameRoot,
        coverImage: webImage(context.coverImage),
        steamAppId: clean(String(context.steamAppId || '')),
        sourcePlatform: clean(context.sourcePlatform),
        source: context.source || 'manual',
        sessions: [],
        logs: [],
        config: { components: ['nr'], installMode: 'files' },
        createdAt: new Date().toISOString()
      }
    )
  }
  async function details(context) {
    const record = await locate(context)
    const wasSaved = !!repository.get(record.id)
    const scanned = await scanRecord(record, { signal: context.signal })
    // A scan may finish after another window saves options or an installation.
    const current = repository.get(record.id)
    Object.assign(record, current || {})
    const exes = (scanned.selectableExecutables || scanned.exeCandidates).map((e) => ({
      ...e,
      recommended: scanned.selection?.path === e.path,
      manualSelection:
        record.swapperOptions?.exePath &&
        pathKey(record.swapperOptions.exePath) === pathKey(e.path),
      hasNativeDlss: installRoutes.nativeDlssPresent(scanned, e),
      installIssue: compatibility.targetIssue(record.gameRoot, e.path),
      antiCheatWarning: compatibility.hasAntiCheat(record.gameRoot, e.path),
      apiOverride: preferenceFor(record, e.path).api,
      launchProfile: preferenceFor(record, e.path).launchProfile,
      profileRoute: preferenceFor(record, e.path).route,
      consumerPreference: preferenceFor(record, e.path).consumerVersion,
      reshadeProxy: preferenceFor(record, e.path).reshadeProxy,
      profilePreferences: record.swapperOptions?.profiles?.[pathKey(e.path)] || {}
    }))
    const installedExe = scanned.install?.exe
    const selected =
      exes.find((e) => e.manualSelection) ||
      exes.find((e) => installedExe && e.rel.toLowerCase() === installedExe.toLowerCase()) ||
      (!installedExe && (!scanned.selection || scanned.selection.state === 'recommended')
        ? exes.find((e) => e.path === (scanned.selection?.path || scanned.chosen?.path))
        : null)
    if (selected) selected.consumer = await inspectConsumer(record.gameRoot, selected)
    let addon = selected?.consumer?.rel || null
    if (selected && !addon) {
      const rel = path.relative(
        record.gameRoot,
        path.join(path.dirname(selected.path), 'renodx-dlss.addon64')
      )
      if (
        await fs.stat(journal.safePath(record.gameRoot, rel)).then(
          (stat) => stat.isFile(),
          () => false
        )
      )
        addon = rel
    }
    // Status must follow the chosen executable, not the scanner's first candidate.
    let reshade = selected ? inspectReShade(path.dirname(selected.path)) : scanned.reshade
    if (
      !reshade.installed &&
      scanned.reshade.kind === 'vulkan-layer' &&
      selected &&
      installedExe &&
      pathKey(selected.path) === pathKey(path.join(record.gameRoot, installedExe))
    )
      reshade = scanned.reshade
    if (wasSaved && !repository.get(record.id)) fail('binding_not_found', '游戏记录已删除')
    if (selected && !activeLegacy(record) && !operation) {
      if (record.exePath && pathKey(record.exePath) !== pathKey(selected.path)) {
        record.previousLocations ||= []
        record.previousLocations.push({
          gameRoot: record.gameRoot,
          exePath: record.exePath,
          fingerprint: record.inspection?.fingerprint
        })
      }
      record.exePath = selected.path
      record.instanceKey = pathKey(selected.path)
      record.cwd = path.dirname(selected.path)
      record.swapperInstalled = !!scanned.install
      persist(record)
    }
    if (exes.length && !repository.get(record.id)) {
      record.instanceKey = pathKey(record.gameRoot) + '|unselected'
      persist(record)
    }
    const pending = await fs.access(journal.pendingPath(record.gameRoot)).then(
      () => true,
      () => false
    )
    return {
      record,
      runtimeStatus: initialRuntimeStatus(!!scanned.install),
      exes,
      chosen: selected || null,
      selection: scanned.selection,
      launchEntries: scanned.launchEntries || [],
      otherExecutables: scanned.otherExecutables || [],
      reason: scanned.emptyReason,
      recommendedRoute: installRoutes.recommendedRoute(
        scanned,
        selected &&
          renderingApi.effective(selected, deploymentChoice(preferenceFor(record, selected.path)))
      ),
      installedRoute: scanned.install?.route || null,
      installedExe,
      installedApi: scanned.install?.api,
      installedApiLabel: scanned.install?.apiLabel,
      installedConsumer:
        selected && installedExe && selected.rel.toLowerCase() === installedExe.toLowerCase()
          ? selected.consumer
          : null,
      installedComponents: scanned.install?.components || null,
      componentsUpdateAvailable:
        !!scanned.install && scanned.install.components?.revision !== deploymentRevision,
      installedReShadeProxy: scanned.install?.reshadeProxy || null,
      previousConsumer: scanned.install?.previousConsumer || null,
      lastRuntimeCheck: record.lastRuntimeCheck || null,
      optiscaler: scanned.install?.optiscaler,
      currentDlss: selectPrimaryDlss(scanned.dlssFiles, selected),
      addon,
      reshade,
      files: [...scanned.dlssFiles, ...scanned.streamlineFiles],
      hasBackup: scanned.hasBackup || pending || activeLegacy(record),
      recoveryPending: pending,
      legacyActive: activeLegacy(record),
      newDlss: payload.dlssVersion,
      builds: optiscaler.RELEASES.map((r) => ({ value: r.version, label: r.label || r.version })),
      operation: operation?.id === record.id ? operation : null
    }
  }
  async function writeOptions({
    id,
    exePath,
    api = 'auto',
    route,
    optiscalerVersion,
    launchProfile,
    fingerprint,
    consumerVersion,
    reshadeProxy
  }) {
    if (!renderingApi.valid(api)) fail('errApiChoice', '渲染 API 选项无效')
    if (launchProfile !== undefined && !renderingApi.valid(launchProfile))
      fail('errApiChoice', '启动模式选项无效')
    const record = need(id),
      scanned = await scanRecord(record)
    const selected = (scanned.selectableExecutables || scanned.exeCandidates).find(
      (e) => pathKey(e.path) === pathKey(exePath)
    )
    if (!selected) fail('choose_executable', '请选择扫描到的游戏程序')
    if (fingerprint && JSON.stringify(fingerprint) !== JSON.stringify(selected.fingerprint))
      fail('executable_changed', '游戏程序已更新，请重新扫描后再选择安装方案。')
    const profile = preferenceFor(record, selected.path, launchProfile).launchProfile
    const consumerChoice =
      consumerVersion ?? preferenceFor(record, selected.path, profile).consumerVersion
    if (!validConsumerChoice(consumerChoice)) fail('consumer_version_invalid', '插件版本选项无效')
    const proxyChoice = reshadeProxy ?? preferenceFor(record, selected.path, profile).reshadeProxy
    if (!validReShadeProxy(proxyChoice)) fail('errApiChoice', 'ReShade 加载文件选项无效')
    const target = renderingApi.effective(
      {
        ...selected,
        manualSelection: true,
        hasNativeDlss: installRoutes.nativeDlssPresent(scanned, selected)
      },
      deploymentChoice({ api, launchProfile: profile })
    )
    const routeError = route && installRoutes.routeError(target, route)
    if (routeError) fail(routeError, featureI18n.t('zh', routeError))
    const { plan: consumerPlan } = await planConsumer(
      record.gameRoot,
      target,
      route,
      consumerChoice
    )
    if (activeLegacy(record) && pathKey(exePath) !== record.instanceKey)
      fail('restore_required', '请先还原旧版 Vertex 安装')
    Object.assign(record, need(id))
    record.swapperOptions = {
      ...record.swapperOptions,
      exePath: selected.path,
      route,
      apis: { ...record.swapperOptions?.apis, [pathKey(selected.path)]: api },
      activeProfiles: {
        ...record.swapperOptions?.activeProfiles,
        [pathKey(selected.path)]: profile
      },
      profiles: {
        ...record.swapperOptions?.profiles,
        [pathKey(selected.path)]: {
          ...record.swapperOptions?.profiles?.[pathKey(selected.path)],
          [profile]: {
            api,
            route,
            fingerprint: selected.fingerprint,
            consumerVersion: consumerChoice,
            reshadeProxy: effectiveReShadeProxy(target, route, proxyChoice),
            consumerPlan: consumerPlan && {
              version: consumerPlan.version,
              sha256: consumerPlan.sha256,
              api: target.api,
              route
            }
          }
        }
      },
      optiscalerVersion: optiscaler.releaseFor(
        optiscalerVersion ?? record.swapperOptions?.optiscalerVersion
      ).version
    }
    persist(record)
  }
  async function exclusive(kind, id, action) {
    if (operation) fail('binding_busy', '请等待当前操作结束')
    operation = { id, kind, logs: [], startedAt: new Date().toISOString() }
    try {
      return await action()
    } finally {
      operation = null
    }
  }
  async function saveOptions(input) {
    await exclusive('configure', input.id, () => writeOptions(input))
    return details({ id: input.id })
  }
  async function autoDetect({ id, exePath, fingerprint, confirmed, signal, requestId }) {
    if (confirmed !== true) fail('detection_confirmation_required', '请先确认启动检测')
    return exclusive('detect', id, async () => {
      const runId = requestId || randomUUID()
      const report = (value) => {
        operation.progress = { ...value, requestId: runId, kind: 'detect' }
      }
      report({ code: 'scanning', message: '正在检查所选程序与游戏进程…' })
      const record = need(id)
      const chosenPath = record.swapperOptions?.exePath || record.exePath
      if (typeof exePath !== 'string' || !chosenPath || pathKey(exePath) !== pathKey(chosenPath))
        fail('executable_changed', '所选程序已变化，请重新确认')
      const scanned = await scan(record.gameRoot, { signal, captureCandidates: true })
      signal?.throwIfAborted()
      const result = await detectRenderer(
        { root: record.gameRoot, exePath, fingerprint, scan: scanned, signal },
        {
          ...detectionOptions,
          observe,
          launch:
            launch ||
            createDetectionLauncher(
              { root: record.gameRoot, scan: scanned, platform: record.sourcePlatform, signal },
              {
                shell,
                discoverSteam,
                onStarting: (message) => report({ code: 'starting', message })
              }
            ),
          onProgress: report
        }
      )
      signal?.throwIfAborted()
      const current = need(id)
      rememberDetection(current, result)
      persist(current)
      if (['detected', 'recommended'].includes(result.code) && result.session) {
        // Save before asking the game to exit: cancellation during the wait must
        // not discard the API needed for installation after the game is closed.
        report({ ...result, code: 'closing', message: '检测完成，正在关闭对应游戏…' })
        signal?.throwIfAborted()
        try {
          result.gameClose = await closeDetected(
            { exePath: result.exePath, session: result.session },
            { signal }
          )
        } catch {
          signal?.throwIfAborted()
          result.gameClose = { status: 'unavailable' }
        }
        signal?.throwIfAborted()
        const closed = ['closed', 'already-exited'].includes(result.gameClose?.status)
        result.message = closed
          ? `${result.code === 'detected' ? '已确认' : '已推荐'} ${renderingApi.label(result.api)}，游戏已关闭，可继续安装。`
          : '检测结果已保留，未能自动关闭对应游戏，请手动退出后安装。'
        if (closed) result.processState = 'not-running'
        // The UI refreshes details next; old running observations are not the
        // state after a close request (including cancelled/declined requests).
        delete result.updates
        report(result)
      }
      return { ...result, requestId: runId, kind: 'detect' }
    })
  }
  async function mutate(id, kind, event) {
    const language = event?.locale === 'en-US' ? 'en' : 'zh'
    if (operation) fail('binding_busy', '请等待当前安装或还原结束')
    const record = need(id)
    if (kind === 'install' && !(record.swapperOptions?.exePath || record.exePath))
      fail('choose_executable', '请先选择实际游戏程序。')
    if (kind === 'install' && activeLegacy(record))
      fail('restore_required', '请先还原旧版 Vertex 安装，再使用新的安装流程')
    operation = { id, kind, logs: [], startedAt: new Date().toISOString() }
    operation.progress = initialProgress(event?.requestId || randomUUID(), kind)
    const send = (item) => {
      if (item.code === 'componentProgress' && operation) {
        const previous = operation.progress
        operation.progress = updateProgress(previous, item.params)
        // Byte updates replace the snapshot; they must not fill the persisted log.
        if (previous.phase === item.params.phase && previous.name === item.params.name) return
      }
      operation?.logs.push(item)
      if (operation?.logs.length > 200) operation.logs.shift()
    }
    const installer = createSwapperInstaller({
      root,
      scan: (_root, options) => scanRecord(need(id), options),
      payload: () => payload.ensure(send),
      dialog,
      shell,
      win: event?.window,
      featureText: (key, ...args) => featureI18n.t(language, key, ...args),
      loadState: () => ({
        lang: language,
        optiscalerVersion: {
          [path.resolve(record.gameRoot).toLowerCase()]: record.swapperOptions?.optiscalerVersion
        }
      }),
      apiPreference: (_state, _dir, exe) => deploymentChoice(preferenceFor(record, exe)),
      consumerPreference: (exe) => preferenceFor(record, exe),
      validateTarget: (detected) => {
        const fingerprint = preferenceFor(record, detected.path).fingerprint
        if (fingerprint && JSON.stringify(fingerprint) !== JSON.stringify(detected.fingerprint))
          fail('executable_changed', '游戏程序已更新，请重新扫描后再安装。')
      },
      companionAddons: () => [],
      gameName: () => record.name,
      history: () => history,
      saveOperation: (dir, manifest, action) => history.record(dir, manifest, action, record.name),
      exclusiveMutation: (action) =>
        withDeploymentScopeMutationLocks(
          [
            ...new Set([
              'bindings',
              pathKey(record.gameRoot),
              pathKey(path.dirname(record.swapperOptions?.exePath || record.exePath))
            ])
          ].map((deployDomain) => ({ gameId: 1, source: 'dlss', deployDomain })),
          action,
          { operation: 'dlss', ownerId: id }
        )
    })
    try {
      if (kind === 'restore') {
        // Capture valid API evidence before restoring/removing its source files.
        // Broken/missing games must still be restorable without a successful scan.
        try {
          await scanRecord(need(id))
        } catch {
          /* Restoration remains available. */
        }
      }
      if (kind === 'restore' && activeLegacy(record)) {
        const result = await (await legacy()).restore(id)
        if (activeLegacy(result)) fail('restore_conflict', '旧版安装仍有未还原的文件，请检查记录')
      } else {
        const result = await installer[kind](
          { sender: { send: (_channel, item) => send(item) } },
          record.gameRoot,
          record.swapperOptions?.exePath || record.exePath,
          record.swapperOptions?.route,
          deploymentChoice(preferenceFor(record, record.swapperOptions?.exePath || record.exePath))
        )
        if (!result.ok && !result.cancelled)
          fail(
            result.code || 'install_failed',
            result.message || featureI18n.t('zh', result.code || 'installFailed')
          )
        if (result.cancelled) {
          operation.progress = updateProgress(operation.progress, {
            phase: 'cancelled',
            name: 'DLSS5'
          })
          return { cancelled: true, progress: operation.progress }
        }
      }
      const current = need(id)
      current.installationSnapshot = null
      if (kind === 'install') {
        try {
          current.installationSnapshot = await snapshot(record.gameRoot)
        } catch {
          send({ code: 'verificationSnapshotUnavailable', params: {} })
        }
      }
      persist(current)
      operation.progress = updateProgress(operation.progress, { phase: 'complete', name: 'DLSS5' })
      return { ok: true, progress: operation.progress }
    } catch (error) {
      operation.progress = updateProgress(operation.progress, {
        phase: 'failed',
        name: operation.progress.name || 'DLSS5'
      })
      throw error
    } finally {
      try {
        const current = need(id)
        current.swapperLog = operation?.logs || []
        current.swapperProgress = operation?.progress || null
        persist(current)
      } finally {
        operation = null
      }
    }
  }
  return {
    isBusy: () => !!operation,
    details,
    saveOptions,
    autoDetect,
    async checkRuntime({ id, exePath, signal }) {
      return exclusive('check', id, async () => {
        const record = need(id)
        const result = await runtimeCheck(
          {
            gameRoot: record.gameRoot,
            baseline: record.installationSnapshot,
            exePath: exePath || record.swapperOptions?.exePath || record.exePath
          },
          { signal }
        )
        const current = need(id)
        current.lastRuntimeCheck = { ...result, historical: true }
        persist(current)
        return result
      })
    },
    state,
    progress({ id, requestId }) {
      const value = operation?.id === id ? operation.progress : need(id).swapperProgress
      return value?.requestId === requestId ? value : null
    },
    checkLocation,
    list: () => repository.list(),
    install: (id, event) => mutate(id, 'install', event),
    restore: (id, event) => mutate(id, 'restore', event),
    async scanLibrary() {
      return discoverLocalGames({ force: true })
    },
    async artwork({ id }) {
      const record = need(id)
      if (artworkIsFresh(record.artwork)) return record.artwork
      const identity = record.steamAppId ? null : steamIdentity(record.gameRoot)
      const art = await look(record.name, record.steamAppId || identity?.id || undefined)
      if (!art) return null
      const current = need(id)
      // Keep resolved artwork through a temporary Steam outage.
      if (!art.assetsResolved && current.artwork?.assetsResolved) return current.artwork
      if (!current.coverImage || current.coverImage === current.artwork?.coverUrl)
        current.coverImage = art.coverUrl
      current.artwork = art
      if (identity) {
        current.steamAppId = identity.id
        current.sourcePlatform = 'Steam'
      }
      art.steamAppId = current.steamAppId
      art.sourcePlatform = current.sourcePlatform
      persist(current)
      return art
    },
    diagnostics({ id }) {
      const record = need(id)
      const selectedExe = record.swapperOptions?.exePath || record.exePath
      return diagnostics.report({
        gameDir: record.gameRoot,
        exeDir: selectedExe ? path.dirname(selectedExe) : record.gameRoot,
        userData: root,
        facts: {
          version: 'Vertex / DLSS5-Swapper 2.2.7',
          activity: JSON.stringify(record.swapperLog || [])
        }
      })
    },
    async remove({ id, onlyIfMissing = false, onlyIfProgramMissing = false }) {
      return exclusive('remove', id, async () => {
        const record = need(id)
        if (onlyIfMissing === true) {
          if ((await checkLocation({ id })).exists)
            fail('game_path_exists', '游戏路径已恢复，未删除记录，请重新打开游戏。')
        } else if (onlyIfProgramMissing === true) {
          // 目录仍在时只在用户确认后移除记录；目录里的文件一律不动。
          const location = await checkLocation({ id })
          if (location.exists && !location.programMissing)
            fail('game_program_exists', '游戏程序已恢复，未删除记录，请重新打开游戏。')
          // 文件安装的还原清单和备份保存在游戏目录，移除列表记录不会丢失它们。
          // 旧版会话的恢复信息依赖此记录，仍须先还原，不能随记录一起丢弃。
          if (location.exists && activeLegacy(record))
            fail('restore_required', '游戏目录里还有未还原的 DLSS5 安装，请先打开游戏还原。')
        } else if (activeLegacy(record)) fail('restore_required', '请先还原旧版安装')
        repository.remove(id)
        return true
      })
    }
  }
}
