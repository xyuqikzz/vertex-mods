import { verifySignedUpdate } from '../security/updateTrust.js'
import pkg from 'electron-updater'
import { app } from 'electron'
import { ipcMain } from '../security/ipc.js'
import { nativeText } from '../services/uiLanguage.js'
import { releaseConfig } from '../../shared/app/release-config.js'
import { createGithubReleaseChecker } from './github-release.js'
import { createUpdateRuntime } from './runtime.js'

export function initUpdater(mainWindow) {
  const runtime = createUpdateRuntime({
    updater: pkg.autoUpdater,
    config: releaseConfig,
    isPackaged: () => app.isPackaged,
    checkGithubRelease: createGithubReleaseChecker({ currentVersion: () => app.getVersion() }),
    verifyInstaller: verifySignedUpdate,
    send(channel, data) {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed?.()) {
        mainWindow.webContents.send(channel, data)
      }
    }
  })
  for (const [channel, handler] of Object.entries({
    'check-for-update': runtime.check,
    'download-update': runtime.download,
    'quit-and-install': runtime.install
  })) {
    ipcMain.handle(channel, async () => {
      try { return await handler() }
      catch (error) {
        // IPC 错误优先带稳定键，避免把底层路径或网络细节传到界面。
        return { success: false, status: 'error', code: error.code,
          messageKey: error.messageKey || 'updates.errors.check_failed',
          message: nativeText(error.messageKey || 'updates.errors.check_failed') }
      }
    })
  }
}
