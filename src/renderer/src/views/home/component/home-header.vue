<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getUserAvatarInitial } from '../../../../../shared/account/user-avatar.js'
import router from '@renderer/router/index.js'
import { useUserStore } from '@renderer/store/userStore.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import UserLogin from '@renderer/component/auth/user-login.vue'
import { taskCenterBadgeCount } from '../../../../../shared/tasks/task-center-counts.js'
import installTaskSvg from '@renderer/assets/icons/install-task.svg'
import settingsSvg from '@renderer/assets/icons/settings.svg'
import devSvg from '@renderer/assets/icons/devSvg.svg'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { useInstallStore } from '@renderer/store/installStore.js'
import { mergeInstallTaskSummary } from '@renderer/views/game/component/task-center/task-center-view-model.js'

const props = defineProps({
  currentTime: {
    type: String,
    default: ''
  },
  currentDate: {
    type: String,
    default: ''
  },
  defaultAvatar: {
    type: String,
    default: ''
  }
})

const { t } = useI18n()
const userStore = useUserStore()
const downloadStore = useDownloadStore()
const installStore = useInstallStore()
const userLoginRef = ref()
const sourceInstallTaskSummary = ref({})
const sourceInstallTaskQuantity = computed(
  () =>
    taskCenterBadgeCount(mergeInstallTaskSummary(sourceInstallTaskSummary.value, installStore.waitingInstallList).badgeCount, downloadStore.downloadList)
)
let sourceInstallTaskSummarySerial = 0
let sourceInstallTaskSummaryTimer = null

const headerUserAvatar = computed(() => {
  if (userStore.isLogin) {
    return userStore.userInfo?.avatar || ''
  }
  return props.defaultAvatar
})
const avatarFailed = ref(false)
const greeting = computed(() => {
  const hour = Number(String(props.currentTime || '').split(':')[0])
  if (!Number.isFinite(hour)) return t('home.welcome')
  if (hour < 5) return t('home.lateNight')
  if (hour < 11) return t('home.morning')
  if (hour < 13) return t('home.noon')
  if (hour < 18) return t('home.afternoon')
  return t('home.evening')
})
watch(headerUserAvatar, () => { avatarFailed.value = false })


function handleStatClick() {
  router.push('/app/game/repository')
}

function handleFeedbackClick() {
  window.open('https://github.com/xyuqikzz/vertex-mods/issues', '_blank')
}

function handleUserClick() {
  if (userStore.isLogin) {
    router.push('/app/user')
    return
  }
  userLoginRef.value?.open()
}

function handleSettingsClick() {
  router.push('/app/settings')
}


function handleInstallTaskClick() {
  router.push('/app/game/install-tasks')
}

function handleDevClick() {
  router.push('/app/devConsole')
}

async function loadSourceInstallTaskSummary() {
  const requestSerial = ++sourceInstallTaskSummarySerial
  try {
    const result = await ipcRenderer.invoke('source-install-task:summary', {})
    if (requestSerial !== sourceInstallTaskSummarySerial) return
    sourceInstallTaskSummary.value = result || {}
  } catch (error) {
    if (requestSerial !== sourceInstallTaskSummarySerial) return
    console.warn('读取安装任务数量失败', error)
  }
}

function scheduleSourceInstallTaskSummary() {
  if (sourceInstallTaskSummaryTimer) return
  sourceInstallTaskSummaryTimer = setTimeout(() => {
    sourceInstallTaskSummaryTimer = null
    loadSourceInstallTaskSummary()
  }, 300)
}

useIpc('source-install-task:updated', loadSourceInstallTaskSummary)
useIpc('source-install-task:item-updated', scheduleSourceInstallTaskSummary)
useIpc('source-install-task:artifact-updated', scheduleSourceInstallTaskSummary)

onMounted(() => {
  installStore.cleanupInstallTasks()
  loadSourceInstallTaskSummary()
})

onUnmounted(() => {
  if (sourceInstallTaskSummaryTimer) {
    clearTimeout(sourceInstallTaskSummaryTimer)
    sourceInstallTaskSummaryTimer = null
  }
})
</script>

