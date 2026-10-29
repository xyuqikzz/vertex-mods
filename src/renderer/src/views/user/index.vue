<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import UserLogin from '@renderer/component/auth/user-login.vue'
import { useUserStore } from '@renderer/store/userStore.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { USER_LOGOUT } from '@renderer/api/modules/user.js'
import { getAccountSessionSignal } from '@renderer/utils/account-session.js'
import AccountOverview from './component/account-overview.vue'
import ProfileTab from './component/profile.vue'
import SecurityTab from './component/settings.vue'
import './account.scss'

defineOptions({ name: 'User' })
const userStore = useUserStore()
const route = useRoute()
const { setMenuName } = useMenuName()
const profileRef = ref(null)
const securityRef = ref(null)
const userLoginRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const actionError = ref('')
const actionBusy = ref(false)
const notice = ref('')
const formState = reactive({ profile: {}, security: {} })
const dirty = computed(() => Boolean(formState.profile.dirty || formState.security.dirty))
const unsavedCount = computed(
  () => (formState.profile.count || 0) + (formState.security.count || 0)
)
const busy = computed(() =>
  Boolean(actionBusy.value || formState.profile.busy || formState.security.busy)
)
const confirm = reactive({ open: false, title: '', description: '', text: '', danger: false })
let resolveConfirm = null
let loadSequence = 0
let allowWindowClose = false

