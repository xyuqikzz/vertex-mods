import { getAllGames, getAllMods } from '../../db/games/game.js'
import { readGameListSnapshot } from '../../services/gameCatalog.js'
import { shouldDeferLocalModRefresh } from './localModRefresh.js'

export function getLocalGameData(event) {
  const allGames = getAllGames()
  event.reply('modifyLocalData', {
    type: 'localGameList',
    params: allGames
  })
  event.reply('getGameListDataSuccess', readGameListSnapshot())
}

export function getLocalModData(event) {
  if (shouldDeferLocalModRefresh()) return
  const allMods = getAllMods()
  event.reply('modifyLocalData', {
    type: 'localModList',
    params: allMods
  })
  event.reply('getGameListDataSuccess', readGameListSnapshot())
}
