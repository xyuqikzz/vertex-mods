import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'fs-extra'
import { assertLocalAgentPath, validateGameRoot } from '../pathAccess.js'
import {
  SOURCE_PLATFORM_ERROR_CODES,
  assertSourceCapability,
  normalizeSourcePlatform
} from '../../../../../shared/sources/source-platform-registry.js'
import { saveInstallRuleConfigTool } from './installRuleConfigWriterTool.js'

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function hashPath(value = '') {
  const text = toSafeText(value)
  return text ? crypto.createHash('sha1').update(path.resolve(text).toLowerCase()).digest('hex').slice(0, 12) : ''
}

function assertSupportedSource(sourcePlatform = '') {
  if (sourcePlatform === 'aggregate') {
    return {
      ok: false,
      success: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.INVALID_AGGREGATE_SOURCE,
      source: 'aggregate',
      message: 'aggregate 只是展示来源，不能作为 AI 工具真实业务来源。请先解析 businessSource 或 targetSourcePlatform。'
    }
  }

  const capability = assertSourceCapability(sourcePlatform, 'installRuleConfig')
  if (!capability.ok) {
    return capability
  }

  if (!['nexus', 'modio'].includes(capability.source)) {
    return {
      ok: false,
      success: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source: capability.source,
      message: '当前工具首版只支持 Nexus / Mod.io 的游戏目录识别兜底。'
    }
  }

  return capability
}

function resolveSourcePlatform(args = {}) {
  return normalizeSourcePlatform(
    args.sourcePlatform || args.source || args.businessSource || args.targetSourcePlatform
  )
}

function resolveNexusIdentity(args = {}) {
  return {
    nexusGameId: toSafeNumber(args.nexusGameId || args.sourceGameId || args.sourceId, 0),
    domainName: toSafeText(
      args.domainName || args.sourceSlug || args.sourceGameSlug || args.gameDomainName
    ).toLowerCase()
  }
}

function resolveModioIdentity(args = {}) {
  return {
    modioGameId: toSafeNumber(args.modioGameId || args.sourceGameId || args.sourceId || args.gameKey, 0),
    nameId: toSafeText(args.nameId || args.sourceSlug || args.sourceGameSlug || args.slug).toLowerCase()
  }
}

function hasSourceIdentity(sourcePlatform = '', args = {}) {
  if (sourcePlatform === 'nexus') {
    const identity = resolveNexusIdentity(args)
    return !!(identity.nexusGameId || identity.domainName)
  }
  if (sourcePlatform === 'modio') {
    const identity = resolveModioIdentity(args)
    return !!(identity.modioGameId || identity.nameId)
  }
  return false
}

function createPathSummary(rootPath = '', exePath = '') {
  const safeRootPath = toSafeText(rootPath)
  const safeExePath = toSafeText(exePath)
  return {
    rootConfigured: !!safeRootPath,
    rootBasename: safeRootPath ? path.basename(safeRootPath) : '',
    exeBasename: safeExePath ? path.basename(safeExePath) : '',
    rootPathHash: hashPath(safeRootPath),
    exePathHash: hashPath(safeExePath)
  }
}

async function resolveInstallRuleDetectFunctions(dependencyOverrides = {}) {
  if (
    typeof dependencyOverrides.installDetectGameRootByRule === 'function' &&
    typeof dependencyOverrides.installDetectGameRootByRuleFromDirectory === 'function'
  ) {
    return {
      installDetectGameRootByRule: dependencyOverrides.installDetectGameRootByRule,
      installDetectGameRootByRuleFromDirectory:
        dependencyOverrides.installDetectGameRootByRuleFromDirectory
    }
  }

  const module = await import('../../../../ipc/game/installRuleDetect.js')
  return {
    installDetectGameRootByRule: module.installDetectGameRootByRule,
    installDetectGameRootByRuleFromDirectory: module.installDetectGameRootByRuleFromDirectory
  }
}

async function resolveNexusBindingWriter(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.upsertNexusGameBinding === 'function') {
    return dependencyOverrides.upsertNexusGameBinding
  }
  const module = await import('../../../../db/sources/nexus/nexusBinding.js')
  return module.upsertNexusGameBinding
}

async function resolveModioBindingWriter(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.upsertModioGameBinding === 'function') {
    return dependencyOverrides.upsertModioGameBinding
  }
  const module = await import('../../../../db/sources/modio/modioBinding.js')
  return module.upsertModioGameBinding
}

