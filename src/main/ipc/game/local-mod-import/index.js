import { nativeText } from '../../../services/uiLanguage.js'
import { dialog, shell } from 'electron'
import { ipcMain } from '../../../security/ipc.js'
import fs from 'fs-extra'
import {
  analyzeSourcePaths,
  ARCHIVE_EXTENSIONS
} from './analyzeService.js'
import {
  commitLocalModImport,
  createLibraryInstallTask,
  deleteLibraryItem,
  getLibraryItem,
  listLibrary,
  updateLibraryMeta
} from './commitService.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizePickMode(value = '') {
  const mode = toSafeText(value, 'archive').toLowerCase()
  return ['archive', 'folder', 'file', 'all'].includes(mode) ? mode : 'archive'
}

async function pickSources(payload = {}) {
  const mode = normalizePickMode(payload.mode)
  const filters =
    mode === 'archive' || mode === 'all'
      ? [
          {
            name: '本地 Mod 压缩包',
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

async function openLibraryPath(payload = {}) {
  const result = getLibraryItem(payload)
  if (!result?.success) return result
  const targetPath = toSafeText(payload.path) || toSafeText(result.data?.library_root_path)
  if (!targetPath || !(await fs.pathExists(targetPath))) {
    return { success: false, message: '本地模组库目录不存在' }
  }
  const message = await shell.openPath(targetPath)
  return {
    success: !message,
    message: message || '已打开本地模组库目录'
  }
}

export function localModImportIndex() {
  ipcMain.handle('localModImport:pickSources', async (_event, payload = {}) => {
    return await pickSources(payload)
  })

  ipcMain.handle('localModImport:analyze', async (_event, payload = {}) => {
    return await analyzeSourcePaths(payload)
  })

  ipcMain.handle('localModImport:commit', async (_event, payload = {}) => {
    return await commitLocalModImport(payload)
  })

  ipcMain.handle('localModImport:listLibrary', async (_event, payload = {}) => {
    return listLibrary(payload)
  })

  ipcMain.handle('localModImport:getLibraryItem', async (_event, payload = {}) => {
    return getLibraryItem(payload)
  })

  ipcMain.handle('localModImport:updateLibraryMeta', async (_event, payload = {}) => {
    return updateLibraryMeta(payload)
  })

  ipcMain.handle('localModImport:deleteLibraryItem', async (_event, payload = {}) => {
    return await deleteLibraryItem(payload)
  })

  ipcMain.handle('localModImport:openLibraryPath', async (_event, payload = {}) => {
    return await openLibraryPath(payload)
  })

  ipcMain.handle('localModImport:createInstallTask', async (event, payload = {}) => {
    return await createLibraryInstallTask(event, payload)
  })
}
