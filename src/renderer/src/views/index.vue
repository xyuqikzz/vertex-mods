<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../i18n/message.js'

// 导入Vue相关方法
import { computed, onMounted, onUnmounted, ref, toRefs, watch } from 'vue'
import { useRouter } from 'vue-router'

// 导入工具和状态管理
import router from '../router/index.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { getSourceInstallTaskCompletionNotice } from '@renderer/utils/source-install-task-events.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import {
  GET_HOME_FEATURE_UPDATE_NOTICE
} from '@renderer/api/modules/index.js'
import { requestManager } from '@renderer/api/index.js'
import { $message } from '@renderer/common/message.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import AppUpdateDialog from '@renderer/component/app-update-dialog.vue'
import { appUpdate } from '@renderer/store/appUpdateStore.js'
import { getAppReleaseUrl } from '../../../shared/app/app-release.js'
import WorkshopAuthDialog from '@renderer/component/WorkshopAuthDialog.vue'
import PageBodyMenu from '@renderer/component/page-body-menu.vue'
import SiteDetailTabs from '@renderer/views/game/component/SiteDetailTabs.vue'
import HomeFeatureUpdateDialog from '@renderer/component/home-feature-update-dialog.vue'
import { taskCenterBadgeCount } from '../../../shared/tasks/task-center-counts.js'
import installTaskSvg from '@renderer/assets/icons/install-task.svg'
import { useInstallStore } from '@renderer/store/installStore.js'
import { mergeInstallTaskSummary } from '@renderer/views/game/component/task-center/task-center-view-model.js'
import { useUserStore } from '@renderer/store/userStore.js'
import {
  VALIDATE_TOKEN,
} from '@renderer/api/modules/user.js'
import storage from '@renderer/common/storage.js'
import { useLocalDatastore } from '@renderer/store/localDataStore.js'
import { Modal } from 'ant-design-vue'
import common from '@renderer/common/index.js'
import { formatInstallFailureMessage } from '../../../shared/installation/install-flow-message.js'
import { releaseConfig } from '../../../shared/app/release-config.js'
import {
  getMenuRouteKey,
  normalizeMenuFullPath,
  normalizeMenuPath
} from '@renderer/utils/menu-route-key.js'

const { VITE_REQUEST_API } = import.meta.env

// 声明变量和引用
const appStore = useAppStore()
const userStore = useUserStore()
const downloadStore = useDownloadStore()
const installStore = useInstallStore()
const localDataStore = useLocalDatastore()
const routerU = useRouter()

// 响应式变量
const canGoBack = ref(false)
const cachedViews = computed(() => appStore.cachedViews)
const {
  release: forceUpdateData,
  visible: forceUpdateActive,
  status: forceUpdateStage
} = toRefs(appUpdate.state)
const forceUpdateProgress = computed(() => appUpdate.state.progress)
const forceUpdateSpeed = computed(() => appUpdate.state.bytesPerSecond)
const appVersionCheckFinished = ref(false)
const featureUpdateNotice = ref(null)
const featureUpdateDialogVisible = ref(false)
const featureUpdatePendingAfterVersionUpdate = ref(false)
const route = computed(() => router.currentRoute.value)
const sourceInstallTaskSummary = ref({})
const sourceInstallTaskQuantity = computed(
  () =>
    taskCenterBadgeCount(mergeInstallTaskSummary(sourceInstallTaskSummary.value, installStore.waitingInstallList).badgeCount, downloadStore.downloadList)
)
const showGlobalSourceInstallTaskEntry = computed(() => {
  const currentPath = route.value.path || ''
  return (
    sourceInstallTaskQuantity.value > 0 &&
    !currentPath.startsWith('/app/home') &&
    !currentPath.startsWith('/app/game/install-tasks')
  )
})
const forceUpdateLatestVersion = computed(() => {
  const data = forceUpdateData.value || {}
  return data.versionName || data.version || data.tag || ''
})
const forceUpdatePrimaryText = computed(() => {
  if (['error', 'unavailable'].includes(forceUpdateStage.value)) return uiText('ui.checkAgain')
  if (forceUpdateStage.value === 'current') return uiText('ui.gotItVariant2')
  if (forceUpdateStage.value === 'installing') return uiText('updates.installing')
  if (forceUpdateStage.value === 'downloaded') return uiText('ui.installNow')
  if (forceUpdateData.value.source === 'github' && forceUpdateData.value.canDownload !== true) return uiText('ui.goToDownload')
  return uiText('updates.downloadAndInstall')
})
const forceUpdateSecondaryText = computed(() =>
  ['downloading', 'downloaded'].includes(forceUpdateStage.value) ? uiText('updates.postpone') :
    forceUpdateStage.value === 'available' ? uiText('ui.later') : uiText('ui.close')
)
const forceUpdateSpeedText = computed(() => {
  const speed = Number(forceUpdateSpeed.value || 0)
  if (!Number.isFinite(speed) || speed <= 0) return ''
  return uiText('ui.downloadSpeedValueS', { value1: (common.formatBytes(speed)) })
})

