import { readonly, reactive } from 'vue'

const state = reactive({
  open: false,
  jobId: '',
  itemId: ''
})

export function openNexusAuthorizationPanel(jobId = '', itemId = '') {
  const safeJobId = String(jobId || '').trim()
  if (!safeJobId) return false
  state.jobId = safeJobId
  state.itemId = String(itemId || '').trim()
  state.open = true
  return true
}

export function closeNexusAuthorizationPanel() {
  state.open = false
  state.itemId = ''
}

export function useNexusAuthorizationPanel() {
  return {
    state: readonly(state),
    setOpen(open = false) {
      if (open) state.open = true
      else closeNexusAuthorizationPanel()
    }
  }
}

