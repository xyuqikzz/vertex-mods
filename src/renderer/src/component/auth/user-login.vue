<script setup>
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import ToolIcon from '@renderer/component/tool-page/ToolIcon.vue'
import { $message } from '@renderer/common/message.js'
import {
  GET_LOGIN_VERIFICATION_CODE,
  GET_REGISTRATION_VERIFICATION_CODE,
  REGISTER_USER,
  SEND_RESET_PASSWORD_LINK,
  USER_LOGIN
} from '@renderer/api/modules/user.js'
import { useUserStore } from '@renderer/store/userStore.js'

const emit = defineEmits(['loginSuccess'])

const { t } = useI18n()
const userStore = useUserStore()

const VIEW = Object.freeze({ LOGIN: 'login', FORGOT: 'forgot', REGISTER: 'register', DONE: 'done' })
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 业务错误在表单里显示，不再额外弹全局提示。
const REQUEST_CONFIG = Object.freeze({ silentBusinessError: true, hideLoading: true })

const isShowLogin = ref(false)
const view = ref(VIEW.LOGIN)
const isLoading = ref(false)
const showPassword = ref(false)
const formError = ref('')
const errors = ref({})
const rootRef = ref(null)

const loginForm = ref(createLoginForm())
const registerForm = ref(createRegisterForm())
const forgotForm = ref({ email: '' })
const forgotSentEmail = ref('')
const codeSentEmail = ref('')
const registerAccount = ref('')

const verifyCode = ref({ key: '', base64: '' })
const verifyCodeLoading = ref(false)

const modalTitle = computed(() => {
  if (view.value === VIEW.REGISTER) return t('auth.register.title')
  if (view.value === VIEW.FORGOT) return t('auth.forgot.title')
  if (view.value === VIEW.DONE) return ''
  return t('auth.login.title')
})

const modalSubtitle = computed(() => {
  if (view.value === VIEW.REGISTER) return t('auth.register.subtitle')
  if (view.value === VIEW.FORGOT) return t('auth.forgot.subtitle')
  if (view.value === VIEW.DONE) return ''
  return t('auth.login.subtitle')
})

const codeCountingDown = computed(() => userStore.regCodeCountdown !== 60)

const passwordRules = computed(() => {
  const value = String(registerForm.value.password || '')
  return [
    {
      key: 'length',
      label: t('auth.register.ruleLength'),
      ok: value.length >= 8 && value.length <= 16
    },
    { key: 'letter', label: t('auth.register.ruleLetter'), ok: /[a-zA-Z]/.test(value) },
    { key: 'digit', label: t('auth.register.ruleDigit'), ok: /[0-9]/.test(value) }
  ]
})

function createLoginForm() {
  return { username: '', password: '', code: '', key: '' }
}

function createRegisterForm() {
  return { nickname: '', username: '', email: '', password: '', confirmPassword: '', captcha: '' }
}

function resetFeedback() {
  formError.value = ''
  errors.value = {}
  showPassword.value = false
}

function setView(next, { keepUsername = '' } = {}) {
  resetFeedback()
  view.value = next
  if (next === VIEW.LOGIN) {
    loginForm.value = { ...createLoginForm(), username: keepUsername }
    getVerifyCode()
  } else if (next === VIEW.REGISTER) {
    registerForm.value = createRegisterForm()
    codeSentEmail.value = ''
  } else if (next === VIEW.FORGOT) {
    forgotForm.value = { email: '' }
    forgotSentEmail.value = ''
  }
  focusFirstField()
}

function open() {
  isShowLogin.value = true
  setView(VIEW.LOGIN)
}

function close() {
  isShowLogin.value = false
}

function focusFirstField() {
  nextTick(() => {
    rootRef.value?.querySelector('input:not([disabled])')?.focus()
  })
}

function focusField(id) {
  nextTick(() => {
    document.getElementById(id)?.focus()
  })
}

function errorId(key) {
  return `auth-${key}-error`
}

function fieldDescribedBy(key, hintId = '') {
  return [errors.value[key] ? errorId(key) : '', hintId].filter(Boolean).join(' ') || undefined
}

function clearError(key) {
  if (errors.value[key]) {
    const next = { ...errors.value }
    delete next[key]
    errors.value = next
  }
}