// 定时器变量
let mouse_position_timer = null
let sourceInstallTaskSummarySerial = 0
let sourceInstallTaskSummaryTimer = null
const sourceInstallTaskCompletionNoticeKeys = new Set()
const MAX_CACHED_VIEWS = 12
const HOME_FEATURE_UPDATE_TODAY_PREFIX = 'home_feature_update_today'
const HOME_FEATURE_UPDATE_SESSION_PREFIX = 'home_feature_update_session'
const FEATURE_UPDATE_ROUTE_ALIASES = Object.freeze({
  '/app/game-tool/fling': '/app/game-tools?tool=fling-trainer'
})
const FEATURE_UPDATE_ROUTE_WHITELIST = [
  /^\/app\/home(?:\?.*)?$/,
  /^\/app\/game(?:\/|\?|$)/,
  /^\/app\/game-tools(?:\?|$)/,
  /^\/app\/game\/install-tasks(?:\?|$)/,
  /^\/app\/download(?:\?|$)/,
  /^\/app\/settings(?:\?|$)/
]
let featureUpdateRequestSerial = 0

// 监听路由变化
watch(
  () => route.value.path,
  (nv) => {
    requestManager.requestQueue.setCurrentPage(nv)
    canGoBack.value = window.history.state.back && window.history.state.back !== '/app'
  }
)

// 定义主路由配置（需要特殊处理的路由）
const primaryRoute = [
  {
    content: '', // 菜单显示文本，默认“加载中”
    path: '/app/home' // 路由路径
  }
]

function ensureMenuItemByRoute(routeLike, fallbackConfig = null) {
  const path = normalizeMenuPath(routeLike?.path)
  const fullPath = normalizeMenuFullPath(routeLike?.fullPath || routeLike?.path)
  if (!path || !path.startsWith('/app/')) {
    return false
  }

  const routeKey = getMenuRouteKey(fullPath)
  const menuIndex = appStore.menuList.findIndex(
    (menuItem) => getMenuRouteKey(menuItem.fullPath || menuItem.path) === routeKey
  )
  if (menuIndex === -1) {
    if (fallbackConfig) {
      appStore.menuList.push({ ...fallbackConfig, path, fullPath })
    } else {
      appStore.menuList.push({
        path,
        fullPath,
        content: '' // 空字符串会在菜单中显示为“加载中”
      })
    }
  } else {
    appStore.menuList[menuIndex].path = path
    appStore.menuList[menuIndex].fullPath = fullPath
  }
  return true
}

watch(
  () => [route.value.path, route.value.fullPath],
  ([newPath, newFullPath], [oldPath = '', oldFullPath = ''] = []) => {
    const exactMatch = primaryRoute.find((item) => item.path === newPath)

    if (exactMatch) {
      const savedPath = appStore.lastRoute || ''
      const savedRoutePath = normalizeMenuPath(savedPath)
      const hasHistory = savedRoutePath === newPath && savedPath !== newFullPath
      const isBackOperation = !!oldPath && normalizeMenuPath(oldFullPath || oldPath) === newPath

      if (hasHistory && !isBackOperation) {
        // 如果是从外部切进来，且有历史记录，则恢复
        router.replace(savedPath)
        return
      }
    }

    const added = ensureMenuItemByRoute(
      {
        path: newPath,
        fullPath: newFullPath
      },
      exactMatch
    )
    if (added) {
      appStore.lastRoute = newFullPath
      appStore.isShowMenu = true
      if (newPath === '/app/home') {
        maybeOpenFeatureUpdateNotice()
      }
      return
    }

    appStore.isShowMenu = false
  },
  { immediate: true }
)

// IPC事件监听

// 在渲染前把目标页面加入缓存名单，避免首次进入时发生二次挂载
watch(
  () => route.value.name,
  (name) => {
    appStore.addCachedView(name)
  },
  { immediate: true }
)

