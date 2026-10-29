import { getLocalGameData, getLocalModData } from './utils.js'

export function requestInitLocalData(event) {
  getLocalGameData(event)
  getLocalModData(event)
}