// 按字段顺序检查，返回第一个出错的字段 id。
function applyErrors(entries = []) {
  const next = {}
  let firstId = ''
  for (const [key, message, fieldId] of entries) {
    if (message && !next[key]) {
      next[key] = message
      if (!firstId) firstId = fieldId
    }
  }
  errors.value = next
  if (firstId) focusField(firstId)
  return !firstId
}

function resolveRequestError(error) {
  const message = String(error?.message || '').trim()
  if (!message || /network error|request failed|timeout/i.test(message)) {
    return t('auth.networkError')
  }
  return /[。.!！?？]$/.test(message) ? message : `${message}。`
}

function validateUsername(value) {
  const text = String(value || '')
  if (!text) return t('auth.errors.usernameRequired')
  if (text.length < 6 || text.length > 12) {
    return t('auth.errors.usernameLength', { count: text.length })
  }
  return ''
}

function validatePassword(value) {
  const text = String(value || '')
  if (!text) return t('auth.errors.passwordRequired')
  if (text.length < 8 || text.length > 16) {
    return t('auth.errors.passwordLength', { count: text.length })
  }
  return ''
}

function validateEmail(value) {
  const text = String(value || '').trim()
  if (!text) return t('auth.errors.emailRequired')
  if (!EMAIL_PATTERN.test(text)) return t('auth.errors.emailInvalid', { at: '@' })
  return ''
}

async function handleLogin() {
  if (isLoading.value) return
  const form = loginForm.value
  formError.value = ''
  const code = String(form.code || '').trim()
  const valid = applyErrors([
    ['loginUsername', validateUsername(form.username), 'auth-login-user'],
    ['loginPassword', validatePassword(form.password), 'auth-login-pass'],
    [
      'loginCode',
      !code
        ? t('auth.errors.codeRequired')
        : code.length !== 5
          ? t('auth.errors.loginCodeLength')
          : '',
      'auth-login-code'
    ]
  ])
  if (!valid) return

  isLoading.value = true
  try {
    const data = await USER_LOGIN({ ...form, code }, REQUEST_CONFIG)
    await userStore.setToken(data)
    $message.success(t('auth.login.success'))
    close()
    emit('loginSuccess')
  } catch (error) {
    formError.value = t('auth.login.failed', { reason: resolveRequestError(error) })
    loginForm.value = { ...loginForm.value, code: '', password: '' }
    getVerifyCode()
    focusField('auth-login-pass')
  } finally {
    isLoading.value = false
  }
}

function validateRegisterForm() {
  const form = registerForm.value
  const nickname = String(form.nickname || '').trim()
  const username = String(form.username || '')
  const captcha = String(form.captcha || '').trim()
  let nicknameError = ''
  if (!nickname) nicknameError = t('auth.errors.nicknameRequired')
  else if (nickname.length < 2 || nickname.length > 10) {
    nicknameError = t('auth.errors.nicknameLength', { count: nickname.length })
  } else if (!/^[一-龥a-zA-Z0-9]+$/.test(nickname)) {
    nicknameError = t('auth.errors.nicknameChars')
  }

  let usernameError = validateUsername(username)
  if (!usernameError && !/^[a-zA-Z0-9]+$/.test(username)) {
    usernameError = t('auth.errors.usernameChars')
  } else if (!usernameError && /([a-zA-Z0-9])\1{3,}/.test(username)) {
    usernameError = t('auth.errors.usernameRepeat')
  }

  let passwordError = validatePassword(form.password)
  if (!passwordError && (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password))) {
    passwordError = t('auth.errors.passwordMix')
  }

  let confirmError = ''
  if (!form.confirmPassword) confirmError = t('auth.errors.confirmRequired')
  else if (form.confirmPassword !== form.password) confirmError = t('auth.errors.confirmMismatch')

  return applyErrors([
    ['regNickname', nicknameError, 'auth-reg-nick'],
    ['regUsername', usernameError, 'auth-reg-user'],
    ['regEmail', validateEmail(form.email), 'auth-reg-mail'],
    [
      'regCode',
      !captcha
        ? t('auth.errors.codeRequired')
        : captcha.length !== 6
          ? t('auth.errors.registerCodeLength')
          : '',
      'auth-reg-code'
    ],
    ['regPassword', passwordError, 'auth-reg-pass'],
    ['regConfirm', confirmError, 'auth-reg-pass2']
  ])
}

