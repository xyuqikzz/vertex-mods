import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { onScopeDispose, ref } from 'vue'

// 确认和统一本地管理弹窗拥有自己的状态；业务变更通过回调交给协调入口。
export function useModManagementDialogs({ toDisplayText }) {
  const clientConfirmDialog = ref(createClientConfirmDialogState())

  const localModManagerDialog = ref(false)

  function createClientConfirmDialogState() {
    return {
      open: false,
      title: '',
      subtitle: '',
      description: '',
      tone: 'default',
      toneLabel: '',
      get confirmText() { return uiText('ui.confirm') },
      get cancelText() { return uiText('ui.cancel') },
      showCancel: true,
      closeOnMask: true,
      focusAction: '',
      disabled: false,
      loading: false,
      error: '',
      details: [],
      impacts: [],
      tags: [],
      onConfirm: null,
      resolver: null
    }
  }

  function buildConfirmTag(text = '', tone = 'default') {
    const label = String(text || '').trim()
    if (!label) return null
    return {
      text: label,
      tone: String(tone || 'default').trim() || 'default'
    }
  }

  function buildConfirmImpact(text = '', tone = 'default') {
    const value = String(text || '').trim()
    if (!value) return null
    return {
      text: value,
      tone: String(tone || 'default').trim() || 'default'
    }
  }

  function buildConfirmDetail(label = '', value = '', fallback = '--') {
    const safeLabel = String(label || '').trim()
    const safeValue = toDisplayText(value, fallback)
    if (!safeLabel || !String(safeValue || '').trim()) return null
    return {
      label: safeLabel,
      value: safeValue
    }
  }

  function closeClientConfirmDialog(confirmed = false) {
    const resolver = clientConfirmDialog.value?.resolver
    clientConfirmDialog.value = createClientConfirmDialogState()
    if (typeof resolver === 'function') {
      resolver(confirmed)
    }
  }

  function openClientConfirmDialog(payload = {}) {
    if (clientConfirmDialog.value.open) {
      closeClientConfirmDialog(false)
    }

    return new Promise((resolve) => {
      clientConfirmDialog.value = {
        ...createClientConfirmDialogState(),
        open: true,
        title: toDisplayText(payload.title, uiText('ui.confirmAction')),
        subtitle: toDisplayText(payload.subtitle, ''),
        description: toDisplayText(payload.description, ''),
        tone: String(payload.tone || 'default').trim() || 'default',
        toneLabel: toDisplayText(payload.toneLabel, ''),
        confirmText: toDisplayText(payload.confirmText, uiText('ui.confirm')),
        cancelText: toDisplayText(payload.cancelText, uiText('ui.cancel')),
        showCancel: payload.showCancel !== false,
        closeOnMask: payload.closeOnMask !== false,
        focusAction: toDisplayText(payload.focusAction, ''),
        disabled: !!payload.disabled,
        loading: false,
        details: Array.isArray(payload.details) ? payload.details.filter(Boolean) : [],
        impacts: Array.isArray(payload.impacts) ? payload.impacts.filter(Boolean) : [],
        tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [],
        onConfirm: typeof payload.onConfirm === 'function' ? payload.onConfirm : null,
        resolver: resolve
      }
    })
  }

  async function handleClientConfirm() {
    if (clientConfirmDialog.value.loading || clientConfirmDialog.value.disabled) {
      return
    }

    const dialog = clientConfirmDialog.value
    const action = dialog.onConfirm
    if (typeof action !== 'function') {
      closeClientConfirmDialog(true)
      return
    }

    clientConfirmDialog.value.loading = true
    clientConfirmDialog.value.error = ''
    try {
      const result = await action()
      if (result === false || result?.success === false) throw new Error(result?.message || uiText('ui.operationIncomplete'))
      if (clientConfirmDialog.value === dialog) closeClientConfirmDialog(true)
    } catch (error) {
      console.error('确认弹窗执行失败', error)
      if (clientConfirmDialog.value === dialog) {
        dialog.loading = false
        dialog.error = error?.message || '操作失败，请重试'
      }
    }
  }

  function handleClientCancel() {
    if (clientConfirmDialog.value.loading) return
    closeClientConfirmDialog(false)
  }

  // 关闭页面必须结清等待确认的流程；迟到操作不能关闭后来打开的弹窗。
  onScopeDispose(() => closeClientConfirmDialog(false))

  return {
    clientConfirmDialog,
    localModManagerDialog,
    buildConfirmTag,
    buildConfirmImpact,
    buildConfirmDetail,
    openClientConfirmDialog,
    handleClientConfirm,
    handleClientCancel
  }
}
