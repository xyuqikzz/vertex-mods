import { app } from 'electron'
import { startSpecifiedApp } from '../system/medhod.js'
import { formatChinaTime, generateFileMD5 } from '../tool.js'
import path from 'path'
import { insertFile } from '../../db/files/files.js'
import { findAndCleanLowVersion, getFileById } from '../../services/managed-files/installerCache.js'
import { verifySignedUpdate } from '../../security/updateTrust.js'

export async function installApp(event, filePath, data) {
  await verifySignedUpdate(filePath)
  const { id, versionName } = data
  const md5 = await generateFileMD5(filePath)
  const file = {
    module: 1,
    type: path.extname(filePath).toLowerCase().replace('.', ''),
    version: versionName,
    external_id: id,
    filePath,
    md5,
    create_time: formatChinaTime()
  }

  insertFile(file)

  startSpecifiedApp(event, { path: filePath }).then(() => {
    setTimeout(() => {
      app.quit()
    }, 200)
  })
}

export async function searchLocalInstallFiles(event, data) {
  const item = await getFileById(data)
  if (item) {
    await executeInstallationApp(event, item)
  }
  if (!item) {
    event.reply('localAppNotFound')
  }
}

async function executeInstallationApp(event, filePath) {
  await verifySignedUpdate(filePath)
  startSpecifiedApp(event, { path: filePath }).then(() => {
    setTimeout(() => {
      app.quit()
    }, 200)
  })
}

export function cleanLowVersion(version) {
  findAndCleanLowVersion(version)
}
