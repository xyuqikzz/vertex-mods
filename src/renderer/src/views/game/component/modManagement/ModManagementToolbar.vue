<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  useId,
  watch
} from 'vue'
import { useRoute } from 'vue-router'
import {
  FolderAddOutlined,
  ReloadOutlined,
  DownloadOutlined,
  MoreOutlined,
  DownOutlined,
  CheckOutlined,
  DeleteOutlined,
  WarningOutlined
} from '@ant-design/icons-vue'
import { VxButton, VxSegmented, VxTag } from '@renderer/component/vertex-ui'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'
import { useModManagementControllerContext } from './mod-management-context.js'

const controller = useModManagementControllerContext()
const ui = inject('mod-management-ui', null)
const route = useRoute()
const profileOpen = ref(false)
const profileTrigger = ref(null)
const profileMenu = ref(null)
const profilePosition = ref({})
const profileSwitchPending = ref(false)
const profileId = useId()
const menuOpen = ref(false)
const trigger = ref(null)
const menu = ref(null)
const position = ref({})
const gameName = computed(() => String(route.query.name || '模组管理'))
const sourceLabel = computed(() => resolveSourcePlatformLabel(controller.activeSource, '本地模组'))
const subtitle = computed(() =>
  [route.query.community || route.query.sourceId, sourceLabel.value].filter(Boolean).join(' · ')
)
const primaryKeys = [
  'manage-local-mod',
  'bind-local',
  'import-local-mod',
  'check-updates',
  'update-all'
]
const primaryActions = computed(() => {
  const actions = (controller.toolbarPrimaryActions || [])
    .filter((action) => primaryKeys.includes(action.key))
    .sort((a, b) => primaryKeys.indexOf(a.key) - primaryKeys.indexOf(b.key))
  if (!actions.some((action) => action.key === 'update-all')) {
    actions.push({ key: 'update-all', labelKey: 'ui.updateAll', get label() { return uiText('ui.updateAll') }, disabled: !ui?.counts.update })
  }
  return actions
})
const menuOrder = ['enable-all', 'disable-all', 'refresh']
// 低频的整页操作收进「更多操作」；危险项由模板放在分隔线之后。
const menuActions = computed(() => [
  ...(controller.toolbarPrimaryActions || [])
    .filter((action) => !primaryKeys.includes(action.key))
    .sort(
      (a, b) =>
        (menuOrder.indexOf(a.key) + 1 || menuOrder.length + 1) -
        (menuOrder.indexOf(b.key) + 1 || menuOrder.length + 1)
    ),
  ...(controller.toolbarDangerActions || [])
])
// Read the operation state independently of its localized label.
function isChecking(action) {
  return action.key === 'check-updates' && Boolean(action.loading)
}
const updatingAll = computed(() => Boolean(ui?.updatingCount))
const endpointOptions = computed(() =>
  (controller.workspaceTabs || [])
    .filter((tab) => ['client', 'server'].includes(tab.key))
    .map((tab) => ({ value: tab.key, label: `${tab.label} ${tab.count}` }))
)
function actionText(action) {
  if (isChecking(action)) return uiText('ui.checkingVariant2')
  if (action.key === 'check-updates') return uiText('tools.checkForUpdates')
  if (action.key === 'update-all' && updatingAll.value) return uiText('ui.updatingVariant3')
  return action.label
}
const isThunderstore = computed(
  () => controller.activeSource === controller.SOURCE_TYPE.THUNDERSTORE
)
const currentProfile = computed(() =>
  String(
    isThunderstore.value
      ? controller.thunderstoreProfile || 'default'
      : controller.activeManagedProfile || 'default'
  )
)
const profileOptions = computed(() =>
  (isThunderstore.value
    ? controller.thunderstoreProfileOptions || []
    : controller.activeManagedProfileOptions || []
  ).map((item, index) => {
    const value = String(typeof item === 'string' ? item : item.value || item.name)
    const isDefault =
      typeof item === 'string'
        ? index === 0
        : (item.isDefault ??
          (/（默认）|\(默认\)/.test(item.label || '') || value.toLowerCase() === 'default'))
    return {
      value,
      isDefault,
      count: typeof item === 'object' && Number.isFinite(item.totalCount) ? item.totalCount : null
    }
  })
)
const currentProfileIsDefault = computed(
  () =>
    profileOptions.value.find((item) => item.value === currentProfile.value)?.isDefault ??
    currentProfile.value.toLowerCase() === 'default'
)
const profileVisible = computed(
  () => isThunderstore.value || controller.activeManagedProfileVisible
)
const profileLoading = computed(
  () =>
    profileSwitchPending.value ||
    controller.currentListLoading ||
    controller.isThunderstoreProfileBusy ||
    controller.isManagedSourceProfileBusy
)
const profileBusy = computed(() => ui?.busy || profileLoading.value)
const profileActions = computed(() =>
  isThunderstore.value &&
  !currentProfileIsDefault.value &&
  typeof controller.deleteThunderstoreProfileConfirm === 'function'
    ? [{ key: 'delete', labelKey: 'ui.deleteCurrentProfile', get label() { return uiText('ui.deleteCurrentProfile') } }]
    : []
)