async function checkAppUpdate() {
  try {
    await appUpdate.check({ automatic: true })
  } catch { /* 更新不可用不影响本地功能。 */ }
  finally {
    appVersionCheckFinished.value = true
    maybeOpenFeatureUpdateNotice()
  }
}

function getFeatureUpdateNoticeVersion(notice = featureUpdateNotice.value) {
  return String(notice?.noticeVersion || '').trim()
}

function getTodayDateText() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getFeatureUpdateTodayKey(notice = featureUpdateNotice.value) {
  const version = getFeatureUpdateNoticeVersion(notice)
  return version ? `${HOME_FEATURE_UPDATE_TODAY_PREFIX}:${version}:${getTodayDateText()}` : ''
}

function getFeatureUpdateSessionKey(notice = featureUpdateNotice.value) {
  const version = getFeatureUpdateNoticeVersion(notice)
  return version ? `${HOME_FEATURE_UPDATE_SESSION_PREFIX}:${version}` : ''
}

function isFeatureUpdateNoticeDismissed(notice = featureUpdateNotice.value) {
  const todayKey = getFeatureUpdateTodayKey(notice)
  const sessionKey = getFeatureUpdateSessionKey(notice)
  if (!todayKey || !sessionKey) return true
  return Boolean(storage.local.get(todayKey) || storage.session.get(sessionKey))
}

async function maybeOpenFeatureUpdateNotice() {
  if (!appVersionCheckFinished.value) return
  if (route.value.path !== '/app/home') return
  if (featureUpdateDialogVisible.value) return
  if (!appStore.AppData.requestUrl) return

  const requestSerial = ++featureUpdateRequestSerial
  try {
    const notice = await GET_HOME_FEATURE_UPDATE_NOTICE()
    if (requestSerial !== featureUpdateRequestSerial) return
    if (!notice || !Array.isArray(notice.items) || !notice.items.length) return
    if (isFeatureUpdateNoticeDismissed(notice)) return

    featureUpdateNotice.value = notice
    if (forceUpdateActive.value) {
      featureUpdatePendingAfterVersionUpdate.value = true
      return
    }
    featureUpdateDialogVisible.value = true
  } catch (error) {
    console.warn('读取首页功能更新通知失败', error)
  }
}

function handleForceUpdateClosed() {
  appUpdate.close()
  if (featureUpdatePendingAfterVersionUpdate.value && featureUpdateNotice.value) {
    featureUpdatePendingAfterVersionUpdate.value = false
    if (route.value.path === '/app/home' && !isFeatureUpdateNoticeDismissed()) {
      featureUpdateDialogVisible.value = true
      return
    }
  }
  maybeOpenFeatureUpdateNotice()
}

async function handleForceUpdatePrimary() {
  if (['error', 'unavailable'].includes(forceUpdateStage.value)) {
    await appUpdate.check()
    return
  }
  if (forceUpdateStage.value === 'current') {
    handleForceUpdateClosed()
    return
  }
  if (['checking', 'installing'].includes(forceUpdateStage.value)) return
  if (forceUpdateData.value.source === 'github' && forceUpdateData.value.canDownload !== true) {
    window.open(getAppReleaseUrl(forceUpdateData.value.tag), '_blank')
    return
  }
  if (forceUpdateStage.value === 'downloaded') {
    try {
      await appUpdate.install()
    } catch (error) {
      $message.error(uiText(error?.messageKey || 'updates.errors.update_install_failed'))
    }
    return
  }

  if (forceUpdateStage.value === 'downloading') return
  try {
    await appUpdate.download()
  } catch (error) {
    $message.error(uiText(error?.messageKey || 'updates.errors.update_download_failed'))
  }
}

function handleForceUpdateSecondary() {
  handleForceUpdateClosed()
}

function handleFeatureUpdateDismiss(payload = {}) {
  const todayKey = getFeatureUpdateTodayKey()
  const sessionKey = getFeatureUpdateSessionKey()
  if (!todayKey || !sessionKey) return

  if (payload.suppressToday) {
    storage.local.set(todayKey, true)
    storage.session.remove(sessionKey)
    return
  }
  storage.session.set(sessionKey, true)
}

function normalizeFeatureUpdateRoute(value = '') {
  const rawValue = String(value || '').trim()
  return FEATURE_UPDATE_ROUTE_ALIASES[rawValue] || rawValue
}

