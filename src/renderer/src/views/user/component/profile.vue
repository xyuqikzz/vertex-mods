<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { VxButton, VxInput, VxTag } from '@renderer/component/vertex-ui'
import { useUserStore } from '@renderer/store/userStore.js'
import { UPLOAD_USER_INFO } from '@renderer/api/modules/user.js'
import { getAccountSessionSignal } from '@renderer/utils/account-session.js'
import { submitAvatar, validateAvatar, validateNickname } from '../profile-service.js'
import { getUserAvatarInitial } from '../../../../../shared/account/user-avatar.js'

const emit = defineEmits(['state'])
const userStore = useUserStore()
const editingNickname = ref(false)
const nickname = ref(userStore.userInfo.nickname || '')
const file = ref(null)
const preview = ref('')
const avatarFailed = ref(false)
const fileInput = ref(null)
const nicknameForm = ref(null)
const nicknameButton = ref(null)
const avatarButton = ref(null)
const busy = ref('')
const error = ref('')
const avatarError = ref('')
const avatarNotice = ref('')
const nicknameError = ref('')
const saved = ref('')
let savedTimer = null
const controller = new AbortController()
const signal = AbortSignal.any([controller.signal, getAccountSessionSignal()])
const currentNickname = computed(() => userStore.userInfo.nickname || '')
const nicknameDirty = computed(
  () => editingNickname.value && nickname.value.trim() !== currentNickname.value
)
const dirtyCount = computed(() => Number(nicknameDirty.value) + Number(Boolean(file.value)))
const fileText = computed(() => {
  if (!file.value) return ''
  const size = file.value.size
  return `${file.value.name} · ${size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`}`
})
watch(
  () => userStore.userInfo.avatar,
  () => {
    avatarFailed.value = false
  }
)
watch(
  [dirtyCount, busy],
  () =>
    emit('state', {
      dirty: dirtyCount.value > 0,
      count: dirtyCount.value,
      busy: Boolean(busy.value)
    }),
  { immediate: true }
)

function flash(name) {
  saved.value = name
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    saved.value = ''
  }, 2000)
}
function resetAvatar() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
}
function closeNickname() {
  editingNickname.value = false
  nickname.value = currentNickname.value
  error.value = nicknameError.value = ''
}
function reset() {
  closeNickname()
  resetAvatar()
  avatarError.value = avatarNotice.value = ''
}
async function startEditNickname() {
  nickname.value = currentNickname.value
  error.value = nicknameError.value = ''
  editingNickname.value = true
  await nextTick()
  const input = nicknameForm.value?.querySelector('input')
  input?.focus()
  input?.select()
}
async function cancelNickname() {
  if (busy.value === 'profile') return
  closeNickname()
  await nextTick()
  nicknameButton.value?.focus()
}
function cancelAvatar() {
  resetAvatar()
  avatarError.value = ''
  nextTick(() => avatarButton.value?.focus())
}
function selectAvatar(event) {
  const selected = event.target.files?.[0]
  if (!selected) return
  avatarError.value = validateAvatar(selected)
  event.target.value = ''
  if (avatarError.value) return
  resetAvatar()
  file.value = selected
  preview.value = URL.createObjectURL(selected)
  avatarNotice.value = ''
}
function handlePreviewError() {
  resetAvatar()
  avatarError.value = uiText('ui.couldNotReadThisImageChooseAValidPNGJPG')
}
async function saveNickname() {
  if (busy.value) return
  nicknameError.value = validateNickname(nickname.value)
  if (nicknameError.value) return
  error.value = ''
  busy.value = 'profile'
  const value = nickname.value.trim()
  let done = false
  try {
    await UPLOAD_USER_INFO(
      { nickname: value, steamFriendCode: userStore.userInfo.steamFriendCode },
      { signal }
    )
    signal.throwIfAborted()
    userStore.setUserInfo({ ...userStore.userInfo, nickname: value })
    editingNickname.value = false
    nickname.value = value
    flash('nickname')
    done = true
  } catch (e) {
    if (!signal.aborted) error.value = '昵称未确认保存：' + (e.message || '请求失败，请重试。')
  } finally {
    busy.value = ''
  }
  // 按钮在 busy 期间是禁用的，解除后再把焦点还给「修改」。
  if (done) {
    await nextTick()
    nicknameButton.value?.focus()
  }
}
async function saveAvatar() {
  if (busy.value || !file.value) return
  avatarError.value = avatarNotice.value = ''
  busy.value = 'avatar'
  try {
    const result = await submitAvatar(file.value, signal)
    userStore.setUserInfo({ ...userStore.userInfo, avatar: result.avatar })
    resetAvatar()
    flash('avatar')
    try {
      await userStore.upUserInfo()
    } catch {
      if (!signal.aborted) avatarNotice.value = '头像已更新，暂未刷新资料，可点击“刷新资料”重试。'
    }
  } catch (e) {
    if (!signal.aborted)
      avatarError.value = '头像未确认提交：' + (e.message || '请求失败，请重试。')
  } finally {
    busy.value = ''
  }
  if (!file.value) {
    await nextTick()
    avatarButton.value?.focus()
  }
}
defineExpose({ reset })
onBeforeUnmount(() => {
  controller.abort()
  clearTimeout(savedTimer)
  resetAvatar()
})
</script>

<template>
  <div class="profile-page" :aria-busy="Boolean(busy)">
    <div class="account-row" :class="{ 'is-editing': file }">
      <span class="account-row-label">{{ $t('ui.avatar') }}</span>
      <div class="account-row-body">
        <div class="avatar-line">
          <span class="account-avatar is-sm" :class="{ 'is-replaced': file }">
            <img
              v-if="userStore.userInfo.avatar && !avatarFailed"
              :src="userStore.userInfo.avatar"
              :alt="$t('ui.currentAvatar')"
              @error="avatarFailed = true"
            />
            <span v-else :aria-label="$t('home.defaultAvatar')">{{
              getUserAvatarInitial(userStore.userInfo.nickname)
            }}</span>
          </span>
          <template v-if="file">
            <svg
              class="avatar-arrow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6"></path>
            </svg>
            <span class="account-avatar is-sm is-new">
              <img :src="preview" :alt="$t('ui.newAvatarPreview')" @error="handlePreviewError" />
            </span>
            <span class="avatar-file">
              <strong>{{ fileText }}</strong>
              <span>{{ $t('ui.takesEffectImmediatelyYouCannotChangeItAgainFor30') }}</span>
            </span>
          </template>
          <span v-else class="account-row-hint"
            >{{ $t('ui.pNGJPGOrWebPUpTo512KBChangeOnce') }}</span
          >
        </div>
        <p v-if="avatarError" class="account-error" role="alert">{{ avatarError }}</p>
        <p v-if="avatarNotice" class="account-row-hint" role="status">{{ avatarNotice }}</p>
      </div>
      <div class="account-row-actions">
        <span v-if="saved === 'avatar'" class="account-saved" role="status">{{ $t('ui.updated') }}</span>
        <template v-if="file">
          <VxButton
            size="sm"
            :loading="busy === 'avatar'"
            :disabled="Boolean(busy)"
            @click="saveAvatar"
            >{{ avatarError ? $t('ui.retryAvatarUpload') : $t('ui.uploadAvatar') }}</VxButton
          >
          <VxButton size="sm" variant="ghost" :disabled="Boolean(busy)" @click="cancelAvatar"
            >{{ $t('ui.cancel') }}</VxButton
          >
        </template>
        <VxButton
          v-else
          ref="avatarButton"
          size="sm"
          variant="secondary"
          :disabled="Boolean(busy)"
          @click="fileInput?.click()"
          >{{ $t('ui.changeAvatar') }}</VxButton
        >
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="selectAvatar"
      />
    </div>

    <form
      v-if="editingNickname"
      ref="nicknameForm"
      class="account-row is-editing nickname-form"
      @submit.prevent="saveNickname"
      @keydown.esc.prevent.stop="cancelNickname"
    >
      <span class="account-row-label">{{ $t('auth.register.nickname') }}</span>
      <div class="account-row-body">
        <div class="nickname-field">
          <VxInput
            v-model="nickname"
            :aria-label="$t('auth.register.nickname')"
            :hint="$t('ui.210CharactersPreviousNicknameValue', { value1: (currentNickname || $t('ui.notSet')) })"
            :error="nicknameError"
            :disabled="busy === 'profile'"
          />
          <span class="nickname-count" aria-hidden="true">{{ nickname.trim().length }}/10</span>
        </div>
        <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      </div>
      <div class="account-row-actions">
        <VxButton
          type="submit"
          size="sm"
          :loading="busy === 'profile'"
          :disabled="Boolean(busy) || nickname.trim() === currentNickname"
          >{{ error ? $t('ui.retrySave') : $t('dialogs.vamCookie.save') }}</VxButton
        >
        <VxButton size="sm" variant="ghost" :disabled="Boolean(busy)" @click="cancelNickname"
          >{{ $t('ui.cancel') }}</VxButton
        >
      </div>
    </form>
    <div v-else class="account-row">
      <span class="account-row-label">{{ $t('auth.register.nickname') }}</span>
      <div class="account-row-body">
        <span class="account-row-value">{{ currentNickname || $t('ui.notSet') }}</span>
      </div>
      <div class="account-row-actions">
        <span v-if="saved === 'nickname'" class="account-saved" role="status">{{ $t('ui.saved') }}</span>
        <VxButton
          ref="nicknameButton"
          size="sm"
          variant="secondary"
          :disabled="Boolean(busy)"
          @click="startEditNickname"
          >{{ $t('ui.edit') }}</VxButton
        >
      </div>
    </div>

    <div class="account-row">
      <span class="account-row-label">{{ $t('auth.register.email') }}</span>
      <div class="account-row-body account-row-inline">
        <template v-if="userStore.userInfo.email">
          <span class="account-row-value is-ellipsis" :title="userStore.userInfo.email">{{
            userStore.userInfo.email
          }}</span>
          <VxTag class="account-status-tag" size="sm" tone="success">{{ $t('ui.set') }}</VxTag>
        </template>
        <span v-else class="account-row-hint">{{ $t('ui.noEmailAddress') }}</span>
      </div>
      <div class="account-row-actions"></div>
    </div>
  </div>
</template>
