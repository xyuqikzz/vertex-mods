import fs from 'fs-extra'
import path from 'path'
import https from 'https'
import axios from 'axios'
import crypto from 'crypto'
import dbInstance from '../../db/dbInstance.js'
import userPath from '../../initPath.js'
import { formatChinaTime } from '../tool.js'
import { getGameByAppId } from './tool.js'
import { StagingManager } from '../../utils/stagingManager.js'
import { extractArchiveByNodeApi } from '../../api/index.js'
import { getGameDataByAppId } from '../../db/games/game.js'
import { insertMod } from '../../db/mods/mods.js'
import { MOD_LIST_ORDER_SQL, getModDeployScopeById } from '../../db/mods/modDeployment.js'
import { buildOccupiedFilesMessage, inspectFileOccupancy } from '../../utils/fileOccupancy.js'
import { reconcileDeploy } from './deployReconciler.js'
import { runModTask } from './taskScheduler.js'
import { STANDARD_METADATA_SCHEMA_VERSION } from './standard/constants.js'

const FICSIT_CACHE_ROOT = path.join(userPath, 'ficsit')
const FICSIT_DOWNLOAD_ROOT = path.join(FICSIT_CACHE_ROOT, 'downloads')
const FICSIT_STAGING_ROOT = path.join(FICSIT_CACHE_ROOT, 'staging')
const FICSIT_DOWNLOAD_BASE_URL = 'https://api.ficsit.app'
const FICSIT_GRAPHQL_ENDPOINT = 'https://api.ficsit.app/v2/query'
const FICSIT_REQUEST_TIMEOUT = 60000
const DEFAULT_DEPENDENCY_CONDITION = '>=0.0.0'
const FICSIT_DEFAULT_LOCKFILE_NAME = 'vertex-lock.json'
const FICSIT_LOCKFILE_VERSION = 1
const FICSIT_LOCKFILE_TARGET_NAME = 'Windows'
const MANDATORY_SML_REFERENCE = 'SML'
const MANDATORY_SML_REFERENCE_KEY = 'sml'
const MANDATORY_SML_MOD_ID = 'rpLvf1Q5igJXc6'
const FICSIT_EXECUTABLE_CANDIDATES = [
  'FactoryGameSteam.exe',
  'FactoryGameEGS.exe',
  'FactoryGame.exe'
]
const FICSIT_DOWNLOAD_RETRY_COUNT = 4
const FICSIT_DOWNLOAD_RETRY_DELAY = 2000
const FICSIT_DOWNLOAD_SPEED_SAMPLE_MS = 400
const FICSIT_DOWNLOAD_HTTPS_AGENT = new https.Agent({
  keepAlive: true
})
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT'
])
const RETRYABLE_NETWORK_MESSAGES = [
  'aborted',
  'socket hang up',
  'network error',
  'timeout',
  'timed out',
  'connection reset'
]
const RETRYABLE_FILE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

const GET_MOD_BY_REFERENCE_QUERY = `
  query GetModByReference($modReference: ModReference!) {
    getModByReference(modReference: $modReference) {
      id
      mod_reference
      name
      logo
      latestVersions {
        release {
          id
          version
          link
          stability
          dependencies {
            mod_reference
            condition
            optional
          }
        }
        beta {
          id
          version
          link
          stability
          dependencies {
            mod_reference
            condition
            optional
          }
        }
        alpha {
          id
          version
          link
          stability
          dependencies {
            mod_reference
            condition
            optional
          }
        }
      }
    }
  }
`

const RESOLVE_MOD_VERSIONS_QUERY = `
  query ResolveModVersions($filter: [ModVersionConstraint!]!) {
    resolveModVersions(filter: $filter) {
      mod_reference
      versions {
        id
        version
        link
        stability
        dependencies {
          mod_reference
          condition
          optional
        }
        mod {
          id
          mod_reference
          name
          logo
        }
      }
    }
  }
`

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function safeText(value) {
  return String(value || '').trim()
}

function getErrorStatusCode(error) {
  const code = Number(error?.response?.status || error?.status || 0)
  return Number.isFinite(code) ? code : 0
}

function getErrorCode(error) {
  return String(error?.code || '')
    .trim()
    .toUpperCase()
}

function isRetryableStatusCode(status) {
  const code = Number(status || 0)
  if (code <= 0) {
    return false
  }

  return code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
}

function isRetryableRequestError(error) {
  if (!error) {
    return false
  }

  if (isRetryableStatusCode(getErrorStatusCode(error))) {
    return true
  }

  const code = getErrorCode(error)
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true
  }

  if (isTlsHandshakeDisconnectError(error)) {
    return true
  }

  const message = String(error?.message || '')
    .trim()
    .toLowerCase()
  if (!message) {
    return false
  }

  return RETRYABLE_NETWORK_MESSAGES.some((keyword) => message.includes(keyword))
}

function isTlsHandshakeDisconnectError(error) {
  const message = String(error?.message || '')
    .trim()
    .toLowerCase()
  if (!message) {
    return false
  }

  return (
    message.includes(
      'client network socket disconnected before secure tls connection was established'
    ) ||
    (message.includes('secure tls connection') && message.includes('disconnected'))
  )
}

function resolveFicsitDownloadErrorMessage(error) {
  const errorCode = getErrorCode(error)
  const message = String(error?.message || '').trim() || '未知错误'
  const normalizedMessage = message.toLowerCase()

  if (
    errorCode === 'ECONNABORTED' ||
    normalizedMessage === 'aborted' ||
    normalizedMessage.includes('aborted')
  ) {
    return '下载连接被中断，已自动重试多次仍失败，请稍后重试或检查网络/代理'
  }

  if (isTlsHandshakeDisconnectError(error)) {
    return '与下载服务器建立安全连接失败，已自动重试多次仍未成功，请稍后重试或检查网络/代理'
  }

  return `下载模组文件失败：${message}`
}

function isRetryableFileAccessError(error) {
  return RETRYABLE_FILE_CODES.has(getErrorCode(error))
}

function isRetryableDownloadError(error) {
  return isRetryableRequestError(error) || isRetryableFileAccessError(error)
}

function waitForMs(delayMs = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(toSafeNumber(delayMs, 0), 0))
  })
}

async function runWithRetry(task, options = {}) {
  const retries = Math.max(toSafeNumber(options?.retries, 0), 0)
  const maxAttempts = retries + 1
  const baseDelayMs = Math.max(toSafeNumber(options?.baseDelayMs, 0), 0)
  const shouldRetry = typeof options?.shouldRetry === 'function' ? options.shouldRetry : () => false
  const onRetry = typeof options?.onRetry === 'function' ? options.onRetry : null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task({
        attempt,
        maxAttempts
      })
    } catch (error) {
      const canRetry = attempt < maxAttempts && shouldRetry(error)
      if (!canRetry) {
        throw error
      }

      const delayMs = baseDelayMs > 0 ? baseDelayMs * attempt : 0
      if (onRetry) {
        onRetry({
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          error
        })
      }

      if (delayMs > 0) {
        await waitForMs(delayMs)
      }
    }
  }

  throw new Error('下载重试失败')
}

function sanitizeName(value, fallback = 'ficsit-mod') {
  const text = safeText(value)
  const cleaned = text.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  return cleaned || fallback
}

function normalizePathForCompare(targetPath) {
  const text = safeText(targetPath)
  if (!text) {
    return ''
  }
  return path.resolve(text).toLowerCase()
}

function buildModDeployTargetPath(modsRootPath, modReference) {
  const root = safeText(modsRootPath)
  const reference = safeText(modReference)
  if (!root || !reference) {
    return ''
  }
  // 防止将模组标识当作相对路径片段写入到非预期目录
  if (
    reference.includes('/') ||
    reference.includes('\\') ||
    reference === '.' ||
    reference === '..'
  ) {
    return ''
  }
  return path.join(root, reference)
}

