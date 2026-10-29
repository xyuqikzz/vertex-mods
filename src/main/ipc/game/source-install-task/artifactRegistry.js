const artifactWaiterMap = new Map()

function createDeferred() {
  let resolvePromise = () => {}
  let rejectPromise = () => {}
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  }
}

export function hasActiveArtifactDownload(artifactKey = '') {
  return artifactWaiterMap.has(String(artifactKey || '').trim())
}

export function registerArtifactDownload(artifactKey = '') {
  const safeArtifactKey = String(artifactKey || '').trim()
  if (!safeArtifactKey) {
    throw new Error('缺少下载产物唯一键')
  }
  if (!artifactWaiterMap.has(safeArtifactKey)) {
    artifactWaiterMap.set(safeArtifactKey, createDeferred())
  }
  return artifactWaiterMap.get(safeArtifactKey).promise
}

export function waitForArtifactDownload(artifactKey = '') {
  const safeArtifactKey = String(artifactKey || '').trim()
  if (!safeArtifactKey || !artifactWaiterMap.has(safeArtifactKey)) {
    return null
  }
  return artifactWaiterMap.get(safeArtifactKey).promise
}

export function resolveArtifactDownload(artifactKey = '', payload = {}) {
  const safeArtifactKey = String(artifactKey || '').trim()
  const waiter = artifactWaiterMap.get(safeArtifactKey)
  if (!waiter) {
    return
  }
  artifactWaiterMap.delete(safeArtifactKey)
  waiter.resolve(payload)
}

export function rejectArtifactDownload(artifactKey = '', error = null) {
  const safeArtifactKey = String(artifactKey || '').trim()
  const waiter = artifactWaiterMap.get(safeArtifactKey)
  if (!waiter) {
    return
  }
  artifactWaiterMap.delete(safeArtifactKey)
  waiter.reject(error instanceof Error ? error : new Error(String(error || '下载失败')))
}