async function handleRegister() {
  if (isLoading.value) return
  formError.value = ''
  if (!validateRegisterForm()) return

  const form = registerForm.value
  isLoading.value = true
  try {
    await REGISTER_USER(
      {
        ...form,
        nickname: form.nickname.trim(),
        email: form.email.trim(),
        captcha: form.captcha.trim()
      },
      REQUEST_CONFIG
    )
    registerAccount.value = form.username
    resetFeedback()
    view.value = VIEW.DONE
  } catch (error) {
    formError.value = resolveRequestError(error)
  } finally {
    isLoading.value = false
  }
}

async function handleForgotPassword() {
  if (forgotSentEmail.value) {
    setView(VIEW.LOGIN)
    return
  }
  formError.value = ''
  const email = String(forgotForm.value.email || '').trim()
  if (!applyErrors([['forgotEmail', validateEmail(email), 'auth-forgot-mail']])) return

  isLoading.value = true
  try {
    await SEND_RESET_PASSWORD_LINK(email, REQUEST_CONFIG)
    forgotSentEmail.value = email
  } catch (error) {
    formError.value = resolveRequestError(error)
  } finally {
    isLoading.value = false
  }
}

async function sendRegisterCode() {
  if (codeCountingDown.value || isLoading.value) return
  const email = String(registerForm.value.email || '').trim()
  const emailError = validateEmail(email)
  if (emailError) {
    errors.value = { ...errors.value, regEmail: emailError }
    focusField('auth-reg-mail')
    return
  }
  clearError('regEmail')
  formError.value = ''
  try {
    await GET_REGISTRATION_VERIFICATION_CODE(email, REQUEST_CONFIG)
    userStore.verificationCodeSentSuccess(0)
    codeSentEmail.value = email
    focusField('auth-reg-code')
  } catch (error) {
    codeSentEmail.value = ''
    formError.value = resolveRequestError(error)
  }
}

async function getVerifyCode() {
  if (verifyCodeLoading.value) return
  verifyCodeLoading.value = true
  try {
    const res = await GET_LOGIN_VERIFICATION_CODE()
    verifyCode.value = res || { key: '', base64: '' }
    loginForm.value = { ...loginForm.value, key: res?.key || '' }
  } catch {
    verifyCode.value = { key: '', base64: '' }
  } finally {
    verifyCodeLoading.value = false
  }
}

async function copyAccount() {
  try {
    await navigator.clipboard.writeText(registerAccount.value)
    $message.success(t('auth.success.copied'))
  } catch {
    $message.warning(t('auth.success.copyFailed'))
  }
}

function goLoginAfterRegister() {
  setView(VIEW.LOGIN, { keepUsername: registerAccount.value })
  focusField('auth-login-pass')
}

defineExpose({
  open
})
</script>

