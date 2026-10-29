const clone = (value) => JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function sessions(snapshot = {}) {
  const map = new Map((snapshot.sessionHistory || []).map((item) => [item.id, item]))
  if (snapshot.currentSessionId)
    map.set(snapshot.currentSessionId, {
      ...map.get(snapshot.currentSessionId),
      id: snapshot.currentSessionId,
      title: snapshot.currentSessionTitle,
      context: snapshot.currentContextSnapshot,
      messages: snapshot.messages || [],
      candidates: snapshot.candidates || [],
      installPlan: snapshot.installPlan || null
    })
  return map
}

function mergeMessages(base = [], local = [], remote = []) {
  const originals = new Map(base.map((item) => [item.id, item]))
  const merged = new Map(remote.map((item) => [item.id, item]))
  for (const message of local) {
    const current = merged.get(message.id)
    if (!current || equal(current, originals.get(message.id))) merged.set(message.id, message)
    // A terminal message must never be replaced by a delayed streaming snapshot.
    else if (current.streaming && !message.streaming) merged.set(message.id, message)
  }
  return [...merged.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
}

// Three-way rebase preserves independent session edits after a CAS conflict.
// Deletions are explicit tombstones; trimming the history is not a deletion.
export function rebaseAssistantSnapshot(base = {}, local = {}, remote = {}) {
  const result = clone(remote)
  const oldSessions = sessions(base)
  const localSessions = sessions(local)
  const remoteSessions = sessions(remote)
  const deleted = new Set([...(remote.deletedSessionIds || []), ...(local.deletedSessionIds || [])])
  for (const [id, value] of localSessions) {
    if (deleted.has(id)) continue
    const original = oldSessions.get(id)
    const current = remoteSessions.get(id)
    if (!current || equal(current, original)) remoteSessions.set(id, value)
    else if (!equal(value, original)) {
      const merged = { ...current }
      for (const key of ['title', 'context', 'candidates', 'installPlan', 'updatedAt']) {
        if (!equal(value[key], original?.[key]) && equal(current[key], original?.[key]))
          merged[key] = value[key]
      }
      merged.messages = mergeMessages(original?.messages, value.messages, current.messages)
      remoteSessions.set(id, merged)
    }
  }
  for (const id of deleted) remoteSessions.delete(id)
  result.deletedSessionIds = [...deleted]
  result.sessionHistory = [...remoteSessions.values()]
    .filter((item) => item.messages?.length)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 20)
  const selectedId = deleted.has(local.currentSessionId)
    ? remote.currentSessionId
    : local.currentSessionId
  const selected = remoteSessions.get(selectedId)
  result.currentSessionId = selected?.id || ''
  result.currentSessionTitle = selected?.title || '新对话'
  result.currentContextSnapshot = selected?.context || {}
  result.messages = selected?.messages || []
  result.candidates = selected?.candidates || []
  result.installPlan = selected?.installPlan || null
  for (const key of ['selectedModel', 'selectedModelConfigBasis', 'selectedMode']) {
    if (!equal(local[key], base[key]) && equal(remote[key], base[key])) result[key] = local[key]
  }
  return result
}

export function acceptAssistantSnapshot(current, payload = {}) {
  const incoming = payload.snapshot
  if (!incoming || typeof incoming !== 'object') return { success: false, snapshot: current }
  const revision = Number(current?.revision || 0)
  if (Number(payload.baseRevision || 0) !== revision)
    return { success: false, conflict: true, snapshot: current }
  const snapshot = clone(incoming)
  snapshot.deletedSessionIds = [
    ...new Set([...(current?.deletedSessionIds || []), ...(snapshot.deletedSessionIds || [])])
  ]
  const deleted = new Set(snapshot.deletedSessionIds)
  snapshot.sessionHistory = (snapshot.sessionHistory || []).filter((item) => !deleted.has(item.id))
  if (deleted.has(snapshot.currentSessionId))
    return { success: false, conflict: true, snapshot: current }
  snapshot.revision = revision + 1
  return { success: true, snapshot }
}
