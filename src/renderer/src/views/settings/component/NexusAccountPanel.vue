<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { VxButton, VxConfirmModal, VxSegmented } from '@renderer/component/vertex-ui'
import { ToolNotice } from '@renderer/component/tool-page'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import {
  nexusAccountState as account,
  refreshNexusAccount,
  performNexusAccountAction
} from '@renderer/store/nexusAccount.js'

const busy = ref(false)
const loading = ref(true)
const switching = ref(false)
const error = ref('')
const confirmLogout = ref(false)
let timer
let disposed = false
const authorizing = computed(() => busy.value || account.phase === 'authorizing')
const modes = [
  { get label() { return uiText('ui.accountSignIn') }, value: 'oauth' },
  { label: 'API Key', value: 'api_key' }
]
async function switchMode(mode) {
  if (switching.value || loading.value || mode === account.mode) return
  switching.value = true
  error.value = ''
  try {
    await performNexusAccountAction('set-mode', { mode })
  } catch (failure) {
    error.value = failure.message
  } finally {
    switching.value = false
  }
}
async function action(name) {
  if (name === 'login' && authorizing.value) return
  if (name === 'login') busy.value = true
  error.value = ''
  try {
    await performNexusAccountAction(name)
  } catch (failure) {
    if (failure.code !== 'nexus_login_cancelled') error.value = failure.message
  } finally {
    if (name === 'login') busy.value = false
  }
}
async function poll() {
  try {
    await refreshNexusAccount()
  } catch (failure) {
    error.value = failure.message
  } finally {
    loading.value = false
  }
  if (!disposed) timer = setTimeout(poll, 1500)
}
onMounted(poll)
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
})
</script>

<template>
  <section
    class="nexus-account"
    :aria-label="$t('ui.nexusAuthorization')"
    :aria-busy="loading || switching || authorizing"
  >
    <SettingGroup :title="$t('ui.authorizationMethod')">
      <SettingRow :label="$t('ui.chooseAnAuthorizationMethod')" :description="$t('ui.chooseEitherMethod')">
        <fieldset class="nexus-account__switch" :disabled="loading || switching">
          <legend class="tool-visually-hidden">{{ $t('ui.nexusAuthorizationMethod') }}</legend>
          <VxSegmented
            :model-value="account.mode"
            :options="modes"
            role="group"
            :aria-label="$t('ui.nexusAuthorizationMethodValue', { value1: (account.mode === 'oauth' ? $t('ui.accountSignIn') : 'API Key') })"
            @update:model-value="switchMode"
          />
        </fieldset>
      </SettingRow>
    </SettingGroup>

    <ToolNotice v-if="error" tone="danger" class="nexus-account__notice">{{ error }}</ToolNotice>

    <div v-if="account.mode === 'api_key'" class="nexus-account__key">
      <slot name="api-key" />
    </div>
    <SettingGroup v-else :title="$t('steamAccount.title')">
      <div class="nexus-account__login setting-account">
        <span class="setting-account__avatar" :class="{ 'is-empty': !account.user }">
          <img
            v-if="account.user?.avatar"
            :src="account.user.avatar"
            :alt="$t('ui.nexusUserAvatar')"
            referrerpolicy="no-referrer"
          />
          <template v-else>{{ account.user ? 'N' : '?' }}</template>
        </span>
        <div class="setting-account__body">
          <p class="setting-account__name">
            {{ account.user?.name || $t('ui.notSignedInToNexus') }}
            <span
              v-if="account.user"
              class="tool-status"
              :class="account.connected ? 'is-success' : 'is-warning'"
            >
              {{ account.connected ? account.user.accountType : $t('steamAccount.expired') }}
            </span>
          </p>
          <p v-if="authorizing" role="status" class="setting-row__description">
            {{ $t('ui.completeSignInIn') }}{{ account.browserMode === 'external' ? $t('ui.browser') : $t('ui.authorizationWindow') }}{{ $t('ui.undefined') }}
          </p>
          <p
            v-else-if="!account.configured"
            role="status"
            class="setting-row__description nexus-account__hint"
          >
            {{ $t('ui.accountSignInIsUnavailable') }}
          </p>
          <p v-else-if="!error && account.message" role="status" class="setting-row__description">
            {{ account.message }}
          </p>
          <p v-else-if="!account.user" class="setting-row__description">
            {{ $t('ui.signInToNexusInTheAuthorizationWindowYouWill') }}
          </p>
        </div>
        <div class="nexus-account__actions setting-account__actions">
          <VxButton
            :variant="account.user ? 'secondary' : 'primary'"
            size="sm"
            :loading="authorizing"
            :disabled="!account.configured || loading || switching"
            @click="action('login')"
          >
            {{ account.user ? $t('steamAccount.reauthorize') : $t('ui.signInAndAuthorize') }}
          </VxButton>
          <VxButton v-if="authorizing" variant="secondary" size="sm" @click="action('cancel')"
            >{{ $t('steamAccount.cancel') }}</VxButton
          >
          <VxButton
            v-if="account.user"
            variant="ghost"
            size="sm"
            class="setting-danger-button"
            :disabled="authorizing"
            @click="confirmLogout = true"
            >{{ $t('steamAccount.signOut') }}</VxButton
          >
        </div>
      </div>
    </SettingGroup>

    <ToolNotice tone="info" class="nexus-account__permission">
      {{ $t('ui.standardAccountsUsuallyNeedToApproveEachFileDownloadOn') }}
    </ToolNotice>

    <VxConfirmModal
      v-model="confirmLogout"
      :title="$t('ui.signOutOfNexus')"
      danger
      :confirm-text="$t('steamAccount.signOut')"
      :description="$t('ui.youWillNeedToSignInAgainExistingTasksWill')"
      :confirm-action="() => performNexusAccountAction('logout')"
    />
  </section>
</template>

<style scoped>
.nexus-account__switch {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.nexus-account > * + * {
  margin-top: 28px;
}
</style>
