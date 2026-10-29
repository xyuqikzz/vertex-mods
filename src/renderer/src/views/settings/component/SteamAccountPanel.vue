<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplayImage } from '@renderer/composables/useDisplayImage.js'
import { VxButton, VxConfirmModal } from '@renderer/component/vertex-ui'
import { ToolNotice } from '@renderer/component/tool-page'
import SettingGroup from './SettingGroup.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'

const { t } = useI18n()
const account = ref({ connected: false, user: null, phase: 'idle', remembered: false })
const reducedMotion = ref(false)
const failedAvatars = ref([])
const failedFrames = ref([])
let motionPreference
const syncMotionPreference = () => { reducedMotion.value = motionPreference.matches }
const avatarSource = computed(() => {
  const user = account.value.user
  return [!reducedMotion.value && user?.animatedAvatar, user?.avatar]
    .find(url => url && !failedAvatars.value.includes(url)) || ''
})
const frameSource = computed(() => {
  const user = account.value.user
  return [!reducedMotion.value && user?.avatarFrame, user?.avatarFrameStatic]
    .find(url => url && !failedFrames.value.includes(url)) || ''
})
const { host: avatarHost, resolvedSrc: avatarSrc, isLoaded: avatarLoaded, isError: avatarFailed,
  onLoad: onAvatarLoad, onError: onAvatarError } = useDisplayImage({
  get src() { return avatarSource.value },
  loading: 'eager'
})
const { host: frameHost, resolvedSrc: frameSrc, isLoaded: frameLoaded, isError: frameFailed,
  onLoad: onFrameLoad, onError: onFrameError } = useDisplayImage({
  get src() { return frameSource.value },
  loading: 'eager'
})
watch(avatarFailed, failed => {
  if (failed && avatarSource.value) failedAvatars.value.push(avatarSource.value)
})
watch(frameFailed, failed => {
  if (failed && frameSource.value) failedFrames.value.push(frameSource.value)
})
watch(() => [account.value.user?.steamId, account.value.user?.avatar, account.value.user?.animatedAvatar,
  account.value.user?.avatarFrame, account.value.user?.avatarFrameStatic], (next, previous) => {
  if (next.some((value, index) => value !== previous[index])) {
    failedAvatars.value = []
    failedFrames.value = []
  }
})
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const storageFailed = ref(false)
const confirmLogout = ref(false)
const authorizing = computed(() => busy.value || account.value.phase === 'authorizing')
const errorKeys = {
  steam_account_failed: 'storage', steam_login_busy: 'busy', workshop_network_failed: 'network',
  workshop_login_failed: 'login', workshop_session_expired: 'login', workshop_tool_failed: 'tool'
}
let timer,
  serial = 0,
  disposed = false
async function refresh() {
  const request = ++serial
  try {
    const result = await ipcRenderer.invoke('steam-account:status')
    if (!result?.success) throw Object.assign(new Error(), { code: result?.code })
    if (!disposed && request === serial) {
      account.value = result.data
      if (storageFailed.value) error.value = ''
      storageFailed.value = false
    }
  } catch (failure) {
    if (!disposed && request === serial) {
      error.value = errorKeys[failure.code] || 'read'
      storageFailed.value = true
    }
  } finally {
    if (!disposed) loading.value = false
  }
}
async function poll() {
  await refresh()
  if (!disposed) timer = setTimeout(poll, 1500)
}
async function action(name) {
  if (name === 'login' && authorizing.value) return
  if (name === 'login') busy.value = true
  error.value = ''
  try {
    const result = await ipcRenderer.invoke(`steam-account:${name}`)
    if (!result?.success)
      throw Object.assign(new Error(), {
        code: result?.code
      })
  } catch (failure) {
    if (failure.code !== 'steam_login_cancelled' && !disposed) error.value = errorKeys[failure.code] || 'action'
    if (name === 'logout') throw failure
  } finally {
    if (name === 'login') busy.value = false
    if (!disposed) await refresh()
  }
}
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMotionPreference()
  motionPreference.addEventListener('change', syncMotionPreference)
  void poll()
})
onBeforeUnmount(() => {
  motionPreference?.removeEventListener('change', syncMotionPreference)
  disposed = true
  serial++
  clearTimeout(timer)
})
</script>