function makeFicsitJobId() {
  return `ficsit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function debugFicsit(_message, _payload = null) {
  // 按需求关闭 FicsitDebug 输出，保留调用点避免改动业务流程
  void _message
  void _payload
}

function emitFicsitProgress(event, payload = {}) {
  try {
    event?.sender?.send('ficsitInstallProgress', {
      stage: '',
      percent: 0,
      message: '',
      ...payload
    })
  } catch {
    // 忽略进度广播异常，避免影响主流程
  }
}

async function ensureFicsitDirs() {
  await fs.ensureDir(FICSIT_CACHE_ROOT)
  await fs.ensureDir(FICSIT_DOWNLOAD_ROOT)
  await fs.ensureDir(FICSIT_STAGING_ROOT)
}

function buildExecutableCandidates(executableFile) {
  const customExecutable = safeText(executableFile)
  if (!customExecutable) {
    return [...FICSIT_EXECUTABLE_CANDIDATES]
  }
  const set = new Set([customExecutable, ...FICSIT_EXECUTABLE_CANDIDATES])
  return Array.from(set)
}

function normalizeFicsitDownloadUrl(downloadUrl = '') {
  const text = safeText(downloadUrl)
  if (!text) {
    return ''
  }
  try {
    return new URL(text, FICSIT_DOWNLOAD_BASE_URL).toString()
  } catch {
    return ''
  }
}

function normalizeModReferenceKey(modReference) {
  return safeText(modReference).toLowerCase()
}

function normalizeDependencyCondition(condition) {
  return safeText(condition) || DEFAULT_DEPENDENCY_CONDITION
}

function isSmlReference(modReference) {
  return normalizeModReferenceKey(modReference) === MANDATORY_SML_REFERENCE_KEY
}

function resolveDependencyLookupIdentifier(modReference) {
  if (isSmlReference(modReference)) {
    return MANDATORY_SML_MOD_ID
  }
  return safeText(modReference)
}

function injectMandatorySmlDependency(rootVersionNode = {}) {
  const dependencies = normalizeDependencyList(rootVersionNode?.dependencies)
  if (isSmlReference(rootVersionNode?.modReference)) {
    debugFicsit('主模组本身为 SML，跳过强制注入', {
      modReference: safeText(rootVersionNode?.modReference),
      dependencies: dependencies.map((item) => ({
        modReference: safeText(item?.modReference),
        condition: safeText(item?.condition),
        optional: !!item?.optional
      }))
    })
    return {
      ...rootVersionNode,
      dependencies
    }
  }

  const nextDependencies = dependencies.map((item) => {
    if (!isSmlReference(item?.modReference)) {
      return item
    }
    return {
      modReference: safeText(item?.modReference) || MANDATORY_SML_REFERENCE,
      condition: normalizeDependencyCondition(item?.condition),
      optional: false
    }
  })

  const hasSmlDependency = nextDependencies.some((item) => isSmlReference(item?.modReference))
  if (!hasSmlDependency) {
    nextDependencies.push({
      modReference: MANDATORY_SML_REFERENCE,
      condition: DEFAULT_DEPENDENCY_CONDITION,
      optional: false
    })
  }

  debugFicsit('已处理强制 SML 依赖注入', {
    rootModReference: safeText(rootVersionNode?.modReference),
    injected: !hasSmlDependency,
    dependenciesBefore: dependencies.map((item) => ({
      modReference: safeText(item?.modReference),
      condition: safeText(item?.condition),
      optional: !!item?.optional
    })),
    dependenciesAfter: nextDependencies.map((item) => ({
      modReference: safeText(item?.modReference),
      condition: safeText(item?.condition),
      optional: !!item?.optional
    }))
  })

  return {
    ...rootVersionNode,
    dependencies: nextDependencies
  }
}

function clampPercent(value) {
  const percent = toSafeNumber(value, 0)
  return Math.max(Math.min(percent, 100), 0)
}

function toBatchPercent(itemPercent, currentIndex, totalCount) {
  const normalizedItemPercent = clampPercent(itemPercent)
  const safeIndex = Math.max(toSafeNumber(currentIndex, 1), 1)
  const safeTotal = Math.max(toSafeNumber(totalCount, 1), 1)

  if (safeTotal <= 1) {
    return normalizedItemPercent
  }

  const progress = (safeIndex - 1 + normalizedItemPercent / 100) / safeTotal
  return clampPercent(Math.floor(progress * 100))
}

function emitFicsitInstallProgress(event, payload = {}) {
  const currentIndex = Math.max(toSafeNumber(payload.currentIndex, 1), 1)
  const totalCount = Math.max(toSafeNumber(payload.totalCount, 1), 1)
  const itemPercent = clampPercent(payload.percent)
  const percent = toBatchPercent(itemPercent, currentIndex, totalCount)

  emitFicsitProgress(event, {
    ...payload,
    currentIndex,
    totalCount,
    itemPercent,
    percent
  })
}

function resolveGraphQLErrorMessage(payload = {}, fallback = 'Ficsit 接口请求失败') {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const message = safeText(errors?.[0]?.message)
  if (message) {
    return message
  }
  return fallback
}

async function requestFicsitGraphQL(query, variables = {}) {
  const response = await axios.post(
    FICSIT_GRAPHQL_ENDPOINT,
    {
      query,
      variables
    },
    {
      timeout: FICSIT_REQUEST_TIMEOUT,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )

  const payload = response?.data && typeof response.data === 'object' ? response.data : {}
  if (Number(response?.status) !== 200) {
    throw new Error(
      resolveGraphQLErrorMessage(payload, `Ficsit 接口请求失败，HTTP 状态码：${response?.status}`)
    )
  }

  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(resolveGraphQLErrorMessage(payload))
  }

  return payload?.data && typeof payload.data === 'object' ? payload.data : {}
}

function normalizeDependencyList(list = []) {
  const safeList = Array.isArray(list) ? list : []
  return safeList
    .map((item) => {
      const modReference = safeText(item?.mod_reference || item?.modReference)
      if (!modReference) {
        return null
      }
      return {
        modReference,
        condition: normalizeDependencyCondition(item?.condition),
        optional: !!item?.optional
      }
    })
    .filter(Boolean)
}

function normalizeResolvedVersionNodeFromLatest(
  modData = {},
  versionNode = {},
  fallbackStability = ''
) {
  const modReference = safeText(modData?.mod_reference)
  const downloadUrl = normalizeFicsitDownloadUrl(versionNode?.link)
  if (!modReference || !downloadUrl) {
    return null
  }

  return {
    modId: toSafeNumber(modData?.id, 0),
    modReference,
    name: safeText(modData?.name) || modReference,
    logo: safeText(modData?.logo),
    versionId: safeText(versionNode?.id),
    version: safeText(versionNode?.version),
    stability: safeText(versionNode?.stability || fallbackStability),
    downloadUrl,
    dependencies: normalizeDependencyList(versionNode?.dependencies)
  }
}

function normalizeResolvedVersionNodeFromResolver(versionNode = {}) {
  const mod = versionNode?.mod && typeof versionNode.mod === 'object' ? versionNode.mod : {}
  const modReference = safeText(mod?.mod_reference)
  const downloadUrl = normalizeFicsitDownloadUrl(versionNode?.link)

  if (!modReference || !downloadUrl) {
    return null
  }

  return {
    modId: toSafeNumber(mod?.id, 0),
    modReference,
    name: safeText(mod?.name) || modReference,
    logo: safeText(mod?.logo),
    versionId: safeText(versionNode?.id),
    version: safeText(versionNode?.version),
    stability: safeText(versionNode?.stability),
    downloadUrl,
    dependencies: normalizeDependencyList(versionNode?.dependencies)
  }
}

function splitVersionIdentifier(identifier) {
  const text = safeText(identifier)
  if (!text) {
    return { raw: '', isNumber: false, numberValue: 0 }
  }

  if (/^\d+$/.test(text)) {
    return {
      raw: text,
      isNumber: true,
      numberValue: Number.parseInt(text, 10)
    }
  }

  return {
    raw: text.toLowerCase(),
    isNumber: false,
    numberValue: 0
  }
}

function parseVersionText(versionText) {
  const raw = safeText(versionText)
  const [rawCore = '', rawMeta = ''] = raw.split('+', 2)
  const [rawMain = '', rawPre = ''] = rawCore.split('-', 2)

  const main = rawMain
    .split('.')
    .filter((item) => safeText(item))
    .map((item) => splitVersionIdentifier(item))

  const pre = rawPre
    .split('.')
    .filter((item) => safeText(item))
    .map((item) => splitVersionIdentifier(item))

  return {
    main,
    pre,
    rawMeta: safeText(rawMeta)
  }
}

function compareVersionIdentifiers(left, right) {
  if (left.isNumber && right.isNumber) {
    if (left.numberValue === right.numberValue) return 0
    return left.numberValue > right.numberValue ? 1 : -1
  }

  if (left.isNumber !== right.isNumber) {
    return left.isNumber ? -1 : 1
  }

  if (left.raw === right.raw) return 0
  return left.raw > right.raw ? 1 : -1
}

function compareVersionStrings(leftVersion, rightVersion) {
  const left = parseVersionText(leftVersion)
  const right = parseVersionText(rightVersion)

  const maxMainLength = Math.max(left.main.length, right.main.length)
  for (let index = 0; index < maxMainLength; index += 1) {
    const leftPart = left.main[index] || splitVersionIdentifier('0')
    const rightPart = right.main[index] || splitVersionIdentifier('0')
    const result = compareVersionIdentifiers(leftPart, rightPart)
    if (result !== 0) {
      return result
    }
  }

  const hasLeftPre = left.pre.length > 0
  const hasRightPre = right.pre.length > 0
  if (hasLeftPre !== hasRightPre) {
    return hasLeftPre ? -1 : 1
  }

  const maxPreLength = Math.max(left.pre.length, right.pre.length)
  for (let index = 0; index < maxPreLength; index += 1) {
    const leftPart = left.pre[index]
    const rightPart = right.pre[index]

    if (!leftPart && !rightPart) return 0
    if (!leftPart) return -1
    if (!rightPart) return 1

    const result = compareVersionIdentifiers(leftPart, rightPart)
    if (result !== 0) {
      return result
    }
  }

  return 0
}

function resolveStabilityWeight(stability) {
  const text = safeText(stability).toLowerCase()
  if (text === 'release') return 3
  if (text === 'beta') return 2
  if (text === 'alpha') return 1
  return 0
}

function pickBestResolvedVersion(versions = []) {
  const safeVersions = (Array.isArray(versions) ? versions : []).filter(Boolean)
  if (!safeVersions.length) {
    return null
  }

  const sorted = [...safeVersions].sort((left, right) => {
    const compareVersion = compareVersionStrings(left?.version, right?.version)
    if (compareVersion !== 0) {
      return compareVersion > 0 ? -1 : 1
    }

    const leftStability = resolveStabilityWeight(left?.stability)
    const rightStability = resolveStabilityWeight(right?.stability)
    if (leftStability === rightStability) {
      return 0
    }

    return leftStability > rightStability ? -1 : 1
  })

  return sorted[0]
}

function makeResolvedVersionKey(item = {}) {
  const versionId = safeText(item?.versionId)
  if (versionId) {
    return versionId
  }
  return `${normalizeModReferenceKey(item?.modReference)}|${safeText(item?.version)}|${safeText(item?.downloadUrl)}`
}

function addConstraintEntry(constraintMap, modReference, condition) {
  const normalizedReference = safeText(modReference)
  if (!normalizedReference) {
    return false
  }

  const key = normalizeModReferenceKey(normalizedReference)
  const normalizedCondition = normalizeDependencyCondition(condition)

  if (!constraintMap.has(key)) {
    constraintMap.set(key, {
      modReference: normalizedReference,
      conditions: new Set([normalizedCondition])
    })
    return true
  }

  const entry = constraintMap.get(key)
  const previousSize = entry.conditions.size
  entry.conditions.add(normalizedCondition)
  return entry.conditions.size !== previousSize
}

function getFicsitInstallRecord(appId, modReference) {
  const game = getGameDataByAppId(appId, { source: 'ficsit', appId })
  if (!game?.id) return null
  const sql = `SELECT *
               FROM mods
               WHERE game_id = ?
                 AND source = 'ficsit'
                 AND source_mod_key = ?`
  return dbInstance.get(sql, [toSafeNumber(game.id, 0), safeText(modReference)])
}

function getFicsitInstallRecordById(id) {
  const sql = `SELECT *
               FROM mods
               WHERE id = ?`
  return dbInstance.get(sql, [toSafeNumber(id, 0)])
}

function listFicsitInstallRecords(appId, profileName = '') {
  const game = getGameDataByAppId(appId, { source: 'ficsit', appId })
  if (!game?.id) return []
  const safeProfileName = safeText(profileName)
  const profileClause = safeProfileName
    ? `AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?`
    : ''
  const sql = `SELECT *
               FROM mods
               WHERE game_id = ?
                 AND source = 'ficsit'
                 ${profileClause}
               ORDER BY ${MOD_LIST_ORDER_SQL}`
  return (
    dbInstance.all(sql, [
      toSafeNumber(game.id, 0),
      ...(safeProfileName ? [safeProfileName.toLowerCase()] : [])
    ]) || []
  )
}

function getFicsitRecordModReference(record = {}) {
  return safeText(record?.source_mod_key || record?.mod_reference || record?.modReference)
}

function getFicsitRecordInstallState(record = {}) {
  return toSafeNumber(record?.install_state ?? record?.installState, 0)
}

function normalizeFicsitRecordDependency(item = {}) {
  if (typeof item === 'string') {
    const modReference = safeText(item)
    return modReference
      ? {
          source: 'ficsit',
          sourceModKey: modReference,
          modReference,
          dependencyRole: 'ficsit_requirement',
          condition: '',
          optional: false,
          name: modReference,
          version: ''
        }
      : null
  }

  const source = item && typeof item === 'object' ? item : {}
  const modReference = safeText(
    source.modReference || source.mod_reference || source.sourceModKey || source.source_mod_key
  )
  if (!modReference) {
    return null
  }

  return {
    source: safeText(source.source || 'ficsit') || 'ficsit',
    sourceModKey: safeText(source.sourceModKey || source.source_mod_key || modReference),
    modReference,
    dependencyRole: safeText(
      source.dependencyRole || source.dependency_role || 'ficsit_requirement'
    ),
    condition: safeText(source.condition || source.requiredVersion || source.required_version),
    optional: source.optional === true,
    name: safeText(source.name || source.modName || modReference),
    version: safeText(source.version)
  }
}

function normalizeFicsitRecordDependencyList(value = []) {
  const result = []
  const seen = new Set()

  for (const item of parseStringArrayJson(value)) {
    const dependency = normalizeFicsitRecordDependency(item)
    if (!dependency) {
      continue
    }

    const key = `${safeText(dependency.sourceModKey || dependency.modReference).toLowerCase()}|${safeText(dependency.condition).toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(dependency)
  }

  return result
}

function doesFicsitDependencyMatchRecord(dependency = {}, record = {}) {
  const dependencyKey = safeText(
    dependency.sourceModKey ||
      dependency.source_mod_key ||
      dependency.modReference ||
      dependency.mod_reference
  ).toLowerCase()
  const recordKey = getFicsitRecordModReference(record).toLowerCase()
  if (dependencyKey && recordKey && dependencyKey === recordKey) {
    return true
  }

  const dependencyModId = safeText(dependency.modId || dependency.mod_id)
  const recordModId = safeText(record.mod_id || record.modId)
  return !!dependencyModId && !!recordModId && dependencyModId === recordModId
}

