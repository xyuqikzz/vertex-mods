<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { VxButton, VxInput } from '@renderer/component/vertex-ui'
import { UPDATE_ACCOUNT_PASSWORD } from '@renderer/api/modules/user.js'
import { getAccountSessionSignal } from '@renderer/utils/account-session.js'
import { validatePassword } from '../profile-service.js'

defineProps({ actionBusy: Boolean })
const emit = defineEmits(['state', 'passwordChanged'])
const editing = ref(false)
const password = ref('')
const repeat = ref('')
const error = ref('')
const busy = ref(false)
const passwordForm = ref(null)
const editButton = ref(null)
const controller = new AbortController()
const signal = AbortSignal.any([controller.signal, getAccountSessionSignal()])
const dirty = computed(() => Boolean(password.value || repeat.value))
watch(
  [dirty, busy],
  () => emit('state', { dirty: dirty.value, count: Number(dirty.value), busy: busy.value }),
  { immediate: true }
)
function reset() {
  password.value = repeat.value = error.value = ''
  editing.value = false
}
async function startEdit() {
  editing.value = true
  await nextTick()
  passwordForm.value?.querySelector('input')?.focus()
}
async function cancel() {
  if (busy.value) return
  reset()
  await nextTick()
  editButton.value?.focus()
}
async function changePassword() {
  if (busy.value) return
  error.value = validatePassword(password.value, repeat.value)
  if (error.value) return
  busy.value = true
  try {
    await UPDATE_ACCOUNT_PASSWORD(
      { password: password.value, repeatPassword: repeat.value },
      { signal }
    )
    signal.throwIfAborted()
    reset()
    emit('passwordChanged')
  } catch (e) {
    if (!signal.aborted) error.value = e.message || '密码未确认修改，请重试。'
  } finally {
    busy.value = false
  }
}
defineExpose({ reset })
onBeforeUnmount(() => {
  controller.abort()
  reset()
})
</script>

<template>
  <form
    v-if="editing"
    ref="passwordForm"
    class="account-row is-editing password-form"
    @submit.prevent="changePassword"
    @keydown.esc.prevent.stop="cancel"
  >
    <span class="account-row-label">{{ $t('ui.loginPassword') }}</span>
    <div class="account-row-body password-fields">
      <VxInput
        v-model="password"
        type="password"
        :label="$t('ui.newPassword')"
        :hint="$t('ui.816CharactersIncludingLettersAndNumbers')"
        :disabled="busy || actionBusy"
      />
      <VxInput
        v-model="repeat"
        type="password"
        :label="$t('ui.enterTheNewPasswordAgain')"
        :error="error"
        :disabled="busy || actionBusy"
      />
      <p class="account-warning">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9v4M12 17h.01"></path>
          <path
            d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
          ></path>
        </svg>
        {{ $t('ui.savingSignsYouOutSignInAgainWithYourNew') }}
      </p>
    </div>
    <div class="account-row-actions">
      <VxButton type="submit" size="sm" :loading="busy" :disabled="actionBusy"
        >{{ $t('ui.saveAndSignInAgain') }}</VxButton
      >
      <VxButton size="sm" variant="ghost" :disabled="busy || actionBusy" @click="cancel"
        >{{ $t('ui.cancel') }}</VxButton
      >
    </div>
  </form>
  <div v-else class="account-row">
    <span class="account-row-label">{{ $t('ui.loginPassword') }}</span>
    <div class="account-row-body">
      <span class="account-row-hint">{{ $t('ui.signInAgainAfterChangingYourPasswordYouCanChange') }}</span>
    </div>
    <div class="account-row-actions">
      <VxButton
        ref="editButton"
        size="sm"
        variant="secondary"
        :disabled="actionBusy"
        @click="startEdit"
        >{{ $t('ui.changePassword') }}</VxButton
      >
    </div>
  </div>
</template>