<template>
  <VxModal
    v-model="isShowLogin"
    :title="modalTitle"
    :subtitle="modalSubtitle"
    :aria-label="view === VIEW.DONE ? t('auth.success.title') : ''"
    :width="440"
    :close-on-overlay="false"
    panel-class="auth-modal"
  >
    <div ref="rootRef" class="auth">
      <div v-if="formError" class="auth__alert" role="alert">
        <ToolIcon name="error" :size="15" />
        <span>{{ formError }}</span>
      </div>

      <!-- 登录 -->
      <form v-if="view === VIEW.LOGIN" class="auth__form" novalidate @submit.prevent="handleLogin">
        <div class="auth__field">
          <label for="auth-login-user" class="auth__label">{{ t('auth.login.username') }}</label>
          <input
            id="auth-login-user"
            v-model="loginForm.username"
            class="auth__input"
            type="text"
            maxlength="12"
            autocomplete="username"
            spellcheck="false"
            :placeholder="t('auth.login.usernamePlaceholder')"
            :aria-invalid="!!errors.loginUsername"
            :aria-describedby="fieldDescribedBy('loginUsername')"
            @input="clearError('loginUsername')"
          />
          <span v-if="errors.loginUsername" :id="errorId('loginUsername')" class="auth__error">
            {{ errors.loginUsername }}
          </span>
        </div>

        <div class="auth__field">
          <div class="auth__label-row">
            <label for="auth-login-pass" class="auth__label">{{ t('auth.login.password') }}</label>
            <button type="button" class="auth__link" @click="setView(VIEW.FORGOT)">
              {{ t('auth.login.forgot') }}
            </button>
          </div>
          <div class="auth__password">
            <input
              id="auth-login-pass"
              v-model="loginForm.password"
              class="auth__input"
              :type="showPassword ? 'text' : 'password'"
              maxlength="16"
              autocomplete="current-password"
              :aria-invalid="!!errors.loginPassword"
              :aria-describedby="fieldDescribedBy('loginPassword')"
              @input="clearError('loginPassword')"
            />
            <button
              type="button"
              class="auth__eye"
              :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
              :aria-pressed="showPassword"
              :title="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
              @click="showPassword = !showPassword"
            >
              <ToolIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
            </button>
          </div>
          <span v-if="errors.loginPassword" :id="errorId('loginPassword')" class="auth__error">
            {{ errors.loginPassword }}
          </span>
        </div>

        <div class="auth__field">
          <label for="auth-login-code" class="auth__label">{{ t('auth.login.code') }}</label>
          <div class="auth__inline">
            <input
              id="auth-login-code"
              v-model="loginForm.code"
              class="auth__input is-code"
              type="text"
              maxlength="5"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('auth.login.codePlaceholder')"
              :aria-invalid="!!errors.loginCode"
              :aria-describedby="fieldDescribedBy('loginCode')"
              @input="clearError('loginCode')"
            />
            <button
              type="button"
              class="auth__captcha"
              :aria-label="t('auth.login.refreshCode')"
              :title="t('auth.login.refreshCode')"
              :aria-busy="verifyCodeLoading"
              @click="getVerifyCode"
            >
              <span class="auth__captcha-image">
                <img v-if="verifyCode.base64" :src="verifyCode.base64" alt="" />
                <span v-else class="auth__spinner is-muted" aria-hidden="true"></span>
              </span>
              <span class="auth__captcha-refresh" aria-hidden="true">
                <ToolIcon name="refresh" :size="14" />
              </span>
            </button>
          </div>
          <span v-if="errors.loginCode" :id="errorId('loginCode')" class="auth__error">
            {{ errors.loginCode }}
          </span>
        </div>

        <button type="submit" class="auth__submit" :disabled="isLoading" :aria-busy="isLoading">
          <span v-if="isLoading" class="auth__spinner" aria-hidden="true"></span>
          {{ isLoading ? t('auth.login.submitting') : t('auth.login.submit') }}
        </button>

        <p class="auth__footer">
          {{ t('auth.login.noAccount') }}
          <button type="button" class="auth__link is-strong" @click="setView(VIEW.REGISTER)">
            {{ t('auth.login.toRegister') }}
          </button>
        </p>
      </form>

      <!-- 找回密码 -->
      <form
        v-else-if="view === VIEW.FORGOT"
        class="auth__form"
        novalidate
        @submit.prevent="handleForgotPassword"
      >
        <button type="button" class="auth__back" @click="setView(VIEW.LOGIN)">
          <ToolIcon name="arrow-left" :size="14" />
          {{ t('auth.forgot.back') }}
        </button>
        <div class="auth__field">
          <label for="auth-forgot-mail" class="auth__label">{{ t('auth.forgot.email') }}</label>
          <input
            id="auth-forgot-mail"
            v-model="forgotForm.email"
            class="auth__input"
            type="email"
            autocomplete="email"
            placeholder="name@example.com"
            :disabled="!!forgotSentEmail"
            :aria-invalid="!!errors.forgotEmail"
            :aria-describedby="fieldDescribedBy('forgotEmail')"
            @input="clearError('forgotEmail')"
          />
          <span v-if="errors.forgotEmail" :id="errorId('forgotEmail')" class="auth__error">
            {{ errors.forgotEmail }}
          </span>
        </div>

        <div v-if="forgotSentEmail" class="auth__notice is-success" role="status">
          <ToolIcon name="check-circle" :size="15" />
          <span>{{ t('auth.forgot.sent', { email: forgotSentEmail }) }}</span>
        </div>

        <button
          type="submit"
          class="auth__submit"
          :class="{ 'is-secondary': !!forgotSentEmail }"
          :disabled="isLoading"
          :aria-busy="isLoading"
        >
          <span v-if="isLoading" class="auth__spinner" aria-hidden="true"></span>
          {{
            forgotSentEmail
              ? t('auth.forgot.backToLogin')
              : isLoading
                ? t('auth.forgot.submitting')
                : t('auth.forgot.submit')
          }}
        </button>
      </form>

      <!-- 注册 -->
      <form
        v-else-if="view === VIEW.REGISTER"
        class="auth__form"
        novalidate
        @submit.prevent="handleRegister"
      >
        <div class="auth__grid">
          <div class="auth__field">
            <label for="auth-reg-nick" class="auth__label">{{ t('auth.register.nickname') }}</label>
            <input
              id="auth-reg-nick"
              v-model="registerForm.nickname"
              class="auth__input"
              type="text"
              maxlength="10"
              autocomplete="nickname"
              :aria-invalid="!!errors.regNickname"
              :aria-describedby="fieldDescribedBy('regNickname', 'auth-reg-nick-hint')"
              @input="clearError('regNickname')"
            />
            <span v-if="errors.regNickname" :id="errorId('regNickname')" class="auth__error">
              {{ errors.regNickname }}
            </span>
            <span v-else id="auth-reg-nick-hint" class="auth__hint">
              {{ t('auth.register.nicknameHint') }}
            </span>
          </div>
          <div class="auth__field">
            <label for="auth-reg-user" class="auth__label">{{ t('auth.register.username') }}</label>
            <input
              id="auth-reg-user"
              v-model="registerForm.username"
              class="auth__input"
              type="text"
              maxlength="12"
              autocomplete="username"
              spellcheck="false"
              :aria-invalid="!!errors.regUsername"
              :aria-describedby="fieldDescribedBy('regUsername', 'auth-reg-user-hint')"
              @input="clearError('regUsername')"
            />
            <span v-if="errors.regUsername" :id="errorId('regUsername')" class="auth__error">
              {{ errors.regUsername }}
            </span>
            <span v-else id="auth-reg-user-hint" class="auth__hint">
              {{ t('auth.register.usernameHint') }}
            </span>
          </div>
        </div>

        <div class="auth__field">
          <label for="auth-reg-mail" class="auth__label">{{ t('auth.register.email') }}</label>
          <div class="auth__inline">
            <input
              id="auth-reg-mail"
              v-model="registerForm.email"
              class="auth__input"
              type="email"
              maxlength="25"
              autocomplete="email"
              :aria-invalid="!!errors.regEmail"
              :aria-describedby="
                fieldDescribedBy('regEmail', codeSentEmail ? 'auth-reg-mail-status' : '')
              "
              @input="clearError('regEmail')"
            />
            <button
              type="button"
              class="auth__send"
              :disabled="codeCountingDown"
              @click="sendRegisterCode"
            >
              {{
                codeCountingDown
                  ? t('auth.register.resendIn', { seconds: userStore.regCodeCountdown })
                  : t('auth.register.sendCode')
              }}
            </button>
          </div>
          <span v-if="errors.regEmail" :id="errorId('regEmail')" class="auth__error">
            {{ errors.regEmail }}
          </span>
          <span
            v-else-if="codeSentEmail"
            id="auth-reg-mail-status"
            class="auth__hint is-success"
            role="status"
          >
            {{ t('auth.register.codeSent', { email: codeSentEmail }) }}
          </span>
        </div>

        <div class="auth__field">
          <label for="auth-reg-code" class="auth__label">{{ t('auth.register.code') }}</label>
          <input
            id="auth-reg-code"
            v-model="registerForm.captcha"
            class="auth__input is-code"
            type="text"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            :placeholder="t('auth.register.codePlaceholder')"
            :aria-invalid="!!errors.regCode"
            :aria-describedby="fieldDescribedBy('regCode')"
            @input="clearError('regCode')"
          />
          <span v-if="errors.regCode" :id="errorId('regCode')" class="auth__error">
            {{ errors.regCode }}
          </span>
        </div>

        <div class="auth__field">
          <label for="auth-reg-pass" class="auth__label">{{ t('auth.register.password') }}</label>
          <div class="auth__password">
            <input
              id="auth-reg-pass"
              v-model="registerForm.password"
              class="auth__input"
              :type="showPassword ? 'text' : 'password'"
              maxlength="16"
              autocomplete="new-password"
              :aria-invalid="!!errors.regPassword"
              :aria-describedby="fieldDescribedBy('regPassword', 'auth-reg-pass-rules')"
              @input="clearError('regPassword')"
            />
            <button
              type="button"
              class="auth__eye"
              :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
              :aria-pressed="showPassword"
              :title="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
              @click="showPassword = !showPassword"
            >
              <ToolIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
            </button>
          </div>
          <ul id="auth-reg-pass-rules" class="auth__rules">
            <li v-for="rule in passwordRules" :key="rule.key" :class="{ 'is-ok': rule.ok }">
              <ToolIcon :name="rule.ok ? 'check' : 'dot'" :size="12" />
              {{ rule.label }}
            </li>
          </ul>
          <span v-if="errors.regPassword" :id="errorId('regPassword')" class="auth__error">
            {{ errors.regPassword }}
          </span>
        </div>

        <div class="auth__field">
          <label for="auth-reg-pass2" class="auth__label">
            {{ t('auth.register.confirmPassword') }}
          </label>
          <input
            id="auth-reg-pass2"
            v-model="registerForm.confirmPassword"
            class="auth__input"
            :type="showPassword ? 'text' : 'password'"
            maxlength="16"
            autocomplete="new-password"
            :aria-invalid="!!errors.regConfirm"
            :aria-describedby="fieldDescribedBy('regConfirm')"
            @input="clearError('regConfirm')"
          />
          <span v-if="errors.regConfirm" :id="errorId('regConfirm')" class="auth__error">
            {{ errors.regConfirm }}
          </span>
        </div>

        <button type="submit" class="auth__submit" :disabled="isLoading" :aria-busy="isLoading">
          <span v-if="isLoading" class="auth__spinner" aria-hidden="true"></span>
          {{ isLoading ? t('auth.register.submitting') : t('auth.register.submit') }}
        </button>

        <p class="auth__footer">
          {{ t('auth.register.hasAccount') }}
          <button type="button" class="auth__link is-strong" @click="setView(VIEW.LOGIN)">
            {{ t('auth.register.toLogin') }}
          </button>
        </p>
      </form>

      <!-- 注册成功 -->
      <div v-else class="auth__done">
        <span class="auth__done-icon" aria-hidden="true">
          <ToolIcon name="check" :size="24" />
        </span>
        <h2 class="auth__done-title">{{ t('auth.success.title') }}</h2>
        <p class="auth__done-lead">{{ t('auth.success.lead') }}</p>
        <div class="auth__account">
          <span class="auth__account-name">{{ registerAccount }}</span>
          <button
            type="button"
            class="auth__copy"
            :aria-label="t('auth.success.copy')"
            :title="t('auth.success.copy')"
            @click="copyAccount"
          >
            <ToolIcon name="copy" :size="15" />
          </button>
        </div>
        <p class="auth__done-note">{{ t('auth.success.note') }}</p>
        <button type="button" class="auth__submit is-done" @click="goLoginAfterRegister">
          {{ t('auth.success.toLogin') }}
        </button>
      </div>
    </div>
  </VxModal>
