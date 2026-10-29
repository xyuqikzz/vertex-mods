import { isVNode, reactive, shallowRef } from 'vue'

const DEFAULT_DIALOG_WIDTH = 520

const defaultState = () => ({
  open: false,
  title: '',
  subtitle: '',
  description: '',
  tone: 'default',
  toneLabel: '',
  confirmText: '确认',
  cancelText: '取消',
  showCancel: true,
  loading: false,
  disabled: false,
  closeOnMask: false,
  focusAction: '',
  details: [],
  impacts: [],
  tags: [],
  width: DEFAULT_DIALOG_WIDTH,
  showIcon: true
})

export const confirmDialogState = reactive(defaultState())
export const confirmDialogContent = shallowRef(null)
export const confirmDialogContentKind = shallowRef('text')

let activeResolve = null
let activeController = null
let activeOptions = {}
let activeSettled = false

function normalizeText(value, fallback = '') {
  const text = String(value ?? fallback ?? '').trim()
  return text || fallback
}

function normalizeTone(options = {}) {
  const explicitTone = normalizeText(options.tone, '')
  if (explicitTone) {
    return ['default', 'danger', 'warning', 'success'].includes(explicitTone)
      ? explicitTone
      : 'default'
  }

  const type = normalizeText(options.type, '').toLowerCase()
  if (type === 'warning') return 'warning'
  if (type === 'success') return 'success'
  if (type === 'danger' || type === 'error') return 'danger'
  if (options.danger) return 'danger'
  return 'default'
}

function normalizeWidth(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }

  const width = String(value ?? '').trim()
  if (width) return width
  return DEFAULT_DIALOG_WIDTH
}

function normalizeFocusAction(value, tone, showCancel) {
  const action = normalizeText(value, '')
  if (action === 'confirm' || action === 'cancel') return action
  return tone === 'danger' && showCancel ? 'cancel' : 'confirm'
}

function normalizeContent(value) {
  if (value == null || value === '') {
    return { kind: 'text', value: '' }
  }

  if (typeof value === 'function') {
    return { kind: 'render', value }
  }

  if (isVNode(value)) {
    return { kind: 'vnode', value }
  }

  return { kind: 'text', value: String(value) }
}

function applyDialogState(options = {}) {
  const tone = normalizeTone(options)
  const showCancel = options.showCancel !== false
  const content = normalizeContent(options.content)

  Object.assign(confirmDialogState, {
    open: true,
    title: normalizeText(options.title, ''),
    subtitle: normalizeText(options.subtitle, ''),
    description: normalizeText(options.description, ''),
    tone,
    toneLabel: normalizeText(options.toneLabel, ''),
    confirmText: normalizeText(options.okText ?? options.confirmText, '确认'),
    cancelText: normalizeText(options.cancelText, '取消'),
    showCancel,
    loading: Boolean(options.loading),
    disabled: Boolean(options.disabled),
    closeOnMask: Boolean(options.closeOnMask),
    focusAction: normalizeFocusAction(options.focusAction, tone, showCancel),
    details: Array.isArray(options.details) ? options.details.filter(Boolean) : [],
    impacts: Array.isArray(options.impacts) ? options.impacts.filter(Boolean) : [],
    tags: Array.isArray(options.tags) ? options.tags.filter(Boolean) : [],
    width: normalizeWidth(options.width),
    showIcon: options.showIcon !== false && options.icon !== ''
  })

  confirmDialogContentKind.value = content.kind
  confirmDialogContent.value = content.value
  activeOptions = { ...options }
}

function finalizeDialog(confirmed = false, settlePromise = true) {
  if (!confirmDialogState.open && !activeController) {
    return
  }

  confirmDialogState.open = false
  confirmDialogState.loading = false

  if (settlePromise && !activeSettled && typeof activeResolve === 'function') {
    activeSettled = true
    activeResolve(confirmed)
  }

  activeResolve = null
  activeController = null
  activeOptions = {}
}

async function handleConfirmAction() {
  if (confirmDialogState.loading || confirmDialogState.disabled) {
    return
  }

  const onOk = activeOptions.onOk || activeOptions.onConfirm
  if (typeof onOk !== 'function') {
    finalizeDialog(true)
    return
  }

  confirmDialogState.loading = true
  try {
    const result = await onOk()
    if (result === false) {
      confirmDialogState.loading = false
      return
    }
    finalizeDialog(true)
  } catch {
    confirmDialogState.loading = false
  }
}

function handleCancelAction() {
  if (confirmDialogState.loading) {
    return
  }

  if (typeof activeOptions.onCancel === 'function') {
    try {
      activeOptions.onCancel()
    } catch {
      // 取消回调仅做清理，不中断关闭流程
    }
  }

  finalizeDialog(false)
}

export function confirmDialog(options = {}) {
  if (activeController) {
    activeController.destroy()
  }

  let resolvePromise
  const promise = new Promise((resolve) => {
    resolvePromise = resolve
  })

  activeSettled = false
  activeResolve = resolvePromise
  applyDialogState(options)

  activeController = Object.assign(promise, {
    destroy() {
      if (activeSettled) return
      activeSettled = true
      finalizeDialog(false, false)
      resolvePromise(false)
    },
    update(nextOptions = {}) {
      if (activeSettled) return
      applyDialogState({
        ...activeOptions,
        ...nextOptions
      })
    }
  })

  return activeController
}

export function installConfirmDialog(Modal) {
  if (!Modal || Modal.__vertexConfirmPatched) {
    return
  }

  const originalConfirm = typeof Modal.confirm === 'function' ? Modal.confirm.bind(Modal) : null

  Modal.confirm = (options = {}) => confirmDialog(options)
  Modal.__vertexConfirmPatched = true
  Modal.__vertexConfirmOriginal = originalConfirm
}

export { handleConfirmAction, handleCancelAction }
