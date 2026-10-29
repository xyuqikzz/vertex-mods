import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

function invokeVamHub(channel, payload = {}, fallback = {}) {
  return ipcRenderer.invoke(channel, sanitizeIpcPayload(payload, fallback))
}

function assertVamHubSuccess(result, fallbackMessage = 'VAM-Hub 请求失败') {
  if (result?.status === 'error') {
    throw new Error(result.error || fallbackMessage)
  }
  if (result?.success === false) {
    throw new Error(result.message || fallbackMessage)
  }
  return result
}

export async function browseVamHubPackages(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:browse-packages', payload),
    'VAM-Hub 资源列表加载失败'
  )
}

export async function getVamHubPackageBasic(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:get-package-basic', payload),
    'VAM-Hub 资源详情加载失败'
  )
}

export async function getVamHubPackageDetail(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:get-package-detail', payload),
    'VAM-Hub 资源详情加载失败'
  )
}

export async function resolveVamHubDependencies(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:resolve-dependencies', payload),
    'VAM-Hub 依赖解析失败'
  )
}

export async function cancelResolveVamHubDependencies(payload = {}) {
  return await invokeVamHub('vamhub:cancel-resolve-dependencies', payload)
}

export async function getVamHubLoginStatus() {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:get-login-status', {}),
    uiText('ui.couldNotReadVAMHubSignInStatus')
  )
}

export async function saveVamHubAuthCookie(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('vamhub:save-auth-cookie', payload),
    'VAM-Hub Cookie 保存失败'
  )
}

export async function resolveVamHubDownloadUrl(payload = {}) {
  return await invokeVamHub('vamhub:resolve-download-url', payload)
}

export async function submitVamHubInstallTask(payload = {}) {
  return assertVamHubSuccess(
    await invokeVamHub('source-install-task:create', payload),
    '加入安装任务失败'
  )
}
