// Progress describes the current file/stage, never a guessed overall percentage.
export function componentProgress(send, component, now = () => performance.now()) {
  let startedAt = 0,
    lastSent = -Infinity,
    previousPhase = '',
    previousFile = ''
  return (value) => {
    const time = now()
    const file = `${value.fileIndex || 1}/${value.fileCount || 1}`
    if (value.phase === 'downloading' && (previousPhase !== value.phase || file !== previousFile))
      startedAt = time
    const elapsed = time - startedAt
    const progress = {
      ...component,
      ...value,
      received: Math.max(0, Number(value.received) || 0),
      total: Math.max(0, Number(value.total) || 0),
      bytesPerSecond:
        value.phase === 'downloading' && elapsed >= 500
          ? Math.round(((Number(value.received) || 0) * 1000) / elapsed)
          : 0
    }
    if (
      value.phase === 'downloading' &&
      previousPhase === value.phase &&
      previousFile === file &&
      time - lastSent < 200 &&
      !(progress.total && progress.received >= progress.total)
    )
      return
    previousPhase = value.phase
    previousFile = file
    lastSent = time
    send({ code: 'componentProgress', params: progress })
  }
}

export function initialProgress(requestId, kind) {
  return {
    requestId,
    kind,
    phase: kind === 'restore' ? 'restoring' : 'preparing',
    name: 'DLSS5',
    received: 0,
    total: 0,
    cached: [],
    downloaded: [],
    warnings: []
  }
}

export function updateProgress(current, value) {
  const name = [value.name, value.version].filter(Boolean).join(' ')
  return {
    ...current,
    name: '',
    version: '',
    received: 0,
    total: 0,
    bytesPerSecond: 0,
    fileIndex: 0,
    fileCount: 0,
    source: '',
    ...value,
    cached:
      value.phase === 'cached' && value.source !== 'bundled'
        ? [...new Set([...current.cached, name])]
        : current.cached,
    bundled: current.bundled || (value.phase === 'cached' && value.source === 'bundled'),
    downloaded:
      value.phase === 'saved' ? [...new Set([...current.downloaded, name])] : current.downloaded,
    warnings:
      value.phase === 'fallback'
        ? [...new Set([...current.warnings, value.message])]
        : current.warnings
  }
}