function ask(title, description, text, danger = false) {
  if (resolveConfirm) resolveConfirm(false)
  Object.assign(confirm, { open: true, title, description, text, danger })
  return new Promise((resolve) => {
    resolveConfirm = resolve
  })
}
function settleConfirm(value) {
  const resolve = resolveConfirm
  resolveConfirm = null
  confirm.open = false
  resolve?.(value)
}
function resetForms() {
  profileRef.value?.reset()
  securityRef.value?.reset()
  formState.profile = {}
  formState.security = {}
}
async function allowLeave() {
  if (busy.value) {
    notice.value = '操作进行中，请等待结果后再离开。'
    return false
  }
  if (!dirty.value) return true
  const leave = await ask(
    '放弃未保存的修改？',
    '尚未提交的昵称、头像选择或密码将被清除。',
    '放弃修改',
    true
  )
  if (leave) resetForms()
  return leave
}
async function refresh() {
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  try {
    const updated = await userStore.upUserInfo()
    if (sequence !== loadSequence) return
    if (!updated && userStore.isLogin) loadError.value = '账号资料未加载，请重试。'
  } catch (e) {
    if (sequence === loadSequence && userStore.isLogin && e.code !== 'ERR_CANCELED')
      loadError.value = e.message || '无法加载账号资料，请检查网络后重试。'
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
async function login() {
  if (await allowLeave()) userLoginRef.value?.open()
}
async function refreshProfile() {
  if (await allowLeave()) await refresh()
}
async function logout(localOnly = false) {
  if (!(await allowLeave())) return
  if (
    !(await ask(
      '退出当前账号？',
      localOnly
        ? '服务端退出未确认。将清除本机登录状态，请在网络恢复后重新登录。'
        : '退出后保留本地游戏、模组、下载任务和客户端设置。',
      localOnly ? '仅退出本机' : '退出登录',
      true
    ))
  )
    return
  actionError.value = ''
  actionBusy.value = true
  const session = getAccountSessionSignal()
  try {
    if (!localOnly)
      await USER_LOGOUT({
        hideLoading: true,
        silentBusinessError: true,
        skipAuthLogout: true,
        timeout: 10000
      })
    if (session.aborted) return
    await userStore.logout({ redirect: false })
    notice.value = localOnly ? '已退出本机，服务端退出尚未确认。' : '已退出登录。'
  } catch (e) {
    if (!session.aborted) actionError.value = '退出失败：' + (e.message || '请检查网络后重试。')
  } finally {
    actionBusy.value = false
  }
}
async function passwordChanged() {
  resetForms()
  await userStore.logout({ redirect: false })
  notice.value = '密码已修改，请重新登录。'
}
function beforeUnload(event) {
  if (allowWindowClose || (!dirty.value && !busy.value)) return
  event.preventDefault()
  event.returnValue = ''
  allowLeave().then((allowed) => {
    if (allowed) {
      allowWindowClose = true
      window.close()
    }
  })
}
watch(
  () => userStore.token,
  () => {
    loadSequence++
    settleConfirm(false)
    resetForms()
    actionError.value = loadError.value = ''
    if (userStore.token) notice.value = ''
    loading.value = false
    if (userStore.isLogin && userStore.token) refresh()
  },
  { immediate: true }
)
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate(allowLeave)
onMounted(() => {
  setMenuName('个人中心', route.path)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  loadSequence++
  settleConfirm(false)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="user-index">
    <PageBody>
      <main class="account-page" :class="{ 'is-guest': !userStore.isLogin }">
        <h1 class="visually-hidden">{{ $t('nav.account') }}</h1>

        <div v-if="!userStore.isLogin" class="account-guest">
          <p v-if="notice" class="account-banner" role="status">{{ notice }}</p>
          <p v-if="userStore.sessionNotice" class="account-banner is-warning" role="alert">
            {{ userStore.sessionNotice }}
          </p>
          <section class="account-card account-login" aria-labelledby="login-heading">
            <span class="account-login-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4 21a8 8 0 0 1 16 0"></path>
              </svg>
            </span>
            <h2 id="login-heading">{{ $t('ui.signInToVertex') }}</h2>
            <p>{{ $t('ui.signInToManageYourAvatarNicknameAndPasswordLocal') }}</p>
            <VxButton @click="login">{{ $t('ui.signIn') }}</VxButton>
          </section>
        </div>

        <template v-else>
          <AccountOverview
            :loading="loading"
            :failed="Boolean(loadError) && !userStore.userInfo.id"
            :busy="busy"
            @refresh="refreshProfile"
            @logout="logout()"
          />
          <div class="account-main">
            <p v-if="notice" class="account-banner" role="status">{{ notice }}</p>
            <div v-if="actionError" class="account-banner is-danger" role="alert">
              <span>{{ actionError }}</span>
              <span class="account-banner-actions">
                <VxButton size="sm" :loading="actionBusy" @click="logout()">{{ $t('ui.retrySignOut') }}</VxButton>
                <VxButton size="sm" variant="secondary" :disabled="actionBusy" @click="logout(true)"
                  >{{ $t('ui.signOutOnThisDeviceOnly') }}</VxButton
                >
              </span>
            </div>

            <section
              v-if="loading && !userStore.userInfo.id"
              class="account-card"
              aria-labelledby="account-heading"
              aria-busy="true"
            >
              <header class="account-card-header">
                <div>
                  <h2 id="account-heading">{{ $t('ui.accountDetails') }}</h2>
                  <p>{{ $t('ui.changesTakeEffectImmediatelyLocalGamesAndModsAreUnaffected') }}</p>
                </div>
              </header>
              <span class="visually-hidden" role="status">{{ $t('ui.loadingAccountDetails') }}</span>
              <div
                v-for="label in ['头像', '昵称', '邮箱', '登录密码']"
                :key="label"
                class="account-row"
              >
                <span class="account-row-label">{{ label }}</span>
                <span class="account-skeleton is-value"></span>
                <span></span>
              </div>
            </section>

            <section
              v-else-if="loadError"
              class="account-card account-load-error"
              aria-labelledby="load-error-heading"
            >
              <span class="account-load-error-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M2 8.8a15 15 0 0 1 20 0"></path>
                  <path d="M5 12.5a10 10 0 0 1 14 0"></path>
                  <path d="M8.5 16.2a5 5 0 0 1 7 0"></path>
                  <path d="M3 3l18 18"></path>
                </svg>
              </span>
              <div>
                <h2 id="load-error-heading">{{ $t('ui.couldNotLoadAccountDetails') }}</h2>
                <p class="account-error" role="alert">{{ loadError }}</p>
                <p class="account-row-hint">
                  {{ $t('ui.localGamesModsAndDownloadTasksAreUnaffectedIfThe') }}
                </p>
                <div class="account-actions">
                  <VxButton size="sm" @click="refresh">{{ $t('common.reload') }}</VxButton>
                  <VxButton size="sm" variant="secondary" @click="login">{{ $t('ui.signInAgain') }}</VxButton>
                  <VxButton
                    class="account-logout-button"
                    size="sm"
                    variant="ghost"
                    @click="logout(true)"
                    >{{ $t('ui.signOutOnThisDeviceOnly') }}</VxButton
                  >
                </div>
              </div>
            </section>

            <section
              v-else-if="userStore.userInfo.id"
              :key="userStore.token"
              class="account-card"
              aria-labelledby="account-heading"
            >
              <header class="account-card-header">
                <div>
                  <h2 id="account-heading">{{ $t('ui.accountDetails') }}</h2>
                  <p>{{ $t('ui.changesTakeEffectImmediatelyLocalGamesAndModsAreUnaffected') }}</p>
                </div>
                <span v-if="unsavedCount" class="account-unsaved" role="status">
                  <span aria-hidden="true"></span>{{ unsavedCount }} {{ $t('ui.unsavedChanges') }}
                </span>
              </header>
              <ProfileTab ref="profileRef" @state="formState.profile = $event" />
              <SecurityTab
                ref="securityRef"
                :action-busy="actionBusy"
                @state="formState.security = $event"
                @password-changed="passwordChanged"
              />
            </section>
          </div>
        </template>
      </main>
    </PageBody>
    <UserLogin ref="userLoginRef" />
    <VxConfirmModal
      :model-value="confirm.open"
      :title="confirm.title"
      :description="confirm.description"
      :confirm-text="confirm.text"
      :danger="confirm.danger"
      :cancel-text="$t('ui.stayHere')"
      @confirm="settleConfirm(true)"
      @update:model-value="!$event && settleConfirm(false)"
    />
  </div>
</template>
