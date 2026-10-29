import {
  buildCanonicalInstallPlan,
  normalizeRemoteSourceModpack
} from '../../../shared/modpacks/source-modpack-contract.js'

export const SOURCE_MODPACK_IMPORT_ERROR_CODES = Object.freeze({
  SHARE_NOT_FOUND: 'share_not_found',
  SHARE_REMOVED: 'share_removed',
  SHARE_UNPUBLISHED: 'share_unpublished',
  SHARE_SOURCE_MISMATCH: 'share_source_mismatch',
  TARGET_GAME_NOT_FOUND: 'target_game_not_found',
  TARGET_GAME_AMBIGUOUS: 'target_game_ambiguous',
  TARGET_PROFILE_MISSING: 'target_profile_missing',
  INSTANCE_CONFLICT: 'instance_conflict',
  INSTANCE_UPDATE_IN_PROGRESS: 'instance_update_in_progress',
  ALREADY_LATEST: 'already_latest',
  LOCAL_DRIFT_DETECTED: 'local_drift_detected',
  MANIFEST_REVISION_CHANGED: 'manifest_revision_changed',
  MANIFEST_REVISION_CONFLICT: 'manifest_revision_conflict',
  SOURCE_RESOLUTION_FAILED: 'source_resolution_failed',
  SOURCE_CAPABILITY_DISABLED: 'source_capability_disabled',
  UNSAFE_UNINSTALL: 'unsafe_uninstall',
  SHARED_MOD_RETAINED: 'shared_mod_retained',
  PARTIAL_UPDATE: 'partial_update'
})

function createCoordinatorError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail })
}

const KNOWN_IMPORT_ERROR_CODES = new Set(Object.values(SOURCE_MODPACK_IMPORT_ERROR_CODES))

function resolveImportErrorCode(error = {}) {
  const rawCode = toText(error?.code)
  if (KNOWN_IMPORT_ERROR_CODES.has(rawCode)) return rawCode
  const message = toText(error?.message)
  const prefix = message.split(':', 1)[0].trim()
  return KNOWN_IMPORT_ERROR_CODES.has(prefix) ? prefix : ''
}

function toText(value = '') {
  return String(value ?? '').trim()
}

function normalizeInput(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    shareCode: toText(source.shareCode || source.share_code),
    entryPoint: toText(source.entryPoint || source.entry_point || 'external').toLowerCase(),
    targetContext:
      source.targetContext && typeof source.targetContext === 'object'
        ? JSON.parse(JSON.stringify(source.targetContext))
        : {},
    intent: toText(source.intent || 'auto').toLowerCase()
  }
}

function ensureRemoteAvailable(remote = {}) {
  if (!remote.packUid && !remote.id) {
    throw createCoordinatorError(SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_NOT_FOUND, '分享码不存在')
  }
  if (remote.deleted === true || Number(remote.deleted) === 1) {
    throw createCoordinatorError(SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_REMOVED, '远程分享已删除')
  }
  if (remote.published === false || Number(remote.published) === 0) {
    throw createCoordinatorError(
      SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_UNPUBLISHED,
      '远程分享已下架'
    )
  }
}

function ensureEntryPointMatches(entryPoint = '', remote = {}, items = []) {
  if (!entryPoint || entryPoint === 'external' || remote.sourceType === 'mixed') return
  const sourceSet = new Set((Array.isArray(items) ? items : []).map((item) => item.sourcePlatform))
  if (sourceSet.size && !sourceSet.has(entryPoint)) {
    throw createCoordinatorError(
      SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_SOURCE_MISMATCH,
      '当前页面与分享来源不匹配',
      { entryPoint, sources: [...sourceSet] }
    )
  }
}

