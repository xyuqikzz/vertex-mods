import { randomUUID } from 'node:crypto'

const snapshots = new Map()
const TTL_MS = 30 * 60 * 1000
const clone = (value) => JSON.parse(JSON.stringify(value))

function prune() {
  for (const [id, entry] of snapshots) if (entry.expiresAt <= Date.now()) snapshots.delete(id)
}

// Snapshots are process-local capabilities. Renderer arguments are never restored into them.
export function saveExecutionSnapshot(kind, value, ctx = {}) {
  prune()
  while (snapshots.size >= 512) snapshots.delete(snapshots.keys().next().value)
  const id = randomUUID()
  snapshots.set(id, {
    kind,
    value: clone(value),
    sessionId: String(ctx.sessionId || ''),
    senderId: ctx.event?.sender?.id ?? null,
    expiresAt: Date.now() + TTL_MS
  })
  return id
}

export function readExecutionSnapshot(id, kind, ctx = {}, consume = false) {
  prune()
  const entry = snapshots.get(String(id || ''))
  if (
    !entry ||
    entry.kind !== kind ||
    entry.sessionId !== String(ctx.sessionId || '') ||
    entry.senderId !== (ctx.event?.sender?.id ?? null)
  )
    return null
  if (consume) snapshots.delete(id)
  return clone(entry.value)
}
