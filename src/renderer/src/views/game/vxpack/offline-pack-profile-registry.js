import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { ensureSourceProfile } from '../../../utils/source-profile-registry.js'
import { OFFLINE_PACK_ERROR_CODE } from '../../../../../shared/modpacks/offline-pack-contract.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeSource(value = '') {
  return toSafeText(value).toLowerCase()
}

function pushTarget(targetMap, source = '', identifier = '') {
  const safeSource = normalizeSource(source)
  const safeIdentifier = toSafeText(identifier)
  if (!safeSource || !safeIdentifier) return
  const key = `${safeSource}:${safeIdentifier.toLowerCase()}`
  if (targetMap.has(key)) return
  targetMap.set(key, {
    source: safeSource,
    identifier: safeIdentifier
  })
}

function pushGameKeyTarget(targetMap, gameKey = '') {
  const text = toSafeText(gameKey)
  const separatorIndex = text.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === text.length - 1) return
  pushTarget(targetMap, text.slice(0, separatorIndex), text.slice(separatorIndex + 1))
}

function pushSourceIdentityTargets(targetMap, input = {}, fallbackSource = '') {
  const source = normalizeSource(
    input.sourcePlatform ||
      input.source_platform ||
      input.sourceType ||
      input.source_type ||
      input.source ||
      fallbackSource
  )
  if (!source) return

  pushGameKeyTarget(targetMap, input.gameKey || input.game_key)
  const identifiers = [
    input.sourceGameSlug,
    input.source_game_slug,
    input.sourceSlug,
    input.source_slug,
    input.community,
    input.communityIdentifier,
    input.sourceGameId,
    input.source_game_id,
    input.sourceId,
    input.source_id,
    input.appId,
    input.app_id,
    input.steamAppId,
    input.steam_app_id
  ]
  for (const identifier of identifiers) {
    pushTarget(targetMap, source, identifier)
  }
}

export function collectOfflinePackProfileRegistryTargets(input = {}) {
  const safeInput = toSafeObject(input)
  const manifest = toSafeObject(safeInput.manifest || safeInput)
  const targetMap = new Map()
  const itemTargetMap = new Map()
  const game = toSafeObject(manifest.game)
  const primaryGame = toSafeObject(manifest.primaryGame || manifest.primary_game)
  const profile = toSafeObject(manifest.profile)
  const fallbackSource = normalizeSource(
    game.sourceType ||
      game.sourcePlatform ||
      primaryGame.sourceType ||
      primaryGame.sourcePlatform ||
      profile.sourcePlatform
  )

  const installableItems = Array.isArray(safeInput.installableItems)
    ? safeInput.installableItems
    : []
  const manifestItems = Array.isArray(manifest.items) ? manifest.items : []
  const itemSource = installableItems.length ? installableItems : manifestItems
  for (const item of itemSource) {
    pushSourceIdentityTargets(itemTargetMap, toSafeObject(item), fallbackSource)
  }

  if (itemTargetMap.size) {
    for (const target of itemTargetMap.values()) {
      pushTarget(targetMap, target.source, target.identifier)
    }
  } else {
    pushSourceIdentityTargets(targetMap, game, fallbackSource)
    pushSourceIdentityTargets(targetMap, primaryGame, fallbackSource)
  }

  return Array.from(targetMap.values())
}

export function registerOfflinePackProfileTargets(input = {}, profileName = '', options = {}) {
  const name = toSafeText(profileName)
  if (!name) {
    return {
      success: false,
      code: OFFLINE_PACK_ERROR_CODE.PROFILE_CREATE_FAILED,
      message: uiText('ui.targetProfileNameIsMissing'),
      targets: [],
      failures: []
    }
  }

  const targets = collectOfflinePackProfileRegistryTargets(input)
  if (!targets.length) {
    return {
      success: false,
      code: OFFLINE_PACK_ERROR_CODE.PROFILE_CREATE_FAILED,
      message: uiText('ui.theOfflinePackageHasNoSourceGameIdentifierToRegister'),
      targets: [],
      failures: []
    }
  }

  const ensureProfile =
    typeof options.ensureProfile === 'function' ? options.ensureProfile : ensureSourceProfile
  // 默认 false：离线包导入只「注册新配置」，不夺走用户当前正在管理的 active profile，
  // 与 deferActivation（导入即「未启用」）语义一致 —— 是否切到导入配置由用户决定。
  // 历史调用方若需要保留「自动切到导入配置」行为，可显式 selectImportedProfile: true。
  const selectImportedProfile = options.selectImportedProfile === true
  const created = []
  const failures = []
  // 可观测性（审计 🟢#30）：profile_register 阶段耗时与成败计数（renderer 侧）
  const __registerStart = Date.now()
  for (const target of targets) {
    try {
      const record = ensureProfile(target.source, target.identifier, name, {
        select: selectImportedProfile
      })
      if (!record) {
        failures.push(target)
        continue
      }
      created.push({
        ...target,
        record
      })
    } catch (error) {
      failures.push({
        ...target,
        error: String(error?.message || error)
      })
    }
  }

  const __registerDurationMs = Date.now() - __registerStart
  if (failures.length) {
    console.warn('[offline-pack] profile_register 失败', {
      durationMs: __registerDurationMs,
      targetCount: targets.length,
      failureCount: failures.length
    })
    return {
      success: false,
      code: OFFLINE_PACK_ERROR_CODE.PROFILE_CREATE_FAILED,
      message: uiText('ui.couldNotCreateTheImportProfile'),
      targets: created,
      failures,
      metrics: { durationMs: __registerDurationMs, targetCount: targets.length, failureCount: failures.length }
    }
  }

  console.log('[offline-pack] profile_register 完成', {
    durationMs: __registerDurationMs,
    targetCount: targets.length
  })
  return {
    success: true,
    code: '',
    profileName: name,
    targets: created,
    failures: [],
    metrics: { durationMs: __registerDurationMs, targetCount: targets.length }
  }
}