export function createSourceModpackShareCoordinator(dependencies = {}) {
  const inspectedPlanMap = new Map()
  const fetchShareByCode = dependencies.fetchShareByCode
  const resolveManifest = dependencies.resolveManifest
  const inspectCanonicalPlan = dependencies.inspectCanonicalPlan
  const applyCanonicalPlan = dependencies.applyCanonicalPlan
  const getInstance = dependencies.getInstance
  const prepareTargetContext = dependencies.prepareTargetContext

  if (typeof fetchShareByCode !== 'function') {
    throw new TypeError('source modpack coordinator requires fetchShareByCode')
  }
  if (typeof resolveManifest !== 'function') {
    throw new TypeError('source modpack coordinator requires resolveManifest')
  }
  if (typeof inspectCanonicalPlan !== 'function') {
    throw new TypeError('source modpack coordinator requires inspectCanonicalPlan')
  }

  return Object.freeze({
    async inspectShareImport(input = {}) {
      const request = normalizeInput(input)
      if (!request.shareCode) {
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_NOT_FOUND,
          '请输入分享码'
        )
      }
      let detail
      try {
        detail = await fetchShareByCode(request.shareCode)
      } catch (error) {
        const errorCode = resolveImportErrorCode(error)
        if (errorCode) {
          throw createCoordinatorError(errorCode, toText(error?.message), error?.detail || {})
        }
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.SHARE_NOT_FOUND,
          toText(error?.message) || '分享码不存在'
        )
      }
      const remote = normalizeRemoteSourceModpack(detail)
      ensureRemoteAvailable(remote)
      if (typeof prepareTargetContext === 'function') {
        request.targetContext = await prepareTargetContext({
          detail,
          remote,
          request,
          targetContext: request.targetContext
        })
      }
      if (!Number(request.targetContext.localGameInstallationId || 0)) {
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.TARGET_GAME_NOT_FOUND,
          '未找到目标游戏安装记录'
        )
      }

      let resolvedItems
      let resolutionWarnings = []
      let manualActions = []
      try {
        const resolution = await resolveManifest({
          detail,
          remote,
          shareCode: request.shareCode,
          entryPoint: request.entryPoint,
          targetContext: request.targetContext
        })
        resolvedItems = Array.isArray(resolution) ? resolution : resolution?.items || []
        resolutionWarnings = Array.isArray(resolution?.warnings) ? resolution.warnings : []
        manualActions = Array.isArray(resolution?.manualActions) ? resolution.manualActions : []
      } catch (error) {
        if (error?.code) throw error
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.SOURCE_RESOLUTION_FAILED,
          toText(error?.message) || '来源条目解析失败'
        )
      }
      const canonicalPlan = buildCanonicalInstallPlan({
        remote,
        targetContext: request.targetContext,
        resolvedItems
      })
      ensureEntryPointMatches(request.entryPoint, remote, canonicalPlan.items)
      const inspection = await inspectCanonicalPlan({
        ...request,
        remote,
        canonicalPlan
      })
      const result = {
        ...inspection,
        detail,
        remote: {
          ...remote,
          ...(inspection?.remote || {})
        },
        planHash: toText(inspection?.planHash) || canonicalPlan.canonicalPlanHash,
        canonicalPlan: inspection?.canonicalPlan || canonicalPlan,
        warnings: [...(inspection?.warnings || []), ...resolutionWarnings],
        manualActions
      }
      if (result.planToken) {
        inspectedPlanMap.set(result.planToken, {
          shareCode: request.shareCode,
          revision: remote.revision,
          manifestHash: remote.manifestHash,
          planHash: result.planHash
        })
      }
      return result
    },

    async applyShareImport(input = {}) {
      if (typeof applyCanonicalPlan !== 'function') {
        throw new TypeError('source modpack coordinator requires applyCanonicalPlan')
      }
      const request = typeof input === 'string' ? { planToken: input } : input || {}
      const planToken = toText(request.planToken || request.plan_token)
      if (!planToken) {
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.MANIFEST_REVISION_CHANGED,
          '安装计划已失效，请重新预检'
        )
      }
      const inspected = inspectedPlanMap.get(planToken)
      if (inspected) {
        const latestDetail = await fetchShareByCode(inspected.shareCode)
        const latestRemote = normalizeRemoteSourceModpack(latestDetail)
        ensureRemoteAvailable(latestRemote)
        if (
          Number(latestRemote.revision || 0) !== Number(inspected.revision || 0) ||
          (inspected.manifestHash && latestRemote.manifestHash !== inspected.manifestHash)
        ) {
          throw createCoordinatorError(
            SOURCE_MODPACK_IMPORT_ERROR_CODES.MANIFEST_REVISION_CHANGED,
            '预检后远程清单已变化，请重新预检'
          )
        }
      }
      const result = await applyCanonicalPlan({
        ...request,
        planToken,
        expectedPlanHash: toText(request.expectedPlanHash || request.expected_plan_hash)
      })
      inspectedPlanMap.delete(planToken)
      return result
    },

    async getShareInstance(instanceId = '') {
      if (typeof getInstance !== 'function') {
        throw new TypeError('source modpack coordinator requires getInstance')
      }
      const id = toText(instanceId)
      if (!id) {
        throw createCoordinatorError(
          SOURCE_MODPACK_IMPORT_ERROR_CODES.INSTANCE_CONFLICT,
          '缺少本地实例 ID'
        )
      }
      return await getInstance(id)
    }
  })
}
