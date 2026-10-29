const pending = new Map()
const owners = new WeakSet()

export function cancelNetworkRequest(event, id) {
  if (typeof id === 'string') pending.get(`${event.sender.id}:${id}`)?.abort()
}

export async function withNetworkRequest(event, id, work) {
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('invalid_request_id')
  const prefix = `${event.sender.id}:`
  const key = prefix + id
  if (pending.has(key)) throw new Error('duplicate_request_id')
  if ([...pending.keys()].filter(key => key.startsWith(prefix)).length >= 24) throw new Error('network_request_limit')
  if (!owners.has(event.sender)) {
    owners.add(event.sender)
    event.sender.once?.('destroyed', () => {
      for (const [key, controller] of pending) if (key.startsWith(prefix)) { controller.abort(); pending.delete(key) }
    })
  }
  const controller = new AbortController()
  pending.set(key, controller)
  try { return await work(controller.signal) }
  finally { pending.delete(key) }
}
