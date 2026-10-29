import { randomUUID } from 'node:crypto'
import { normalizeWorkshopCredentials, normalizeWorkshopGuardCode } from '../../../shared/sources/steam-workshop.js'

const states = new Map()
const sessions = new Map()

const expired = () => new Error('Steam 授权请求已结束，请在任务中心重试')
const publicState = state => ({
  jobId: state.jobId, phase: state.phase, kind: state.kind, message: state.message,
  qrText: state.qrText, requestId: state.requestId, purpose: state.purpose, remember: state.remember
})

// 凭据仅交给当前任务的等待者；公开状态、事件和任务记录中不包含凭据。
export function createWorkshopAuthSession(event, jobId, signal, options = {}) {
  const sender = event?.sender
  if (!sender || sender.isDestroyed()) return null
  sessions.get(jobId)?.close()
  let pending, closed = false
  let remember = options.remember === true
  function update(patch) {
    if (closed || sender.isDestroyed()) return
    const previous = states.get(jobId)
    const state = {
      jobId, senderId: sender.id,
      phase: patch.phase || previous?.phase || 'qr',
      kind: patch.kind || '',
      message: patch.message || '',
      qrText: patch.qrText ?? previous?.qrText ?? '',
      requestId: pending?.id || '',
      purpose: options.purpose === 'settings' ? 'settings' : 'download', remember
    }
    states.set(jobId, state)
    sender.send('workshop:auth-updated', publicState(state))
  }
  function clear() {
    pending?.reject(expired())
    states.delete(jobId)
    if (!sender.isDestroyed()) sender.send('workshop:auth-updated', { jobId, phase: 'closed', qrText: '' })
  }
  function close() {
    if (closed) return
    closed = true
    clear()
    if (sessions.get(jobId) === api) sessions.delete(jobId)
    signal?.removeEventListener('abort', close)
    sender.removeListener?.('destroyed', close)
  }
  function request(state, requestSignal) {
    if (closed || signal?.aborted || requestSignal?.aborted || sender.isDestroyed()) return Promise.reject(expired())
    pending?.reject(expired())
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const cancel = () => finish(reject, expired())
      const finish = (settle, value) => {
        if (pending?.id !== id) return
        pending = null
        clearTimeout(timer)
        requestSignal?.removeEventListener('abort', cancel)
        settle(value)
      }
      const timer = setTimeout(cancel, 10 * 60 * 1000)
      pending = { id, phase: state.phase, resolve: value => finish(resolve, value), reject: error => finish(reject, error) }
      requestSignal?.addEventListener('abort', cancel, { once: true })
      update({ ...state, qrText: state.qrText || '' })
    })
  }
  function respond(senderId, payload) {
    if (closed || signal?.aborted || senderId !== sender.id || !pending || payload.requestId !== pending.id) throw expired()
    const value = pending.phase === 'guard'
      ? { code: normalizeWorkshopGuardCode(payload.code) }
      : payload.mode === 'qr' ? { loginMode: 'qr' } : normalizeWorkshopCredentials(payload)
    pending.resolve(value)
    update({ phase: 'connecting', qrText: '', message: '正在验证 Steam 登录信息…' })
    return { success: true }
  }
  function setRemember(senderId, payload) {
    if (closed || senderId !== sender.id || !pending || payload.requestId !== pending.id || typeof payload.remember !== 'boolean') throw expired()
    remember = payload.remember
    update(states.get(jobId) || {})
    return { success: true }
  }
  const api = { update, request, clear, close, respond, setRemember, get remember() { return remember } }
  sessions.set(jobId, api)
  sender.once?.('destroyed', close)
  signal?.addEventListener('abort', close, { once: true })
  if (signal?.aborted) close()
  return api
}

export function submitWorkshopAuth(senderId, payload = {}) {
  try {
    const session = sessions.get(payload.jobId)
    if (!session) throw expired()
    return session.respond(senderId, payload)
  } catch (error) {
    return { success: false, message: error.message }
  }
}

export function rememberWorkshopAuth(senderId, payload = {}) {
  try {
    const session = sessions.get(payload.jobId)
    if (!session) throw expired()
    return session.setRemember(senderId, payload)
  } catch (error) {
    return { success: false, message: error.message }
  }
}

export function updateWorkshopQr(event, jobId, qrText = '') {
  if (!qrText) states.delete(jobId)
  const sender = event?.sender
  if (!sender || sender.isDestroyed()) return
  if (qrText) states.set(jobId, { jobId, qrText, senderId: sender.id })
  sender.send('workshop:auth-updated', { jobId, qrText })
}

export function getWorkshopQrStates(senderId) {
  return [...states.values()]
    .filter((state) => state.senderId === senderId)
    .map(publicState)
}