function isAllowedFeatureUpdateRoute(value = '') {
  const routeValue = normalizeFeatureUpdateRoute(value)
  return FEATURE_UPDATE_ROUTE_WHITELIST.some((pattern) => pattern.test(routeValue))
}

function normalizeFeatureVersion(value = '') {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
}

function isFeatureVersionSupported(item = {}) {
  const currentVersion = normalizeFeatureVersion(appStore.AppData.version)
  const featureVersion = normalizeFeatureVersion(item.featureVersion)
  if (!currentVersion || !featureVersion) return true
  return common.compareVersions(currentVersion, featureVersion) >= 0
}

function showFeatureVersionUpdateConfirm() {
  Modal.confirm({
    get title() { return uiText('ui.thisVersionDoesNotSupportThisFeature') },
    content: '当前 Vertex 版本暂不支持该功能，更新后即可体验。',
    get okText() { return uiText('settings.update.check') },
    get cancelText() { return uiText('ui.cancel') },
    onOk: async () => {
      await appUpdate.check()
    }
  })
}

function handleFeatureUpdateAction(payload = {}) {
  const item = payload.item || payload
  const actionType = String(item.actionType || 'none')
    .trim()
    .toLowerCase()
  const actionValue = String(item.actionValue || '').trim()
  if (actionType === 'none' || !actionValue) return

  if (!isFeatureVersionSupported(item)) {
    showFeatureVersionUpdateConfirm()
    return
  }

  if (actionType === 'route') {
    const targetRoute = normalizeFeatureUpdateRoute(actionValue)
    if (!isAllowedFeatureUpdateRoute(targetRoute)) {
      $message.warning(uiMessage('ui.thisFeatureLinkIsNotSupported'))
      return
    }
    featureUpdateDialogVisible.value = false
    handleFeatureUpdateDismiss({ suppressToday: Boolean(payload.suppressToday) })
    routerU.push(targetRoute)
    return
  }

  if (actionType === 'url') {
    if (!/^https?:\/\//i.test(actionValue)) {
      $message.warning(uiMessage('ui.invalidExternalLink'))
      return
    }
    featureUpdateDialogVisible.value = false
    handleFeatureUpdateDismiss({ suppressToday: Boolean(payload.suppressToday) })
    window.open(actionValue, '_blank')
  }
}

function checkLoginStatus() {
  const token = userStore.token
  if (!token) {
    if (userStore.isLogin) userStore.logout()
    return
  }
  VALIDATE_TOKEN().then((valid) => {
    if (userStore.token !== token) return
    if (!valid) userStore.logout()
    else userStore.upUserInfo().catch(() => {})
  }).catch(() => {})
}



watch(
  () => [userStore.isLogin, userStore.token],
  ([isLogin, token]) => {
    if (isLogin && token) userStore.upUserInfo().catch(() => {})
  }
)

useIpc('download-progress-1', (data) => {
  downloadStore.updateDataById(data.id, data)
})

useIpc('download-progress', (data = {}) => {
  appUpdate.setProgress(data)
})

useIpc('update-available', (info = {}) => {
  if (!releaseConfig.updatesEnabled) return
  appUpdate.markAvailable(info)
})

useIpc('update-downloaded', (info = {}) => {
  appUpdate.markDownloaded(info)
})

useIpc('update-not-available', (info = {}) => {
  if (!releaseConfig.updatesEnabled) return
  forceUpdateData.value = info
  forceUpdateStage.value = 'current'
  appUpdate.state.messageKey = 'updates.current'
  appUpdate.state.lastCheckedAt = new Date().toISOString()
})

useIpc('update-error', (error = {}) => {
  appUpdate.markDownloadFailed(error)
})

watch(forceUpdateActive, (visible) => {
  if (visible && featureUpdateDialogVisible.value) {
    featureUpdatePendingAfterVersionUpdate.value = true
    featureUpdateDialogVisible.value = false
  }
})

useIpc('download-failed', (data) => {
  const { id, message = '' } = data
  downloadStore.downloadFailedById(id, message, data)
})

useIpc('download-success', (data) => {
  const { id } = data
  downloadStore.downloadSuccessfulById(id, data)
})

useIpc('download-canceled', (data) => {
  const { id, message = '' } = data
  downloadStore.downloadFailedById(id, message, data)
})

function addExternalDownloadTask(data) {
  if (!data || typeof data !== 'object') {
    return
  }
  downloadStore.addDownloadItem(data, {
    skipQueue: true
  })
}

