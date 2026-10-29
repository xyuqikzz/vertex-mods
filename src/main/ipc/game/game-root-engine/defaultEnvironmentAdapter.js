import fs from 'fs-extra'
import { getGameList } from '../../../db/games/game.js'
import { scanDriveByFilename } from '../scanDrive.js'

export const defaultGameRootEnvironmentAdapter = Object.freeze({
  async pathExists(targetPath = '') {
    return await fs.pathExists(targetPath)
  },
  async readDirectory(targetPath = '') {
    return await fs.readdir(targetPath, { withFileTypes: true })
  },
  listInstalledGames() {
    const games = getGameList()
    return Array.isArray(games) ? games : []
  },
  async findExecutableByName(fileName = '') {
    return await scanDriveByFilename(fileName)
  }
})