function resolveRuleJsonObject(rawRuleJson) {
  if (rawRuleJson && typeof rawRuleJson === 'object' && !Array.isArray(rawRuleJson)) {
    return rawRuleJson
  }

  const text = toSafeText(rawRuleJson)
  if (!text) return {}

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return null
  }
}

function hasGameDetectCandidates(rawRuleJson) {
  const ruleJson = resolveRuleJsonObject(rawRuleJson)
  if (ruleJson === null) {
    return true
  }
  const gameDetect =
    ruleJson?.game_detect && typeof ruleJson.game_detect === 'object'
      ? ruleJson.game_detect
      : ruleJson?.gameDetect && typeof ruleJson.gameDetect === 'object'
        ? ruleJson.gameDetect
        : {}
  const candidates = Array.isArray(gameDetect.candidates)
    ? gameDetect.candidates
    : Array.isArray(gameDetect.candidate_list)
      ? gameDetect.candidate_list
      : Array.isArray(gameDetect.candidateList)
        ? gameDetect.candidateList
        : []

  return candidates.length > 0
}

function normalizeDetectFailure(result = {}, sourcePlatform = '') {
  const reason = toSafeText(result.reason || result.errorCode, 'not_found')
  const errorCode =
    reason === 'missing_directory'
      ? 'directory_not_found'
      : ['no_candidates', 'not_found', 'directory_not_found'].includes(reason)
        ? reason
        : 'not_found'

  return {
    success: false,
    matched: false,
    sourcePlatform,
    strategy: toSafeText(result.strategy, 'highest_confidence'),
    errorCode,
    message:
      errorCode === 'no_candidates'
        ? '规则缺少 game_detect.candidates，无法只读检测游戏目录。'
        : errorCode === 'directory_not_found'
          ? '用户选择的目录不存在或不可访问。'
          : '未能根据当前 game_detect 规则识别游戏目录，请让用户手动绑定目录后重试。',
    pathSummary: createPathSummary()
  }
}

function normalizeDetectSuccess(result = {}, sourcePlatform = '') {
  return {
    success: true,
    sourcePlatform,
    strategy: toSafeText(result.strategy, 'highest_confidence'),
    candidateName: toSafeText(result.candidateName),
    candidateType: toSafeText(result.candidateType),
    confidence: toSafeNumber(result.confidence, 0),
    matched: true,
    matchSource: toSafeText(result.source),
    rootConfigured: true,
    appId: toSafeNumber(result.appId, 0),
    gameId: toSafeNumber(result.gameId, 0),
    pathSummary: createPathSummary(result.rootPath, result.exePath)
  }
}

export async function detectGameRootTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const sourcePlatform = resolveSourcePlatform(args)
  const capability = assertSupportedSource(sourcePlatform)
  if (!capability.ok) {
    return {
      success: false,
      errorCode: capability.errorCode || SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source: capability.source || sourcePlatform,
      message: capability.message || '当前来源未开启游戏目录识别兜底能力。'
    }
  }

  if (!hasSourceIdentity(sourcePlatform, args)) {
    return {
      success: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.MISSING_SOURCE_IDENTITY,
      source: sourcePlatform,
      message: '缺少 sourceGameId / sourceSlug / domainName / nameId，无法沉淀来源游戏识别结果。'
    }
  }

  const selectedDirectory = toSafeText(args.selectedDirectory || args.directory || args.rootPath)
  const identity = sourcePlatform === 'nexus' ? resolveNexusIdentity(args) : resolveModioIdentity(args)
  const ruleJson = args.ruleJson || args.rule_json || {}
  if (!hasGameDetectCandidates(ruleJson)) {
    return normalizeDetectFailure({ reason: 'no_candidates' }, sourcePlatform)
  }

  const payload = {
    ...identity,
    domainName: identity.domainName || identity.nameId,
    nexusGameId: identity.nexusGameId || 0,
    ruleJson
  }
  const detectFunctions = await resolveInstallRuleDetectFunctions(dependencyOverrides)
  const result = selectedDirectory
    ? await detectFunctions.installDetectGameRootByRuleFromDirectory({ ...payload, selectedDirectory })
    : await detectFunctions.installDetectGameRootByRule(payload)

  if (!result?.success) {
    return normalizeDetectFailure(result, sourcePlatform)
  }

  return normalizeDetectSuccess(result, sourcePlatform)
}