useIpc('source-install-task:download-enqueued', addExternalDownloadTask)
useIpc('mod-browser:download-enqueued', addExternalDownloadTask)

useIpc('openFileFail', (data) => {
  $message.warning(data)
})

useIpc('app-status', (data) => {
  const { success, message = '' } = data
  if (success) $message.success(message)
  else $message.warning(message)
})

useIpc('node-notify', (data) => {
  const { type, message } = data
  const shouldNormalize = type === 'warning' || type === 'error'
  const content = shouldNormalize
    ? formatInstallFailureMessage(message, {
        fallback: message || '操作失败，请稍后重试'
      })
    : message
  if (shouldNormalize) {
    console.warn('主进程通知详情', data)
  }
  $message.show({
    type,
    content
  })
})

// 本地数据 全局监听
useIpc('modifyLocalData', (data) => {
  const { type, params } = data
  console.log(type, params)
  localDataStore[type] = params
})

// 协议链接唤起窗口。
useIpc('ai-assistant:configure', (payload = {}) => {
  routerU.push({
    path: '/app/settings',
    query: { section: payload.section === 'sources' ? 'nexus' : 'services' }
  })
})
useIpc('openSpecifiedLink', () => {
  ipcRenderer.send('showWindow')
})

// 监听需要下载的数据



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

function handleGlobalSourceInstallTaskClick() {
  routerU.push('/app/game/install-tasks')
}

function handleLegacyInstallTaskNavigation(event) {
  const taskId = String(event?.detail?.taskId || '').trim()
  if (!taskId || route.value.path.startsWith('/app/game/install-tasks')) return
  routerU.push({
    path: '/app/game/install-tasks',
    query: { legacyTaskId: taskId }
  })
}

function resolveSourceInstallTaskNoticeKey(data = {}, state = '') {
  const jobId = String(data?.job_id || data?.jobId || data?.job?.job_id || data?.job?.jobId || '').trim()
  if (jobId) {
    return `job:${jobId}`
  }

  const title = String(data?.title || data?.job?.title || '').trim()
  const completedAt = String(data?.completed_at || data?.completedAt || data?.job?.completed_at || '').trim()
  const updatedAt = String(data?.updated_at || data?.updatedAt || data?.job?.updated_at || '').trim()
  return `fallback:${state}:${title}:${completedAt}:${updatedAt}`
}

function rememberSourceInstallTaskNotice(key = '') {
  if (!key || sourceInstallTaskCompletionNoticeKeys.has(key)) {
    return false
  }

  sourceInstallTaskCompletionNoticeKeys.add(key)
  if (sourceInstallTaskCompletionNoticeKeys.size > 100) {
    const firstKey = sourceInstallTaskCompletionNoticeKeys.values().next().value
    sourceInstallTaskCompletionNoticeKeys.delete(firstKey)
  }
  return true
}

useIpc('source-install-task:updated', (data) => {
  loadSourceInstallTaskSummary()

  // 任务完成时显示成功通知
  const state = String(data?.state || '').trim()
  if (state === 'completed' || state === 'completed_with_warning') {
    const noticeKey = resolveSourceInstallTaskNoticeKey(data, state)
    if (!rememberSourceInstallTaskNotice(noticeKey)) {
      return
    }

    const notice = getSourceInstallTaskCompletionNotice(data)
    $message[notice.type](notice.displayMessage)
  }
})
useIpc('source-install-task:item-updated', scheduleSourceInstallTaskSummary)
useIpc('source-install-task:artifact-updated', scheduleSourceInstallTaskSummary)

// 监听整合包单个模组的下载/缓存完成事件


// 监听整合包安装完成事件




useIpc('getModInstallRecordSuccess', (data) => {
  downloadStore.modInstallList = data
})

// 生命周期钩子
onMounted(() => {
  appStore.AppData.requestUrl = VITE_REQUEST_API
  if (router.currentRoute.value.path === '/app') router.replace('/app/home')
  installStore.cleanupInstallTasks()
  loadSourceInstallTaskSummary()
  window.addEventListener('vertex:open-install-task-detail', handleLegacyInstallTaskNavigation)

  ipcRenderer.send('getAppVersion')
  ipcRenderer.send('requestInitLocalData')
})

onUnmounted(() => {
  clearInterval(mouse_position_timer)
  if (sourceInstallTaskSummaryTimer) {
    clearTimeout(sourceInstallTaskSummaryTimer)
    sourceInstallTaskSummaryTimer = null
  }
  window.removeEventListener('vertex:open-install-task-detail', handleLegacyInstallTaskNavigation)
})

