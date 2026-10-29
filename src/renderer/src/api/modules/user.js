import { Request } from '../index.js'
import { useAppStore } from '@renderer/store/appStore.js'

const appStore = useAppStore()

let requestInstance = null

function getRequestInstance() {
  if (!requestInstance) {
    requestInstance = new Request()
  }
  return requestInstance
}

const http = {
  get: (...args) => getRequestInstance().get(...args),
  post: (...args) => getRequestInstance().post(...args),
  put: (...args) => getRequestInstance().put(...args),
  delete: (...args) => getRequestInstance().delete(...args),
  send: (...args) => getRequestInstance().send(...args)
}

export function GET_REGISTRATION_VERIFICATION_CODE(to, config = {}) {
  return http.post(
    `/user/register/send/code?to=${encodeURIComponent(to)}`,
    {},
    {
      baseURL: appStore.AppData.requestUrl,
      ...config
    }
  )
}

export function REGISTER_USER(data = {}, config = {}) {
  return http.post(`/user/register`, data, {
    baseURL: appStore.AppData.requestUrl,
    ...config
  })
}

export function GET_LOGIN_VERIFICATION_CODE() {
  return http.get('/user/login/verification/code', {
    baseURL: appStore.AppData.requestUrl
  })
}

export function USER_LOGIN(data = {}, config = {}) {
  return http.post('/user/login', data, {
    baseURL: appStore.AppData.requestUrl,
    ...config
  })
}

export function SEND_RESET_PASSWORD_LINK(email, config = {}) {
  return http.post(
    '/user/email/password/recovery',
    {
      email
    },
    {
      baseURL: appStore.AppData.requestUrl,
      ...config
    }
  )
}

export function GET_USER_INFO(config = {}) {
  return http.get(`/user/info`, {
    baseURL: appStore.AppData.requestUrl,
    hideLoading: true,
    ...config
  })
}

export function VALIDATE_TOKEN() {
  return http.get('/user/validate/token', {
    baseURL: appStore.AppData.requestUrl
  })
}

export function USER_LOGOUT(config = {}) {
  return http.post(
    '/user/logout',
    {},
    {
      baseURL: appStore.AppData.requestUrl,
      ...config
    }
  )
}

export function UPDATE_ACCOUNT_PASSWORD(data, config = {}) {
  return http.post('/user/update/password', data, {
    baseURL: appStore.AppData.requestUrl, hideLoading: true, silentBusinessError: true, ...config
  })
}

export function UPLOAD_AVATAR(data, config = {}) {
  return http.post('/user/avatar', data, {
    baseURL: appStore.AppData.requestUrl, hideLoading: true, silentBusinessError: true,
    timeout: 60000, ...config
  })
}




export function UPLOAD_USER_INFO(data, config = {}) {
  return http.post(`/user/upload/info`, data, {
    baseURL: appStore.AppData.requestUrl, hideLoading: true, silentBusinessError: true, ...config
  })
}



export function CAN_UPLOAD_AVATAR(config = {}) {
  return http.get('/user/can/upload/avatar', {
    baseURL: appStore.AppData.requestUrl, hideLoading: true, silentBusinessError: true, ...config
  })
}
