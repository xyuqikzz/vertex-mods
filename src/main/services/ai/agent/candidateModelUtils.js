import { sanitizeForModel } from '../../../../shared/ai/tools/ai-agent-tool-loop.js'
import { resolveBusinessSource } from '../../../../shared/sources/source-platform-registry.js'
import { mergeAiAgentCandidates } from '../../../../shared/ai/conversation/ai-agent-candidate-merge.js'

export const MAX_AGENT_MODEL_CANDIDATES = 8

const MODEL_ARRAY_LIMITS = Object.freeze({
  records: MAX_AGENT_MODEL_CANDIDATES,
  tasks: 10,
  conflicts: 20,
  mods: 50,
  games: 50
})

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
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
  const files = Array.isArray(candidate.files) ? candidate.files.filter(isPlainObject) : []
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
  const versions = Array.isArray(candidate.versions) ? candidate.versions.filter(isPlainObject) : []
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

export function shrinkToolResultForModel(nameOrResult = '', maybeResult = undefined) {
  const hasToolName = typeof nameOrResult === 'string'
  const name = hasToolName ? nameOrResult : ''
  const result = hasToolName ? maybeResult || {} : nameOrResult || {}
  const plainResult = toPlainJson(result, {})
  const safeResult = sanitizeForModel(plainResult)
  if (!safeResult || typeof safeResult !== 'object') {
    return safeResult
  }
  if (plainResult.document?.content && name === 'vertex.install.archive.inspect') {
    // Paginated documents already have a bounded size. Preserve that complete page;
    // slicing again would silently skip text at document.nextOffset.
    safeResult.document = { ...sanitizeForModel(plainResult.document), content: sanitizeForModel(plainResult.document.content.slice(0, 8000), 0, 'evidenceContent') }
  }
  if (Array.isArray(plainResult.selectionRequests)) {
    safeResult.selectionRequests = plainResult.selectionRequests.slice(0, 50).map((entry) => ({
      itemId: entry.itemId, selectionRequest: sanitizeForModel(entry.selectionRequest)
    }))
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
  const records = Array.isArray(result?.records) ? result.records : []
  return records
    .slice(0, MAX_AGENT_MODEL_CANDIDATES)
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

function collectPageSearchSelectedCandidates(snapshot = {}, fallback = {}) {
  const search = isPlainObject(snapshot.search) ? snapshot.search : {}
  const selectedRecords = [
    ...(isPlainObject(search.selectedRecord) ? [search.selectedRecord] : []),
    ...(Array.isArray(search.selectedRecords) ? search.selectedRecords.filter(isPlainObject) : [])
  ]

  return selectedRecords
    .slice(0, MAX_AGENT_MODEL_CANDIDATES)
    .map((record) => normalizeCandidate(record, fallback))
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      _candidateOrigin: 'page_context_selected_record',
      selected: true
    }))
}

export function collectCandidates(name = '', result = {}) {
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

export function collectPageContextCandidates(context = {}) {
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

export function mergeCandidates(...groups) {
  return mergeAiAgentCandidates(groups, MAX_AGENT_MODEL_CANDIDATES)
}