useIpc('getAppVersionSuccess', (data) => {
  appStore.AppData = {
    ...appStore.AppData,
    ...data
  }
  checkAppUpdate()
  checkLoginStatus()
})


useIpc('data-log', (data) => {
  console.log(data)
})
</script>

<template>
  <WorkshopAuthDialog />
  <div class="app">
    <div class="app-right">
      <div class="right-view">
        <!--
          页签栏全局只保留一份。放在各页面的 page-body 里时，每个缓存页面各有一份实例，
          切页会在实例间换显示，隐藏实例的滚动位置和溢出遮罩已被重置，导致页签栏闪烁。
        -->
        <PageBodyMenu v-if="appStore.isShowMenu" />
        <div class="right-view-content" :class="{ 'has-menu': appStore.isShowMenu }">
          <router-view v-slot="{ Component, route: viewRoute }">
            <keep-alive :include="cachedViews" :max="MAX_CACHED_VIEWS">
              <component
                :is="Component"
                v-if="viewRoute.name !== 'GameSiteDetail'"
                :key="viewRoute.meta.usePathKey ? viewRoute.path : viewRoute.fullPath"
              />
            </keep-alive>
          </router-view>
          <SiteDetailTabs />
        </div>
      </div>
    </div>

    <button
      v-if="showGlobalSourceInstallTaskEntry"
      class="global-source-install-task-entry"
      type="button"
      :title="$t('nav.tasks')"
      @click="handleGlobalSourceInstallTaskClick"
    >
      <installTaskSvg class="icon-svg" />
      <span v-if="sourceInstallTaskQuantity > 0" class="task-badge">
        {{ sourceInstallTaskQuantity }}
      </span>
    </button>


    <app-update-dialog
      v-model="forceUpdateActive"
      :dialog-stage="forceUpdateStage"
      :current-version="appUpdate.state.currentVersion || appStore.AppData.version"
      :latest-version="forceUpdateLatestVersion"
      :publish-time="forceUpdateData.publishTime"
      :release-notes="forceUpdateData.releaseNotes"
      :release-source="forceUpdateData.source || (releaseConfig.updatesEnabled ? 'custom' : 'github')"
      :message="appUpdate.state.message"
      :message-key="appUpdate.state.messageKey"
      :primary-text="forceUpdatePrimaryText"
      :secondary-text="forceUpdateSecondaryText"
      :progress="forceUpdateProgress"
      :speed-text="forceUpdateSpeedText"
      @primary="handleForceUpdatePrimary"
      @secondary="handleForceUpdateSecondary"
      @close="handleForceUpdateClosed"
    />

    <home-feature-update-dialog
      v-model="featureUpdateDialogVisible"
      :notice="featureUpdateNotice"
      @dismiss="handleFeatureUpdateDismiss"
      @action="handleFeatureUpdateAction"
    />
  </div>
</template>

<style scoped lang="scss">
.app {
  // 主窗口使用系统原生边框（frame: true），圆角由 Windows 绘制；
  // 内容区再加圆角会在窗口四角露出底色。
  display: flex;
  overflow: hidden;
  box-sizing: border-box;
}

.app-right {
  height: 100vh;
  width: 100%;

  .right-view {
    width: 100%;
    height: 100%;
    padding: 15px;
    background: var(--right-view-bottom-bc);
  }

  // 与原先 page-body 内的 calc(100% - 42px) 等价，页面内容区尺寸保持不变。
  .right-view-content {
    width: 100%;
    height: 100%;

    &.has-menu {
      height: calc(100% - 42px);
    }
  }
}

.global-source-install-task-entry {
  position: fixed;
  right: 24px;
  bottom: 208px;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 50%;
  background: #ffffff;
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    0 8px 24px rgba(15, 23, 42, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  z-index: 902;
  transition:
    transform 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    color: #1d4ed8;
    transform: translateY(-2px);
    box-shadow:
      0 12px 30px rgba(15, 23, 42, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }

  &:active {
    transform: translateY(0);
  }

  .icon-svg {
    font-size: 19px;
    line-height: 1;
  }

  .task-badge {
    position: absolute;
    top: -7px;
    right: -7px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    background: rgba(37, 99, 235, 0.14);
    font-size: 12px;
    color: #1d4ed8;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
}
</style>
