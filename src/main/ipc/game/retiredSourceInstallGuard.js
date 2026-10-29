import path from 'node:path'
import fs from 'node:fs'
import {
  findRetiredSource,
  createRetiredSourceError
} from '../../../shared/sources/retired-source-policy.js'

// 历史来源下的本地库安装不是在线来源：必须用主进程已有库记录核验，不信任 payload 的布尔豁免。
export async function assertInstallSourceAvailable(payload = {}, lookup) {
  const source = findRetiredSource(payload)
  if (!source) return false
  const text = JSON.stringify(payload)
  if (/"(?:download_url|downloadUrl)"\s*:\s*"[^"\s]+"/.test(text))
    throw createRetiredSourceError(source)
  const entries = Array.isArray(payload.items) ? payload.items : [payload]
  if (!entries.length) throw createRetiredSourceError(source)
  const getLibraryItem =
    lookup || (await import('../../db/mods/localModLibrary.js')).getLocalModLibraryItem
  for (const entry of entries) {
    const data = entry.meta?.installPayload || entry.installPayload || entry.data || entry
    const id = Number(data.metadata?.localLibraryItemId || 0)
    const record = id > 0 ? getLibraryItem(id) : null
    const filePath = String(
      entry.filePath ||
        entry.item?.filePath ||
        entry.item?.finalFilePath ||
        data.filePath ||
        data.localPath ||
        ''
    ).trim()
    if (
      !record ||
      !filePath ||
      !record.library_root_path ||
      Number(data.gameId) !== Number(record.game_id)
    )
      throw createRetiredSourceError(source)
    const relative = path.relative(path.resolve(record.library_root_path), path.resolve(filePath))
    const archivedPath = String(record.metadata?.archivedSourcePath || '')
    const archivedMatch =
      archivedPath &&
      path.resolve(archivedPath).toLowerCase() === path.resolve(filePath).toLowerCase()
    if (
      (!archivedMatch && (!relative || relative.startsWith('..') || path.isAbsolute(relative))) ||
      !fs.existsSync(filePath)
    )
      throw createRetiredSourceError(source)
  }
  return true
}
