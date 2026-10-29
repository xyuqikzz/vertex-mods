import { nativeText } from '../../uiLanguage.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertLocalAgentPath, isPathWithin, isProtectedRoot } from './pathAccess.js'

export async function resolveLogAccess(appDataPath, args, ctx, deps = {}) {
  const roots = []
  const files = []
  const appRoot = await fs.realpath(appDataPath).catch(() => '')
  if (appRoot) {
    for (const name of ['logs', 'log']) {
      const real = await fs.realpath(path.join(appRoot, name)).catch(() => '')
      if (real && isPathWithin(appRoot, real)) roots.push(real)
    }
    const mainLog = path.join(appRoot, 'Vertex.log')
    if ((await fs.realpath(mainLog).catch(() => '')) === mainLog) files.push(mainLog)
  }
  // These roots come from main-process records, never from model/page-context paths.
  let gameRoots = deps.allowedLogRoots
  if (!gameRoots) {
    try {
      const getGames = deps.getGameList || (await import('../../../db/games/game.js')).getGameList
      gameRoots = (await getGames())
        .flatMap((row) => [row.client_root_path, row.server_root_path])
        .filter(Boolean)
    } catch {
      gameRoots = []
    }
  }
  for (const root of gameRoots) {
    try {
      assertLocalAgentPath(root)
    } catch {
      continue
    }
    const real = await fs.realpath(root).catch(() => '')
    if (real && !(await isProtectedRoot(real))) roots.push(real)
  }
  if (args.selectFiles === true) {
    let select = deps.selectLogFiles
    if (!select) {
      const { dialog, BrowserWindow } = await import('electron')
      if (!ctx.event?.sender || ctx.event.sender.isDestroyed?.())
        return { roots, files, selectedFiles: [] }
      select = async () => {
        const options = {
          title: nativeText('selectLogs'),
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: nativeText('logsAndText'), extensions: ['log', 'txt'] }]
        }
        const parent = BrowserWindow.fromWebContents(ctx.event.sender)
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options)
        return result.canceled ? [] : result.filePaths
      }
    }
    const selectedFiles = []
    for (const file of await select()) {
      const real = await fs.realpath(file).catch(() => '')
      if (real) {
        files.push(real)
        selectedFiles.push(real)
      }
    }
    return { roots, files, selectedFiles }
  }
  return { roots, files, selectedFiles: [] }
}