export async function bindGameRootTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const sourcePlatform = resolveSourcePlatform(args)
  const capability = assertSupportedSource(sourcePlatform)
  if (!capability.ok) {
    return {
      success: false,
      errorCode: capability.errorCode || SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source: capability.source || sourcePlatform,
      message: capability.message || '当前来源未开启游戏目录绑定能力。'
    }
  }

  if (!hasSourceIdentity(sourcePlatform, args)) {
    return {
      success: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.MISSING_SOURCE_IDENTITY,
      source: sourcePlatform,
      message: '缺少来源游戏身份，无法保存目录绑定。'
    }
  }

  let detectedRootPath = toSafeText(args.detectedRootPath || args.rootPath || args.gameRootPath)
  let detectedExePath = toSafeText(args.detectedExePath || args.exePath || args.clientExePath)
  try {
    if (detectedRootPath) assertLocalAgentPath(detectedRootPath)
    if (detectedExePath) assertLocalAgentPath(detectedExePath)
  } catch (error) {
    return { success: false, errorCode: 'invalid_game_root', message: error.message }
  }
  if (!detectedRootPath || !(await fs.pathExists(detectedRootPath))) {
    return {
      success: false,
      errorCode: 'directory_not_found',
      source: sourcePlatform,
      message: '待绑定的游戏目录不存在或不可访问。'
    }
  }
  if (!detectedExePath || !(await fs.pathExists(detectedExePath))) {
    return {
      success: false,
      errorCode: 'exe_not_found',
      source: sourcePlatform,
      message: '待绑定的游戏可执行文件不存在或不可访问。'
    }
  }

  try {
    const resolved = await validateGameRoot(detectedRootPath, detectedExePath)
    detectedRootPath = resolved.root
    detectedExePath = resolved.exe
  } catch (error) {
    return { success: false, errorCode: 'invalid_game_root', message: error.message }
  }
  const bindingWriter =
    sourcePlatform === 'nexus'
      ? await resolveNexusBindingWriter(dependencyOverrides)
      : await resolveModioBindingWriter(dependencyOverrides)
  const bindingResult =
    sourcePlatform === 'nexus'
      ? bindingWriter({
          ...resolveNexusIdentity(args),
          appId: toSafeNumber(args.appId, 0),
          backendGameId: toSafeNumber(args.backendGameId || args.gameId, 0),
          gameName: toSafeText(args.gameName || args.name),
          coverImage: toSafeText(args.coverImage),
          detectedRootPath,
          detectedExePath
        })
      : bindingWriter({
          ...resolveModioIdentity(args),
          appId: toSafeNumber(args.appId || args.modioGameId || args.sourceGameId, 0),
          backendGameId: toSafeNumber(args.backendGameId || args.gameId, 0),
          gameName: toSafeText(args.gameName || args.name),
          coverImage: toSafeText(args.coverImage),
          detectedRootPath,
          detectedExePath
        })

  let ruleSaveResult = null
  if (toSafeText(args.mergeStrategy || args.merge_strategy) === 'game_detect_only' && args.ruleJson) {
    const saveTool = dependencyOverrides.saveInstallRuleConfigTool || saveInstallRuleConfigTool
    ruleSaveResult = await saveTool({
      ...args,
      sourcePlatform,
      ...resolveNexusIdentity(args),
      ...resolveModioIdentity(args),
      mergeStrategy: 'game_detect_only'
    })
  }

  return {
    success: bindingResult?.success === true && (!ruleSaveResult || ruleSaveResult.success === true),
    bindingSaved: bindingResult?.success === true,
    ruleSaved: ruleSaveResult ? ruleSaveResult.success === true : false,
    sourcePlatform,
    configScope: 'local_override',
    configType: ruleSaveResult?.configType || '',
    pathSummary: createPathSummary(detectedRootPath, detectedExePath),
    binding: bindingResult?.binding
      ? {
          id: toSafeNumber(bindingResult.binding.id, 0),
          appId: toSafeNumber(bindingResult.binding.appId, 0),
          gameName: toSafeText(bindingResult.binding.gameName),
          rootConfigured: !!bindingResult.binding.detectedRootPath
        }
      : null,
    ruleSave: ruleSaveResult
      ? {
          success: ruleSaveResult.success === true,
          errorCode: toSafeText(ruleSaveResult.errorCode),
          ruleVersion: toSafeNumber(ruleSaveResult.ruleVersion, 0),
          configType: toSafeText(ruleSaveResult.configType)
        }
      : null,
    message:
      bindingResult?.success === true
        ? '已保存来源游戏目录绑定。'
        : '来源游戏目录绑定保存失败。'
  }
}
