import { parseAiAgentToolCalls } from './ai-agent-tool-call-parser.js'
import { buildAiAgentSystemPrompt } from '../config/ai-agent-role-config.js'
import { resolveBusinessSource, resolveSourcePlatformLabel } from '../../sources/source-platform-registry.js'
import { mergeAiAgentCandidates } from '../conversation/ai-agent-candidate-merge.js'

const MAX_TOOL_LOOP_COUNT = 3
const MAX_TOOL_CALLS_PER_ROUND = 4
const MAX_TOOL_RECORDS = 8
const MAX_MODEL_CONTEXT_TEXT_LENGTH = 24000
const MODEL_ARRAY_LIMITS = Object.freeze({
  records: MAX_TOOL_RECORDS,
  tasks: 10,
  conflicts: 20,
  mods: 50,
  games: 50
})
const SENSITIVE_KEY_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session(?!_?ids?$))/i
const SENSITIVE_URL_PARAM_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session|access.?token|refresh.?token|signature|credential|policy|expires|key.?pair.?id|^key$|^sig$)/i
const INLINE_URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/gi
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi
const PRIVATE_PATH_LIST_KEY_PATTERN = /^(?:private.?paths?|path.?list|paths)$/i
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>;,，。；、）)\]}]+/g
const UNIX_ABSOLUTE_PATH_PATTERN =
  /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>;,，。；、）)\]}]+)/g
