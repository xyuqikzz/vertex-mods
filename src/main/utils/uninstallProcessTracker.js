const identity = (row) => `${row.pid}:${row.created || ''}`

// The launcher may exit before its temporary/uninstaller child. Keep observing the
// original process tree, with the pre-launch snapshot excluding unrelated installers.
export async function waitForUninstallProcesses({
  baseline = [], getSnapshot, getLaunchState, processName = '',
  timeoutMs = 1800000, pollMs = 1000, quietMs = 3000,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  const existing = new Set(baseline.map(identity))
  const tracked = new Set()
  const startedAt = now()
  let quietSince = null
  while (now() - startedAt < timeoutMs) {
    const state = getLaunchState()
    if (state.error) throw state.error
    if (state.closed && !state.pid) return { timeout: false, exitCode: null }
    if (state.pid > 0) tracked.add(state.pid)
    const rows = await getSnapshot()
    const fresh = rows.filter((row) => !existing.has(identity(row)))
    let expanded
    do {
      expanded = false
      for (const row of fresh) {
        const innoChild = /^unins\d*\.exe$/i.test(processName) && /^_(?:iu|is).*\.(?:tmp|exe)$/i.test(row.name)
        if (!tracked.has(row.pid) && (tracked.has(row.parentPid) || innoChild)) {
          tracked.add(row.pid)
          expanded = true
        }
      }
    } while (expanded)
    const alive = fresh.some((row) => tracked.has(row.pid))
    if (state.closed && !alive) {
      quietSince ??= now()
      if (now() - quietSince >= quietMs) return { timeout: false, exitCode: state.exitCode }
    } else {
      quietSince = null
    }
    await sleep(pollMs)
  }
  return { timeout: true, exitCode: null }
}
