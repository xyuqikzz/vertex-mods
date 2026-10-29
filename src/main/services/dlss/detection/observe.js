import fs from 'node:fs/promises'
import { refineCandidates } from '../renderer-evidence.js'
import { collectEngineEvidence } from './engine-evidence.js'
import { collectGpuClientEvidence } from './gpu-client.js'
import { resolveRendering } from './resolver.js'
import { ownedPath, pathKey } from './executables.js'
import { gameProcessState, snapshotGameProcesses } from '../processes.js'

export async function refreshRuntimeCandidates(root, candidates, options = {}) {
  await refineCandidates(root, candidates, options)
  for (const exe of candidates) {
    const { evidence, issues } = collectEngineEvidence(root, exe, options.processRows, {
      ...options,
      peers: candidates
    })
    const gpu = collectGpuClientEvidence(exe, options.processRows)
    exe.rendering = resolveRendering(
      exe,
      [...evidence, ...gpu.evidence],
      [...issues, ...gpu.issues]
    )
  }
  return candidates
}

// A detection session reuses static PE facts but reads processes/config/logs anew.
// Never feed last poll's observed API back in as static evidence.
export async function observeRuntime(
  { root, candidates, exePath, launchExePath, relatedExePaths, dependencies = [] },
  { processes = snapshotGameProcesses, signal, ...options } = {}
) {
  signal?.throwIfAborted()
  const target = candidates.find((exe) => pathKey(exe.path) === pathKey(exePath))
  if (!target || !ownedPath(root, exePath))
    throw Object.assign(new Error('游戏程序已变化，请重新扫描'), { code: 'executable_changed' })
  for (const file of [...new Set([exePath, launchExePath].filter(Boolean))]) {
    const expected = candidates.find((exe) => pathKey(exe.path) === pathKey(file))
    const stat = await fs.stat(file).catch(() => null)
    if (
      !ownedPath(root, file) ||
      !stat ||
      stat.size !== expected?.fingerprint?.size ||
      stat.mtimeMs !== expected?.fingerprint?.modifiedAt
    )
      throw Object.assign(new Error('游戏程序已变化，请重新扫描'), { code: 'executable_changed' })
  }
  for (const file of dependencies) {
    const stat = ownedPath(root, file.path) && (await fs.stat(file.path).catch(() => null))
    if (!stat || stat.size !== file.size || stat.mtimeMs !== file.modifiedAt)
      throw Object.assign(new Error('游戏渲染组件已变化，请重新扫描'), {
        code: 'executable_changed'
      })
  }
  let rows
  try {
    rows = await processes(root, exePath, {
      signal,
      relatedExePath: launchExePath,
      relatedExePaths
    })
  } catch {
    rows = null
  }
  signal?.throwIfAborted()
  const fresh = structuredClone(candidates)
  for (const exe of fresh) exe.processState = gameProcessState(exe.path, rows)
  await refreshRuntimeCandidates(root, fresh, { ...options, processRows: rows })
  return {
    candidates: fresh,
    processState: gameProcessState(exePath, rows),
    sessions: (rows || [])
      .filter((row) => row.exe && pathKey(row.exe) === pathKey(exePath))
      .map((row) => ({ pid: row.pid, startedAt: row.startedAt }))
  }
}