const WINDOWS_ABSOLUTE_PATH_DETECT_PATTERN = /\b[A-Za-z]:[\\/]/
const UNIX_ABSOLUTE_PATH_DETECT_PATTERN =
  /(^|[\s:：([{（])\/(?:Users|home|var|tmp|mnt|Volumes)\//

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveCandidateSourceFields(candidate = {}, fallback = {}) {
  const rawCandidateSource = pickFirstText(
    candidate.source,
    candidate.sourcePlatform,
    candidate.source_platform
  ).toLowerCase()
  const displaySource = pickFirstText(
    candidate.displaySource,
    candidate.display_source,
    candidate.sourcePlatform,
    candidate.source_platform,
    candidate.source,
    fallback.displaySource,
    fallback.display_source,
    fallback.source
  ).toLowerCase()
  const businessSource = resolveBusinessSource({
    displaySource,
    sourcePlatform: pickFirstText(
      candidate.sourcePlatform,
      candidate.source_platform,
      candidate.source,
      fallback.sourcePlatform,
      fallback.source_platform,
      fallback.source
    ),
    source: pickFirstText(candidate.source, fallback.source),
    businessSource: pickFirstText(
      candidate.businessSource,
      candidate.business_source,
      displaySource === 'aggregate' && rawCandidateSource !== 'aggregate' ? rawCandidateSource : '',
      fallback.businessSource,
      fallback.business_source
    ),
    targetSourcePlatform: pickFirstText(
      candidate.targetSourcePlatform,
      candidate.target_source_platform,
      displaySource === 'aggregate' && rawCandidateSource !== 'aggregate' ? rawCandidateSource : '',
      fallback.targetSourcePlatform,
      fallback.target_source_platform
    )
  })
  const source = pickFirstText(businessSource, displaySource).toLowerCase()

  return {
    source,
    businessSource: source,
    displaySource: displaySource || source
  }
}

function getFileIdentity(file = {}) {
  return pickFirstText(file.fileId, file.file_id, file.id, file.fileName, file.file_name, file.name)
}

function findSelectedFileFromList(candidate = {}) {
  const files = toSafeArray(candidate.files).filter(isPlainObject)
  if (!files.length) return {}

  const selectedFileIdentity = pickFirstText(
    candidate.selectedFileId,
    candidate.selected_file_id,
    candidate.fileId,
    candidate.file_id,
    candidate.selectedFileName,
    candidate.selected_file_name,
    candidate.fileName,
    candidate.file_name
  )

  if (selectedFileIdentity) {
    const selectedFile = files.find((file) => getFileIdentity(file) === selectedFileIdentity)
    if (selectedFile) return selectedFile
  }

  return files.length === 1 ? files[0] : {}
}

function getVersionIdentity(version = {}) {
  return pickFirstText(
    version.version,
    version.versionNumber,
    version.version_number,
    version.id,
    version.name
  )
}

function findSelectedVersionFromList(candidate = {}, selectedFile = {}) {
  const versions = toSafeArray(candidate.versions).filter(isPlainObject)
  if (!versions.length) return {}

  const selectedVersionIdentity = pickFirstText(
    candidate.selectedVersionId,
    candidate.selected_version_id,
    candidate.selectedVersionName,
    candidate.selected_version_name,
    candidate.version,
    candidate.modVersion,
    selectedFile.version,
    selectedFile.versionNumber,
    selectedFile.version_number
  )

  if (selectedVersionIdentity) {
    const selectedVersion = versions.find(
      (version) => getVersionIdentity(version) === selectedVersionIdentity
    )
    if (selectedVersion) return selectedVersion
  }

  return versions.length === 1 ? versions[0] : {}
}

function assertExecutionActive(execution = {}) {
  if (execution?.controller?.signal?.aborted) {
    const error = new Error('AI 助手执行已取消')
    error.name = 'AbortError'
    throw error
  }
}

function sanitizeUrlHashValue(hash = '') {
  const text = String(hash || '')
  if (!text || !SENSITIVE_URL_PARAM_PATTERN.test(text)) return hash

  const body = text.startsWith('#') ? text.slice(1) : text
  if (!body) return '#[redacted]'

  const questionIndex = body.indexOf('?')
  if (questionIndex < 0 && body.startsWith('/')) return '#[redacted]'

  const prefix = questionIndex >= 0 ? body.slice(0, questionIndex) : ''
  const queryText = questionIndex >= 0 ? body.slice(questionIndex + 1) : body
  if (!queryText || (!queryText.includes('=') && !queryText.includes('&'))) {
    return '#[redacted]'
  }

  const params = new URLSearchParams(queryText)
  let changed = false
  for (const key of [...params.keys()]) {
    const value = params.get(key)
    if (SENSITIVE_URL_PARAM_PATTERN.test(key) || SENSITIVE_URL_PARAM_PATTERN.test(value || '')) {
      params.set(key, '[redacted]')
      changed = true
    }
  }
  if (!changed) return '#[redacted]'

  const nextQuery = params.toString()
  return `#${prefix ? `${prefix}?` : ''}${nextQuery}`
}

function sanitizeTextForModel(value = '', maxLength = 2000) {
  const text = String(value ?? '')
  const hasLocalAbsolutePath = (rawValue = '') => {
    const rawText = String(rawValue ?? '')
    return (
      WINDOWS_ABSOLUTE_PATH_DETECT_PATTERN.test(rawText) ||
      UNIX_ABSOLUTE_PATH_DETECT_PATTERN.test(rawText)
    )
  }
  const sanitizeUrlValue = (rawUrl = '') => {
    try {
      const parsed = new URL(rawUrl)
      let changed = false
      for (const key of [...parsed.searchParams.keys()]) {
        const paramValue = parsed.searchParams.get(key)
        if (SENSITIVE_URL_PARAM_PATTERN.test(key) || hasLocalAbsolutePath(paramValue)) {
          parsed.searchParams.set(key, '[redacted]')
          changed = true
        }
      }
      if (parsed.hash && SENSITIVE_URL_PARAM_PATTERN.test(parsed.hash)) {
        parsed.hash = sanitizeUrlHashValue(parsed.hash)
        changed = true
      }
      return changed ? parsed.toString() : rawUrl
    } catch {
      return rawUrl
    }
  }

  if (/^https?:\/\//i.test(text)) {
    const sanitizedUrl = sanitizeUrlValue(text)
    return sanitizedUrl.length > maxLength ? `${sanitizedUrl.slice(0, maxLength)}...` : sanitizedUrl
  }

  const urlReplacements = []
  let sanitized = text.replace(INLINE_URL_PATTERN, (matched) => {
    const placeholder = `__VERTEX_SAFE_URL_${urlReplacements.length}__`
    urlReplacements.push([placeholder, sanitizeUrlValue(matched)])
    return placeholder
  })
  sanitized = sanitized
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, '[path]')
    .replace(UNIX_ABSOLUTE_PATH_PATTERN, '$1[path]')
  for (const [placeholder, sanitizedUrl] of urlReplacements) {
    sanitized = sanitized.replace(placeholder, sanitizedUrl)
  }

  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...` : sanitized
}

export function sanitizeForModel(value, depth = 0, field = '') {
  if (depth > 5) {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        return sanitizeTextForModel(value)
      }
      return value
    }
    return undefined
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, ['entries', 'mappings', 'options'].includes(field) ? 200 : 30)
      .map((item) => sanitizeForModel(item, depth + 1))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return sanitizeTextForModel(value, field === 'evidenceContent' ? 8000 : 2000)
    }
    return value
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (SENSITIVE_KEY_PATTERN.test(key) || PRIVATE_PATH_LIST_KEY_PATTERN.test(key)) {
      return result
    }
    const normalized = sanitizeForModel(item, depth + 1, key)
    if (typeof normalized !== 'undefined') {
      result[key] = normalized
    }
    return result
  }, {})
}

export function stringifyForModel(value) {
  const text = JSON.stringify(sanitizeForModel(value), null, 2)
  return text.length > MAX_MODEL_CONTEXT_TEXT_LENGTH
    ? `${text.slice(0, MAX_MODEL_CONTEXT_TEXT_LENGTH)}\n...`
    : text
}

// 只保留后续查询需要的标识和状态，不把安装载荷、授权或长篇外部资料带进历史。
export function buildAiAgentToolResultSummary(result = {}) {
  const fields = [
    'id', 'modId', 'installedModId', 'source', 'businessSource', 'sourceGameId', 'sourceSlug',
    'domainName', 'community', 'gameId', 'localGameId', 'backendGameId', 'gameName', 'name', 'title', 'fileId', 'version',
    'jobId', 'taskId', 'agentTaskId', 'planId', 'preflightId', 'reference', 'state', 'status',
    'success', 'accepted', 'enabled', 'actionType', 'total', 'page', 'nextPage',
    'archiveRef', 'evidenceRef', 'errorCode', 'itemId', 'profileName', 'endpointType',
    'offset', 'nextOffset', 'verified', 'completionState'
  ]
  const pick = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {}
    return Object.fromEntries(fields.flatMap((key) => {
      const value = item[key]
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return [[key, value]]
      // 不能截断 ID 后再拿它查另一条记录；异常长标识直接省略。
      if (typeof value !== 'string' || !value.trim() || value.length > 256) return []
      return [[key, sanitizeTextForModel(value)]]
    }))
  }
  const summary = {}
  const add = (key, value) => {
    if (JSON.stringify({ ...summary, [key]: value }).length > 3200) return false
    summary[key] = value
    return true
  }
  for (const [key, value] of Object.entries(pick(result))) add(key, value)
  if (result.selectionRequest?.binding) {
    add('selectionRequest', {
      binding: sanitizeTextForModel(result.selectionRequest.binding),
      selected: (result.selectionRequest.selected || []).slice(0, 128).map((id) => sanitizeTextForModel(id))
    })
  }
  for (const key of ['record', 'detail', 'mod', 'task', 'plan', 'result', 'preflight']) {
    const value = pick(result?.[key])
    if (Object.keys(value).length) add(key, value)
  }
  for (const key of ['records', 'mods', 'tasks', 'games', 'candidates', 'dependencies']) {
    if (!Array.isArray(result?.[key])) continue
    const items = []
    for (const item of result[key].slice(0, 8)) {
      const value = pick(item)
      // 保持列表前缀顺序，避免省略一项后“第二个”指向错误对象。
      if (!Object.keys(value).length || !add(key, [...items, value])) break
      items.push(value)
    }
    if (items.length < result[key].length) summary.truncated = true
  }
  if (result?.truncated === true) summary.truncated = true
  return summary
}

// 只携带当前会话中的对话与执行摘要；不接受历史 system/tool 角色或隐藏推理。
export function buildAiAgentConversationHistory(messages = []) {
  const eligible = (Array.isArray(messages) ? messages : []).filter(
    (item) =>
      ['user', 'assistant'].includes(item?.role) &&
      item.streaming !== true &&
      item.type !== 'error'
  )
  const firstUser = eligible.find((item) => item.role === 'user' && typeof item.content === 'string' && item.content.trim())
  const recent = eligible.slice(-16)
  const selected = firstUser && !recent.includes(firstUser) ? [firstUser, ...recent] : recent
  const normalized = selected.map((item) => {
    const content = typeof item.content === 'string' ? sanitizeTextForModel(item.content, 6000).slice(0, 6000).trim() : ''
    const evidence = []
    const calls = (item.role === 'assistant' && Array.isArray(item.toolCalls) ? item.toolCalls : [])
      .filter((call) => call && typeof call === 'object')
      .slice(-6)
    for (const call of calls.reverse()) {
      const args = sanitizeForModel(call.arguments || {})
      const entry = {
        name: sanitizeTextForModel(call.name, 100),
        arguments: JSON.stringify(args).length <= 700 ? args : buildAiAgentToolResultSummary(args),
        success: typeof call.success === 'boolean' ? call.success : undefined,
        errorCode: sanitizeTextForModel(call.errorCode || '', 100),
        message: sanitizeTextForModel(call.message || '', 240),
        confirmationRequired: call.confirmationRequired === true,
        resultSummary: buildAiAgentToolResultSummary(call.resultSummary)
      }
      // 按完整记录分配预算，不把 JSON 截在 ID 或结果中间。
      if (JSON.stringify([entry, ...evidence]).length <= 4800) evidence.unshift(entry)
    }
    const evidenceText = evidence.length
      ? `\n历史执行摘要（仅作线索，当前状态需重新核验）：${JSON.stringify(evidence)}`
      : ''
    const isToolProtocol = item.role === 'assistant' &&
      /^(?:\{|\[|```(?:json)?\s*\{)/i.test(content) && parseAiAgentToolCalls(content).length > 0
    return {
      role: item.role,
      content: `${isToolProtocol ? '' : content.slice(0, evidenceText ? 1000 : 6000)}${evidenceText}`.trim()
    }
  }).filter((item) => item.content)

  // 优先最近的完整消息，同时为最初的用户目标保留空间。
  const anchor = firstUser && selected[0] === firstUser ? normalized[0] : null
  const retained = []
  let remaining = 12000 - (anchor?.content.length || 0)
  for (let index = normalized.length - 1; index >= (anchor ? 1 : 0); index -= 1) {
    const item = normalized[index]
    if (item.content.length > remaining) break
    retained.unshift(item)
    remaining -= item.content.length
  }
  return anchor ? [anchor, ...retained] : retained
}

