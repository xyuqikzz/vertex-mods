import path from 'path'
import {
  INSTALL_ENGINE_ERROR_CODES,
  InstallEngineError
} from '../installEngineError.js'
import { isPathInside } from '../pathSafety.js'
import { normalizeLaunchArgumentList, toPathParts } from './runnerUtils.js'
import { normalizeInstallPostInstallBaseType } from './stepNormalizer.js'
import {
  LIFECYCLE_PATH_LIKE_FIELDS,
  LIFECYCLE_TEXT_LIKE_FIELDS
} from './contracts.js'

function resolveLifecycleRuntimeTemplateText(value = '', payload = {}) {
  const text = String(value ?? '')
  if (!text) {
    return ''
  }

  const runtimeVariableMap = {
    game_root: String(payload?.gameRoot || '').trim(),
    game_path: String(payload?.gameRoot || '').trim(),
    target_root: String(payload?.targetRoot || '').trim(),
    target_path: String(payload?.targetRoot || '').trim(),
    staging_root: String(payload?.stagingRoot || payload?.sourceRoot || '').trim(),
    staging_path: String(payload?.stagingRoot || payload?.sourceRoot || '').trim()
  }

  return text.replace(/\{([a-z0-9_]+)\}/gi, (match, variableName) => {
    const safeVariableName = String(variableName || '')
      .trim()
      .toLowerCase()
    return Object.prototype.hasOwnProperty.call(runtimeVariableMap, safeVariableName)
      ? runtimeVariableMap[safeVariableName]
      : match
  })
}

function resolveLifecycleRuntimeArgumentList(value = [], payload = {}) {
  return normalizeLaunchArgumentList(value)
    .map((item) => resolveLifecycleRuntimeTemplateText(item, payload))
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function resolveInstallLifecycleStepRuntime(step = {}, payload = {}, dependencies = {}) {
  const gameRootText = String(payload?.gameRoot || '').trim()
  const targetRootText = String(payload?.targetRoot || '').trim()
  const stagingRootText = String(payload?.stagingRoot || payload?.sourceRoot || '').trim()
  const safeGameRoot = gameRootText ? path.resolve(gameRootText) : ''
  const safeTargetRoot = targetRootText ? path.resolve(targetRootText) : ''
  const safeStagingRoot = stagingRootText ? path.resolve(stagingRootText) : ''
  const runtimeTemplatePayload = {
    gameRoot: safeGameRoot,
    targetRoot: safeTargetRoot,
    stagingRoot: safeStagingRoot,
    sourceRoot: safeStagingRoot
  }
  const defaultBaseType = normalizeInstallPostInstallBaseType(payload?.targetBaseType, 'game')
  const baseType = normalizeInstallPostInstallBaseType(step.baseType, defaultBaseType)
  let baseRoot = safeGameRoot
  let boundaryRoot = safeGameRoot

  if (baseType === 'staging') {
    if (!safeStagingRoot) {
      throw new Error('生命周期动作缺少暂存目录，无法执行')
    }
    baseRoot = safeStagingRoot
    boundaryRoot = safeStagingRoot
  } else if (baseType === 'target') {
    if (!safeTargetRoot) {
      throw new Error('生命周期动作缺少已解析目标目录，无法执行')
    }
    baseRoot = safeTargetRoot
    boundaryRoot = safeTargetRoot
  } else {
    if (typeof dependencies?.resolveInstallTargetBoundaryRoot !== 'function') {
      throw new Error('生命周期动作缺少目标边界解析器，无法执行')
    }

    const resolvedBoundary = dependencies.resolveInstallTargetBoundaryRoot(baseType, safeGameRoot)
    baseRoot = resolvedBoundary.targetBoundaryRoot
    boundaryRoot = resolvedBoundary.targetBoundaryRoot

    if (resolvedBoundary.targetBaseType === 'game' && !safeGameRoot) {
      throw new Error('生命周期动作缺少游戏根目录，无法执行')
    }
  }

  if (!baseRoot) {
    throw new Error('生命周期动作缺少基准目录，无法执行')
  }

  const resolvedStepPathText = resolveLifecycleRuntimeTemplateText(
    String(step.path || ''),
    runtimeTemplatePayload
  )
  const resolvedTargetPath =
    resolvedStepPathText && resolvedStepPathText !== '.'
      ? path.resolve(baseRoot, ...toPathParts(resolvedStepPathText))
      : baseRoot

  if (!isPathInside(boundaryRoot, resolvedTargetPath)) {
    throw new InstallEngineError(
      INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
      '生命周期动作路径越界，已拒绝执行'
    )
  }

  // H1：对 path-like / text-like 字段做模板展开 + 边界校验。
  // path-like：模板展开后立即做 isPathInside 校验，把 lifecycleActions 后置兜底前移，
  // 错误信息与 lifecycleActions 保持一致（PATH_OUT_OF_BOUNDS）。
  // text-like：仅模板展开，无边界校验。
  const resolvedPaths = {}
  for (const fieldName of LIFECYCLE_PATH_LIKE_FIELDS) {
    if (fieldName === 'path') continue // 已由 resolvedTargetPath 处理
    const rawValue = step[fieldName]
    if (rawValue === undefined || rawValue === null || rawValue === '') continue
    const expandedText = resolveLifecycleRuntimeTemplateText(
      String(rawValue),
      runtimeTemplatePayload
    )
    if (!expandedText || expandedText === '.') continue
    const fullPath = path.resolve(baseRoot, ...toPathParts(expandedText))
    if (!isPathInside(boundaryRoot, fullPath)) {
      throw new InstallEngineError(
        INSTALL_ENGINE_ERROR_CODES.PATH_OUT_OF_BOUNDS,
        `生命周期动作字段 ${fieldName} 路径越界，已拒绝执行`
      )
    }
    resolvedPaths[fieldName] = fullPath
  }

  const resolvedTexts = {}
  for (const fieldName of LIFECYCLE_TEXT_LIKE_FIELDS) {
    const rawValue = step[fieldName]
    if (rawValue === undefined || rawValue === null) continue
    const textValue = String(rawValue)
    if (!textValue) continue
    resolvedTexts[fieldName] = resolveLifecycleRuntimeTemplateText(
      textValue,
      runtimeTemplatePayload
    )
  }

  return {
    action: String(step.action || '')
      .trim()
      .toLowerCase(),
    baseType,
    baseRoot,
    boundaryRoot,
    resolvedTargetPath,
    // H1：所有路径类字段已模板展开 + 已边界校验；lifecycleActions 优先消费。
    resolvedPaths,
    // H1：所有文本类字段已模板展开；lifecycleActions 优先消费。
    resolvedTexts,
    args: resolveLifecycleRuntimeArgumentList(step.args || [], runtimeTemplatePayload),
    stdin: resolveLifecycleRuntimeArgumentList(step.stdin || [], runtimeTemplatePayload),
    stdinIntervalMs:
      Number.isFinite(Number(step.stdinIntervalMs)) && Number(step.stdinIntervalMs) >= 0
        ? Math.floor(Number(step.stdinIntervalMs))
        : 220,
    requiresConsole: !!step.requiresConsole,
    repeat:
      Number.isFinite(Number(step.repeat)) && Number(step.repeat) > 0
        ? Math.floor(Number(step.repeat))
        : 1,
    timeoutMs:
      Number.isFinite(Number(step.timeoutMs)) && Number(step.timeoutMs) > 0
        ? Math.floor(Number(step.timeoutMs))
        : 300000
  }
}
