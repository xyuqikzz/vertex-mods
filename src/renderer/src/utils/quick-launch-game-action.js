import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../i18n/message.js'
import { normalizeSourcePlatform, getSourcePlatformDefinition } from '../../../shared/sources/source-platform-registry.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { increaseQuickLaunchWeight } from '@renderer/utils/quick-launch-weight.js'
import { getR2modmanCommunityMetaBySteamAppId } from '@renderer/utils/community-api.js'
import { resolveSelectedSourceProfileName } from '@renderer/utils/source-profile-registry.js'

const SOURCE_TYPE = Object.freeze({
  THUNDERSTORE: 'thunderstore'
})

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainStringList(input) {
  if (!Array.isArray(input)) {
    return []
  }
  return input.map((item) => String(item || '').trim()).filter(Boolean)
}

function normalizeSourceType(value = '') {
  const source = normalizeSourcePlatform(value)
  return getSourcePlatformDefinition(source) ? source : ''
}

function getGameSteamAppId(game = {}) {
  return toSafeNumber(game?.steamAppId || game?.app_id || game?.appId || game?.steam_app_id, 0)
}

function getThunderstoreCommunity(game = {}) {
  return String(game?.source_slug || game?.source_id || '')
    .trim()
    .toLowerCase()
}

function getQuickLaunchModCount(game = {}) {
  const candidates = [game?.modCount, game?.clientModCount]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return 0
}

async function resolveThunderstoreSourceMeta(game = {}, steamAppId = 0) {
  const sourceMeta = game?.sourceMeta?.[SOURCE_TYPE.THUNDERSTORE] || {}
  if (steamAppId <= 0) {
    return sourceMeta
  }

  try {
    const mappedMeta = await getR2modmanCommunityMetaBySteamAppId(steamAppId)
    if (mappedMeta?.community) {
      return {
        ...sourceMeta,
        ...mappedMeta
      }
    }
  } catch (error) {
    console.error('[Quick Launch] 社区映射加载失败', error)
  }

  return sourceMeta
}

export function shouldInjectQuickLaunchMods(game = {}) {
  return (
    normalizeSourceType(game?.currentSource || game?.source || game?.sourceType) ===
      SOURCE_TYPE.THUNDERSTORE && getQuickLaunchModCount(game) > 0
  )
}

export function getQuickLaunchPrimaryActionText(game = {}, translate) {
  const inject = shouldInjectQuickLaunchMods(game)
  if (translate) return translate(inject ? 'quickLaunch.inject' : 'quickLaunch.launch')
  return inject ? uiText('quickLaunch.inject') : uiText('modBrowser.launch')
}

export async function startQuickLaunchGame(game = {}, options = {}) {
  const ensureGameSource =
    typeof options.ensureGameSource === 'function' ? options.ensureGameSource : async (item) => item
  const onResolvedGamePath =
    typeof options.onResolvedGamePath === 'function' ? options.onResolvedGamePath : null
  const resolvedGame = await ensureGameSource(game)
  const steamAppId = getGameSteamAppId(resolvedGame)

  if (shouldInjectQuickLaunchMods(resolvedGame)) {
    const sourceMeta = await resolveThunderstoreSourceMeta(resolvedGame, steamAppId)
    const community = String(sourceMeta?.community || getThunderstoreCommunity(resolvedGame) || '')
      .trim()
      .toLowerCase()
    if (!community) {
      $message.warning(uiMessage('ui.thisGameHasNoThunderstoreCommunityIdentifierForModInjection'))
      return
    }
    const profileName = resolveSelectedSourceProfileName(SOURCE_TYPE.THUNDERSTORE, community)

    increaseQuickLaunchWeight(steamAppId)

    try {
      let gameExePath = String(resolvedGame?.client_exe_path || '').trim()
      if (!gameExePath) {
        const selectResult = await ipcRenderer.invoke('thunderstoreSelectGameExecutable', {
          community,
          profileName,
          packageLoader: String(sourceMeta?.packageLoader || '').trim(),
          appId: Number(steamAppId || 0),
          preferPath: ''
        })

        if (selectResult?.canceled) {
          return
        }

        gameExePath = String(selectResult?.gameExePath || '').trim()
        if (!gameExePath) {
          throw new Error(uiText('ui.noExecutableSelected'))
        }
      }

      const result = await ipcRenderer.invoke('thunderstoreLaunchGame', {
        community,
        profileName,
        appId: Number(steamAppId || 0),
        packageLoader: String(sourceMeta?.packageLoader || '').trim(),
        launchMode: 'modded',
        gameExePath,
        exeNames: toPlainStringList(sourceMeta?.exeNames),
        steamFolderName: String(sourceMeta?.steamFolderName || '').trim()
      })

      const resolvedPath = String(result?.gameExePath || gameExePath || '').trim()
      if (resolvedPath) {
        resolvedGame.client_exe_path = resolvedPath
        game.client_exe_path = resolvedPath
        onResolvedGamePath?.(resolvedPath, resolvedGame)
      }

      $message.success(uiMessage('ui.modsInjectedLaunchingTheGame'))
      return
    } catch (error) {
      console.error('快捷启动注入 Thunderstore 模组失败', error)
      $message.error(uiMessage('ui.injectionFailedValue', { value1: (error?.message || uiText('ui.checkTheGamePathAndLaunchArguments')) }))
      return
    }
  }

  const clientExePath = String(resolvedGame?.client_exe_path || (resolvedGame.discovered && steamAppId ? `steam://rungameid/${steamAppId}` : '')).trim()
  if (!clientExePath) {
    $message.warning(uiMessage('ui.noUsableLaunchPathFound'))
    return
  }

  increaseQuickLaunchWeight(steamAppId)
  ipcRenderer.send('startSpecifiedApp', {
    path: clientExePath,
    steamAppId
  })
}