function resolveContextSource(context = {}) {
  return toSafeText(context?.page?.source || context?.game?.source || 'vertex').toLowerCase()
}

function resolveSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source, 'Vertex')
}

export function buildContextScopeText(context = {}) {
  const sourceLabel = resolveSourceLabel(resolveContextSource(context))
  const gameName = toSafeText(context?.game?.name)
  const pageTitle = toSafeText(context?.page?.title)
  const scope = [sourceLabel, gameName || pageTitle].filter(Boolean).join(' / ')
  return scope || '当前页面'
}

function buildModelContextLine(options = {}) {
  const model = toSafeText(options.model)
  return model ? `当前模型：${model}` : ''
}

function buildInitialMessages(message = '', context = {}, tools = [], options = {}) {
  return [
    {
      role: 'system',
      content: buildAiAgentSystemPrompt(tools, { ...options, message, context })
    },
    ...buildAiAgentConversationHistory(options.history),
    {
      role: 'user',
      content: [
        `用户问题：${message}`,
        `当前范围：${buildContextScopeText(context)}`,
        buildModelContextLine(options),
        '当前页面上下文（已脱敏）：',
        stringifyForModel(context)
      ]
        .filter(Boolean)
        .join('\n')
    }
  ]
}

function normalizeToolCallSummary(call = {}, result = {}) {
  return {
    name: toSafeText(call.name),
    arguments: sanitizeForModel(call.arguments || {}),
    success: result?.success !== false,
    errorCode: toSafeText(result?.errorCode),
    message: toSafeText(result?.message),
    resultSummary: buildAiAgentToolResultSummary(result),
    confirmationRequired: result?.confirmationRequired === true,
    confirmation:
      result?.confirmation && typeof result.confirmation === 'object'
        ? sanitizeForModel(result.confirmation)
        : null
  }
}