<template>
  <header class="header-section">
    <div class="header-left">
      <button class="user-panel" type="button" @click="handleUserClick">
        <span class="user-avatar-box">
          <img v-if="headerUserAvatar && !avatarFailed" :src="headerUserAvatar" class="user-avatar" :alt="t('home.avatar')" @error="avatarFailed = true" />
          <span v-else class="user-avatar-initial" :aria-label="t('home.defaultAvatar')">{{ getUserAvatarInitial(userStore.userInfo?.nickname) }}</span>
        </span>

        <span class="user-info">
          <span class="user-name">
            {{ userStore.isLogin ? userStore.userInfo?.nickname || t('home.myAccount') : t('home.signIn') }}
          </span>

          <span class="user-meta">
            <span class="user-desc">{{ userStore.isLogin ? greeting : t('home.profileHint') }}</span>
          </span>
        </span>
      </button>
    </div>

    <div class="header-center">
      <nav class="system-controls" :aria-label="t('home.navigation')">
        <button class="header-action-btn btn-my-games" type="button" @click="handleStatClick">
          <span>{{ t('nav.library') }}</span>
        </button>

        <button
          class="header-action-btn btn-feedback"
          type="button"
          @click="handleFeedbackClick"
        >
          <span>{{ t('home.feedback') }}</span>
        </button>

        <button
          v-if="userStore.isLogin"
          class="header-action-btn btn-my"
          type="button"
          @click="handleUserClick"
        >
          <span>{{ t('nav.account') }}</span>
        </button>
      </nav>
    </div>

    <div class="header-right">
      <div class="action-group" :aria-label="t('home.shortcuts')">
        <button
          class="icon-btn dev-btn"
          type="button"
          :title="t('nav.console')"
          @click="handleDevClick"
        >
          <devSvg class="icon-svg" />
        </button>


        <button
          class="icon-btn install-task-btn"
          type="button"
          :title="t('nav.tasks')"
          @click="handleInstallTaskClick"
        >
          <installTaskSvg class="icon-svg install-task-icon" />
          <span v-if="sourceInstallTaskQuantity > 0" class="install-task-badge">
            {{ sourceInstallTaskQuantity }}
          </span>
        </button>

        <button
          class="icon-btn setting-btn"
          type="button"
          :title="t('nav.settings')"
          @click="handleSettingsClick"
        >
          <settingsSvg class="icon-svg" />
        </button>
      </div>
      <span class="control-divider"></span>

      <div class="time-block" :aria-label="t('home.currentTime')">
        <span class="time-value">{{ currentTime }}</span>
        <div class="time-meta">
          <span class="time-date">{{ currentDate }}</span>
        </div>
      </div>
    </div>
  </header>
  <user-login ref="userLoginRef" />
</template>

<style scoped lang="scss">
$color-text-primary: #1a2233;
$color-text-secondary: #526174;
$color-text-tertiary: #8b99ab;
$color-border-subtle: rgba(148, 163, 184, 0.2);

.header-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 56px;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
}

.header-left {
  display: flex;
  align-items: center;
  flex: 0 1 260px;
  min-width: 0;
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
}

.user-panel {
  width: 100%;
  max-width: 270px;
  min-width: 198px;
  height: 52px;
  margin-left: -6px;
  padding: 5px 10px 5px 6px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.72);
    border-color: rgba(226, 232, 240, 0.9);
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }
}

.user-avatar-box {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.04);
}

.user-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.user-avatar-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 20px;
  font-weight: 600;
  color: inherit;
}

.user-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
}

.user-name {
  max-width: 158px;
  font-size: 15px;
  font-weight: 700;
  color: $color-text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-meta {
  min-height: 18px;
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.user-desc {
  font-size: 12px;
  line-height: 1;
  color: $color-text-tertiary;
}

.header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  flex: 0 0 auto;
  min-width: 292px;
}

.system-controls {
  min-width: 0;
  height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.control-divider {
  width: 1px;
  height: 22px;
  background: $color-border-subtle;
}

.header-action-btn {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  color: $color-text-secondary;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 14px;
  white-space: nowrap;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
  line-height: 1.2;

  &:hover:not(:disabled) {
    background: #ffffff;
    color: $color-text-primary;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }
}

.header-feedback-icon {
  width: 14px;
  height: 14px;
}

.time-block {
  min-width: 122px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
}

.time-value {
  font-size: 23px;
  font-weight: 800;
  color: $color-text-primary;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.time-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.time-date {
  font-size: 12px;
  font-weight: 500;
  color: $color-text-tertiary;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
}

.icon-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.2s ease,
    opacity 0.2s ease;

  &:hover {
    background: #ffffff;
    border-color: rgba(226, 232, 240, 0.9);
    color: #1f2a3d;
  }

  &:active {
    opacity: 0.8;
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }

  svg {
    width: 18px;
    height: 18px;
  }

  .icon-svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  :deep(.icon-svg path) {
    fill: currentColor;
  }
}

.install-task-btn {
  .install-task-icon {
    font-size: 17px;
    line-height: 1;
  }

  .install-task-badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    transform: translate(38%, -38%);
    border-radius: 8px;
    background: #eff6ff;
    border: 1px solid rgba(37, 99, 235, 0.2);
    font-size: 10px;
    color: #1d4ed8;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
}

</style>
