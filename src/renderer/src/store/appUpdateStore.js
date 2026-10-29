import { reactive } from 'vue'
import ipcRenderer from '../common/ipcRenderer.js'

const clampPercent = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}
const nonNegative = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function createAppUpdateController(
  checkForUpdate,
  { downloadUpdate = async () => {}, installUpdate = async () => {} } = {}
) {
  const state = reactive({
    visible: false,
    checking: false,
    status: 'idle',
    release: {},
    currentVersion: '',
    message: '',
    messageKey: '',
    lastCheckedAt: '',
    progress: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0
  })
  let pending = null
  let startupChecked = false
  let dismissed = false
  let installAfterDownload = false
  let installPending = null

  function close() {
    if (state.status === 'installing') return
    installAfterDownload = false
    dismissed = true
    state.visible = false
  }

  function open() {
    dismissed = false
    state.visible = true
  }

  function resetProgress(progress = 0) {
    state.progress = progress
    state.bytesPerSecond = 0
    state.transferred = 0
    state.total = 0
  }

  // inline: the settings page shows the result in place instead of opening the dialog.
  function check({ automatic = false, inline = false } = {}) {
    if (automatic && startupChecked) return pending || Promise.resolve()
    if (automatic) startupChecked = true
    if (!automatic && !inline) open()
    // Do not reset an installer that is already downloading or ready to install.
    if (['downloading', 'downloaded', 'installing'].includes(state.status)) return Promise.resolve()
    if (pending) return pending
    dismissed = false
    state.checking = true
    state.status = 'checking'
    state.message = ''
    state.messageKey = ''
    state.release = {}
    pending = Promise.resolve()
      .then(checkForUpdate)
      .then((result) => {
        if (result?.legacy) return
        state.currentVersion = result?.currentVersion || state.currentVersion
        state.release = result?.release || {}
        state.status = ['available', 'current', 'unavailable', 'error'].includes(result?.status)
          ? result.status
          : 'error'
        state.message = result?.message || ''
        state.messageKey = result?.messageKey || (state.status === 'error' ? 'updates.errors.check_failed' : '')
        state.lastCheckedAt = new Date().toISOString()
        if (automatic && state.status === 'available' && !dismissed) state.visible = true
      })
      .catch(() => {
        state.status = 'error'
        state.message = ''
        state.messageKey = 'updates.errors.check_failed'
      })
      .finally(() => {
        state.checking = false
        pending = null
      })
    return pending
  }

  // 仅具备完整更新元数据的 GitHub 发布可原地下载；安装始终由主进程校验。
  async function download() {
    if (state.status !== 'available' || (state.release?.source === 'github' && state.release.canDownload !== true)) return
    state.status = 'downloading'
    state.messageKey = ''
    installAfterDownload = true
    resetProgress()
    try {
      const result = await downloadUpdate()
      if (result?.success === false) throw Object.assign(new Error(result.code || 'update_download_failed'), result)
    } catch (error) {
      installAfterDownload = false
      if (state.status === 'downloading') state.status = 'available'
      state.messageKey = error.messageKey || 'updates.errors.update_download_failed'
      throw error
    }
  }

  function install() {
    if (installPending) return installPending
    if (state.status !== 'downloaded') return Promise.resolve()
    state.status = 'installing'
    state.messageKey = ''
    installPending = Promise.resolve().then(installUpdate).then((result) => {
      if (result?.success === false) throw Object.assign(new Error(result.code || 'update_install_failed'), result)
    }).catch((error) => {
      if (state.status === 'installing') state.status = 'downloaded'
      state.messageKey = error.messageKey || 'updates.errors.update_install_failed'
      throw error
    }).finally(() => { installPending = null })
    return installPending
  }

  function setProgress(data = {}) {
    if (state.status !== 'downloading') return
    state.progress = clampPercent(data.progress ?? data.percent)
    state.bytesPerSecond = nonNegative(data.speed ?? data.bytesPerSecond)
    state.transferred = nonNegative(data.transferred)
    state.total = nonNegative(data.total)
  }

  function markAvailable(release = {}) {
    state.release = release
    state.status = 'available'
    state.messageKey = ''
    resetProgress()
    open()
  }

  function markDownloaded(release = {}) {
    if (state.status === 'installing') return installPending
    const shouldInstall = installAfterDownload
    installAfterDownload = false
    state.release = { ...state.release, ...release }
    state.status = 'downloaded'
    state.progress = 100
    state.bytesPerSecond = 0
    open()
    // 安装异常已投射为可见错误状态，后台事件不制造未处理的 Promise 拒绝。
    if (shouldInstall) return install().catch(() => {})
  }

  function markDownloadFailed(error = {}) {
    installAfterDownload = false
    if (['downloading', 'installing'].includes(state.status)) state.status = 'available'
    state.messageKey = error.messageKey || 'updates.errors.update_download_failed'
  }

  return {
    state,
    check,
    close,
    open,
    download,
    install,
    setProgress,
    markAvailable,
    markDownloaded,
    markDownloadFailed
  }
}

export const appUpdate = createAppUpdateController(() => ipcRenderer.invoke('check-for-update'), {
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('quit-and-install')
})