function resolveNextPage(result = {}, total = 0) {
  const explicitNextPage = Number(result.nextPage ?? result.pagination?.nextPage)
  if (Number.isFinite(explicitNextPage) && explicitNextPage > 0) {
    return explicitNextPage
  }
  const page = Number(result.page ?? result.currentPage ?? result.pagination?.page)
  const pageSize = Number(result.pageSize ?? result.pagination?.pageSize)
  if (Number.isFinite(page) && page > 0 && Number.isFinite(pageSize) && pageSize > 0) {
    return page * pageSize < total ? page + 1 : undefined
  }
  return undefined
}

function appendTruncationMeta(result = {}, key = '', total = 0, returned = 0, limit = 0) {
  if (total <= returned) return
  const truncation = {
    total,
    returned,
    limit,
    truncated: true
  }
  const nextPage = resolveNextPage(result, total)
  if (nextPage) {
    truncation.nextPage = nextPage
  }
  result._modelMeta = {
    ...(isPlainObject(result._modelMeta) ? result._modelMeta : {}),
    truncation: {
      ...(isPlainObject(result._modelMeta?.truncation) ? result._modelMeta.truncation : {}),
      [key]: truncation
    }
  }
}

function truncateModelArray(result = {}, key = '', limit = 0) {
  if (!Array.isArray(result[key])) return
  const total = result[key].length
  result[key] = result[key]
    .slice(0, limit)
    .map((item) => sanitizeForModel(item))
    .filter((item) => typeof item !== 'undefined')
  appendTruncationMeta(result, key, total, result[key].length, limit)
}