</template>

<style scoped lang="scss">
.auth {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--color-text, #151922);
  font-size: 14px;
}

.auth__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.auth__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.auth__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.auth__label {
  color: var(--color-text-secondary, #344054);
  font-size: 13px;
  font-weight: 600;
}

.auth__input {
  width: 100%;
  min-width: 0;
  height: 40px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--color-border-strong, #c4ceda);
  border-radius: var(--radius-md, 8px);
  background: var(--control-bg, #ffffff);
  color: var(--color-text, #151922);
  font: inherit;
  font-size: 14px;
  transition:
    border-color var(--duration-fast, 0.15s) ease,
    box-shadow var(--duration-fast, 0.15s) ease;

  &::placeholder {
    color: var(--color-placeholder, #667085);
  }

  &:hover:not(:disabled) {
    border-color: var(--color-text-subtle, #98a2b3);
  }

  &:focus {
    outline: none;
    border-color: var(--color-accent, #0a96ff);
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }

  &[aria-invalid='true'] {
    border-color: var(--color-danger, #dc2626);
  }

  &[aria-invalid='true']:focus {
    box-shadow: 0 0 0 3px var(--color-danger-soft, #fee2e2);
  }

  &:disabled {
    background: var(--control-bg-disabled, #f3f5f8);
    color: var(--color-text-muted, #667085);
  }

  &.is-code {
    letter-spacing: 0.08em;
  }
}

.auth__hint,
.auth__error {
  font-size: 12.5px;
  line-height: 1.45;
}

.auth__hint {
  color: var(--color-text-muted, #667085);

  &.is-success {
    color: var(--color-success-strong, #15803d);
  }
}

.auth__error {
  color: var(--color-danger-strong, #b91c1c);
}

.auth__alert,
.auth__notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  line-height: 1.5;

  :deep(svg) {
    flex: 0 0 auto;
    margin-top: 2px;
  }
}

.auth__alert {
  border: 1px solid #f3b9b9;
  background: var(--color-danger-soft, #fee2e2);
  color: var(--color-danger-strong, #b91c1c);
}

.auth__notice.is-success {
  border: 1px solid #b7e4c7;
  background: var(--color-success-soft, #dcfce7);
  color: var(--color-success-strong, #15803d);
}

.auth__password {
  position: relative;

  .auth__input {
    padding-right: 44px;
  }
}

.auth__eye,
.auth__copy {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted, #667085);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover, #f1f4f8);
    color: var(--color-text, #151922);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }
}

.auth__eye {
  position: absolute;
  top: 4px;
  right: 4px;
}

.auth__inline {
  display: flex;
  gap: 8px;

  .auth__input {
    flex: 1 1 auto;
  }
}

.auth__captcha {
  flex: 0 0 auto;
  width: 132px;
  height: 40px;
  display: flex;
  align-items: stretch;
  padding: 0;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface-soft, #f7f8fa);
  overflow: hidden;
  cursor: pointer;

  &:hover {
    border-color: var(--color-border-strong, #c4ceda);
  }

  &:hover .auth__captcha-refresh {
    color: var(--color-text, #151922);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--color-accent, #0a96ff);
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }
}

.auth__captcha-image {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  place-items: center;
  background: var(--color-bg, #eef1f5);

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.auth__captcha-refresh {
  flex: 0 0 auto;
  width: 32px;
  display: grid;
  place-items: center;
  border-left: 1px solid var(--color-border, #d9e0e8);
  color: var(--color-text-muted, #667085);
}

.auth__send {
  flex: 0 0 auto;
  min-width: 108px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface, #ffffff);
  color: var(--color-text-secondary, #344054);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-surface-hover, #f1f4f8);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }

  &:disabled {
    background: var(--control-bg-disabled, #f3f5f8);
    color: var(--color-text-muted, #667085);
    cursor: not-allowed;
  }
}

.auth__rules {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--color-text-muted, #667085);
  font-size: 12.5px;

  li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  li.is-ok {
    color: var(--color-success-strong, #15803d);
  }
}

.auth__submit {
  height: 40px;
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--color-accent, #0a96ff);
  border-radius: var(--radius-md, 8px);
  background: var(--color-accent, #0a96ff);
  color: var(--color-text-inverse, #ffffff);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast, 0.15s) ease;

  &:hover:not(:disabled) {
    background: var(--color-accent-hover, #0888e6);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }

  &:disabled {
    cursor: progress;
    opacity: 0.8;
  }

  &.is-secondary {
    border-color: var(--color-border, #d9e0e8);
    background: var(--color-surface, #ffffff);
    color: var(--color-text-secondary, #344054);

    &:hover:not(:disabled) {
      background: var(--color-surface-hover, #f1f4f8);
    }
  }

  &.is-done {
    align-self: stretch;
    margin-top: 8px;
  }
}

.auth__spinner {
  width: 13px;
  height: 13px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: auth-spin 0.7s linear infinite;

  &.is-muted {
    color: var(--color-text-subtle, #98a2b3);
  }
}

.auth__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  color: var(--color-text-muted, #667085);
  font-size: 13px;
}

.auth__link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-active, #0677c7);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;

  &.is-strong {
    font-size: 13px;
    font-weight: 600;
  }

  &:hover {
    color: var(--color-accent-strong, #0b4f85);
    text-decoration: underline;
  }

  &:focus-visible {
    outline: none;
    border-radius: 4px;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }
}

.auth__back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: -4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-active, #0677c7);
  font: inherit;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: var(--color-accent-strong, #0b4f85);
  }

  &:focus-visible {
    outline: none;
    border-radius: 4px;
    box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
  }
}

.auth__done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  text-align: center;
}

.auth__done-icon {
  width: 52px;
  height: 52px;
  margin-bottom: 8px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--color-success-soft, #dcfce7);
  color: var(--color-success-strong, #15803d);
}

.auth__done-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.auth__done-lead,
.auth__done-note {
  margin: 0;
  color: var(--color-text-muted, #667085);
  font-size: 13px;
}

.auth__account {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 2px;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface-soft, #f7f8fa);
}

.auth__account-name {
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 16px;
  font-weight: 600;
  user-select: all;
}

@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth__spinner {
    animation-duration: 2s;
  }
}
</style>