function closeProfile(restore = false) {
  profileOpen.value = false
  if (restore) profileTrigger.value?.focus()
}
function updateProfilePosition() {
  if (!profileOpen.value) return
  const rect = profileTrigger.value?.$el?.getBoundingClientRect()
  if (!rect) return
  const gap = 4
  const availableBelow = window.innerHeight - rect.bottom - gap - 8
  const above = availableBelow < 180 && rect.top > availableBelow
  profilePosition.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`,
    top: above ? 'auto' : `${rect.bottom + gap}px`,
    bottom: above ? `${window.innerHeight - rect.top + gap}px` : 'auto',
    maxHeight: `${Math.max(80, above ? rect.top - gap - 8 : availableBelow)}px`
  }
}
async function openProfile() {
  if (profileBusy.value) return
  if (profileOpen.value) {
    closeProfile(true)
    return
  }
  closeMenu()
  profileOpen.value = true
  updateProfilePosition()
  await nextTick()
  const options = [...(profileMenu.value?.querySelectorAll('[role="option"]') || [])]
  ;(
    options.find((option) => option.getAttribute('aria-selected') === 'true') || options[0]
  )?.focus()
}
async function selectProfile(option) {
  if (profileBusy.value) return
  closeProfile(true)
  if (option.value === currentProfile.value) return
  profileSwitchPending.value = true
  try {
    await (isThunderstore.value
      ? controller.handleThunderstoreProfileSelect(option.value)
      : controller.handleManagedSourceProfileSelect(option.value))
    await nextTick()
  } finally {
    profileSwitchPending.value = false
  }
}
function profileKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeProfile(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...profileMenu.value.querySelectorAll('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  } else if (event.key === 'Tab') closeProfile(true)
}
function runProfileAction() {
  closeProfile(true)
  controller.deleteThunderstoreProfileConfirm(currentProfile.value)
}
watch(
  () => controller.activeSource,
  () => closeProfile()
)

function closeMenu(restore = false) {
  menuOpen.value = false
  if (restore) trigger.value?.focus()
}
function updatePosition() {
  updateProfilePosition()
  const rect = trigger.value?.$el?.getBoundingClientRect()
  if (!rect) return
  position.value = {
    top: `${rect.bottom + 4}px`,
    right: `${Math.max(8, window.innerWidth - rect.right)}px`
  }
}
async function openMenu() {
  closeProfile()
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) return
  updatePosition()
  await nextTick()
  menu.value?.querySelector('button:not(:disabled)')?.focus()
}
function menuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...menu.value.querySelectorAll('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  } else if (event.key === 'Tab') closeMenu(true)
}
function outsideClick(event) {
  if (
    profileOpen.value &&
    !profileMenu.value?.contains(event.target) &&
    !profileTrigger.value?.$el?.contains(event.target)
  )
    closeProfile()
  if (
    menuOpen.value &&
    !menu.value?.contains(event.target) &&
    !trigger.value?.$el?.contains(event.target)
  )
    closeMenu()
}
function runAction(action) {
  closeMenu(true)
  if (ui) ui.toolbarAction(action)
  else controller.handleToolbarAction(action.key)
}
onMounted(() => {
  document.addEventListener('pointerdown', outsideClick)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsideClick)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
onDeactivated(() => {
  closeMenu()
  closeProfile()
})
</script>

<template>
  <div class="mm-toolbar-wrap">
    <header class="mm-toolbar-panel">
      <div class="mm-game-identity">
        <div class="mm-game-copy">
          <h1 :title="gameName">{{ gameName }}</h1>
          <p :title="subtitle">{{ subtitle }}</p>
        </div>
      </div>
      <span
        v-if="profileVisible || endpointOptions.length > 1"
        class="mm-toolbar-divider"
        aria-hidden="true"
      ></span>
      <span v-if="profileVisible" class="mm-toolbar-label" aria-hidden="true">{{ $t('ui.configuration') }}</span>
      <VxButton
        v-if="profileVisible"
        ref="profileTrigger"
        variant="secondary"
        size="sm"
        class="mm-profile-trigger"
        :class="{ 'is-open': profileOpen }"
        :disabled="Boolean(profileBusy)"
        :loading="Boolean(profileLoading)"
        aria-haspopup="listbox"
        :aria-expanded="profileOpen"
        :aria-controls="`${profileId}-listbox`"
        :aria-label="$t('ui.profileValue', { value1: (currentProfile) })"
        @click="openProfile"
        @keydown.down.prevent="openProfile"
        @keydown.up.prevent="openProfile"
      >
        <span class="mm-profile-current" :title="currentProfile">{{ currentProfile }}</span>
        <VxTag v-if="currentProfileIsDefault" size="sm" class="mm-profile-default">{{ $t('ui.default') }}</VxTag>
        <DownOutlined class="mm-profile-arrow" aria-hidden="true" />
      </VxButton>
      <VxSegmented
        v-if="endpointOptions.length > 1"
        class="mm-endpoints"
        :model-value="controller.activeTab"
        :options="endpointOptions"
        :aria-label="$t('ui.deploymentLocation')"
        @update:model-value="controller.activeTab = $event"
      />
      <div class="mm-toolbar-actions">
        <VxButton
          v-for="action in primaryActions"
          :key="action.key"
          size="sm"
          :variant="action.key === 'update-all' ? 'primary' : 'secondary'"
          :class="`mm-action-${action.key}`"
          :title="actionText(action)"
          :aria-label="actionText(action)"
          :aria-busy="isChecking(action) || (action.key === 'update-all' && updatingAll)"
          :disabled="
            action.disabled ||
            Boolean(ui?.busy) ||
            (action.key === 'update-all' && ui && !ui.counts.update)
          "
          @click="runAction(action)"
        >
          <span
            v-if="isChecking(action) || (action.key === 'update-all' && updatingAll)"
            class="mm-spin"
            aria-hidden="true"
          ></span>
          <DownloadOutlined v-else-if="action.key === 'update-all'" />
          <ReloadOutlined v-else-if="action.key === 'check-updates'" />
          <FolderAddOutlined v-else />
          <span class="mm-action-text">{{ actionText(action) }}</span>
          <span
            v-if="action.key === 'update-all' && ui?.counts.update && !updatingAll"
            class="mm-update-count"
            >{{ ui.counts.update }}</span
          >
        </VxButton>
        <VxButton
          ref="trigger"
          variant="secondary"
          size="sm"
          class="mm-more-trigger"
          :class="{ 'is-open': menuOpen }"
          :aria-label="$t('ui.moreActions')"
          :title="$t('ui.moreActions')"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :disabled="Boolean(ui?.busy)"
          @click="openMenu"
          @keydown.down.prevent="openMenu"
        >
          <MoreOutlined />
        </VxButton>
      </div>
    </header>
    <div v-if="controller.sourceErrorText" class="mm-alert" role="alert">
      <WarningOutlined aria-hidden="true" />{{ controller.sourceErrorText }}
    </div>
    <Teleport to="body">
      <div
        v-if="profileOpen"
        ref="profileMenu"
        class="mm-profile-popover mm-scrollbar"
        :style="profilePosition"
        @keydown="profileKeydown"
      >
        <div :id="`${profileId}-label`" class="mm-profile-heading">{{ $t('ui.switchProfileVariant2') }}</div>
        <div :id="`${profileId}-listbox`" role="listbox" :aria-labelledby="`${profileId}-label`">
          <VxButton
            v-for="option in profileOptions"
            :key="option.value"
            variant="ghost"
            size="sm"
            role="option"
            class="mm-profile-option"
            :class="{ 'is-current': option.value === currentProfile }"
            :aria-selected="option.value === currentProfile"
            :disabled="Boolean(profileBusy)"
            @click="selectProfile(option)"
          >
            <span class="mm-profile-option-name" :title="option.value">{{ option.value }}</span>
            <VxTag v-if="option.isDefault" size="sm" class="mm-profile-default">{{ $t('ui.default') }}</VxTag>
            <span v-if="option.count !== null" class="mm-profile-count"
              >{{ option.count }} {{ $t('ui.mods') }}</span
            >
            <CheckOutlined
              v-if="option.value === currentProfile"
              class="mm-profile-check"
              aria-hidden="true"
            />
          </VxButton>
        </div>
        <template v-if="profileActions.length">
          <div class="mm-menu-divider" role="separator"></div>
          <VxButton
            v-for="action in profileActions"
            :key="action.key"
            variant="ghost"
            size="sm"
            class="mm-profile-action mm-danger-text"
            :disabled="Boolean(profileBusy)"
            @click="runProfileAction"
            ><DeleteOutlined />{{ action.label }}</VxButton
          >
        </template>
      </div>

      <div
        v-if="menuOpen"
        ref="menu"
        class="mm-more-menu"
        role="menu"
        :aria-label="$t('ui.moreActions')"
        :style="position"
        @keydown="menuKeydown"
      >
        <template v-for="action in menuActions" :key="action.key">
          <div v-if="action.tone === 'danger'" class="mm-menu-divider" role="separator"></div>
          <VxButton
            variant="ghost"
            size="sm"
            role="menuitem"
            :class="{ 'mm-danger-text': action.tone === 'danger' }"
            :disabled="action.disabled"
            @click="runAction(action)"
            >{{ action.label }}{{ action.tone === 'danger' ? '…' : '' }}</VxButton
          >
        </template>
      </div>
    </Teleport>
  </div>
</template>