function shrinkToolResult(name = '', result = {}) {
  const plainResult = toPlainJson(result, {})
  const safeResult = sanitizeForModel(plainResult)
  if (!safeResult || typeof safeResult !== 'object') {
    return safeResult
  }

  if (name === 'vertex.install.tasks') {
    const tasks = Array.isArray(plainResult.tasks)
      ? plainResult.tasks
      : Array.isArray(plainResult.records)
        ? plainResult.records
        : []
    if (Array.isArray(plainResult.tasks) || Array.isArray(plainResult.records)) {
      safeResult.tasks = tasks
      delete safeResult.records
      truncateModelArray(safeResult, 'tasks', MODEL_ARRAY_LIMITS.tasks)
    }
    return safeResult
  }

  for (const [key, limit] of Object.entries(MODEL_ARRAY_LIMITS)) {
    if (Array.isArray(plainResult[key])) {
      safeResult[key] = plainResult[key]
    }
    truncateModelArray(safeResult, key, limit)
  }

  return safeResult
}

function normalizeCandidate(candidate = {}, fallback = {}) {
  if (!isPlainObject(candidate)) return null
  const safeCandidate = sanitizeForModel(toPlainJson(candidate, {}))
  const selectedFile = isPlainObject(safeCandidate.selectedFile)
    ? safeCandidate.selectedFile
    : findSelectedFileFromList(safeCandidate)
  const selectedVersion = isPlainObject(safeCandidate.selectedVersion)
    ? safeCandidate.selectedVersion
    : findSelectedVersionFromList(safeCandidate, selectedFile)
  const sourceFields = resolveCandidateSourceFields(safeCandidate, fallback)
  const modId = pickFirstText(
    safeCandidate.modId,
    safeCandidate.mod_id,
    safeCandidate.id,
    safeCandidate.packageFullName,
    safeCandidate.fullName,
    safeCandidate.slug,
    safeCandidate.name
  )
  const name = pickFirstText(
    safeCandidate.name,
    safeCandidate.modName,
    safeCandidate.title,
    safeCandidate.displayName,
    safeCandidate.packageName,
    safeCandidate.fullName,
    modId
  )

  if (!modId && !name) return null

  return {
    ...safeCandidate,
    ...sourceFields,
    sourceLabel: pickFirstText(safeCandidate.sourceLabel, fallback.sourceLabel),
    modId: pickFirstText(safeCandidate.modId, safeCandidate.mod_id, modId),
    id: typeof safeCandidate.id === 'undefined' ? modId : safeCandidate.id,
    name,
    sourceGameId: pickFirstText(
      safeCandidate.sourceGameId,
      safeCandidate.source_game_id,
      safeCandidate.gameId,
      fallback.sourceGameId
    ),
    sourceSlug: pickFirstText(
      safeCandidate.sourceSlug,
      safeCandidate.source_slug,
      safeCandidate.domainName,
      safeCandidate.community,
      fallback.sourceSlug
    ),
    version: pickFirstText(
      safeCandidate.version,
      safeCandidate.modVersion,
      selectedVersion.version,
      selectedVersion.versionNumber,
      selectedVersion.version_number,
      selectedFile.version,
      selectedFile.versionName,
      fallback.version
    ),
    fileId: pickFirstText(
      safeCandidate.fileId,
      safeCandidate.file_id,
      safeCandidate.selectedFileId,
      safeCandidate.selected_file_id,
      selectedFile.fileId,
      selectedFile.file_id,
      selectedFile.id,
      selectedVersion.fileId,
      selectedVersion.file_id,
      selectedVersion.id,
      fallback.fileId
    ),
    fileName: pickFirstText(
      safeCandidate.fileName,
      safeCandidate.file_name,
      safeCandidate.selectedFileName,
      safeCandidate.selected_file_name,
      selectedFile.fileName,
      selectedFile.file_name,
      selectedFile.name,
      selectedVersion.fileName,
      selectedVersion.file_name,
      selectedVersion.name,
      fallback.fileName
    ),
    downloadUrl: pickFirstText(
      safeCandidate.downloadUrl,
      safeCandidate.download_url,
      selectedFile.downloadUrl,
      selectedFile.download_url,
      selectedVersion.downloadUrl,
      selectedVersion.download_url,
      fallback.downloadUrl
    )
  }
}

