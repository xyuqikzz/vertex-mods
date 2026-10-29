import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'

export function useCommunityInstall(identity) {
  const { t } = useI18n()
  const invoke = (channel, payload) => ipcRenderer.invoke(channel, sanitizeIpcPayload(payload))
  const detailRequests = new Set()
  const context = ref({ state: 'loading' })
  const contextBusy = ref(false)
  const installed = ref([])
  const busy = ref({})
  const profileOpen = ref(false)
  const operationBusy = ref(false)
  const files = ref({ open: false, detail: null, mode: 'download', busy: false, error: '' })
  function closeFiles() {
    if (files.value.busy) return
    files.value = { ...files.value, open: false, error: '' }
  }
  const profiles = useModSourceProfiles({
    sourceKey: identity.source,
    identifier: () => identity.sourceGameId
  })
  const canInstall = computed(() => context.value.state === 'identified')
  const canManage = computed(() => context.value.canManage === true || canInstall.value)
  const canLaunch = computed(() => canManage.value && Boolean(context.value.game?.exePath))
  const hasRule = computed(() => Boolean(context.value.document))
  let disposed = false
  let installedRequest = 0
  const sourceMeta = computed(() => ({
    ...context.value.sourceMeta,
    profileName: profiles.activeProfileName.value
  }))
  const statusText = computed(() =>
    contextBusy.value
      ? t('modBrowser.scanning')
      : {
          identified: t('modBrowser.identified'),
          unidentified: t('modBrowser.unidentified'),
          no_rule: t('modBrowser.noRule'),
          rule_error: t('modBrowser.ruleError'),
          loading: t('modBrowser.loadingRule')
        }[context.value.state] || t('modBrowser.unknownStatus')
  )

  async function refreshInstalled() {
    const request = ++installedRequest
    if (!canManage.value) {
      installed.value = []
      return
    }
    try {
      const result = await invoke('getInstalledModsBySource', {
        appId: context.value.appId,
        sourceMeta: sourceMeta.value,
        endpointType: 0
      })
      if (!result?.success) throw new Error(result?.message || t('modBrowser.installedFailed'))
      if (!disposed && request === installedRequest) installed.value = result.records || []
    } catch (error) {
      if (!disposed && request === installedRequest) {
        installed.value = []
        $message.error(error.message)
      }
    }
  }
  async function loadContext(select = false) {
    if (contextBusy.value) return
    contextBusy.value = true
    try {
      const result = await invoke(
        select ? 'community:select-directory' : 'community:context',
        identity
      )
      if (!result.success) throw new Error(result.message)
      if (disposed || result.data.canceled) return
      context.value = result.data
      await refreshInstalled()
    } catch (error) {
      if (!disposed) context.value = { state: 'rule_error', message: error.message }
    } finally {
      contextBusy.value = false
    }
  }
  function installedFor(id) {
    return installed.value.filter((record) => {
      const key = String(record.source_mod_key || '')
      return key === `${identity.source}:${id}` || key.startsWith(`${identity.source}:${id}:`)
    })
  }
  async function submit(detail, file, mode) {
    if (files.value.busy) return
    files.value.busy = true
    files.value.error = ''
    busy.value = { ...busy.value, [detail.id]: true }
    try {
      const result = await invoke('community:submit', {
        ...identity,
        mode,
        modId: detail.id,
        fileId: file.id,
        profileName: profiles.activeProfileName.value,
        sharedRuleDocument: context.value.document?.sharedRuleDocument
      })
      if (!result.success || result.data?.success === false)
        throw new Error(result.message || result.data?.message || t('modBrowser.submitFailed'))
      files.value.open = false
      $message.success(mode === 'install' ? t('modBrowser.queued') : t('modBrowser.queuedDownload'))
    } catch (error) {
      files.value.error = error.message
      $message.error(error.message)
    } finally {
      files.value.busy = false
      busy.value = { ...busy.value, [detail.id]: false }
    }
  }
  async function primary(item, mode = canInstall.value ? 'install' : 'download') {
    if (busy.value[item.id]) return
    busy.value = { ...busy.value, [item.id]: true }
    let requestId
    try {
      // Steam 创意工坊也先读取物品详情并打开确认弹窗，提交时主进程会再次核验文件。
      requestId = crypto.randomUUID()
      detailRequests.add(requestId)
      const response = await invoke('community:detail', { ...identity, modId: item.id, networkRequestId: requestId })
      if (!response.success) throw new Error(response.message)
      if (disposed) return
      const detail = response.data
      files.value = { open: true, detail, mode, busy: false, error: '' }
    } catch (error) {
      if (!disposed) $message.error(error.message)
    } finally {
      if (requestId) detailRequests.delete(requestId)
      busy.value = { ...busy.value, [item.id]: false }
    }
  }
  const headerActions = computed(() => [
    { key: 'profile', label: t('modBrowser.profiles'), disabled: !canManage.value || operationBusy.value },
    { key: 'manage', label: t('modBrowser.manage'), disabled: !canManage.value },
    { key: 'launch', label: t('modBrowser.launch'), type: 'primary', disabled: !canLaunch.value },
    { key: 'scan', label: t('modBrowser.scan'), placement: 'more', loading: contextBusy.value },
    {
      key: 'manual-bind',
      label: t('modBrowser.manual'),
      placement: 'more',
      disabled: !hasRule.value || contextBusy.value
    },
    { key: 'open-root', label: t('modBrowser.openRoot'), placement: 'more', visible: canManage.value },
    { key: 'source', label: t('modBrowser.openSource'), placement: 'more' },
    { key: 'back', label: t('modBrowser.back'), placement: 'more' }
  ])
  const dlssContext = computed(() => ({
    name: identity.gameName,
    gameRoot: context.value.game?.rootPath || '',
    exePath: context.value.game?.exePath || '',
    steamAppId: context.value.appId || 0,
    sourcePlatform: identity.source
  }))
  async function headerAction(key) {
    if (key === 'scan') await loadContext()
    if (key === 'manual-bind') await loadContext(true)
    if (key === 'profile') profileOpen.value = true
    if (key === 'launch' && canLaunch.value)
      ipcRenderer.send(
        'startSpecifiedApp',
        sanitizeIpcPayload({ path: context.value.game.exePath, steamAppId: null })
      )
    if (key === 'open-root' && canManage.value)
      ipcRenderer.send('openSpecifyPath', { path: context.value.game.rootPath })
  }
  const profilePayload = computed(() => ({
    appId: context.value.appId,
    source: identity.source,
    sourceId: identity.sourceGameId,
    sourceSlug: context.value.document?.gameKey || context.value.sourceMeta?.sourceSlug,
    endpointType: 0
  }))
  async function profileOperation(operation, args, after) {
    if (operationBusy.value) return
    operationBusy.value = true
    try {
      const result = await invoke(`sourceProfile:${operation}`, {
        ...profilePayload.value,
        ...args
      })
      if (!result?.success) throw new Error(result?.message || uiText('ui.profileOperationFailed'))
      after()
      await refreshInstalled()
    } catch (error) {
      $message.error(error.message)
      return { success: false, message: error.message }
    } finally {
      operationBusy.value = false
    }
  }
  async function switchProfile(name) {
    await profileOperation(
      'switch',
      { currentProfile: profiles.activeProfileName.value, targetProfile: name },
      () => profiles.setSelectedProfile(name)
    )
  }
  function createProfile(name) {
    const result = profiles.addProfile(name)
    if (!result.ok) $message.warning(result.reason)
  }
  async function renameProfile({ profileName, name }) {
    const valid = profiles.validateProfileRename(profileName, name)
    if (!valid.ok) {
      $message.warning(valid.reason)
      return
    }
    await profileOperation('rename', { previousProfile: profileName, nextProfile: name }, () =>
      profiles.renameProfile(profileName, name)
    )
  }
  async function deleteProfile(name) {
    return profileOperation('delete', { profileName: name }, () => profiles.removeProfile(name))
  }
  const taskUpdated = (_event, task) => {
    if (
      task?.source === identity.source &&
      ['completed', 'partial_failed', 'failed'].includes(task.state)
    )
      refreshInstalled()
  }
  ipcRenderer.on('source-install-task:updated', taskUpdated)
  onBeforeUnmount(() => {
    disposed = true
    for (const id of detailRequests) window.api.network.cancel(id).catch(() => {})
    detailRequests.clear()
    ipcRenderer.removeListener('source-install-task:updated', taskUpdated)
  })
  return {
    context,
    contextBusy,
    statusText,
    canInstall,
    hasRule,
    headerActions,
    dlssContext,
    loadContext,
    headerAction,
    installedFor,
    busy,
    primary,
    files,
    closeFiles,
    submit,
    profiles,
    profileOpen,
    operationBusy,
    switchProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    installed,
    refreshInstalled
  }
}
