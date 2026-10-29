import { assertGithubUpdateMetadata, assertUpdateMetadata } from '../security/updatePolicy.js'
import { GITHUB_UPDATE_PROVIDER } from '../../shared/app/app-release.js'

export function createUpdateRuntime({ updater, config, isPackaged, checkGithubRelease, verifyInstaller, send }) {
  let approvedRelease = null
  let lastResult = null
  let availableInfo = null
  let verifiedInstaller = ''
  let downloadPending = null
  let installPending = null
  let installing = false

  const failure = (code) => Object.assign(new Error(code), { code, messageKey: `updates.errors.${code}` })
  const report = (code) => send('update-error', { code, messageKey: `updates.errors.${code}` })
  const validate = (info) => config.updatesEnabled
    ? assertUpdateMetadata(info, config.updateFeed)
    : assertGithubUpdateMetadata(info, approvedRelease)

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableDifferentialDownload = true
  if (config.updatesEnabled) updater.setFeedURL({ provider: 'generic', url: config.updateFeed })

  updater.on('update-available', (info) => {
    availableInfo = null
    verifiedInstaller = ''
    try {
      validate(info)
      availableInfo = info
      // GitHub 的检查结果由 API 提供；准备下载时的 provider 事件不能重置界面进度。
      if (config.updatesEnabled) send('update-available', info)
    } catch { report('untrusted_update_metadata') }
  })
  updater.on('update-not-available', (info) => {
    if (config.updatesEnabled && !downloadPending) {
      availableInfo = null
      send('update-not-available', info)
    }
  })
  updater.on('download-progress', (progress) => {
    if (downloadPending) send('download-progress', progress)
  })
  updater.on('error', () => {
    const code = installing ? 'update_install_failed' : downloadPending ? 'update_download_failed' : 'check_failed'
    installing = false
    verifiedInstaller = ''
    report(code)
  })

  async function check() {
    if (downloadPending || verifiedInstaller || installing) return lastResult || { success: true, legacy: true }
    availableInfo = null
    approvedRelease = null
    if (!config.updatesEnabled) {
      const result = await checkGithubRelease()
      if (result.status === 'available' && result.release?.canDownload === true) {
        approvedRelease = Object.freeze({ ...result.release })
      }
      lastResult = result
      return result
    }
    if (!isPackaged()) throw failure('updates_development_only')
    try {
      await updater.checkForUpdates()
      lastResult = { success: true, legacy: true }
      return lastResult
    } catch {
      report('check_failed')
      throw failure('check_failed')
    }
  }

  function download() {
    if (downloadPending) return downloadPending
    if (installing) return Promise.reject(failure('update_not_verified'))
    if (!config.updatesEnabled && !approvedRelease) return Promise.reject(failure('untrusted_update_metadata'))
    if (!isPackaged()) return Promise.reject(failure('updates_development_only'))
    verifiedInstaller = ''
    downloadPending = Promise.resolve().then(async () => {
      try {
        if (!config.updatesEnabled) {
          availableInfo = null
          updater.setFeedURL({ ...GITHUB_UPDATE_PROVIDER })
          const result = await updater.checkForUpdates()
          validate(result?.updateInfo)
          availableInfo = result.updateInfo
        }
        validate(availableInfo)
        await updater.downloadUpdate()
        const file = updater.installerPath
        if (!file) throw failure('update_not_verified')
        try { await verifyInstaller(file) }
        catch { throw failure('update_signature_rejected') }
        if (updater.installerPath !== file) throw failure('update_not_verified')
        verifiedInstaller = file
        send('update-downloaded', {
          ...availableInfo,
          ...(approvedRelease || {}),
          canDownload: true
        })
        return { success: true }
      } catch (error) {
        verifiedInstaller = ''
        const code = error.messageKey ? error.code :
          /update_(source|metadata|digest)|untrusted_update/.test(error.message)
            ? 'untrusted_update_metadata' : 'update_download_failed'
        report(code)
        throw failure(code)
      }
    }).finally(() => { downloadPending = null })
    return downloadPending
  }

  function install() {
    if (installPending) return installPending
    if (installing) return Promise.resolve({ success: true })
    if (!verifiedInstaller || verifiedInstaller !== updater.installerPath) {
      return Promise.reject(failure('update_not_verified'))
    }
    installPending = Promise.resolve().then(async () => {
      const file = verifiedInstaller
      try {
        await verifyInstaller(file)
        if (verifiedInstaller !== file || updater.installerPath !== file) throw new Error('file_changed')
      } catch {
        verifiedInstaller = ''
        report('update_signature_rejected')
        throw failure('update_signature_rejected')
      }
      installing = true
      try {
        updater.quitAndInstall(true, true)
        if (!installing) throw failure('update_install_failed')
        return { success: true }
      } catch {
        installing = false
        report('update_install_failed')
        throw failure('update_install_failed')
      }
    }).finally(() => { installPending = null })
    return installPending
  }

  return { check, download, install }
}
