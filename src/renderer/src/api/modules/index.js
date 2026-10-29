import { Request } from '../index.js'
import { useAppStore } from '@renderer/store/appStore.js'

const appStore = useAppStore()

const http = new Request()

export function GET_HOME_ADS() {
  return http.get('/app/home-ads', {
    baseURL: appStore.AppData.requestUrl,
    hideLoading: true
  })
}

export function GET_HOME_FEATURE_UPDATE_NOTICE() {
  return http.get('/app/feature-update-notice', {
    baseURL: appStore.AppData.requestUrl,
    hideLoading: true
  })
}

// 系统优化脚本相关接口
export function GET_SYSTEM_SCRIPTS() {
  return http.get('/system-script/list', {
    baseURL: appStore.AppData.requestUrl
  })
}

export function GET_SYSTEM_SCRIPTS_BY_TYPE(type) {
  return http.get(`/system-script/type/${type}`, {
    baseURL: appStore.AppData.requestUrl
  })
}

export function GET_SYSTEM_SCRIPT_DETAIL(id) {
  return http.get(`/system-script/${id}`, {
    baseURL: appStore.AppData.requestUrl
  })
}