function collectSearchCandidates(result = {}) {
  return toSafeArray(result?.records)
    .slice(0, MAX_TOOL_RECORDS)
    .map((record) =>
      normalizeCandidate(record, {
        source: result?.source,
        displaySource: result?.displaySource,
        sourceLabel: result?.sourceLabel,
        sourceGameId: result?.sourceGameId || result?.source_game_id,
        sourceSlug: result?.sourceSlug || result?.source_slug || result?.domainName || result?.community
      })
    )
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      _candidateOrigin: 'tool_search'
    }))
}

function collectDetailCandidates(result = {}) {
  const fallback = {
    source: result?.source || result?.businessSource,
    displaySource: result?.displaySource,
    sourceLabel: result?.sourceLabel,
    sourceGameId: result?.sourceGameId || result?.source_game_id,
    sourceSlug: result?.sourceSlug || result?.source_slug || result?.domainName || result?.community,
    version: result?.version,
    fileId: result?.fileId || result?.file_id,
    fileName: result?.fileName || result?.file_name,
    downloadUrl: result?.downloadUrl || result?.download_url
  }
  const candidates = ['record', 'detail', 'mod', 'data']
    .map((key) => normalizeCandidate(result?.[key], fallback))
    .filter(Boolean)

  if (!candidates.length) {
    const candidate = normalizeCandidate(result, fallback)
    if (candidate) candidates.push(candidate)
  }

  return candidates.slice(0, 1).map((candidate) => ({
    ...candidate,
    _candidateOrigin: 'tool_detail'
  }))
}