function findFicsitDependentRecords(record = {}, options = {}) {
  const appId = toSafeNumber(record?.app_id || record?.appId || record?.game_app_id, 0)
  const recordId = toSafeNumber(record?.id, 0)
  if (!appId || !recordId) {
    return []
  }
  const profileName = safeText(options?.profileName || record?.profile_name || record?.profileName)

  return listFicsitInstallRecords(appId, profileName).filter((item) => {
    if (toSafeNumber(item?.id, 0) === recordId) {
      return false
    }
    if (options?.enabledOnly === true && getFicsitRecordInstallState(item) !== 1) {
      return false
    }
    const dependencies = normalizeFicsitRecordDependencyList(
      item?.dependencies_json || item?.dependencies
    )
    return dependencies.some((dependency) => doesFicsitDependencyMatchRecord(dependency, record))
  })
}

function formatFicsitDependentRecordNames(records = [], limit = 3) {
  const names = (Array.isArray(records) ? records : [])
    .map((item) => safeText(item?.name || getFicsitRecordModReference(item)))
    .filter(Boolean)
  if (names.length <= limit) {
    return names.join('、')
  }
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 个模组`
}

async function ensureSmlEnabledWhenOtherModsEnabled(appId) {
  const safeAppId = toSafeNumber(appId, 0)
  if (!safeAppId) {
    return {
      changed: false
    }
  }

  const allRecords = listFicsitInstallRecords(safeAppId)
  const hasEnabledOtherMods = allRecords.some(
    (item) =>
      !isSmlReference(getFicsitRecordModReference(item)) && getFicsitRecordInstallState(item) === 1
  )

  if (!hasEnabledOtherMods) {
    return {
      changed: false
    }
  }

  const smlRecordRaw = allRecords.find((item) => isSmlReference(getFicsitRecordModReference(item)))
  if (!smlRecordRaw) {
    throw new Error('存在已启用模组时必须启用 SML，但未找到 SML 记录，请先安装 SML')
  }

  const smlRecord = normalizeFicsitRecord(smlRecordRaw)
  if (toSafeNumber(smlRecord?.installState, 0) === 1) {
    return {
      changed: false,
      record: smlRecord
    }
  }

  if (!smlRecord.stagingPath || !smlRecord.targetPath) {
    throw new Error('SML 缺少部署路径，请重新安装 SML')
  }

  if (!(await fs.pathExists(smlRecord.stagingPath))) {
    throw new Error('SML 暂存目录不存在，请重新安装 SML')
  }

  updateFicsitInstallState(smlRecord.id, true)
  const reconcileResult = await reconcileDeploy({
    mode: 'ficsit_auto_enable_rebuild',
    modId: smlRecord.id,
    reason: 'ficsit_auto_enable_sml'
  })
  if (!reconcileResult?.success) {
    throw new Error(reconcileResult?.message || 'SML 安全部署重建失败')
  }

  const latest = normalizeFicsitRecord(getFicsitInstallRecordById(smlRecord.id))
  debugFicsit('检测到其他模组已启用，自动启用 SML', {
    appId: safeAppId,
    smlId: toSafeNumber(latest?.id, 0),
    modReference: safeText(latest?.modReference)
  })

  return {
    changed: true,
    record: latest
  }
}

function upsertFicsitInstallRecord(payload = {}) {
  const now = formatChinaTime()
  insertMod({
    appid: toSafeNumber(payload.app_id, 0),
    sourceMeta: {
      source: 'ficsit',
      appId: toSafeNumber(payload.app_id, 0),
      sourceId: toSafeNumber(payload.app_id, 0)
    },
    source: 'ficsit',
    modId: safeText(payload.mod_id),
    source_mod_key: safeText(payload.mod_reference),
    modName: safeText(payload.name),
    name: safeText(payload.name),
    description: safeText(
      payload.description || payload.short_description || payload.shortDescription
    ),
    version: safeText(payload.version),
    downloadUrl: safeText(payload.download_url),
    cover: safeText(payload.logo),
    dependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
    files: Array.isArray(payload.files) ? payload.files : [],
    metadata: {
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
      logo: safeText(payload.logo),
      modReference: safeText(payload.mod_reference),
      versionId: safeText(payload.version_id),
      stability: safeText(payload.stability),
      downloadUrl: safeText(payload.download_url)
    },
    stagingPath: safeText(payload.staging_path),
    targetPath: safeText(payload.target_path),
    archivePath: safeText(payload.archive_path),
    installState: toSafeNumber(payload.install_state, 1),
    install_state: toSafeNumber(payload.install_state, 1),
    installedAt: safeText(payload.installed_at || now),
    updatedAt: safeText(payload.updated_at || now),
    endpoint_type: 0
  })

  return getFicsitInstallRecord(payload.app_id, payload.mod_reference)
}

function updateFicsitInstallState(id, enabled) {
  const sql = `UPDATE mods
               SET install_state = ?,
                   is_active = ?
               WHERE id = ?`
  dbInstance.run(sql, [enabled ? 1 : 0, enabled ? 1 : 0, toSafeNumber(id, 0)])
}

function removeFicsitInstallRecord(id) {
  const sql = `DELETE
               FROM mods
               WHERE id = ?`
  dbInstance.run(sql, [toSafeNumber(id, 0)])
}

function normalizeFicsitRecord(record = {}) {
  const metadata = parseJsonObject(record.metadata_json || record.metadata)
  const dependencies = normalizeFicsitRecordDependencyList(
    record.dependencies_json || record.dependencies
  )
  return {
    id: toSafeNumber(record.id, 0),
    appId: toSafeNumber(record.app_id || record.game_app_id, 0),
    modId: toSafeNumber(record.mod_id, 0),
    modReference: safeText(record.source_mod_key || record.mod_reference),
    name: safeText(record.name),
    version: safeText(record.version),
    downloadUrl: safeText(record.download_url),
    logo: safeText(record.cover || record.logo),
    stagingPath: safeText(record.staging_path),
    sourceRootPath: safeText(record.source_root_path),
    targetPath: safeText(record.target_path),
    files: parseStringArrayJson(record.files_json),
    installPaths: parseStringArrayJson(record.install_paths_json),
    archivePath: safeText(record.archive_path),
    installState: toSafeNumber(record.install_state, 1),
    priorityOrder: toSafeNumber(record.priority_order, 0),
    deployDomain: safeText(record.deploy_domain),
    installModel: safeText(record.install_model || 'legacy'),
    compatFlags: safeText(record.compat_flags || '[]'),
    lastReconcileAt: safeText(record.last_reconcile_at),
    profileName: safeText(record.profile_name || 'default'),
    dependencies,
    metadata,
    source: safeText(record.source || metadata.source || 'ficsit') || 'ficsit',
    sourceAdapter: safeText(metadata.sourceAdapter || metadata.source_adapter || 'ficsit'),
    ruleId: safeText(
      metadata?.installRulePlan?.ruleId ||
        metadata?.sourceInstallPlan?.ruleId ||
        metadata?.ficsitInstallPlan?.ruleId
    ),
    strategy: safeText(
      metadata?.installRulePlan?.strategy ||
        metadata?.sourceInstallPlan?.strategy ||
        metadata?.ficsitInstallPlan?.strategy
    ),
    fileCount: (() => {
      try {
        return Array.isArray(JSON.parse(String(record.files_json || '[]')))
          ? JSON.parse(String(record.files_json || '[]')).length
          : 0
      } catch {
        return toSafeNumber(record.file_count, 0)
      }
    })(),
    installedAt: safeText(record.installed_at),
    updatedAt: safeText(record.updated_at)
  }
}

function parseStringArrayJson(value = []) {
  if (Array.isArray(value)) {
    return value
  }

  const text = safeText(value)
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  const text = safeText(value)
  if (!text) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function resolveFicsitRecordFilePaths(record = {}) {
  const targetPath = safeText(record?.target_path || record?.targetPath)
  const modReference = safeText(record?.mod_reference || record?.modReference)
  const targetRoot = targetPath ? path.resolve(targetPath) : ''
  const relativeFiles = parseStringArrayJson(record?.files_json || record?.files)
  const result = []

  for (const item of relativeFiles) {
    const text = safeText(item)
    if (!text) {
      continue
    }

    const absolutePath = path.isAbsolute(text)
      ? path.resolve(text)
      : targetRoot
        ? path.resolve(path.join(targetRoot, text))
        : ''
    if (!absolutePath) {
      continue
    }

    result.push(absolutePath)
  }

  const modsRoot = resolveModsRootFromTargetPath(targetPath, modReference)
  if (modsRoot) {
    result.push(path.join(modsRoot, FICSIT_DEFAULT_LOCKFILE_NAME))
  }

  return result
}

function inspectFicsitRecordsOccupancy(records = []) {
  const safeRecords = Array.isArray(records) ? records.filter(Boolean) : []
  const filePaths = []

  for (const record of safeRecords) {
    filePaths.push(...resolveFicsitRecordFilePaths(record))
  }

  const inspectResult = inspectFileOccupancy(filePaths)
  return {
    ...inspectResult,
    success: !inspectResult.hasOccupiedFiles,
    message: inspectResult.hasOccupiedFiles
      ? buildOccupiedFilesMessage(inspectResult.occupiedFiles)
      : ''
  }
}

function resolveFactoryGameRoot(gameRecord = {}) {
  const rootPath = safeText(gameRecord.client_root_path)
  const exePath = safeText(gameRecord.client_exe_path)

  const candidates = []
  if (rootPath) {
    candidates.push(path.join(rootPath, 'FactoryGame'))
    candidates.push(rootPath)
  }

  if (exePath) {
    let current = path.dirname(exePath)
    const parsedRoot = path.parse(current).root
    while (current && current !== parsedRoot) {
      candidates.push(current)
      if (path.basename(current).toLowerCase() === 'factorygame') {
        break
      }
      current = path.dirname(current)
    }
  }

  for (const item of candidates) {
    if (!item) continue
    const normalized = path.resolve(item)
    if (!fs.existsSync(normalized)) continue
    if (path.basename(normalized).toLowerCase() === 'factorygame') {
      return normalized
    }
    const nested = path.join(normalized, 'FactoryGame')
    if (fs.existsSync(nested)) {
      return nested
    }
  }

  return ''
}

async function resolveFicsitTargetPath(gameRecord = {}) {
  const factoryGameRoot = resolveFactoryGameRoot(gameRecord)
  if (!factoryGameRoot) {
    return ''
  }
  const modsRoot = path.join(factoryGameRoot, 'Mods')
  await fs.ensureDir(modsRoot)
  return modsRoot
}

function resolveModsRootFromTargetPath(targetPath, modReference = '') {
  const target = safeText(targetPath)
  if (!target) {
    return ''
  }

  const resolvedTarget = path.resolve(target)
  const modsMatch = resolvedTarget.match(/^(.*?[\\/]mods)(?:[\\/].*)?$/i)
  if (modsMatch?.[1]) {
    return path.resolve(modsMatch[1])
  }

  const baseName = safeText(path.basename(resolvedTarget))
  if (baseName.toLowerCase() === 'mods') {
    return resolvedTarget
  }

  if (normalizeModReferenceKey(baseName) === normalizeModReferenceKey(modReference)) {
    return path.dirname(resolvedTarget)
  }

  return path.dirname(resolvedTarget)
}

function resolvePreferredModsRootFromRecords(records = [], fallbackTargetPath = '') {
  const fallbackRoot = resolveModsRootFromTargetPath(fallbackTargetPath)
  if (fallbackRoot) {
    return fallbackRoot
  }

  const safeRecords = Array.isArray(records) ? records : []
  for (const record of safeRecords) {
    const root = resolveModsRootFromTargetPath(
      safeText(record?.target_path || record?.targetPath),
      safeText(record?.mod_reference || record?.modReference)
    )
    if (root) {
      return root
    }
  }

  return ''
}

function buildFicsitDefaultLockfile(records = []) {
  const safeRecords = Array.isArray(records) ? records : []
  const enabledRecords = safeRecords
    .filter((record) => toSafeNumber(record?.install_state ?? record?.installState, 0) === 1)
    .filter((record) => safeText(record?.mod_reference || record?.modReference))
    .sort((left, right) =>
      normalizeModReferenceKey(left?.mod_reference || left?.modReference).localeCompare(
        normalizeModReferenceKey(right?.mod_reference || right?.modReference)
      )
    )

  const mods = {}
  for (const record of enabledRecords) {
    const modReference = safeText(record?.mod_reference || record?.modReference)
    const version = safeText(record?.version)
    const link = safeText(record?.download_url || record?.downloadUrl)

    mods[modReference] = {
      dependencies: {},
      targets: {
        [FICSIT_LOCKFILE_TARGET_NAME]: {
          hash: '',
          link
        }
      },
      version
    }
  }

  return {
    mods,
    version: FICSIT_LOCKFILE_VERSION
  }
}

async function writeFicsitDefaultLockFileByAppId(appId, fallbackTargetPath = '') {
  const safeAppId = toSafeNumber(appId, 0)
  if (!safeAppId) {
    return ''
  }

  const records = listFicsitInstallRecords(safeAppId)
  const modsRoot = resolvePreferredModsRootFromRecords(records, fallbackTargetPath)
  if (!modsRoot) {
    throw new Error('未识别到 Mods 目录，无法写入 default-lock.json')
  }

  await fs.ensureDir(modsRoot)
  const lockfilePath = path.join(modsRoot, FICSIT_DEFAULT_LOCKFILE_NAME)
  const payload = buildFicsitDefaultLockfile(records)
  await fs.writeJson(lockfilePath, payload, { spaces: 2 })

  debugFicsit('已写入 default-lock.json', {
    appId: safeAppId,
    lockfilePath,
    enabledMods: Object.keys(payload?.mods || {})
  })

  return lockfilePath
}

async function resolveGameRecordByExecutable(appId, gameId, executableFile, sourceMeta = {}) {
  const candidates = buildExecutableCandidates(executableFile)
  for (const candidate of candidates) {
    const gameRecord = await getGameByAppId(String(appId), candidate, gameId, sourceMeta)
    if (!gameRecord) continue
    return {
      executableFile: candidate,
      gameRecord
    }
  }
  return {
    executableFile: '',
    gameRecord: null
  }
}

async function fetchRootResolvedVersion(payload = {}) {
  const modReference = safeText(payload.modReference)
  const expectedVersion = safeText(payload.expectedVersion)
  const expectedDownloadUrl = normalizeFicsitDownloadUrl(payload.expectedDownloadUrl)

  if (!modReference) {
    throw new Error('缺少模组标识，无法解析依赖')
  }

  const responseData = await requestFicsitGraphQL(GET_MOD_BY_REFERENCE_QUERY, {
    modReference
  })

  const modData = responseData?.getModByReference
  if (!modData || typeof modData !== 'object') {
    throw new Error(`未找到模组：${modReference}`)
  }

  const latest =
    modData?.latestVersions && typeof modData.latestVersions === 'object'
      ? modData.latestVersions
      : {}
  const candidates = [
    normalizeResolvedVersionNodeFromLatest(modData, latest.release, 'release'),
    normalizeResolvedVersionNodeFromLatest(modData, latest.beta, 'beta'),
    normalizeResolvedVersionNodeFromLatest(modData, latest.alpha, 'alpha')
  ].filter(Boolean)

  if (!candidates.length) {
    throw new Error(`模组 ${modReference} 暂无可安装版本`)
  }

  let selected = null

  if (expectedDownloadUrl) {
    selected = candidates.find(
      (item) => normalizeFicsitDownloadUrl(item.downloadUrl) === expectedDownloadUrl
    )
  }

  if (!selected && expectedVersion) {
    selected = candidates.find((item) => safeText(item.version) === expectedVersion)
  }

  if (!selected && expectedVersion) {
    const resolvedVersions = await fetchResolvedVersionsByCondition(
      modReference,
      expectedVersion,
      new Map()
    )
    selected =
      resolvedVersions.find((item) => safeText(item.version) === expectedVersion) ||
      pickBestResolvedVersion(resolvedVersions)
  }

  if (!selected) {
    selected = candidates[0]
  }

  if (!selected) {
    throw new Error(`无法确定模组 ${modReference} 的安装版本`)
  }

  selected.modId = toSafeNumber(selected.modId, toSafeNumber(payload.modId, 0))
  selected.name = safeText(selected.name || payload.name || modReference)
  selected.logo = safeText(selected.logo || payload.logo)

  // 主模组依赖以 resolveModVersions 的精确版本结果为准，避免 latestVersions 依赖缺失
  selected = await hydrateRootVersionDependencies(selected)

  return selected
}

async function hydrateRootVersionDependencies(rootNode = {}) {
  const modReference = safeText(rootNode?.modReference)
  const version = safeText(rootNode?.version)
  if (!modReference || !version) {
    return rootNode
  }

  let versions = []
  try {
    const preferredLookupIdentifier = resolveDependencyLookupIdentifier(modReference)
    versions = await fetchResolvedVersionsByCondition(
      modReference,
      version,
      new Map(),
      preferredLookupIdentifier
    )
    if (!versions.length && preferredLookupIdentifier !== modReference) {
      versions = await fetchResolvedVersionsByCondition(
        modReference,
        version,
        new Map(),
        modReference
      )
    }
  } catch {
    return rootNode
  }

  if (!Array.isArray(versions) || !versions.length) {
    return rootNode
  }

  const normalizedRootDownloadUrl = normalizeFicsitDownloadUrl(rootNode?.downloadUrl)
  const exactVersionMatch = versions.find(
    (item) =>
      safeText(item?.version) === version &&
      (!normalizedRootDownloadUrl ||
        normalizeFicsitDownloadUrl(item?.downloadUrl) === normalizedRootDownloadUrl)
  )
  const selected = exactVersionMatch || pickBestResolvedVersion(versions) || rootNode

  return {
    ...selected,
    modId: toSafeNumber(selected?.modId, toSafeNumber(rootNode?.modId, 0)),
    modReference: safeText(selected?.modReference || rootNode?.modReference),
    name: safeText(selected?.name || rootNode?.name),
    logo: safeText(selected?.logo || rootNode?.logo),
    versionId: safeText(selected?.versionId || rootNode?.versionId),
    version: safeText(selected?.version || rootNode?.version),
    stability: safeText(selected?.stability || rootNode?.stability),
    downloadUrl: normalizeFicsitDownloadUrl(selected?.downloadUrl || rootNode?.downloadUrl),
    dependencies: normalizeDependencyList(selected?.dependencies || rootNode?.dependencies)
  }
}

async function fetchResolvedVersionsByCondition(
  modReference,
  condition,
  cacheMap,
  lookupIdentifier = ''
) {
  const normalizedReference = safeText(modReference)
  const normalizedLookupIdentifier = safeText(lookupIdentifier || normalizedReference)
  const normalizedCondition = normalizeDependencyCondition(condition)
  const cacheKey = `${normalizeModReferenceKey(normalizedReference)}|${normalizeModReferenceKey(normalizedLookupIdentifier)}|${normalizedCondition}`

  if (cacheMap.has(cacheKey)) {
    debugFicsit('命中依赖版本缓存', {
      modReference: normalizedReference,
      lookupIdentifier: normalizedLookupIdentifier,
      condition: normalizedCondition
    })
    return cacheMap.get(cacheKey)
  }

  debugFicsit('开始查询依赖版本', {
    modReference: normalizedReference,
    lookupIdentifier: normalizedLookupIdentifier,
    condition: normalizedCondition
  })

  const responseData = await requestFicsitGraphQL(RESOLVE_MOD_VERSIONS_QUERY, {
    filter: [
      {
        modIdOrReference: normalizedLookupIdentifier,
        version: normalizedCondition
      }
    ]
  })

  const allItems = Array.isArray(responseData?.resolveModVersions)
    ? responseData.resolveModVersions
    : []
  const matchedItem =
    allItems.find(
      (item) =>
        normalizeModReferenceKey(item?.mod_reference) ===
        normalizeModReferenceKey(normalizedReference)
    ) || allItems[0]

  const versions = (Array.isArray(matchedItem?.versions) ? matchedItem.versions : [])
    .map((item) => normalizeResolvedVersionNodeFromResolver(item))
    .filter(Boolean)

  debugFicsit('依赖版本查询完成', {
    modReference: normalizedReference,
    lookupIdentifier: normalizedLookupIdentifier,
    condition: normalizedCondition,
    versionCount: versions.length,
    matchedReference: safeText(matchedItem?.mod_reference),
    versions: versions.slice(0, 5).map((item) => ({
      modReference: safeText(item?.modReference),
      version: safeText(item?.version),
      downloadUrl: safeText(item?.downloadUrl)
    }))
  })

  cacheMap.set(cacheKey, versions)
  return versions
}

async function resolveVersionByConstraints(modReference, conditions = [], cacheMap = new Map()) {
  const normalizedReference = safeText(modReference)
  if (!normalizedReference) {
    throw new Error('缺少依赖模组标识')
  }

  const constraintList = Array.from(
    new Set(
      (Array.isArray(conditions) ? conditions : [])
        .map((item) => normalizeDependencyCondition(item))
        .filter(Boolean)
    )
  )

  if (!constraintList.length) {
    constraintList.push(DEFAULT_DEPENDENCY_CONDITION)
  }

  let candidateMap = null

  for (const condition of constraintList) {
    const preferredLookupIdentifier = resolveDependencyLookupIdentifier(normalizedReference)
    let versions = await fetchResolvedVersionsByCondition(
      normalizedReference,
      condition,
      cacheMap,
      preferredLookupIdentifier
    )
    if (!versions.length && preferredLookupIdentifier !== normalizedReference) {
      versions = await fetchResolvedVersionsByCondition(
        normalizedReference,
        condition,
        cacheMap,
        normalizedReference
      )
    }
    if (!versions.length) {
      throw new Error(`依赖 ${normalizedReference} 不满足版本约束：${condition}`)
    }

    const currentMap = new Map()
    for (const versionNode of versions) {
      currentMap.set(makeResolvedVersionKey(versionNode), versionNode)
    }

    if (!candidateMap) {
      candidateMap = currentMap
      continue
    }

    const intersectionMap = new Map()
    for (const [key, value] of candidateMap.entries()) {
      if (currentMap.has(key)) {
        intersectionMap.set(key, value)
      }
    }

    candidateMap = intersectionMap
  }

  const candidates = candidateMap ? Array.from(candidateMap.values()) : []
  if (!candidates.length) {
    throw new Error(`依赖 ${normalizedReference} 的版本约束冲突：${constraintList.join(' , ')}`)
  }

  const selected = pickBestResolvedVersion(candidates)
  if (!selected) {
    throw new Error(`依赖 ${normalizedReference} 无可用安装版本`)
  }

  return selected
}

function buildTopologicalInstallOrder(selectedMap, rootKey) {
  const visited = new Set()
  const visiting = new Set()
  const order = []

  const visitNode = (key) => {
    if (visited.has(key)) {
      return
    }

    if (visiting.has(key)) {
      throw new Error(`检测到依赖循环：${key}`)
    }

    visiting.add(key)
    const node = selectedMap.get(key)
    if (node) {
      const dependencies = normalizeDependencyList(node.dependencies)
      for (const dependency of dependencies) {
        if (dependency.optional) continue
        const dependencyKey = normalizeModReferenceKey(dependency.modReference)
        if (!dependencyKey || dependencyKey === key) continue
        if (selectedMap.has(dependencyKey)) {
          visitNode(dependencyKey)
        }
      }
      order.push(key)
    }

    visiting.delete(key)
    visited.add(key)
  }

  if (selectedMap.has(rootKey)) {
    visitNode(rootKey)
  }

  for (const key of selectedMap.keys()) {
    visitNode(key)
  }

  const rootIndex = order.indexOf(rootKey)
  if (rootIndex >= 0 && rootIndex !== order.length - 1) {
    order.splice(rootIndex, 1)
    order.push(rootKey)
  }

  return order.map((key) => selectedMap.get(key)).filter(Boolean)
}

async function buildInstallPlanFromRoot(rootVersionNode) {
  const rootKey = normalizeModReferenceKey(rootVersionNode?.modReference)
  if (!rootKey) {
    throw new Error('主模组信息无效，无法解析依赖')
  }

  const selectedMap = new Map([[rootKey, rootVersionNode]])
  const constraintMap = new Map()
  const resolveCache = new Map()

  const rootDependencies = normalizeDependencyList(rootVersionNode?.dependencies)
  for (const dependency of rootDependencies) {
    if (dependency.optional) continue
    addConstraintEntry(constraintMap, dependency.modReference, dependency.condition)
  }

  for (let round = 0; round < 50; round += 1) {
    let changed = false

    const entries = Array.from(constraintMap.entries())
    for (const [constraintKey, entry] of entries) {
      if (constraintKey === rootKey) {
        continue
      }

      const selectedVersion = await resolveVersionByConstraints(
        entry.modReference,
        Array.from(entry.conditions),
        resolveCache
      )

      const previousVersion = selectedMap.get(constraintKey)
      if (
        !previousVersion ||
        makeResolvedVersionKey(previousVersion) !== makeResolvedVersionKey(selectedVersion)
      ) {
        selectedMap.set(constraintKey, selectedVersion)
        changed = true
      }

      const selectedDependencies = normalizeDependencyList(selectedVersion.dependencies)
      for (const dependency of selectedDependencies) {
        if (dependency.optional) continue
        if (addConstraintEntry(constraintMap, dependency.modReference, dependency.condition)) {
          changed = true
        }
      }
    }

    if (!changed) {
      break
    }

    if (round >= 49) {
      throw new Error('依赖解析超出最大轮次，请稍后重试')
    }
  }

  const installOrder = buildTopologicalInstallOrder(selectedMap, rootKey)
  return {
    rootKey,
    installOrder
  }
}

function resolveArchiveExtension(downloadUrl = '') {
  const normalizedUrl = normalizeFicsitDownloadUrl(downloadUrl)
  if (!normalizedUrl) {
    return '.zip'
  }
  try {
    const url = new URL(normalizedUrl)
    const ext = path.extname(url.pathname || '').toLowerCase()
    return ext || '.zip'
  } catch {
    return '.zip'
  }
}

async function downloadFileWithProgress({
  event,
  jobId,
  modReference,
  modName,
  currentIndex,
  totalCount,
  url,
  targetPath
}) {
  const normalizedUrl = normalizeFicsitDownloadUrl(url)
  if (!normalizedUrl) {
    throw new Error('模组下载地址无效')
  }

  try {
    await runWithRetry(
      async ({ attempt, maxAttempts }) => {
        await fs.remove(targetPath).catch(() => {})
        emitFicsitInstallProgress(event, {
          jobId,
          modReference,
          modName,
          currentIndex,
          totalCount,
          stage: 'download',
          percent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          speed: 0,
          message:
            attempt > 1
              ? `正在重新下载模组文件（${attempt}/${maxAttempts}）...`
              : '正在下载模组文件...'
        })

        const response = await axios.get(normalizedUrl, {
          responseType: 'stream',
          timeout: 120000,
          maxRedirects: 5,
          httpsAgent: FICSIT_DOWNLOAD_HTTPS_AGENT,
          headers: {
            'User-Agent': 'Vertex-Ficsit-Installer/1.0',
            Accept: 'application/octet-stream,*/*',
            Connection: 'keep-alive'
          },
          validateStatus: () => true
        })

        if (Number(response?.status) !== 200 || !response?.data) {
          const statusCode = Number(response?.status || 0)
          const detail = String(response?.statusText || '').trim()
          const error = new Error(
            `下载失败（HTTP ${statusCode || 0}）${detail ? `: ${detail}` : ''}`
          )
          error.status = statusCode
          throw error
        }

        const totalBytes = toSafeNumber(response.headers?.['content-length'], 0)
        let downloadedBytes = 0

        emitFicsitInstallProgress(event, {
          jobId,
          modReference,
          modName,
          currentIndex,
          totalCount,
          stage: 'download',
          percent: 0,
          downloadedBytes: 0,
          totalBytes,
          speed: 0,
          message: '正在下载模组文件...'
        })

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(targetPath)
          let settled = false
          let lastSpeedSampleAt = Date.now()
          let lastSpeedSampleBytes = 0
          let latestSpeed = 0

          const cleanup = () => {
            response.data.removeListener('data', handleData)
            response.data.removeListener('error', handleError)
            writer.removeListener('error', handleError)
            writer.removeListener('finish', handleFinish)
          }

          const finishWithError = (error) => {
            if (settled) {
              return
            }
            settled = true
            cleanup()
            try {
              response.data.destroy()
            } catch (cleanupError) {
              void cleanupError
            }
            try {
              writer.destroy()
            } catch (cleanupError) {
              void cleanupError
            }
            reject(error)
          }

          const finishSuccessfully = () => {
            if (settled) {
              return
            }
            settled = true
            cleanup()
            resolve()
          }

          const handleData = (chunk) => {
            const size = toSafeNumber(chunk?.length, 0)
            downloadedBytes += size
            const now = Date.now()
            const elapsedMs = Math.max(now - lastSpeedSampleAt, 0)
            if (
              elapsedMs >= FICSIT_DOWNLOAD_SPEED_SAMPLE_MS ||
              (totalBytes > 0 && downloadedBytes >= totalBytes)
            ) {
              const byteDelta = Math.max(downloadedBytes - lastSpeedSampleBytes, 0)
              latestSpeed =
                elapsedMs > 0 ? Math.max(Math.round((byteDelta * 1000) / elapsedMs), 0) : 0
              lastSpeedSampleAt = now
              lastSpeedSampleBytes = downloadedBytes
            }
            const percent =
              totalBytes > 0 ? Math.min(Math.floor((downloadedBytes / totalBytes) * 100), 100) : 0
            emitFicsitInstallProgress(event, {
              jobId,
              modReference,
              modName,
              currentIndex,
              totalCount,
              stage: 'download',
              percent,
              downloadedBytes,
              totalBytes,
              speed: latestSpeed,
              message: '正在下载模组文件...'
            })
          }
          const handleError = (error) => {
            finishWithError(error)
          }
          const handleFinish = () => {
            finishSuccessfully()
          }

          response.data.on('data', handleData)
          response.data.on('error', handleError)
          writer.on('error', handleError)
          writer.on('finish', handleFinish)

          response.data.pipe(writer)
        })
      },
      {
        retries: FICSIT_DOWNLOAD_RETRY_COUNT,
        baseDelayMs: FICSIT_DOWNLOAD_RETRY_DELAY,
        shouldRetry: isRetryableDownloadError,
        onRetry: (retryInfo) => {
          emitFicsitInstallProgress(event, {
            jobId,
            modReference,
            modName,
            currentIndex,
            totalCount,
            stage: 'download',
            percent: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
            message: `下载中断，准备重试（${retryInfo.nextAttempt}/${retryInfo.maxAttempts}）`
          })
        }
      }
    )
  } catch (error) {
    throw new Error(resolveFicsitDownloadErrorMessage(error))
  }
}

function pickDeploySourceRoot(stagingPath) {
  // 与 SMM 对齐：保持压缩包内相对结构不变，不自动剥离一级目录
  return stagingPath
}

function countFilesRecursively(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0
  }

  const stats = fs.statSync(targetPath)
  if (!stats.isDirectory()) {
    return 1
  }

  let count = 0
  const names = fs.readdirSync(targetPath)
  for (const name of names) {
    count += countFilesRecursively(path.join(targetPath, name))
  }
  return count
}

function collectFilesRecursively(targetPath, basePath = targetPath) {
  if (!fs.existsSync(targetPath)) {
    return []
  }

  const stats = fs.statSync(targetPath)
  if (!stats.isDirectory()) {
    return [path.relative(basePath, targetPath).replace(/\\/g, '/')]
  }

  const result = []
  const names = fs.readdirSync(targetPath)
  for (const name of names) {
    result.push(...collectFilesRecursively(path.join(targetPath, name), basePath))
  }
  return result.filter(Boolean)
}

async function collectDeployFileSnapshot(deploySource, deployTarget) {
  try {
    const manifestResult = await StagingManager.buildManifest(deploySource, {
      targetPath: deployTarget
    })
    if (manifestResult?.success !== false && Array.isArray(manifestResult?.entries)) {
      const deployedFiles = manifestResult.entries
        .map((entry) => String(entry?.targetRelativePath || '').trim())
        .filter(Boolean)
      return {
        fileCount: deployedFiles.length,
        deployedFiles
      }
    }
  } catch (error) {
    console.warn('[Ficsit] 原生文件快照构建失败，回退到 JS 扫描', error)
  }

  return {
    fileCount: countFilesRecursively(deploySource),
    deployedFiles: collectFilesRecursively(deploySource)
  }
}

async function extractArchiveToStaging({
  event,
  jobId,
  modReference,
  modName,
  currentIndex,
  totalCount,
  archivePath,
  stagingPath
}) {
  await fs.remove(stagingPath)
  await fs.ensureDir(stagingPath)

  emitFicsitInstallProgress(event, {
    jobId,
    modReference,
    modName,
    currentIndex,
    totalCount,
    stage: 'extract',
    percent: 15,
    message: '正在解压模组文件...'
  })

  await extractArchiveByNodeApi(archivePath, stagingPath, { overwrite: true })

  emitFicsitInstallProgress(event, {
    jobId,
    modReference,
    modName,
    currentIndex,
    totalCount,
    stage: 'extract',
    percent: 70,
    message: '解压完成，准备部署...'
  })
}

async function cleanInstalledRecordFiles(record = {}, options = {}) {
  const stagingPath = safeText(record.staging_path)
  const targetPath = safeText(record.target_path)
  const archivePath = safeText(record.archive_path)

  if (!options.skipUndeploy && stagingPath && targetPath) {
    try {
      await StagingManager.undeploy(stagingPath, targetPath)
    } catch (error) {
      console.warn('清理旧部署失败（忽略并继续）', error)
    }
  }

  if (stagingPath) {
    await fs.remove(stagingPath)
  }
  if (archivePath) {
    await fs.remove(archivePath)
  }
}

async function canReuseInstalledRecord(record, expectedVersion, expectedTargetPath = '') {
  if (!record) return false
  if (toSafeNumber(record.install_state, 0) !== 1) return false
  if (safeText(record.version) !== safeText(expectedVersion)) return false

  const stagingPath = safeText(record.staging_path)
  const targetPath = safeText(record.target_path)
  if (!stagingPath || !targetPath) return false

  const expectedTargetKey = normalizePathForCompare(expectedTargetPath)
  const actualTargetKey = normalizePathForCompare(targetPath)
  if (expectedTargetKey && expectedTargetKey !== actualTargetKey) {
    return false
  }

  if (!(await fs.pathExists(stagingPath))) return false
  return true
}

async function splitPreparedInstallOrderByInstalled(appId, targetPath, rootKey, installOrder = []) {
  const safeRootKey = normalizeModReferenceKey(rootKey)
  const pendingInstallOrder = []
  const reusedInstalledDependencies = []

  for (const item of Array.isArray(installOrder) ? installOrder : []) {
    const normalizedNode = normalizePreparedFicsitPlanItem(item)
    const modReference = safeText(normalizedNode?.modReference)
    if (!modReference) {
      continue
    }

    const nodeKey = normalizeModReferenceKey(modReference)
    if (nodeKey === safeRootKey) {
      pendingInstallOrder.push(normalizedNode)
      continue
    }

    const installedRecord = getFicsitInstallRecord(appId, modReference)
    const expectedTargetPath = buildModDeployTargetPath(targetPath, modReference)
    const reusable = await canReuseInstalledRecord(
      installedRecord,
      safeText(normalizedNode?.version),
      expectedTargetPath
    )

    if (!reusable) {
      pendingInstallOrder.push(normalizedNode)
      continue
    }

    reusedInstalledDependencies.push({
      modReference,
      name: safeText(normalizedNode?.name || modReference),
      version: safeText(normalizedNode?.version),
      recordId: toSafeNumber(installedRecord?.id, 0)
    })
  }

  return {
    pendingInstallOrder,
    reusedInstalledDependencies
  }
}

async function installResolvedMod(event, payload = {}) {
  const appId = toSafeNumber(payload.appId, 0)
  const modsRootPath = safeText(payload.targetPath)
  const jobId = safeText(payload.jobId)
  const currentIndex = Math.max(toSafeNumber(payload.currentIndex, 1), 1)
  const totalCount = Math.max(toSafeNumber(payload.totalCount, 1), 1)
  const skipIfSameInstalled = !!payload.skipIfSameInstalled
  const providedArchivePath = safeText(payload.archivePath)
  const node = payload.node && typeof payload.node === 'object' ? payload.node : {}

  const modId = toSafeNumber(node.modId, 0)
  const modReference = safeText(node.modReference)
  const modName = safeText(node.name || node.modReference)
  const version = safeText(node.version)
  const logo = safeText(node.logo)
  const normalizedDownloadUrl = normalizeFicsitDownloadUrl(node.downloadUrl)

  if (!appId || !modsRootPath || !modReference || !normalizedDownloadUrl) {
    throw new Error(`模组 ${modReference || '未知'} 安装参数不完整`)
  }
  const modTargetPath = buildModDeployTargetPath(modsRootPath, modReference)
  if (!modTargetPath) {
    throw new Error(`模组 ${modReference || '未知'} 的安装目录不合法`)
  }

  const oldRecord = getFicsitInstallRecord(appId, modReference)
  if (skipIfSameInstalled && (await canReuseInstalledRecord(oldRecord, version, modTargetPath))) {
    debugFicsit('依赖命中同版本，跳过安装', {
      appId,
      modReference,
      version,
      recordId: toSafeNumber(oldRecord?.id, 0)
    })
    emitFicsitInstallProgress(event, {
      jobId,
      modReference,
      modName,
      currentIndex,
      totalCount,
      stage: 'done',
      percent: 100,
      message: '已安装同版本，跳过'
    })
    return {
      skipped: true,
      record: normalizeFicsitRecord(oldRecord)
    }
  }

  emitFicsitInstallProgress(event, {
    jobId,
    modReference,
    modName,
    currentIndex,
    totalCount,
    stage: 'start',
    percent: 0,
    message: '正在准备安装...'
  })

  const uniqueKey = sanitizeName(`${modReference}_${version || 'latest'}_${modId || '0'}`)
  const archiveExt = resolveArchiveExtension(normalizedDownloadUrl)
  const archiveHash = crypto
    .createHash('md5')
    .update(`${normalizedDownloadUrl}|${Date.now()}`)
    .digest('hex')
  const archivePath =
    providedArchivePath ||
    path.join(FICSIT_DOWNLOAD_ROOT, `${uniqueKey}_${archiveHash}${archiveExt}`)
  const stagingPath = path.join(FICSIT_STAGING_ROOT, String(appId), uniqueKey)
  let deploySource = ''

  try {
    if (oldRecord) {
      await cleanInstalledRecordFiles(oldRecord, { skipUndeploy: true })
    }

    if (providedArchivePath) {
      if (!(await fs.pathExists(providedArchivePath))) {
        throw new Error(`模组 ${modReference} 的下载归档不存在`)
      }
    } else {
      await downloadFileWithProgress({
        event,
        jobId,
        modReference,
        modName,
        currentIndex,
        totalCount,
        url: normalizedDownloadUrl,
        targetPath: archivePath
      })
    }

    await extractArchiveToStaging({
      event,
      jobId,
      modReference,
      modName,
      currentIndex,
      totalCount,
      archivePath,
      stagingPath
    })

    emitFicsitInstallProgress(event, {
      jobId,
      modReference,
      modName,
      currentIndex,
      totalCount,
      stage: 'deploy',
      percent: 80,
      message: '正在部署模组文件...'
    })

    deploySource = pickDeploySourceRoot(stagingPath)
    const { fileCount, deployedFiles } = await collectDeployFileSnapshot(
      deploySource,
      modTargetPath
    )
    const savedRecord = upsertFicsitInstallRecord({
      app_id: appId,
      mod_id: modId,
      mod_reference: modReference,
      name: modName || modReference,
      version,
      version_id: safeText(node.versionId),
      stability: safeText(node.stability),
      download_url: normalizedDownloadUrl,
      logo,
      staging_path: deploySource,
      target_path: modTargetPath,
      archive_path: archivePath,
      install_state: 1,
      file_count: fileCount,
      dependencies: Array.isArray(node.dependencies) ? node.dependencies : [],
      files: deployedFiles,
      installed_at: formatChinaTime(),
      updated_at: formatChinaTime()
    })
    if (!savedRecord?.id) {
      throw new Error('Ficsit 安装记录写入后未找到对应模组，无法执行安全部署重建')
    }
    const reconcileResult = await reconcileDeploy({
      mode: 'ficsit_install_rebuild',
      modId: savedRecord?.id,
      reason: 'ficsit_install'
    })
    if (!reconcileResult?.success) {
      throw new Error(reconcileResult?.message || 'Ficsit 安全部署重建失败')
    }

    debugFicsit('依赖安装并写库完成', {
      appId,
      modReference,
      version,
      recordId: toSafeNumber(savedRecord?.id, 0),
      fileCount,
      targetPath: modTargetPath,
      stagingPath: safeText(savedRecord?.staging_path || savedRecord?.stagingPath)
    })

    emitFicsitInstallProgress(event, {
      jobId,
      modReference,
      modName,
      currentIndex,
      totalCount,
      stage: 'done',
      percent: 100,
      message: '安装完成'
    })

    return {
      skipped: false,
      record: normalizeFicsitRecord(savedRecord)
    }
  } catch (error) {
    try {
      await fs.remove(stagingPath)
      if (!providedArchivePath) {
        await fs.remove(archivePath)
      }
    } catch (cleanupError) {
      console.warn('安装失败后清理临时文件失败（忽略）', cleanupError)
    }

    emitFicsitInstallProgress(event, {
      jobId,
      modReference,
      modName,
      currentIndex,
      totalCount,
      stage: 'error',
      percent: 100,
      message: `安装失败：${String(error?.message || '未知错误')}`
    })

    error.__ficsitProgressEmitted = true
    throw error
  }
}

export async function ficsitResolveGamePath(payload = {}) {
  const appId = toSafeNumber(payload?.appId, 0)
  const gameId = toSafeNumber(payload?.gameId, 0)
  const executableFile = safeText(payload?.executableFile)
  const sourceMeta = payload?.sourceMeta || {}

  if (!appId) {
    return {
      success: false,
      message: '缺少 appId'
    }
  }

  const { gameRecord, executableFile: matchedExecutable } = await resolveGameRecordByExecutable(
    appId,
    gameId,
    executableFile,
    sourceMeta
  )
  if (!gameRecord) {
    return {
      success: false,
      message: '未找到游戏路径'
    }
  }

  const targetPath = await resolveFicsitTargetPath(gameRecord)
  if (!targetPath) {
    return {
      success: false,
      message: '未找到 FactoryGame/Mods 目录'
    }
  }

  const clientExePath = safeText(gameRecord?.client_exe_path)
  return {
    success: true,
    game: {
      appId,
      gameId: toSafeNumber(gameRecord?.game_id, gameId),
      clientRootPath: safeText(gameRecord?.client_root_path),
      clientExePath,
      executableFile: matchedExecutable || executableFile,
      targetPath,
      found: !!clientExePath
    }
  }
}

function normalizePreparedFicsitPlanItem(item = {}) {
  const dependencies = Array.isArray(item?.dependencies) ? item.dependencies : []
  return {
    modId: toSafeNumber(item?.modId, 0),
    modReference: safeText(item?.modReference),
    name: safeText(item?.name || item?.modReference),
    version: safeText(item?.version),
    versionId: safeText(item?.versionId),
    stability: safeText(item?.stability),
    downloadUrl: normalizeFicsitDownloadUrl(item?.downloadUrl),
    logo: safeText(item?.logo),
    filePath: safeText(item?.filePath || item?.archivePath),
    dependencies: dependencies
      .map((dep) => ({
        modReference: safeText(dep?.modReference || dep?.mod_reference),
        condition: safeText(dep?.condition),
        optional: !!dep?.optional
      }))
      .filter((dep) => dep.modReference)
  }
}

export async function ficsitPrepareInstallPlan(payload = {}) {
  const appId = toSafeNumber(payload?.appId, 0)
  const gameId = toSafeNumber(payload?.gameId, 0)
  const executableFile = safeText(payload?.executableFile)
  const modId = toSafeNumber(payload?.modId, 0)
  const modReference = safeText(payload?.modReference)
  const modName = safeText(payload?.name)
  const version = safeText(payload?.version)
  const downloadUrl = safeText(payload?.downloadUrl)
  const logo = safeText(payload?.logo)

  if (!appId || !modReference) {
    return {
      success: false,
      message: '安装参数不完整'
    }
  }

  try {
    await ensureFicsitDirs()

    const resolveResult = await ficsitResolveGamePath({ appId, gameId, executableFile })
    if (!resolveResult?.success) {
      return {
        success: false,
        message: resolveResult?.message || '未识别到游戏路径'
      }
    }

    const targetPath = safeText(resolveResult?.game?.targetPath)
    if (!targetPath) {
      return {
        success: false,
        message: '未识别到有效模组目录'
      }
    }

    let rootVersionNode = await fetchRootResolvedVersion({
      modReference,
      modId,
      name: modName,
      logo,
      expectedVersion: version,
      expectedDownloadUrl: downloadUrl
    })

    rootVersionNode = injectMandatorySmlDependency(rootVersionNode)
    const planResult = await buildInstallPlanFromRoot(rootVersionNode)
    const installOrder = Array.isArray(planResult?.installOrder) ? planResult.installOrder : []
    if (!installOrder.length) {
      return {
        success: false,
        message: '依赖解析结果为空，无法继续安装'
      }
    }

    const rootKey = safeText(planResult?.rootKey || normalizeModReferenceKey(modReference))
    const { pendingInstallOrder, reusedInstalledDependencies } =
      await splitPreparedInstallOrderByInstalled(appId, targetPath, rootKey, installOrder)

    debugFicsit('Ficsit 预下载安装计划过滤完成', {
      appId,
      modReference,
      targetPath,
      totalCount: installOrder.length,
      pendingCount: pendingInstallOrder.length,
      reusedInstalledDependencyCount: reusedInstalledDependencies.length,
      reusedInstalledDependencies
    })

    return {
      success: true,
      appId,
      targetPath,
      rootKey,
      requestModReference: modReference,
      reusedInstalledDependencyCount: reusedInstalledDependencies.length,
      reusedInstalledDependencies,
      installPlan: pendingInstallOrder
    }
  } catch (error) {
    debugFicsit('生成 Ficsit 下载计划失败', {
      appId,
      modReference,
      message: String(error?.message || '生成安装计划失败'),
      stack: safeText(error?.stack)
    })
    return {
      success: false,
      message: String(error?.message || '生成安装计划失败')
    }
  }
}

export async function ficsitInstallMod(event, payload = {}) {
  const appId = toSafeNumber(payload?.appId, 0)
  const gameId = toSafeNumber(payload?.gameId, 0)
  const executableFile = safeText(payload?.executableFile)
  const modId = toSafeNumber(payload?.modId, 0)
  const modReference = safeText(payload?.modReference)
  const modName = safeText(payload?.name)
  const version = safeText(payload?.version)
  const downloadUrl = safeText(payload?.downloadUrl)
  const logo = safeText(payload?.logo)

  if (!appId || !modReference) {
    return {
      success: false,
      message: '安装参数不完整'
    }
  }

  await ensureFicsitDirs()

  debugFicsit('收到安装请求', {
    appId,
    gameId,
    modId,
    modReference,
    modName,
    version,
    downloadUrl,
    executableFile
  })

  const resolveResult = await ficsitResolveGamePath({ appId, gameId, executableFile })
  if (!resolveResult?.success) {
    return {
      success: false,
      message: resolveResult?.message || '未识别到游戏路径'
    }
  }

  const targetPath = safeText(resolveResult?.game?.targetPath)
  if (!targetPath) {
    return {
      success: false,
      message: '未识别到有效模组目录'
    }
  }

  const jobId = makeFicsitJobId()
  let rootVersionNode = null
  let installOrder = []

  try {
    emitFicsitInstallProgress(event, {
      jobId,
      modReference,
      modName: modName || modReference,
      currentIndex: 1,
      totalCount: 1,
      stage: 'resolve',
      percent: 0,
      message: '正在解析依赖...'
    })

    rootVersionNode = await fetchRootResolvedVersion({
      modReference,
      modId,
      name: modName,
      logo,
      expectedVersion: version,
      expectedDownloadUrl: downloadUrl
    })
    debugFicsit('根模组解析完成', {
      modReference: safeText(rootVersionNode?.modReference),
      version: safeText(rootVersionNode?.version),
      downloadUrl: safeText(rootVersionNode?.downloadUrl),
      dependencies: normalizeDependencyList(rootVersionNode?.dependencies).map((item) => ({
        modReference: safeText(item?.modReference),
        condition: safeText(item?.condition),
        optional: !!item?.optional
      }))
    })
    rootVersionNode = injectMandatorySmlDependency(rootVersionNode)

    const planResult = await buildInstallPlanFromRoot(rootVersionNode)
    installOrder = Array.isArray(planResult?.installOrder) ? planResult.installOrder : []

    debugFicsit('安装计划已生成', {
      appId,
      rootKey: safeText(planResult?.rootKey),
      totalCount: installOrder.length,
      installOrder: installOrder.map((item) => ({
        modReference: safeText(item?.modReference),
        version: safeText(item?.version),
        downloadUrl: safeText(item?.downloadUrl)
      }))
    })

    if (!installOrder.length) {
      throw new Error('依赖解析结果为空，无法继续安装')
    }

    const rootKey = safeText(planResult?.rootKey || normalizeModReferenceKey(modReference))
    const totalCount = installOrder.length
    const installResults = []

    for (let index = 0; index < installOrder.length; index += 1) {
      const node = installOrder[index]
      const currentIndex = index + 1
      const nodeKey = normalizeModReferenceKey(node?.modReference)
      const isRootMod = nodeKey === rootKey

      const result = await installResolvedMod(event, {
        appId,
        targetPath,
        jobId,
        currentIndex,
        totalCount,
        node,
        skipIfSameInstalled: !isRootMod
      })

      installResults.push({
        ...result,
        node
      })

      debugFicsit('安装计划节点执行完成', {
        appId,
        modReference: safeText(node?.modReference),
        version: safeText(node?.version),
        skipped: !!result?.skipped,
        recordId: toSafeNumber(result?.record?.id, 0)
      })
    }

    const rootResult =
      installResults.find(
        (item) => normalizeModReferenceKey(item?.node?.modReference) === rootKey
      ) || installResults[installResults.length - 1]

    const dependencyCount = Math.max(totalCount - 1, 0)
    const skippedCount = installResults.filter((item) => item?.skipped).length

    let message = '安装完成'
    if (dependencyCount > 0) {
      message = `安装完成（含 ${dependencyCount} 个依赖）`
    }
    if (skippedCount > 0) {
      message += `，跳过 ${skippedCount} 个已安装依赖`
    }
    const smlAutoEnabledResult = await ensureSmlEnabledWhenOtherModsEnabled(appId)
    if (smlAutoEnabledResult?.changed) {
      message += '，已自动启用 SML'
    }
    const lockfilePath = await writeFicsitDefaultLockFileByAppId(appId, targetPath)

    debugFicsit('安装流程完成', {
      appId,
      requestModReference: modReference,
      totalCount,
      dependencyCount,
      skippedCount,
      smlAutoEnabled: !!smlAutoEnabledResult?.changed,
      lockfilePath,
      installedRecordCount: installResults.map((item) => item?.record).filter(Boolean).length
    })

    return {
      success: true,
      message,
      jobId,
      lockfilePath,
      record: rootResult?.record || null,
      records: installResults.map((item) => item?.record).filter(Boolean),
      installPlan: installOrder.map((item) => ({
        modReference: safeText(item?.modReference),
        name: safeText(item?.name),
        version: safeText(item?.version),
        downloadUrl: safeText(item?.downloadUrl)
      }))
    }
  } catch (error) {
    debugFicsit('安装流程失败', {
      appId,
      requestModReference: modReference,
      message: String(error?.message || '安装失败'),
      stack: safeText(error?.stack)
    })
    if (!error?.__ficsitProgressEmitted) {
      emitFicsitInstallProgress(event, {
        jobId,
        modReference: safeText(rootVersionNode?.modReference || modReference),
        modName: safeText(rootVersionNode?.name || modName || modReference),
        currentIndex: 1,
        totalCount: Math.max(installOrder.length, 1),
        stage: 'error',
        percent: 100,
        message: `安装失败：${String(error?.message || '未知错误')}`
      })
    }

    return {
      success: false,
      message: String(error?.message || '安装失败')
    }
  }
}

export async function ficsitInstallDownloadedMods(event, payload = {}) {
  const appId = toSafeNumber(payload?.appId, 0)
  const targetPath = safeText(payload?.targetPath)
  const rootKey = safeText(payload?.rootKey)
  const requestModReference = safeText(payload?.requestModReference)
  const items = Array.isArray(payload?.items) ? payload.items : []

  if (!appId || !targetPath) {
    return {
      success: false,
      message: '安装参数不完整'
    }
  }

  const installOrder = items.map((item) => normalizePreparedFicsitPlanItem(item)).filter(Boolean)
  if (!installOrder.length) {
    return {
      success: false,
      message: '缺少已下载的安装计划'
    }
  }

  const safeRootKey =
    safeText(rootKey) ||
    normalizeModReferenceKey(
      requestModReference || installOrder[installOrder.length - 1]?.modReference
    )
  const jobId = safeText(payload?.jobId) || makeFicsitJobId()
  const requestReference =
    requestModReference || safeText(installOrder[installOrder.length - 1]?.modReference)

  try {
    await ensureFicsitDirs()

    emitFicsitInstallProgress(event, {
      jobId,
      modReference: requestReference,
      modName: safeText(installOrder[installOrder.length - 1]?.name || requestReference),
      currentIndex: 1,
      totalCount: installOrder.length,
      stage: 'prepare',
      percent: 0,
      message: '下载完成，正在开始安装...'
    })

    const installResults = []
    for (let index = 0; index < installOrder.length; index += 1) {
      const node = installOrder[index]
      const currentIndex = index + 1
      const nodeKey = normalizeModReferenceKey(node?.modReference)
      const isRootMod = nodeKey === safeRootKey

      const result = await installResolvedMod(event, {
        appId,
        targetPath,
        jobId,
        currentIndex,
        totalCount: installOrder.length,
        node,
        archivePath: safeText(node?.filePath),
        skipIfSameInstalled: !isRootMod
      })

      installResults.push({
        ...result,
        node
      })
    }

    const rootResult =
      installResults.find(
        (item) => normalizeModReferenceKey(item?.node?.modReference) === safeRootKey
      ) || installResults[installResults.length - 1]

    const dependencyCount = Math.max(installOrder.length - 1, 0)
    const skippedCount = installResults.filter((item) => item?.skipped).length

    let message = '安装完成'
    if (dependencyCount > 0) {
      message = `安装完成（含 ${dependencyCount} 个依赖）`
    }
    if (skippedCount > 0) {
      message += `，跳过 ${skippedCount} 个已安装依赖`
    }

    const smlAutoEnabledResult = await ensureSmlEnabledWhenOtherModsEnabled(appId)
    if (smlAutoEnabledResult?.changed) {
      message += '，已自动启用 SML'
    }
    const lockfilePath = await writeFicsitDefaultLockFileByAppId(appId, targetPath)

    return {
      success: true,
      message,
      jobId,
      lockfilePath,
      record: rootResult?.record || null,
      records: installResults.map((item) => item?.record).filter(Boolean),
      installPlan: installOrder.map((item) => ({
        modReference: safeText(item?.modReference),
        name: safeText(item?.name),
        version: safeText(item?.version),
        downloadUrl: safeText(item?.downloadUrl)
      }))
    }
  } catch (error) {
    debugFicsit('使用已下载归档安装 Ficsit 模组失败', {
      appId,
      requestModReference: requestReference,
      message: String(error?.message || '安装失败'),
      stack: safeText(error?.stack)
    })

    if (!error?.__ficsitProgressEmitted) {
      emitFicsitInstallProgress(event, {
        jobId,
        modReference: requestReference,
        modName: safeText(installOrder[installOrder.length - 1]?.name || requestReference),
        currentIndex: 1,
        totalCount: Math.max(installOrder.length, 1),
        stage: 'error',
        percent: 100,
        message: `安装失败：${String(error?.message || '未知错误')}`
      })
    }

    return {
      success: false,
      message: String(error?.message || '安装失败')
    }
  }
}

export async function ficsitGetInstalledMods(payload = {}) {
  const appId = toSafeNumber(payload?.appId, 0)
  if (!appId) {
    return {
      success: false,
      message: '缺少 appId',
      records: []
    }
  }

  const profileName = safeText(payload?.profileName || payload?.sourceMeta?.profileName)
  const rawRows = listFicsitInstallRecords(appId, profileName)
  const rows = rawRows.map((item) => {
    const dependents = findFicsitDependentRecords(item, { profileName })
    const activeDependents = findFicsitDependentRecords(item, { enabledOnly: true, profileName })
    return {
      ...normalizeFicsitRecord(item),
      dependents: dependents.map((record) => normalizeFicsitRecord(record)),
      activeDependents: activeDependents.map((record) => normalizeFicsitRecord(record))
    }
  })
  debugFicsit('读取已安装模组列表', {
    appId,
    total: rows.length,
    records: rows.map((item) => ({
      id: toSafeNumber(item?.id, 0),
      modReference: safeText(item?.modReference),
      name: safeText(item?.name),
      version: safeText(item?.version),
      installState: toSafeNumber(item?.installState, 0)
    }))
  })
  return {
    success: true,
    records: rows
  }
}

export async function ficsitCheckModFileOccupancy(payload = {}) {
  const idList = Array.isArray(payload?.ids) ? payload.ids : []
  const singleId = toSafeNumber(payload?.id, 0)
  const targetIds = [
    ...new Set([...idList, ...(singleId > 0 ? [singleId] : [])].map(Number))
  ].filter((item) => Number.isFinite(item) && item > 0)

  if (!targetIds.length) {
    return {
      success: false,
      message: '缺少 id'
    }
  }

  const records = targetIds.map((id) => getFicsitInstallRecordById(id)).filter(Boolean)
  if (!records.length) {
    return {
      success: false,
      message: '未找到模组记录'
    }
  }

  const result = inspectFicsitRecordsOccupancy(records)
  return {
    success: result.success,
    message: result.message,
    totalCount: result.totalCount,
    occupiedFiles: result.occupiedFiles
  }
}

async function executeFicsitSetModEnabled(payload = {}, taskContext = {}) {
  const updateTask = typeof taskContext.update === 'function' ? taskContext.update : () => {}
  const id = toSafeNumber(payload?.id, 0)
  const enabled = !!payload?.enabled
  if (!id) {
    return {
      success: false,
      message: '缺少 id'
    }
  }

  const record = getFicsitInstallRecordById(id)
  if (!record) {
    return {
      success: false,
      message: '未找到模组记录'
    }
  }

  const normalized = normalizeFicsitRecord(record)
  debugFicsit('收到启用状态切换请求', {
    id,
    appId: toSafeNumber(normalized?.appId, 0),
    modReference: safeText(normalized?.modReference),
    name: safeText(normalized?.name),
    targetEnabled: enabled,
    currentEnabled: normalized.installState === 1
  })
  if (enabled === (normalized.installState === 1)) {
    return {
      success: true,
      message: enabled ? '模组已启用' : '模组已禁用'
    }
  }

  if (enabled) {
    updateTask({ stage: 'planning', progress: 20, currentTarget: '检查 Ficsit 启用条件' })
    if (!normalized.stagingPath || !normalized.targetPath) {
      return {
        success: false,
        message: '缺少部署路径，请重新安装该模组'
      }
    }
    if (!(await fs.pathExists(normalized.stagingPath))) {
      return {
        success: false,
        message: '模组暂存目录不存在，请重新安装'
      }
    }

    updateTask({ stage: 'applying', progress: 50, currentTarget: '更新 Ficsit 启用状态' })
    updateFicsitInstallState(id, true)
    updateTask({ stage: 'verifying', progress: 70, currentTarget: '协调 Ficsit 部署域' })
    const reconcileResult = await reconcileDeploy({
      mode: 'incremental',
      modId: id,
      reason: 'ficsit_enable'
    })
    if (!reconcileResult?.success) {
      updateFicsitInstallState(id, false)
      throw new Error(reconcileResult?.message || 'Ficsit 启用部署重建失败')
    }

    const smlAutoEnabledResult = isSmlReference(normalized?.modReference)
      ? { changed: false }
      : await ensureSmlEnabledWhenOtherModsEnabled(normalized?.appId)

    updateTask({ stage: 'verifying', progress: 85, currentTarget: '写入 Ficsit 锁文件' })
    const lockfilePath = await writeFicsitDefaultLockFileByAppId(
      normalized?.appId,
      normalized?.targetPath
    )

    let message = '模组已启用'
    if (smlAutoEnabledResult?.changed) {
      message += '，已自动启用 SML'
    }
    return {
      success: true,
      message,
      lockfilePath
    }
  }

  if (isSmlReference(normalized?.modReference)) {
    updateTask({ stage: 'planning', progress: 20, currentTarget: '检查 SML 禁用条件' })
    const allRecords = listFicsitInstallRecords(normalized?.appId)
    const enabledOtherMods = allRecords.filter((item) => {
      if (toSafeNumber(item?.id, 0) === id) {
        return false
      }
      if (isSmlReference(getFicsitRecordModReference(item))) {
        return false
      }
      return getFicsitRecordInstallState(item) === 1
    })
    if (enabledOtherMods.length > 0) {
      debugFicsit('拦截 SML 禁用：存在其他已启用模组', {
        appId: toSafeNumber(normalized?.appId, 0),
        enabledOtherMods: enabledOtherMods.map((item) => ({
          id: toSafeNumber(item?.id, 0),
          modReference: getFicsitRecordModReference(item),
          name: safeText(item?.name)
        }))
      })
      return {
        success: false,
        message: '存在其他已启用模组时，SML 不能禁用'
      }
    }
  }

  const activeDependents = findFicsitDependentRecords(record, { enabledOnly: true })
  if (activeDependents.length > 0) {
    return {
      success: false,
      message: `存在已启用模组依赖该模组：${formatFicsitDependentRecordNames(activeDependents)}`
    }
  }

  updateTask({ stage: 'planning', progress: 30, currentTarget: '检查 Ficsit 禁用条件' })
  if (!normalized.stagingPath || !normalized.targetPath) {
    return {
      success: false,
      message: '缺少部署路径，请重新安装该模组'
    }
  }

  const occupancyResult = inspectFicsitRecordsOccupancy([record])
  if (!occupancyResult.success) {
    return {
      success: false,
      message: occupancyResult.message
    }
  }

  updateTask({ stage: 'applying', progress: 55, currentTarget: '更新 Ficsit 禁用状态' })
  updateFicsitInstallState(id, false)
  updateTask({ stage: 'verifying', progress: 75, currentTarget: '协调 Ficsit 部署域' })
  const reconcileResult = await reconcileDeploy({
    mode: 'incremental',
    modId: id,
    reason: 'ficsit_disable'
  })
  if (!reconcileResult?.success) {
    updateFicsitInstallState(id, true)
    throw new Error(reconcileResult?.message || 'Ficsit 禁用部署重建失败')
  }
  const lockfilePath = await writeFicsitDefaultLockFileByAppId(
    normalized?.appId,
    normalized?.targetPath
  )
  return {
    success: true,
    message: '模组已禁用',
    lockfilePath
  }
}

export async function ficsitSetModEnabled(eventOrPayload = {}, payload = undefined) {
  const hasEvent = eventOrPayload && typeof eventOrPayload.reply === 'function'
  const taskEvent = hasEvent ? eventOrPayload : null
  const taskPayload = hasEvent ? payload || {} : eventOrPayload || {}

  return await runModTask({
    event: taskEvent,
    type: taskPayload?.enabled ? 'ficsit_enable_mod' : 'ficsit_disable_mod',
    cancelable: false,
    execute: async ({ task, update }) => {
      update({ stage: 'planning', progress: 10, currentTarget: '准备切换 Ficsit 模组状态' })
      return await executeFicsitSetModEnabled(taskPayload, { task, update })
    }
  })
}

async function executeFicsitUninstallMod(payload = {}, taskContext = {}) {
  const updateTask = typeof taskContext.update === 'function' ? taskContext.update : () => {}
  const id = toSafeNumber(payload?.id, 0)
  if (!id) {
    return {
      success: false,
      message: '缺少 id'
    }
  }

  const record = getFicsitInstallRecordById(id)
  if (!record) {
    return {
      success: false,
      message: '未找到模组记录'
    }
  }

  const normalizedRecord = normalizeFicsitRecord(record)
  const deployScope = getModDeployScopeById(id)
  debugFicsit('收到卸载请求', {
    id,
    appId: toSafeNumber(normalizedRecord?.appId, 0),
    modReference: safeText(normalizedRecord?.modReference),
    name: safeText(normalizedRecord?.name)
  })
  if (isSmlReference(normalizedRecord?.modReference)) {
    updateTask({ stage: 'planning', progress: 20, currentTarget: '检查 SML 卸载条件' })
    const allRecords = listFicsitInstallRecords(normalizedRecord?.appId)
    const hasOtherMods = allRecords.some((item) => {
      if (toSafeNumber(item?.id, 0) === id) {
        return false
      }
      return !isSmlReference(getFicsitRecordModReference(item))
    })
    if (hasOtherMods) {
      debugFicsit('拦截 SML 卸载：仍存在其他模组', {
        appId: toSafeNumber(normalizedRecord?.appId, 0),
        otherMods: allRecords
          .filter(
            (item) =>
              toSafeNumber(item?.id, 0) !== id && !isSmlReference(getFicsitRecordModReference(item))
          )
          .map((item) => ({
            id: toSafeNumber(item?.id, 0),
            modReference: getFicsitRecordModReference(item),
            name: safeText(item?.name)
          }))
      })
      return {
        success: false,
        message: '请先卸载其他模组后再卸载 SML'
      }
    }
  }

  const dependentRecords = findFicsitDependentRecords(record)
  if (dependentRecords.length > 0) {
    return {
      success: false,
      message: `存在其他模组依赖该模组：${formatFicsitDependentRecordNames(dependentRecords)}`
    }
  }

  try {
    updateTask({ stage: 'scanning', progress: 35, currentTarget: '检查 Ficsit 文件占用' })
    const occupancyResult = inspectFicsitRecordsOccupancy([record])
    if (!occupancyResult.success) {
      return {
        success: false,
        message: occupancyResult.message
      }
    }

    updateTask({ stage: 'applying', progress: 55, currentTarget: '移除 Ficsit 安装记录' })
    removeFicsitInstallRecord(id)
    updateTask({ stage: 'verifying', progress: 75, currentTarget: '协调 Ficsit 部署域' })
    const reconcileResult = await reconcileDeploy({
      mode: 'incremental',
      scope: deployScope,
      reason: 'ficsit_uninstall'
    })
    if (!reconcileResult?.success) {
      throw new Error(reconcileResult?.message || 'Ficsit 卸载部署重建失败')
    }
    await cleanInstalledRecordFiles(record, { skipUndeploy: true })
    const lockfilePath = await writeFicsitDefaultLockFileByAppId(
      normalizedRecord?.appId,
      normalizedRecord?.targetPath
    )
    debugFicsit('卸载完成并已删除记录', {
      id,
      appId: toSafeNumber(normalizedRecord?.appId, 0),
      modReference: safeText(normalizedRecord?.modReference),
      lockfilePath
    })
    return {
      success: true,
      message: '卸载完成',
      lockfilePath
    }
  } catch (error) {
    debugFicsit('卸载失败', {
      id,
      appId: toSafeNumber(normalizedRecord?.appId, 0),
      modReference: safeText(normalizedRecord?.modReference),
      message: String(error?.message || '卸载失败'),
      stack: safeText(error?.stack)
    })
    return {
      success: false,
      message: String(error?.message || '卸载失败')
    }
  }
}

export async function ficsitUninstallMod(eventOrPayload = {}, payload = undefined) {
  const hasEvent = eventOrPayload && typeof eventOrPayload.reply === 'function'
  const taskEvent = hasEvent ? eventOrPayload : null
  const taskPayload = hasEvent ? payload || {} : eventOrPayload || {}

  return await runModTask({
    event: taskEvent,
    type: 'ficsit_uninstall_mod',
    cancelable: false,
    execute: async ({ task, update }) => {
      update({ stage: 'planning', progress: 10, currentTarget: '准备卸载 Ficsit 模组' })
      return await executeFicsitUninstallMod(taskPayload, { task, update })
    }
  })
}
