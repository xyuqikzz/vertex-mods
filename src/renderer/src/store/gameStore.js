import { normalizeSourcePlatform, getSourcePlatformDefinition } from '../../../shared/sources/source-platform-registry.js'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const SOURCE_TYPE = Object.freeze({
  VERTEX: 'vertex',
  THUNDERSTORE: 'thunderstore',
  FICSIT: 'ficsit',
  NEXUS: 'nexus',
  MODIO: 'modio'
})

const DEFAULT_MANAGED_GAME = Object.freeze({
  manageKey: '',
  sourceId: '',
  steamAppId: '',
  chineseTitle: '',
  is_server_installed: 0,
  server_install_mod_type: 0,
  gId: '',
  sourceType: SOURCE_TYPE.VERTEX,
  sourceCommunity: '',
  sourceDomainName: '',
  sourceNexusGameId: '',
  sourceProfile: 'default',
  sourceGameId: ''
})

function normalizeSourceType(value = '') {
  const source = normalizeSourcePlatform(value)
  return getSourcePlatformDefinition(source) ? source : ''
}

function normalizePositiveNumber(value, defaultValue = '') {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    return defaultValue
  }
  return number
}

function normalizeSourceIdentifier(sourceType = SOURCE_TYPE.VERTEX, value = '', defaultValue = '') {
  const text = String(value || '').trim()
  if (!text) {
    return defaultValue
  }

  if (sourceType === SOURCE_TYPE.THUNDERSTORE || sourceType === SOURCE_TYPE.NEXUS) {
    return text.toLowerCase()
  }

  return text
}

function normalizeManagedGame(game = {}) {
  const sourceType = normalizeSourceType(game.sourceType)
  const sourceCommunity = String(game.sourceCommunity || '')
    .trim()
    .toLowerCase()
  const sourceDomainName = String(game.sourceDomainName || '')
    .trim()
    .toLowerCase()
  const sourceNexusGameId = normalizePositiveNumber(
    game.sourceNexusGameId,
    DEFAULT_MANAGED_GAME.sourceNexusGameId
  )
  const sourceProfile =
    String(game.sourceProfile || DEFAULT_MANAGED_GAME.sourceProfile).trim() || 'default'
  const sourceGameId = String(game.sourceGameId || '').trim()
  const steamAppId = normalizePositiveNumber(game.steamAppId, DEFAULT_MANAGED_GAME.steamAppId)
  const fallbackSourceId =
    sourceType === SOURCE_TYPE.THUNDERSTORE
      ? sourceCommunity
      : sourceType === SOURCE_TYPE.NEXUS
        ? sourceNexusGameId || sourceDomainName
        : steamAppId
  const sourceId = normalizeSourceIdentifier(
    sourceType,
    game.sourceId || fallbackSourceId,
    DEFAULT_MANAGED_GAME.sourceId
  )
  const manageKey =
    String(game.manageKey || '').trim() ||
    [
      sourceType,
      sourceId || '',
      sourceGameId || '',
      sourceCommunity || '',
      sourceDomainName || '',
      sourceProfile || ''
    ]
      .join(':')
      .replace(/:+$/g, '')

  return {
    ...DEFAULT_MANAGED_GAME,
    ...game,
    manageKey,
    sourceId,
    steamAppId,
    chineseTitle: String(game.chineseTitle || '').trim(),
    is_server_installed: Number(game.is_server_installed || 0),
    server_install_mod_type: Number(game.server_install_mod_type || 0),
    gId: normalizePositiveNumber(game.gId, DEFAULT_MANAGED_GAME.gId),
    sourceType,
    sourceCommunity,
    sourceDomainName,
    sourceNexusGameId,
    sourceProfile,
    sourceGameId
  }
}

function isSameManagedGame(prev = {}, next = {}) {
  return (
    String(prev.manageKey || '') === String(next.manageKey || '') &&
    Number(prev.steamAppId || 0) === Number(next.steamAppId || 0) &&
    String(prev.chineseTitle || '') === String(next.chineseTitle || '') &&
    Number(prev.is_server_installed || 0) === Number(next.is_server_installed || 0) &&
    Number(prev.server_install_mod_type || 0) === Number(next.server_install_mod_type || 0) &&
    Number(prev.gId || 0) === Number(next.gId || 0) &&
    normalizeSourceType(prev.sourceType) === normalizeSourceType(next.sourceType) &&
    String(prev.sourceId || '').trim().toLowerCase() ===
      String(next.sourceId || '').trim().toLowerCase() &&
    String(prev.sourceCommunity || '')
      .trim()
      .toLowerCase() ===
      String(next.sourceCommunity || '')
        .trim()
        .toLowerCase() &&
    String(prev.sourceDomainName || '')
      .trim()
      .toLowerCase() ===
      String(next.sourceDomainName || '')
        .trim()
        .toLowerCase() &&
    Number(prev.sourceNexusGameId || 0) === Number(next.sourceNexusGameId || 0) &&
    String(prev.sourceProfile || 'default').trim() ===
      String(next.sourceProfile || 'default').trim() &&
    String(prev.sourceGameId || '') === String(next.sourceGameId || '')
  )
}

export const useGameStore = defineStore('gameStore', () => {
  const currentManagedGameList = ref([normalizeManagedGame()])

  const checkUpdateCountdown = ref(30)

  function startTimerCheckUpdate() {
    checkUpdateCountdown.value = 29
    let id = setInterval(() => {
      checkUpdateCountdown.value -= 1
      if (checkUpdateCountdown.value <= 0) {
        clearInterval(id)
        checkUpdateCountdown.value = 30
      }
    }, 1000)
  }

  function setCurrentManagedGame(game) {
    const normalizedGame = normalizeManagedGame(game)
    const { manageKey } = normalizedGame
    const index = currentManagedGameList.value.findIndex((g) => g.manageKey === manageKey)
    if (index !== -1) {
      if (isSameManagedGame(currentManagedGameList.value[index], normalizedGame)) {
        return
      }
      currentManagedGameList.value.splice(index, 1, normalizedGame)
    } else {
      currentManagedGameList.value.push(normalizedGame)
    }
  }

  return {
    currentManagedGameList,
    checkUpdateCountdown,
    setCurrentManagedGame,
    startTimerCheckUpdate
  }
})
