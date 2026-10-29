import { nativeText } from '../../services/uiLanguage.js'
import { dialog } from 'electron'
import fs from 'node:fs/promises'
import db from '../../db/dbInstance.js'
import { listLegacySourceMods, createLegacyRecordExport } from '../../db/sources/legacySourceRecords.js'

export async function exportLegacySourceRecords(payload = {}) {
  let records
  try {
    records = [0, 1].flatMap((endpoint) => listLegacySourceMods(db, payload.appId, endpoint, '', payload))
  } catch (error) {
    return { success: false, code: error.code, message: error.message }
  }
  if (!records.length) return { success: false, message: '没有可导出的历史记录' }
  const selection = await dialog.showSaveDialog({
    title: nativeText('exportLegacy'),
    defaultPath: 'Vertex-历史模组记录.json',
    filters: [{ name: nativeText('jsonRecords'), extensions: ['json'] }]
  })
  if (selection.canceled || !selection.filePath) return { success: false, canceled: true }
  await fs.writeFile(
    selection.filePath,
    JSON.stringify(createLegacyRecordExport(records), null, 2),
    'utf8'
  )
  return { success: true, count: records.length, message: '历史记录已导出；模组文件和备份保持原位' }
}
