import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { getAccountState, setAccountState } from '../utils/account-bootstrap.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { stripUserEntitlements, migrateUserLocalStorage, sanitizeUserState } from '../../../shared/account/user-config-policy.js'
import router from '@renderer/router/index.js'
import { GET_USER_INFO } from '@renderer/api/modules/user.js'
import { resetAccountSession } from '../utils/account-session.js'
import { resolveUserAvatar } from '../../../shared/account/user-avatar.js'

migrateUserLocalStorage(localStorage)

const appStore = useAppStore()

export const useUserStore = defineStore(
  'userStore',
  () => {
    const isLogin = ref(getAccountState().isLogin)
    const createEmptyUserInfo = () => ({
      nickname: '',
      email: '',
      steamFriendCode: null,
      avatar: '',
      createdAt: '',
      id: null
    })
    const userInfo = ref(createEmptyUserInfo())
    let sessionRevision = 0
    let infoRequest = null
    const sessionNotice = ref('')
    const token = ref(getAccountState().token)
    const regCodeCountdown = ref(60)
    const isAdult = ref('adult')

    function verificationCodeSentSuccess(type) {
      if (type === 0) {
        regCodeCountdown.value = 60
        regCodeCountdown.value -= 1
        let id = setInterval(() => {
          regCodeCountdown.value -= 1
          if (regCodeCountdown.value <= 0) {
            regCodeCountdown.value = 60
            clearInterval(id)
          }
        }, 1000)
      }
    }

    // 客户端只保留当前登录账号，不再保存或切换多个账号。
    function applyAccount(state) {
      setAccountState(state)
      token.value = state.token
      isLogin.value = state.isLogin
      appStore.menuAllList[2].isShow = state.isLogin ? 1 : 0
    }
    ipcRenderer.on('account:changed', (_event, state) => applyAccount(state))
    async function setToken(session) {
      sessionNotice.value = ''
      applyAccount(await window.api.account.adopt(session))
    }
    async function logout({ reason = '', redirect = true } = {}) {
      const state = await window.api.account.logout({ session: token.value })
      sessionNotice.value = reason === 'expired' ? '登录已过期，请重新登录后核对资料。' : ''
      applyAccount(state)
      userInfo.value = createEmptyUserInfo()
      if (redirect) router.push('/app/home')
    }

    function setUserInfo(data) {
      userInfo.value = { ...createEmptyUserInfo(), ...stripUserEntitlements(data) }
      userInfo.value.avatar = resolveUserAvatar(data?.avatar, data?.id, appStore.AppData.requestUrl)
    }

    async function upUserInfo() {
      const requestToken = token.value
      const revision = sessionRevision
      if (!isLogin.value || !requestToken) return false
      if (infoRequest) return infoRequest
      const pending = (async () => {
        const data = await GET_USER_INFO()
        if (revision !== sessionRevision || requestToken !== token.value || !isLogin.value) return false
        if (!data || !data.id) throw new Error(uiText('ui.accountDetailsAreIncompletePleaseTryAgain'))
        setUserInfo(data)
        return true
      })()
      infoRequest = pending
      try { return await pending } finally {
        if (infoRequest === pending) infoRequest = null
      }
    }

    watch(token, () => {
      sessionRevision += 1
      resetAccountSession()
      infoRequest = null
      userInfo.value = createEmptyUserInfo()
      appStore.removeCachedView?.('User')
    }, { flush: 'sync' })

    return {
      isLogin,
      sessionNotice,
      userInfo,
      token,
      regCodeCountdown,
      isAdult,
      verificationCodeSentSuccess,
      setToken,
      logout,
      upUserInfo,
      setUserInfo
    }
  },
  {
    persist: {
      pick: ['isAdult'],
      serializer: {
        serialize: (state) => JSON.stringify(sanitizeUserState(state)),
        deserialize: (text) => sanitizeUserState(JSON.parse(text))
      }
    }
  }
)