function collectCandidatesFromResult(name = '', result = {}) {
  if (result?.success === false) return []
  if (name === 'vertex.mod.search') {
    return collectSearchCandidates(result)
  }
  if (name === 'vertex.mod.detail') {
    return collectDetailCandidates(result)
  }
  if (name === 'vertex.page.context') {
    const snapshot = isPlainObject(result?.snapshot) ? result.snapshot : result
    return collectPageContextCandidates(snapshot)
  }
  return []
}

function collectPageSearchSelectedCandidates(snapshot = {}, fallback = {}) {
  const search = isPlainObject(snapshot.search) ? snapshot.search : {}
  const selectedRecords = [
    ...(isPlainObject(search.selectedRecord) ? [search.selectedRecord] : []),
    ...toSafeArray(search.selectedRecords).filter(isPlainObject)
  ]

  return selectedRecords
    .slice(0, MAX_TOOL_RECORDS)
    .map((record) => normalizeCandidate(record, fallback))
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      _candidateOrigin: 'page_context_selected_record',
      selected: true
    }))
}

function collectPageContextCandidates(context = {}) {
  const snapshot = toPlainJson(context, {})
  const page = isPlainObject(snapshot.page) ? snapshot.page : {}
  const mod = isPlainObject(snapshot.mod) ? snapshot.mod : {}
  const game = isPlainObject(snapshot.game) ? snapshot.game : {}
  const pageType = toSafeText(page.type)
  const fallback = {
    source: pickFirstText(
      snapshot.businessSource,
      page.businessSource,
      page.source,
      game.businessSource,
      game.source
    ),
    displaySource: pickFirstText(snapshot.displaySource, page.displaySource, game.displaySource),
    sourceLabel: pickFirstText(snapshot.businessSourceLabel, snapshot.sourceLabel),
    sourceGameId: pickFirstText(snapshot.sourceGameId, game.sourceGameId),
    sourceSlug: pickFirstText(snapshot.sourceSlug, game.sourceSlug),
    gameId: pickFirstText(game.id, game.gameId)
  }
  const selectedSearchCandidates = collectPageSearchSelectedCandidates(snapshot, fallback)
  if (pageType !== 'mod_detail' && !toSafeText(mod.modId || mod.id)) {
    return selectedSearchCandidates
  }

  const candidate = normalizeCandidate(
    {
      ...mod,
      source: pickFirstText(
        mod.source,
        mod.businessSource,
        snapshot.businessSource,
        page.businessSource,
        page.source
      ),
      displaySource: pickFirstText(mod.displaySource, snapshot.displaySource, page.displaySource),
      sourceLabel: pickFirstText(
        snapshot.businessSourceLabel,
        mod.sourceLabel,
        snapshot.sourceLabel
      ),
      sourceGameId: pickFirstText(mod.sourceGameId, snapshot.sourceGameId, game.sourceGameId),
      sourceSlug: pickFirstText(mod.sourceSlug, snapshot.sourceSlug, game.sourceSlug),
      gameId: pickFirstText(mod.gameId, game.id, game.gameId),
      gameName: pickFirstText(game.name, snapshot.gameName)
    },
    {}
  )

  if (!candidate) return selectedSearchCandidates
  return [
    ...selectedSearchCandidates,
    {
      ...candidate,
      _candidateOrigin: 'page_context_mod_detail',
      selected: candidate.selected === true || pageType === 'mod_detail'
    }
  ]
}

