import {
  analyzeSourcePath,
  analyzeSourcePaths as analyzeSourcePathsBase
} from '../local-mod-import/analyzeService.js'
import { collectBatchDuplicatePaths, validateManagedSourcePath } from './safetyService.js'
import { LOCAL_MOD_MANAGER_ERROR_CODE } from './localModManagerResult.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizePathItems(payload = {}) {
  if (Array.isArray(payload.paths)) {
    return payload.paths
  }
  if (Array.isArray(payload.items)) {
    return payload.items
      .map((item) => (typeof item === 'string' ? item : item?.path))
      .filter(Boolean)
  }
  return []
}

async function findDuplicateState(payload = {}, analysis = {}, safePath = '') {
  try {
    const duplicateService = await import('./duplicateService.js')
    return {
      assetDuplicate: analysis?.fingerprint
        ? duplicateService.findDuplicateLocalAsset({
            ...payload,
            fingerprint: analysis.fingerprint
          })
        : null,
      bindingDuplicate: duplicateService.findDuplicateLocalBindingPath({
        ...payload,
        path: analysis?.path || safePath
      })
    }
  } catch {
    return {
      assetDuplicate: null,
      bindingDuplicate: null
    }
  }
}

function createRiskState(analysis = {}, safety = {}) {
  const riskReasons = []
  if (safety.safe === false) {
    riskReasons.push({
      code: safety.code,
      message: safety.message,
      path: safety.path || analysis.path || ''
    })
  }
  if (
    Number(analysis.fileCount || 0) > 2000 ||
    Number(analysis.sizeBytes || 0) > 1024 * 1024 * 1024
  ) {
    riskReasons.push({
      code: 'local_mod_large_binding',
      message: '来源体积或文件数量较大，原地接管后启用/禁用可能耗时'
    })
  }
  return {
    riskLevel: riskReasons.some((item) => item.code === LOCAL_MOD_MANAGER_ERROR_CODE.PATH_UNSAFE)
      ? 'blocked'
      : riskReasons.length
        ? 'warning'
        : 'safe',
    riskReasons
  }
}

async function analyzeOne(itemPath = '', payload = {}, batchDuplicateSet = new Set()) {
  const safePath = toSafeText(itemPath)
  if (!safePath) {
    return { success: false, message: '路径为空' }
  }
  const safety = validateManagedSourcePath(safePath, payload)
  const analysis =
    safety.code === LOCAL_MOD_MANAGER_ERROR_CODE.PATH_MISSING
      ? { success: false, message: safety.message, path: safety.path || safePath }
      : await analyzeSourcePath(safePath)
  const { assetDuplicate, bindingDuplicate } = await findDuplicateState(
    payload,
    analysis,
    safety.path || safePath
  )
  const batchDuplicate = batchDuplicateSet.has(
    (analysis?.path || safety.path || safePath).toLowerCase()
  )
  const risk = createRiskState(analysis, safety)
  const duplicateState = {
    duplicated: !!assetDuplicate || !!bindingDuplicate || batchDuplicate,
    batchDuplicate,
    assetDuplicate,
    bindingDuplicate
  }

  return {
    ...analysis,
    path: analysis?.path || safety.path || safePath,
    success: analysis?.success !== false && safety.safe !== false,
    message: safety.safe === false ? safety.message : analysis?.message || '',
    code: safety.safe === false ? safety.code : '',
    riskLevel: duplicateState.duplicated && risk.riskLevel === 'safe' ? 'warning' : risk.riskLevel,
    riskReasons: risk.riskReasons,
    duplicateState,
    recommendedMode: analysis?.sourceType === 'archive' ? 'library_install_task' : 'bind_existing'
  }
}

export async function analyzeLocalModSources(payload = {}) {
  const paths = normalizePathItems(payload)
  if (!paths.length) {
    return await analyzeSourcePathsBase(payload)
  }

  const duplicatePaths = collectBatchDuplicatePaths(paths)
  const duplicateKeySet = new Set(duplicatePaths.map((item) => String(item || '').toLowerCase()))
  const items = []
  for (const itemPath of paths) {
    items.push(await analyzeOne(itemPath, payload, duplicateKeySet))
  }

  return {
    success: true,
    data: {
      items,
      successCount: items.filter((item) => item.success).length,
      failedCount: items.filter((item) => !item.success).length
    }
  }
}
