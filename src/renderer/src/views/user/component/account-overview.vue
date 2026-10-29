<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { useUserStore } from '@renderer/store/userStore.js'
import { getUserAvatarInitial } from '../../../../../shared/account/user-avatar.js'

defineProps({
  loading: Boolean,
  failed: Boolean,
  busy: Boolean
})
const emit = defineEmits(['refresh', 'logout'])
const userStore = useUserStore()
const info = computed(() => userStore.userInfo)
const avatarFailed = ref(false)
const copied = ref(false)
let copiedTimer = null
const dateText = computed(() => {
  const date = new Date(info.value.createdAt)
  return info.value.createdAt && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('zh-CN')
    : uiText('ui.none')
})
watch(
  () => info.value.avatar,
  () => {
    avatarFailed.value = false
  }
)

async function copyId() {
  if (!info.value.id) return
  try {
    await navigator.clipboard.writeText(String(info.value.id))
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    copied.value = false
  }
}
onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
  <aside class="account-overview" :aria-label="$t('ui.accountOverview')" :aria-busy="loading && !info.id">
    <template v-if="loading && !info.id">
      <span class="account-skeleton is-avatar"></span>
      <span class="account-skeleton is-title"></span>
      <span class="account-skeleton is-line"></span>
      <div class="account-overview-section">
        <span class="account-skeleton is-row"></span>
        <span class="account-skeleton is-row"></span>
      </div>
    </template>
    <template v-else>
      <span class="account-avatar is-lg" :class="{ 'is-muted': failed }">
        <img
          v-if="info.avatar && !avatarFailed"
          :src="info.avatar"
          :alt="$t('ui.currentAvatar')"
          @error="avatarFailed = true"
        />
        <span v-else :aria-label="$t('home.defaultAvatar')">{{ getUserAvatarInitial(info.nickname) }}</span>
      </span>
      <p class="account-overview-name">{{ info.nickname || $t('home.myAccount') }}</p>
      <p v-if="failed" class="account-sync-tag"><span aria-hidden="true"></span>{{ $t('ui.detailsNotSynced') }}</p>
      <p v-else-if="info.id" class="account-overview-id">
        <span>{{ $t('ui.userID') }}</span>
        <span class="account-mono">{{ info.id }}</span>
        <button
          class="account-icon-button"
          type="button"
          :aria-label="copied ? $t('ui.userIDCopied') : $t('ui.copyUserID')"
          :title="copied ? $t('ui.copiedVariant2') : $t('tools.copy')"
          @click="copyId"
        >
          <svg
            v-if="copied"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12l5 5L20 7"></path>
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="12" height="12" rx="2"></rect>
            <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
          </svg>
        </button>
        <span class="visually-hidden" role="status">{{ copied ? $t('ui.userIDCopied') : '' }}</span>
      </p>
      <p v-if="failed" class="account-overview-section account-row-hint">
        {{ $t('ui.loadYourAccountDetailsToViewYourEmailAndRegistration') }}
      </p>
      <dl v-else class="account-overview-section account-overview-details">
        <div>
          <dt>{{ $t('auth.register.email') }}</dt>
          <dd :title="info.email || ''">{{ info.email || $t('ui.notSet') }}</dd>
        </div>
        <div>
          <dt>{{ $t('ui.registeredOn') }}</dt>
          <dd>{{ dateText }}</dd>
        </div>
      </dl>
    </template>
    <div class="account-overview-section account-overview-actions">
      <VxButton
        variant="secondary"
        size="sm"
        :loading="loading"
        :disabled="busy"
        @click="emit('refresh')"
      >
        {{ $t('ui.refreshDetails') }}
      </VxButton>
      <VxButton
        class="account-logout-button"
        variant="secondary"
        size="sm"
        :disabled="busy || loading"
        @click="emit('logout')"
      >
        {{ $t('steamAccount.signOut') }}
      </VxButton>
    </div>
  </aside>
</template>
