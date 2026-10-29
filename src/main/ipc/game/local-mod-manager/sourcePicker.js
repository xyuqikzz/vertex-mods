import { nativeText } from '../../../services/uiLanguage.js'
import { dialog, shell } from 'electron'
import fs from 'fs-extra'
import { ARCHIVE_EXTENSIONS } from '../local-mod-import/analyzeService.js'
import { getLocalModLibraryItem } from '../../../db/mods/localModLibrary.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizePickMode(value = '') {
  const mode = toSafeText(value, 'all').toLowerCase()
  return ['archive', 'folder', 'file', 'all'].includes(mode) ? mode : 'all'
}

export async function pickLocalModSources(payload = {}) {
  const mode = normalizePickMode(payload.mode)
  const filters =
    mode === 'archive' || mode === 'all'
      ? [
          {
            name: '本地 Mod 来源',
            extensions: [...ARCHIVE_EXTENSIONS].map((item) => item.replace('.', ''))
          },
          { name: nativeText('allFiles'), extensions: ['*'] }
        ]
      : [{ name: nativeText('allFiles'), extensions: ['*'] }]

  const properties =
    mode === 'folder'
      ? ['openDirectory', 'multiSelections', 'dontAddToRecent']
      : mode === 'all'
        ? ['openFile', 'openDirectory', 'multiSelections', 'dontAddToRecent']
        : ['openFile', 'multiSelections', 'dontAddToRecent']

  const result = await dialog.showOpenDialog({
    title: toSafeText(payload.title, nativeText('selectModSource')),
    filters,
    properties
  })

  return {
    success: !result.canceled,
    canceled: result.canceled,
    paths: Array.isArray(result.filePaths) ? result.filePaths : []
  }
}

export async function selectLocalModInstallTargetFolder(payload = {}) {
  const result = await dialog.showOpenDialog({
    title: toSafeText(payload.title, nativeText('selectInstallTarget')),
    defaultPath: toSafeText(payload.defaultPath || payload.gameRoot),
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
  })
  return {
    success: !result.canceled,
    canceled: result.canceled,
    path: Array.isArray(result.filePaths) ? result.filePaths[0] || '' : ''
  }
}

export async function openLocalModPath(payload = {}) {
  const item =
    payload?.id || payload?.libraryItemId
      ? getLocalModLibraryItem(payload.id ?? payload.libraryItemId)
      : null
  const targetPath = toSafeText(payload.path) || toSafeText(item?.library_root_path)
  if (!targetPath || !(await fs.pathExists(targetPath))) {
    return { success: false, message: '路径不存在' }
  }
  const message = await shell.openPath(targetPath)
  return {
    success: !message,
    message: message || '已打开路径'
  }
}
