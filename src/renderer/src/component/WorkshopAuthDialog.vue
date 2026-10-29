<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { VxCheckbox, VxDialogActions, VxInput, VxModal, VxSegmented } from './vertex-ui'
import { normalizeWorkshopCredentials, normalizeWorkshopGuardCode, workshopQrMatrix } from '../../../shared/sources/steam-workshop.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'

const pending = ref({})
const cancelling = ref(false)
const submitting = ref(false)
const mode = ref('qr')
const username = ref('')
const password = ref('')
const code = ref('')
const guardMode = ref('code')
const errorText = ref('')
const current = computed(() => Object.values(pending.value)[0] || null)
const isSettings = computed(() => current.value?.purpose === 'settings')
const rememberBusy = ref(false)
const canChoose = computed(() => ['qr', 'credentials'].includes(current.value?.phase))
const isGuard = computed(() => current.value?.phase === 'guard')
const canSubmit = computed(() => Boolean(current.value?.requestId) && (isGuard.value || (canChoose.value && mode.value === 'credentials')))
const matrix = computed(() => workshopQrMatrix(current.value?.qrText))
const qrViewBox = computed(() => `0 0 ${(matrix.value[0]?.length || 0) + 16} ${matrix.value.length + 16}`)
const qrPath = computed(() => matrix.value.flatMap((row, y) => row.flatMap((dark, x) =>
  dark ? [`M${x + 8} ${y + 8}h1v1h-1z`] : []
)).join(''))
watch(() => current.value?.jobId, () => {
  username.value = ''
  password.value = ''
  code.value = ''
  errorText.value = ''
  mode.value = 'qr'
})
watch(() => current.value?.requestId, () => {
  password.value = ''
  code.value = ''
  errorText.value = ''
  if (current.value?.phase === 'credentials') mode.value = 'credentials'
})
watch(mode, (value) => {
  password.value = ''; errorText.value = ''
  if (value === 'qr' && current.value?.phase === 'credentials') void restartQr()
})
onBeforeUnmount(() => { password.value = ''; code.value = '' })
function receive(data) {
  if (!data?.jobId) return
  if (data.phase && data.phase !== 'closed') pending.value[data.jobId] = data
  else if (data.qrText) pending.value[data.jobId] = { ...data, phase: 'qr' }
  else delete pending.value[data.jobId]
}
useIpc('workshop:auth-updated', receive)
onMounted(async () => {
  try {
    ;(await ipcRenderer.invoke('workshop:auth-state')).forEach(receive)
  } catch {
    /* 无授权任务时不打扰用户。 */
  }
})
async function submit() {
  if (!canSubmit.value || submitting.value || cancelling.value || rememberBusy.value) return
  errorText.value = ''
  let fields
  try {
    fields = isGuard.value
      ? { code: normalizeWorkshopGuardCode(code.value) }
      : normalizeWorkshopCredentials({ username: username.value, password: password.value, guardMode: guardMode.value })
  } catch (error) {
    errorText.value = error.message
    return
  }
  const jobId = current.value.jobId
  const requestId = current.value.requestId
  submitting.value = true
  password.value = ''
  code.value = ''
  try {
    const result = await ipcRenderer.invoke('workshop:auth-submit', { jobId, requestId, ...fields })
    if (result?.success !== true && current.value?.jobId === jobId)
      errorText.value = result?.message || '提交登录信息失败，请重试'
  } catch {
    errorText.value = '提交登录信息失败，请重试'
  } finally {
    fields = null
    submitting.value = false
  }
}
async function restartQr() {
  if (!current.value?.requestId || submitting.value) return
  const { jobId, requestId } = current.value
  submitting.value = true
  try {
    const result = await ipcRenderer.invoke('workshop:auth-submit', { jobId, requestId, mode: 'qr' })
    if (!result?.success) errorText.value = result?.message || '无法重新生成二维码'
  } catch {
    errorText.value = '无法重新生成二维码，请重试'
  } finally { submitting.value = false }
}
async function remember(value) {
  if (!current.value?.requestId || rememberBusy.value) return
  const { jobId, requestId } = current.value
  rememberBusy.value = true
  try {
    const result = await ipcRenderer.invoke('workshop:auth-remember', { jobId, requestId, remember: value })
    if (!result?.success && current.value?.requestId === requestId) errorText.value = result?.message || '无法更新登录保存选项'
  } catch {
    errorText.value = '无法更新登录保存选项，请重试'
  } finally { rememberBusy.value = false }
}
async function cancel() {
  if (!current.value || cancelling.value) return
  const jobId = current.value.jobId
  cancelling.value = true
  try {
    const result = isSettings.value
      ? await ipcRenderer.invoke('steam-account:cancel')
      : await ipcRenderer.invoke('source-install-task:cancel', { jobId })
    if (result?.success === false) throw new Error(result.message || uiText('ui.couldNotCancel'))
    delete pending.value[jobId]
  } catch (error) {
    $message.error(error.message)
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <VxModal
    :model-value="Boolean(current)"
    :title="$t('ui.steamSignInAuthorization')"
    :description="isSettings ? $t('ui.afterAuthorizationTheAccountCanBeReusedForModDownloads') : $t('ui.signInToASteamAccountThatOwnsThisGame')"
    :width="560"
    @update:model-value="!$event && cancel()"
  >
    <div v-if="current" class="workshop-auth">
      <VxSegmented
        v-if="canChoose"
        v-model="mode"
        :options="[{ value: 'qr', label: $t('ui.signInQr') }, { value: 'credentials', label: $t('ui.accountPassword') }]"
        :aria-label="$t('ui.steamSignInMethod')"
      />
      <p class="workshop-auth__hint">{{ $t('ui.theConfirmationScreenOnYourPhoneShowsTheDeviceName') }}</p>
      <p v-if="current.message" class="workshop-auth__message" role="status">{{ current.message }}</p>
      <template v-if="canChoose || isGuard">
        <VxCheckbox
          :model-value="current.remember === true" :label="$t('ui.rememberSignInAcrossRestarts')"
          :disabled="!current.requestId || submitting || cancelling || rememberBusy" @update:model-value="remember" />
        <p class="workshop-auth__hint">{{ $t('ui.signInIsEncryptedOnThisComputerIfUncheckedThe') }}</p>
      </template>
      <template v-if="canChoose && mode === 'qr'">
        <svg v-if="matrix.length" class="workshop-auth-qr" :viewBox="qrViewBox" role="img" :aria-label="$t('ui.steamSignInQRCode')" shape-rendering="crispEdges">
          <rect width="100%" height="100%" fill="#fff" />
          <path :d="qrPath" fill="#000" />
        </svg>
        <p v-else class="workshop-auth__waiting" role="status">{{ $t('ui.generatingQRCode') }}</p>
        <p class="workshop-auth__hint">{{ $t('ui.scanWithTheSteamMobileAppIfScanningFailsSwitch') }}</p>
      </template>
      <form v-else-if="canChoose" class="workshop-auth__form" autocomplete="off" @submit.prevent="submit">
        <VxInput v-model="username" :label="$t('ui.steamAccount')" :placeholder="$t('ui.yourSignInNameNotYourNicknameOrEmail')" :disabled="submitting || cancelling" @keydown.enter.prevent="submit" />
        <VxInput v-model="password" :label="$t('auth.login.password')" type="password" :disabled="submitting || cancelling" :error="errorText" @keydown.enter.prevent="submit" />
        <div class="workshop-auth__verification">
          <span>{{ $t('ui.steamGuardVerificationMethod') }}</span>
          <VxSegmented v-model="guardMode" :options="[{ value: 'code', label: '输入验证码' }, { value: 'mobile', label: '手机应用确认' }]" />
        </div>
        <p class="workshop-auth__hint">{{ $t('ui.passwordsAndVerificationCodesAreUsedOnlyForThisVerification') }}</p>
      </form>
      <form v-else-if="isGuard" class="workshop-auth__form" autocomplete="off" @submit.prevent="submit">
        <VxInput
          v-model="code"
          :label="current.kind === 'email' ? $t('auth.register.code') : $t('ui.steamGuardCode')"
          :hint="current.kind === 'email' ? $t('ui.enterThe5CharacterCodeSteamSentToYourLinked') : $t('ui.openSteamGuardInTheSteamMobileAppAndEnter')"
          :disabled="submitting || cancelling"
          :error="errorText"
          @keydown.enter.prevent="submit"
        />
      </form>
      <p v-else class="workshop-auth__waiting" role="status">{{ current.phase === 'mobile' ? $t('ui.waitingForPhoneConfirmation') : $t('ui.connectingToSteamPleaseWait') }}</p>
      <p v-if="errorText && !canSubmit" role="alert">{{ errorText }}</p>
    </div>
    <template #footer>
      <VxDialogActions
        :cancel-text="isSettings ? $t('steamAccount.cancel') : $t('ui.cancelThisDownload')"
        :cancel-disabled="cancelling"
        :show-confirm="canSubmit"
        :confirm-text="isGuard ? $t('ui.verifyAndContinue') : isSettings ? $t('ui.signInAndAuthorizeVariant2') : $t('ui.signInAndContinue')"
        :confirm-loading="submitting"
        :confirm-disabled="cancelling || rememberBusy"
        @cancel="cancel"
        @confirm="submit"
      />
    </template>
  </VxModal>
</template>

<style scoped>
.workshop-auth-qr {
  display: block;
  width: 280px;
  height: 280px;
  max-width: 100%;
  margin: var(--space-4) auto;
  background: #fff;
}
.workshop-auth,
.workshop-auth__form,
.workshop-auth__verification {
  display: grid;
  gap: var(--space-3);
}
.workshop-auth p { margin: 0; }
.workshop-auth__hint { color: var(--color-text-muted); font-size: var(--font-size-sm); }
.workshop-auth__message { color: var(--color-text); }
.workshop-auth__waiting { padding: var(--space-6) 0; text-align: center; color: var(--color-text-muted); }
</style>
