import userPath from '../../../initPath.js'
import store from '../../../storage/store/index.js'

export function readRuntimeDownloadConfig() {
  return {
    userPath,
    downloadPath: store.getStore('systemConfig.settings.downloadPath')
  }
}
