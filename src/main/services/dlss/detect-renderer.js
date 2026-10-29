import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { canonical, fail, pathKey, safeJoin } from './files.js'
import { observeRuntime } from './detection/observe.js'
import renderingApi from '../../../shared/dlss-swapper/rendering-api.js'

export async function launchForDetection(exePath) {
  // Do not attach the detection AbortSignal: stopping observation must not kill the game.
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    shell: false,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}

export async function detectRenderer(
  { root, exePath, fingerprint, scan, signal },
  {
    observe = observeRuntime,
    launch = launchForDetection,
    wait = (ms) => delay(ms, undefined, { signal }),
    now = Date.now,
    timeoutMs = 90000,
    intervalMs = 2500,
    runningWaitMs = 15000,
    gpuSettleMs = 10000,
    onProgress = () => {}
  } = {}
) {
  signal?.throwIfAborted()
  const canonicalRoot = await canonical(root, true)
  const candidates = scan.runtimeCandidates
  const selected = candidates?.find((exe) => pathKey(exe.path) === pathKey(exePath))
  if (
    !selected ||
    !fingerprint ||
    JSON.stringify(selected.fingerprint) !== JSON.stringify(fingerprint)
  )
    fail('executable_changed', '游戏程序已变化，请重新扫描')
  await safeJoin(canonicalRoot, path.relative(canonicalRoot, selected.path))
  if (
    !/\.exe$/i.test(selected.path) ||
    selected.encrypted ||
    ['helper', 'dedicated-server', 'interpreter'].includes(selected.role)
  )
    fail('detection_manual_launch', '此程序无法自动启动，请手动启动游戏后检测。')
  // A recognized bootstrapper is launched as selected, but evidence belongs to
  // its real renderer. Report that identity without silently changing selection.
  const linked = scan.launchEntries?.find((entry) => pathKey(entry.path) === pathKey(exePath))
  const observedExe = linked?.target || selected.path
  const observed = candidates.find((exe) => pathKey(exe.path) === pathKey(observedExe))
  if (!observed || ['helper', 'dedicated-server', 'interpreter'].includes(observed.role))
    fail('executable_changed', '实际游戏程序已变化，请重新扫描')
  await safeJoin(canonicalRoot, path.relative(canonicalRoot, observedExe))
  const dependencies = []
  for (const file of new Set(
    [
      observed.evidenceFile,
      ...(observed.staticApiCandidates || []).flatMap((item) =>
        (item.sources || []).map((source) => source.file)
      )
    ].filter(Boolean)
  )) {
    if (pathKey(file) === pathKey(observedExe)) continue
    await safeJoin(canonicalRoot, path.relative(canonicalRoot, file))
    const stat = await fs.stat(file)
    dependencies.push({ path: file, size: stat.size, modifiedAt: stat.mtimeMs })
  }
  const launchers = (scan.launchEntries || [])
    .filter((entry) => pathKey(entry.target) === pathKey(observedExe))
    .map((entry) => entry.path)
  const input = {
    root: canonicalRoot,
    candidates,
    exePath: observedExe,
    launchExePath: selected.path,
    relatedExePaths: launchers,
    dependencies
  }
  const started = now()
  const deadline = now() + timeoutMs
  let seenRunning = false,
    runningSince = null,
    runningSession = '',
    launchFailed = false
  const exact = (api) => renderingApi.choices.some((choice) => choice.value === api)
  const describe = (result) => {
    const target = result.candidates.find((exe) => pathKey(exe.path) === pathKey(observedExe))
    const rendering = target?.rendering
    const state = result.processState
    const session = result.sessions?.length === 1 ? result.sessions[0] : null
    const validSession = session?.pid > 0 && Number.isFinite(Date.parse(session.startedAt))
    let code = 'waiting',
      api = null,
      confidence = null,
      source = null
    let message = launchFailed
      ? '自动启动未成功，请从游戏平台手动启动游戏，检测会继续。'
      : '等待游戏启动；若未打开，请从游戏平台手动启动。'
    if (state === 'unavailable') {
      code = 'unavailable'
      message = '暂时无法读取游戏进程，请检查游戏与 Vertex 的运行权限，或手动选择 API。'
    } else if (state === 'multiple') {
      code = 'multiple'
      message = '检测到多个游戏实例，请保留一个后重新检测。'
    } else if (state === 'running') {
      code = 'unconfirmed'
      message = '游戏已运行，正在核对渲染 API…'
      if (
        validSession &&
        exact(rendering?.current?.api) &&
        !rendering.reasons?.includes('runtime_conflict')
      ) {
        code = 'detected'
        api = rendering.current.api
        confidence = rendering.current.state
        source = 'runtime'
        message = `已确认本次渲染 API：${renderingApi.label(api)}。`
      } else if (
        rendering?.state === 'conflict' ||
        rendering?.reasons?.includes('requested_conflict')
      ) {
        code = 'conflict'
        message = '游戏已运行，但渲染证据存在冲突，请手动选择 API 或调整启动模式后重新检测。'
      } else if (validSession && exact(rendering?.recommendedApi)) {
        code = 'recommended'
        api = rendering.recommendedApi
        source =
          rendering.recommendationSource === 'gpu-client'
            ? 'gpu-client'
            : rendering.requested
              ? rendering.requested.evidence?.some(
                  (e) => e.source === 'process-arguments' && e.scope === 'current'
                )
                ? 'process-arguments'
                : 'engine-config'
              : 'static'
        confidence = 'recommended'
        const label = {
          'process-arguments': '启动参数',
          'engine-config': '游戏配置',
          'gpu-client': '系统图形信息',
          static: '程序文件'
        }[source]
        message = `游戏已运行，推荐 ${renderingApi.label(api)}（依据${label}，实际 API 未确认）。`
      }
    } else if (seenRunning) {
      code = 'exited'
      message = '游戏进程已退出，本次未取得稳定结果。请重新启动后检测。'
    }
    if (linked && ['detected', 'recommended'].includes(code))
      message += ` 检测来自 ${path.relative(root, observedExe)}，当前程序选择未改变。`
    return {
      code,
      api,
      confidence,
      source,
      message,
      processState: state,
      exePath: observedExe,
      fingerprint: observed.fingerprint,
      dependencies,
      session: validSession ? session : null,
      observedAt: now(),
      elapsedMs: now() - started,
      updates: result.candidates
        .filter((e) =>
          [selected.path, observedExe].some((file) => pathKey(file) === pathKey(e.path))
        )
        .map((e) => ({ path: e.path, processState: e.processState, rendering: e.rendering }))
    }
  }
  let result = await observe(input, { signal })
  signal?.throwIfAborted()
  if (result.processState === 'not-running') {
    // Also avoid starting a second bootstrapper while the first is loading.
    const launcherActive = result.candidates.some(
      (exe) =>
        [selected.path, ...launchers].some((file) => pathKey(file) === pathKey(exe.path)) &&
        ['running', 'multiple', 'unavailable'].includes(exe.processState)
    )
    if (!launcherActive) {
      signal?.throwIfAborted()
      // Revalidate the executable just before the only launch attempt.
      const current = await fs.stat(selected.path)
      if (current.size !== fingerprint.size || current.mtimeMs !== fingerprint.modifiedAt)
        fail('executable_changed', '游戏程序已变化，请重新扫描')
      signal?.throwIfAborted()
      try {
        onProgress({ ...describe(result), code: 'starting', message: '正在尝试启动所选程序…' })
        await launch(selected.path)
      } catch {
        launchFailed = true
      }
    }
  }
  let previous = ''
  while (true) {
    signal?.throwIfAborted()
    const value = describe(result)
    const sessionKey = value.session ? JSON.stringify(value.session) : ''
    if (value.processState === 'running') {
      seenRunning = true
      if (runningSince === null || runningSession !== sessionKey) runningSince = now()
      runningSession = sessionKey
    } else {
      runningSince = null
      runningSession = ''
    }
    const identity = JSON.stringify([value.code, value.api, value.source, sessionKey])
    const stable = identity === previous
    // Client hints can describe a device created during startup, before the
    // final renderer. Give a new session time to initialize before closing it.
    const settled =
      value.source !== 'gpu-client' ||
      Math.max(now() - Date.parse(value.session?.startedAt), now() - runningSince) >= gpuSettleMs
    const finished =
      stable &&
      settled &&
      ['detected', 'recommended', 'conflict', 'multiple', 'unavailable', 'exited'].includes(
        value.code
      )
    const noEvidence =
      value.code === 'unconfirmed' &&
      value.processState === 'running' &&
      runningSince !== null &&
      now() - runningSince >= runningWaitMs
    const timedOut = now() >= deadline
    if (finished || noEvidence || timedOut) {
      // An observation arriving on the deadline still counts; a single sample never confirms an API.
      if (!finished && ['detected', 'recommended'].includes(value.code)) {
        value.code = 'unconfirmed'
        value.api = value.confidence = value.source = null
      }
      if (value.code === 'unconfirmed')
        value.message =
          '游戏已运行，但没有足够证据确认渲染 API。可手动选择，或切换启动模式后重新检测。'
      if (['waiting', 'starting'].includes(value.code)) {
        value.code = 'manual_required'
        value.message = '未检测到游戏运行，请从游戏平台手动启动后重新检测。'
      }
      onProgress(value)
      return value
    }
    onProgress({
      ...value,
      code: ['detected', 'recommended'].includes(value.code) ? 'confirming' : value.code,
      message: ['detected', 'recommended'].includes(value.code)
        ? '游戏已运行，正在复核识别结果…'
        : value.message
    })
    previous = identity
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())))
    result = await observe(input, { signal })
  }
}
