import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, onActivated, onDeactivated, onScopeDispose, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useModSourceProfiles } from '@renderer/hooks/useModSourceProfiles.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { gamePresentation } from '@renderer/i18n/content.js'
import { useI18n } from 'vue-i18n'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import { localSourceCards, filterLocalSourceCards } from './adapters/local-source-adapter.js'
import { getManagedModSourceUrl, withModDirectoryAction } from '../../../../../../shared/games/mod-management-location.js'
import { openManagedModLocation } from './open-mod-location.js'

export function useLocalSourceModManagement() {
  const route = useRoute()
  const source = String(route.params.source)
  const sourceId = String(route.params.id)
  const query = { ...route.query }
  const appId = Number(query.appId || 0)
  const { t } = useI18n()
  const title = computed(() => gamePresentation({ name: String(query.name || sourceId), englishTitle: String(query.englishTitle || '') }).title)
  const { setMenuName } = useMenuName()
  const profiles = useModSourceProfiles({ sourceKey: source, identifier: () => sourceId })
  const records = ref([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const keyword = ref('')
  const tab = ref('all')
  const selectedKey = ref('')
  const confirmation = reactive({
    open: false,
    title: '',
    description: '',
    danger: false,
    action: null
  })
  let serial = 0
  let active = true
  let disposed = false
  const invoke = (channel, payload) =>
    ipcRenderer.invoke(channel, JSON.parse(JSON.stringify(payload)))
  const sourceMeta = () => ({
    source,
    sourceId,
    appId,
    sourceSlug: String(query.sourceSlug || ''),
    profileName: profiles.activeProfileName.value
  })
  async function refresh() {
    const request = ++serial
    loading.value = true
    error.value = ''
    try {
      const result = await invoke('getInstalledModsBySource', {
        appId,
        sourceMeta: sourceMeta(),
        endpointType: 0
      })
      if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotReadLocalMods'))
      if (!disposed && request === serial) records.value = result.records || []
    } catch (failure) {
      if (!disposed && request === serial) error.value = failure.message || '读取失败，请重试'
    } finally {
      if (!disposed && request === serial) loading.value = false
    }
  }
  async function mutate(channel, payload) {
    if (busy.value) throw new Error(uiText('tools.anotherOperationIsInProgressTryAgainLater'))
    busy.value = true
    try {
      const result = await invoke(channel, payload)
      if (!result || result.success === false) throw new Error(result?.message || uiText('ui.operationFailedVariant2'))
      await refresh()
    } finally {
      busy.value = false
    }
  }
  function confirm(title, description, action, danger = false) {
    if (busy.value || confirmation.open) return
    Object.assign(confirmation, { open: true, title, description, action, danger })
  }
  function remove(card) {
    if (card.disabled || card.toggle.checked) return
    confirm(
      '卸载模组',
      uiText('ui.uninstallValue', { value1: (card.title) }),
      () => mutate('uninstallModById', { id: card.raw.id }),
      true
    )
  }
  async function toggle(card, checked) {
    if (busy.value || card.disabled) return
    try {
      await mutate('toggleModState', { id: card.raw.id, isActive: Boolean(checked) })
    } catch (failure) {
      $message.error(failure.message || '切换失败')
    }
  }
  function switchProfile(profile) {
    if (profile === profiles.activeProfileName.value) return
    confirm('切换配置方案', uiText('ui.switchToValueAndUpdateTheEnabledModsInThe', { value1: (profile) }), async () => {
      if (busy.value) throw new Error(uiText('ui.anOperationIsAlreadyRunning'))
      busy.value = true
      try {
        const result = await invoke('sourceProfile:switch', {
          ...sourceMeta(),
          endpointType: 0,
          currentProfile: profiles.activeProfileName.value,
          targetProfile: profile
        })
        if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotSwitchProfile'))
        if (!disposed) profiles.setSelectedProfile(profile)
      } finally {
        busy.value = false
      }
    })
  }
  const cards = computed(() => localSourceCards(records.value, source, busy.value || loading.value))
  const displayCards = computed(() => filterLocalSourceCards(cards.value, keyword.value, tab.value))
  const selectedCard = computed(
    () => displayCards.value.find((card) => card.key === selectedKey.value) || null
  )
  watch(
    displayCards,
    (rows) => {
      if (!rows.some((row) => row.key === selectedKey.value)) selectedKey.value = rows[0]?.key || ''
    },
    { immediate: true }
  )
  watch(profiles.activeProfileName, () => {
    records.value = []
    refresh()
  })
  useIpc('source-install-task:updated', (task) => {
    if (
      active &&
      !busy.value &&
      task?.source === source &&
      ['completed', 'partial_failed', 'failed'].includes(task.state)
    )
      refresh()
  })
  onActivated(() => {
    active = true
    setMenuName(() => t('modBrowser.managementTab', { name: title.value }))
    refresh()
  })
  onDeactivated(() => {
    active = false
  })
  onScopeDispose(() => {
    disposed = true
    serial++
  })
  const profileOptions = computed(() =>
    profiles.profileOptions.value.map((item) => ({ value: item.name, label: item.label }))
  )
  const workspaceController = reactive({
    SOURCE_TYPE: { THUNDERSTORE: 'thunderstore' },
    activeSource: source,
    activeTab: tab,
    sourceErrorText: error,
    isBatchUninstalling: busy,
    workspaceTabs: computed(() => [
      { key: 'all', labelKey: 'tools.all', get label() { return uiText('tools.all') }, count: records.value.length },
      {
        key: 'enabled',
        labelKey: 'ui.enabled', get label() { return uiText('ui.enabled') },
        count: records.value.filter((row) => Number(row.is_active) === 1).length
      },
      {
        key: 'disabled',
        labelKey: 'ui.disabled', get label() { return uiText('ui.disabled') },
        count: records.value.filter((row) => Number(row.is_active) !== 1).length
      }
    ]),
    activeManagedProfileVisible: true,
    activeManagedProfile: profiles.activeProfileName,
    activeManagedProfileOptions: profileOptions,
    isManagedSourceProfileBusy: busy,
    handleManagedSourceProfileSelect: switchProfile,
    toolbarScopeText: computed(() => `${title.value} · ${resolveSourcePlatformLabel(source)}`),
    toolbarPrimaryActions: computed(() => [
      { key: 'refresh', labelKey: 'tools.refreshList', get label() { return uiText('tools.refreshList') }, disabled: busy.value || loading.value }
    ]),
    toolbarDangerActions: [],
    sideOverviewPills: [],
    modSearchKeyword: keyword,
    listHeadCount: computed(() => displayCards.value.length),
    filteredEnabledCount: computed(
      () => displayCards.value.filter((card) => card.toggle.checked).length
    ),
    currentListLoading: loading,
    displayCards,
    selectedModKey: selectedKey,
    selectedCard,
    currentDisplayEmptyState: computed(() => ({
      title: error.value
        ? uiText('ui.couldNotLoadLocalMods')
        : records.value.length
          ? uiText('ui.noMatchingMods')
          : uiText('ui.noModsAreInstalledInThisProfileYet'),
      desc: error.value || '可调整搜索、筛选或刷新列表。'
    })),
    selectedDetailActions: computed(() => withModDirectoryAction(selectedCard.value, selectedCard.value?.actions || [])),
    handleDetailAction: (card, key) => {
      if (key === 'open-install-root') return openManagedModLocation(card.raw)
      if (key === 'open-source-page') {
        const url = getManagedModSourceUrl(card.raw, source)
        if (url) ipcRenderer.send('openBrowse', { url })
      }
    },
    selectedDetailInfo: computed(() => ({
      infoGroups: selectedCard.value
        ? [
            {
              get title() { return uiText('ui.installationInformation') },
              rows: [
                { labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: resolveSourcePlatformLabel(source) },
                { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: selectedCard.value.raw.version || '--' },
                { labelKey: 'ui.configuration', get label() { return uiText('ui.configuration') }, value: profiles.activeProfileName.value },
                { labelKey: 'tools.installedOn', get label() { return uiText('tools.installedOn') }, value: selectedCard.value.raw.installed_at || selectedCard.value.raw.created_at || '--' },
                { labelKey: 'ui.recordID', get label() { return uiText('ui.recordID') }, value: String(selectedCard.value.raw.id) }
              ]
            }
          ]
        : []
    })),
    handleToolbarAction: (action) => {
      if (action === 'refresh' && !busy.value) return refresh()
    },
    selectMod: (key) => {
      selectedKey.value = key
    },
    handleListItemToggle: toggle,
    handleDetailToggle: toggle,
    handleListItemDelete: remove,
    handleDetailDelete: remove,
    prioritySortSupported: false,
    priorityOrderDirty: false
  })
  return { workspaceController, confirmation }
}