<template>
  <section class="steam-account" :aria-label="t('steamAccount.label')" :aria-busy="loading || authorizing">
    <SettingGroup :title="t('steamAccount.title')">
      <div class="steam-account__identity setting-account">
        <span class="steam-account__portrait" :class="{ 'has-frame': frameLoaded && !frameFailed }" @dragstart.prevent>
          <span ref="avatarHost" class="setting-account__avatar" :class="{ 'is-empty': !account.user }">
            <img
              v-if="avatarSrc" v-show="avatarLoaded && !avatarFailed" :key="avatarSrc"
              :src="avatarSrc" :alt="t('steamAccount.avatar', { name: account.user?.name || '' })"
              draggable="false" referrerpolicy="no-referrer" @load="onAvatarLoad" @error="onAvatarError" />
            <span v-if="!avatarLoaded || avatarFailed" aria-hidden="true">{{ account.user ? 'S' : '?' }}</span>
          </span>
          <span ref="frameHost" class="steam-account__frame" aria-hidden="true">
            <img
              v-if="frameSrc" v-show="frameLoaded && !frameFailed" :key="frameSrc" :src="frameSrc"
              alt="" draggable="false" referrerpolicy="no-referrer" @load="onFrameLoad" @error="onFrameError" />
          </span>
        </span>
        <div class="setting-account__body">
          <p class="setting-account__name">
            <span>{{ account.user?.name || t('steamAccount.signedOut') }}</span>
            <span
              v-if="account.user"
              class="tool-status"
              :class="account.connected ? 'is-success' : 'is-warning'"
            >
              {{
                account.connected
                  ? account.remembered
                    ? t('steamAccount.saved')
                    : t('steamAccount.sessionOnly')
                  : t('steamAccount.expired')
              }}
            </span>
          </p>
          <p v-if="account.user?.username && account.user.name !== account.user.username" class="setting-row__description">
            {{ t('steamAccount.accountName', { name: account.user.username }) }}
          </p>
          <p v-if="authorizing" role="status" class="setting-row__description">
            {{ t('steamAccount.authorizing') }}
          </p>
          <p v-else-if="account.phase === 'expired'" role="status" class="setting-row__description">
            {{ t('steamAccount.expiredHint') }}
          </p>
          <p v-else-if="account.connected" class="setting-row__description">
            {{
              account.remembered
                ? t('steamAccount.savedHint')
                : t('steamAccount.sessionHint')
            }}
          </p>
          <p v-else class="setting-row__description">{{ t('steamAccount.signInHint') }}</p>
        </div>
        <div class="steam-account__actions setting-account__actions">
          <VxButton
            :variant="account.user ? 'secondary' : 'primary'"
            size="sm"
            :loading="authorizing"
            :disabled="loading || storageFailed"
            @click="action('login')"
          >
            {{ account.user ? t('steamAccount.reauthorize') : t('steamAccount.signIn') }}
          </VxButton>
          <VxButton v-if="authorizing" variant="secondary" size="sm" @click="action('cancel')"
            >{{ t('steamAccount.cancel') }}</VxButton
          >
          <VxButton
            v-if="account.user || storageFailed"
            variant="ghost"
            size="sm"
            class="setting-danger-button"
            :disabled="authorizing"
            @click="confirmLogout = true"
            >{{ storageFailed ? t('steamAccount.clear') : t('steamAccount.signOut') }}</VxButton
          >
        </div>
      </div>
    </SettingGroup>
    <ToolNotice v-if="error" tone="danger" class="steam-account__error">{{ t(`steamAccount.errors.${error}`) }}</ToolNotice>
    <VxConfirmModal
      v-model="confirmLogout"
      :title="t('steamAccount.signOutTitle')"
      danger
      :confirm-text="t('steamAccount.signOut')"
      :description="t('steamAccount.signOutHint')"
      :confirm-action="() => action('logout')"
    />
  </section>
</template>

<style scoped>
.steam-account > * + * {
  margin-top: 28px;
}

.steam-account p {
  overflow-wrap: anywhere;
}

.steam-account__portrait {
  position: relative;
  flex: 0 0 auto;
  padding: calc(var(--space-1) * 1.5);
}

.steam-account__portrait .setting-account__avatar {
  width: 66px;
  height: 66px;
}

.steam-account__portrait.has-frame .setting-account__avatar {
  border-radius: 0;
}

.steam-account__frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.steam-account__frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