function mergeCandidates(...candidateGroups) {
  return mergeAiAgentCandidates(candidateGroups, MAX_TOOL_RECORDS)
}

function dedupeToolCallSummaries(toolCalls = []) {
  const summaryMap = new Map()
  for (const call of toSafeArray(toolCalls)) {
    const key = [toSafeText(call.name), toSafeText(call.errorCode), toSafeText(call.message)].join(
      '::'
    )
    if (!summaryMap.has(key)) {
      summaryMap.set(key, call)
    }
  }
  return [...summaryMap.values()]
}

function buildFallbackAssistantMessage(options = {}) {
  const candidates = toSafeArray(options.candidates)
  const failedCalls = dedupeToolCallSummaries(
    toSafeArray(options.toolCalls).filter((item) => item.success === false)
  )
  if (candidates.length) {
    return `已根据当前范围搜索到 ${candidates.length} 个候选模组。请选择候选项生成安装计划，提交前仍需要你确认。`
  }
  if (failedCalls.length) {
    return failedCalls
      .map((call) => `${call.name} 未完成：${call.message || call.errorCode || '未知原因'}`)
      .join('\n')
  }
  return '已读取当前上下文，但本轮没有得到可展示的候选结果。请补充游戏、来源或关键词。'
}

export async function runAiAgentToolLoop(options = {}) {
  const message = toSafeText(options.message)
  const context = toPlainJson(options.context, {})
  const requestCompletion = options.requestCompletion
  const executeTool = options.executeTool
  const execution = options.execution || {}
  const messages = buildInitialMessages(message, context, options.tools || [], {
    model: options.model,
    history: options.history
  })
  const allToolCalls = []
  const confirmations = []
  let candidates = collectPageContextCandidates(context)
  let assistantMessage = ''

  if (typeof requestCompletion !== 'function') {
    throw new Error('AI Agent 缺少模型请求函数')
  }
  if (typeof executeTool !== 'function') {
    throw new Error('AI Agent 缺少工具执行函数')
  }

  for (let round = 0; round < MAX_TOOL_LOOP_COUNT; round += 1) {
    assertExecutionActive(execution)
    const content = await requestCompletion(messages, execution)
    const toolCalls = parseAiAgentToolCalls(content, { requireEnvelope: true }).slice(0, MAX_TOOL_CALLS_PER_ROUND)

    if (!toolCalls.length) {
      assistantMessage = content
      break
    }

    messages.push({
      role: 'assistant',
      content
    })

    const roundResults = []
    for (const toolCall of toolCalls) {
      assertExecutionActive(execution)
      const result = await executeTool(toolCall, context, execution)
      const summary = normalizeToolCallSummary(toolCall, result)
      const shrinked = shrinkToolResult(toolCall.name, result)
      allToolCalls.push(summary)
      if (result?.confirmationRequired === true && result?.confirmation) {
        confirmations.push(sanitizeForModel(result.confirmation))
      }
      candidates = mergeCandidates(candidates, collectCandidatesFromResult(toolCall.name, result))
      roundResults.push({
        ...summary,
        // 本轮已有完整工具结果；精简摘要仅用于下一次对话。
        resultSummary: undefined,
        result: shrinked
      })
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ _vertexToolResults: sanitizeForModel(roundResults), dataOnly: true }, null, 2)
    })
  }

  if (!assistantMessage || parseAiAgentToolCalls(assistantMessage).length) {
    assistantMessage = buildFallbackAssistantMessage({
      candidates,
      toolCalls: allToolCalls
    })
  }

  return {
    assistantMessage,
    candidates,
    confirmations,
    toolCalls: allToolCalls
  }
}
