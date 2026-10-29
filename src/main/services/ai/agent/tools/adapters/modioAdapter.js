import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_NODES = 50
const MODIO_SOURCE_LABEL = resolveSourcePlatformLabel('modio', 'Mod.io')

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function pickFirstIdentityText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text && text !== '0') return text
  }
  return ''
}

function pickImageUrl(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = toSafeText(value)
      if (text) return text
    }
    if (value && typeof value === 'object') {
      const text = pickFirstText(
        value.thumb_640x360,
        value.thumb320x180,
        value.original,
        value.url,
        value.filename
      )
      if (text) return text
    }
  }
  return ''
}

function resolveNestedModioRecord(record = {}) {
  if (!record || typeof record !== 'object') return {}
  if (record.mod && typeof record.mod === 'object') {
    return record.mod
  }
  if (record.dependency && typeof record.dependency === 'object') {
    return record.dependency
  }
  return {}
}

function resolveModioGameId(candidate = {}, context = {}) {
  return toSafeNumber(
    pickFirstText(
      candidate.gameId,
      candidate.game_id,
      candidate.modioGameId,
      candidate.modio_game_id,
      candidate.sourceGameId,
      context?.game?.sourceGameId,
      context?.game?.modioGameId,
      context?.game?.gameId,
      context?.game?.id,
      context?.route?.query?.sourceGameId,
      context?.route?.query?.modioGameId,
      context?.route?.query?.gameId
    ),
    0
  )
}

function resolveModioModId(record = {}) {
  const nested = resolveNestedModioRecord(record)
  return pickFirstIdentityText(
    record.modId,
    record.mod_id,
    record.dependencyId,
    record.dependency_id,
    record.sourceModId,
    nested.id,
    nested.modId,
    nested.mod_id,
    record.id
  )
}

function resolveModioFileId(record = {}) {
  const file = record.modfile || record.modFile || record.file || {}
  return pickFirstText(record.fileId, record.file_id, file?.id, file?.fileId, file?.file_id)
}

function normalizeModioVisitKey(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (!text) return ''
  if (!text.startsWith('modio:')) return text

  const parts = text.split(':').filter(Boolean)
  if (parts.length >= 4) {
    return parts[2] || ''
  }
  return parts[1] || text
}

function buildModioVisitKey(record = {}) {
  const modId = resolveModioModId(record)
  return normalizeModioVisitKey(modId || record.id || record.sourceModKey || record.name)
}

function collectModioDependencySources(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const nested = resolveNestedModioRecord(source)
  const file = source.modfile || source.modFile || source.file || {}
  const groups = [
    source.dependencies,
    source.requiredMods,
    source.required_mods,
    source.requires,
    source.required,
    source.metadata?.dependencies,
    source.latestVersion?.dependencies,
    file?.dependencies,
    nested?.dependencies,
    nested?.requiredMods,
    nested?.required_mods
  ]
  const result = []
  for (const group of groups) {
    if (Array.isArray(group)) {
      result.push(...group)
    }
  }
  return result
}

function normalizeModioDependencyList(list = [], options = {}) {
  const source = Array.isArray(list) ? list : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const node = normalizeModioNode(item, {
      ...options,
      isRoot: false,
      installState: options.installState || 'pending'
    })
    if (!node) continue

    const key = buildModioVisitKey(node)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(node)
  }

  return result
}

function normalizeModioNode(record = {}, options = {}) {
  if (typeof record === 'number' || typeof record === 'string') {
    const rawId = pickFirstIdentityText(record)
    if (!rawId) return null
    const modId = toSafeNumber(rawId, 0)
    return {
      source: 'modio',
      sourceType: 'modio',
      id: modId ? String(modId) : rawId,
      modId,
      fileId: 0,
      gameId: toSafeNumber(options.gameId, 0),
      name: modId ? `依赖模组-${modId}` : rawId,
      version: '',
      optional: false,
      dependencyRole: options.dependencyRole || 'required',
      dependencies: [],
      dependencyCount: 0,
      installState: options.installState || 'pending',
      isRoot: options.isRoot === true,
      depth: toSafeNumber(options.depth, 0),
      sortIndex: toSafeNumber(options.sortIndex, 0),
      sourceModKey: modId ? `modio:${modId}` : '',
      raw: record
    }
  }

  if (!record || typeof record !== 'object') {
    return null
  }

  const nested = resolveNestedModioRecord(record)
  const file = record.modfile || record.modFile || record.file || nested.modfile || {}
  const modId = toSafeNumber(resolveModioModId(record), 0)
  const fallbackId = pickFirstIdentityText(record.id, nested.id, record.name, nested.name)
  const id = modId ? String(modId) : fallbackId
  const name = pickFirstText(
    record.name,
    record.modName,
    record.mod_name,
    record.dependency_name,
    nested.name,
    modId ? `依赖模组-${modId}` : fallbackId
  )

  if (!id && !name) {
    return null
  }

  const fileId = toSafeNumber(resolveModioFileId(record), 0)
  const gameId = toSafeNumber(
    pickFirstText(record.gameId, record.game_id, nested.gameId, nested.game_id, options.gameId),
    0
  )
  const dependencyRole = pickFirstText(
    record.dependencyRole,
    record.dependency_role,
    options.dependencyRole,
    'required'
  )
  const dependencies = normalizeModioDependencyList(collectModioDependencySources(record), {
    gameId,
    installState: 'pending'
  })

  return {
    source: 'modio',
    sourceType: 'modio',
    id: id || name,
    modId,
    fileId,
    gameId,
    name,
    summary: pickFirstText(
      record.summary,
      record.description,
      nested.summary,
      nested.description_plaintext
    ),
    version: pickFirstText(record.version, record.modVersion, file?.version, nested.version),
    profileUrl: pickFirstText(record.profileUrl, record.profile_url, nested.profile_url),
    pictureUrl: pickImageUrl(
      record.pictureUrl,
      record.logo,
      nested.logo,
      nested.media?.images?.[0]
    ),
    optional:
      record.optional === true ||
      record.isOptional === true ||
      dependencyRole.toLowerCase().includes('optional'),
    dependencyRole,
    dependencies,
    dependencyCount: dependencies.length,
    installState: options.installState || 'pending',
    isRoot: options.isRoot === true,
    depth: toSafeNumber(options.depth, 0),
    sortIndex: toSafeNumber(options.sortIndex, 0),
    sourceModKey: modId ? (fileId ? `modio:${modId}:${fileId}` : `modio:${modId}`) : '',
    raw: toPlainJson(record, {})
  }
}

function createInstalledSet(ctx = {}, context = {}) {
  const sources = [
    ctx.installedModioModIds,
    ctx.installedModIds,
    ctx.installedModioMods,
    ctx.installedMods,
    context?.installedModioModIds,
    context?.installedModIds,
    context?.installedModioMods,
    context?.installedMods
  ]
  const result = new Set()

  for (const source of sources) {
    for (const item of Array.isArray(source) ? source : []) {
      const rawKey =
        typeof item === 'string' || typeof item === 'number'
          ? item
          : item?.source === 'modio' ||
              item?.sourceType === 'modio' ||
              item?.sourcePlatform === 'modio'
            ? resolveModioModId(item) || item?.sourceModKey
            : ''
      const key = normalizeModioVisitKey(rawKey)
      if (key) {
        result.add(key)
      }
    }
  }

  return result
}

async function resolveGetDetail(ctx = {}, options = {}) {
  if (typeof ctx.getModDetail === 'function') {
    return ctx.getModDetail
  }
  if (options.allowDynamicImport !== true) {
    return null
  }
  const modSourceModule = await import('../../../../mod-source/runtime.js')
  return modSourceModule.getModSourceDetail
}

async function resolveGetDependencies(ctx = {}, options = {}) {
  if (typeof ctx.getModioDependencies === 'function') {
    return ctx.getModioDependencies
  }
  if (typeof ctx.getModioModDependencies === 'function') {
    return ctx.getModioModDependencies
  }
  if (options.allowDynamicImport !== true) {
    return null
  }
  const modSourceModule = await import('../../../../mod-source/runtime.js')
  return modSourceModule.getModioModDependencies || null
}

async function fetchModioDetail({ gameId, modId, context, getDetail }) {
  if (!modId || typeof getDetail !== 'function') return null

  try {
    const result = await getDetail({
      source: 'modio',
      gameId,
      modioGameId: gameId,
      modId,
      id: modId,
      context
    })
    if (result?.record && typeof result.record === 'object') {
      return result.record
    }
    if (
      result &&
      typeof result === 'object' &&
      !Object.prototype.hasOwnProperty.call(result, 'success')
    ) {
      return result
    }
    return null
  } catch {
    return null
  }
}

async function fetchModioDependencies({ gameId, modId, context, getDependencies }) {
  if (!gameId || !modId || typeof getDependencies !== 'function') return []

  try {
    const result = await getDependencies({
      source: 'modio',
      gameId,
      modioGameId: gameId,
      modId,
      id: modId,
      context
    })
    const list = Array.isArray(result)
      ? result
      : Array.isArray(result?.records)
        ? result.records
        : Array.isArray(result?.dependencies)
          ? result.dependencies
          : Array.isArray(result?.data)
            ? result.data
            : []
    return normalizeModioDependencyList(list, {
      gameId,
      installState: 'pending'
    })
  } catch {
    return []
  }
}

function withDependencies(node = null, dependencies = []) {
  if (!node) return null
  return {
    ...node,
    dependencies,
    dependencyCount: dependencies.length
  }
}

export async function resolveModioDependencies(args = {}, ctx = {}) {
  const candidate = toPlainJson(args.candidate, {})
  const context = toPlainJson(args.context || ctx?.pageContext, {})
  const gameId = resolveModioGameId(candidate, context)
  const maxDepth = Math.max(1, Math.min(3, toSafeNumber(args.maxDepth, DEFAULT_MAX_DEPTH)))
  const maxNodes = Math.max(1, Math.min(50, toSafeNumber(args.maxNodes, DEFAULT_MAX_NODES)))
  const installedSet = createInstalledSet(ctx, context)
  const warnings = []
  let detailResolver = typeof ctx.getModDetail === 'function' ? ctx.getModDetail : null
  let dependenciesResolver =
    typeof ctx.getModioDependencies === 'function'
      ? ctx.getModioDependencies
      : typeof ctx.getModioModDependencies === 'function'
        ? ctx.getModioModDependencies
        : null

  async function ensureDetailResolver() {
    if (!detailResolver) {
      detailResolver = await resolveGetDetail(ctx, {
        allowDynamicImport: Boolean(gameId)
      })
    }
    return detailResolver
  }

  async function ensureDependenciesResolver() {
    if (!dependenciesResolver) {
      dependenciesResolver = await resolveGetDependencies(ctx, {
        allowDynamicImport: Boolean(gameId)
      })
    }
    return dependenciesResolver
  }

  let rootRecord = {
    ...candidate,
    gameId: gameId || candidate.gameId
  }
  let root = normalizeModioNode(rootRecord, {
    isRoot: true,
    gameId,
    depth: 0,
    sortIndex: 0
  })

  if (!root) {
    return {
      success: false,
      source: 'modio',
      sourceLabel: MODIO_SOURCE_LABEL,
      errorCode: 'missing_modio_context',
      message: 'Mod.io 依赖解析缺少 modId / id。'
    }
  }

  if (!root.dependencies.length) {
    const detailRecord = await fetchModioDetail({
      gameId,
      modId: root.modId,
      context,
      getDetail: await ensureDetailResolver()
    })
    if (detailRecord) {
      rootRecord = {
        ...rootRecord,
        ...detailRecord,
        gameId: gameId || detailRecord.gameId,
        modId: root.modId || detailRecord.modId || detailRecord.id
      }
      root = normalizeModioNode(rootRecord, {
        isRoot: true,
        gameId,
        depth: 0,
        sortIndex: 0
      })
    }
  }

  if (!root.dependencies.length) {
    root = withDependencies(
      root,
      await fetchModioDependencies({
        gameId,
        modId: root.modId,
        context,
        getDependencies: await ensureDependenciesResolver()
      })
    )
  }

  const visited = new Set([buildModioVisitKey(root)])
  const installPlan = [root]
  const dependencies = []
  const queue = root.dependencies.map((dependency) => ({
    dependency,
    depth: 1
  }))

  while (queue.length && installPlan.length < maxNodes) {
    const { dependency, depth } = queue.shift()
    const key = buildModioVisitKey(dependency)
    if (!key || visited.has(key)) {
      continue
    }
    visited.add(key)

    const installed = installedSet.has(key)
    let node = normalizeModioNode(dependency, {
      gameId,
      depth,
      sortIndex: installPlan.length,
      installState: installed ? 'reused_installed' : 'pending'
    })

    if (node && depth <= maxDepth) {
      const detailRecord = await fetchModioDetail({
        gameId,
        modId: node.modId,
        context,
        getDetail: await ensureDetailResolver()
      })
      if (detailRecord) {
        node = normalizeModioNode(
          {
            ...detailRecord,
            modId: node.modId || detailRecord.modId || detailRecord.id,
            fileId: node.fileId || detailRecord.fileId || detailRecord.file_id,
            optional: node.optional,
            dependencyRole: node.dependencyRole
          },
          {
            gameId,
            depth,
            sortIndex: installPlan.length,
            installState: installed ? 'reused_installed' : 'pending'
          }
        )
      }

      if (node && !node.dependencies.length) {
        node = withDependencies(
          node,
          await fetchModioDependencies({
            gameId,
            modId: node.modId,
            context,
            getDependencies: await ensureDependenciesResolver()
          })
        )
      }
    }

    if (!node) continue

    installPlan.push(node)
    dependencies.push(node)

    if (depth < maxDepth) {
      for (const childDependency of node.dependencies) {
        if (installPlan.length + queue.length >= maxNodes) {
          warnings.push(`依赖节点数量达到上限 ${maxNodes}，已停止继续展开。`)
          break
        }
        queue.push({
          dependency: childDependency,
          depth: depth + 1
        })
      }
    } else if (node.dependencies.length) {
      warnings.push(
        `依赖 ${node.name || node.id} 已达到递归深度上限 ${maxDepth}，未继续展开子依赖。`
      )
    }
  }

  const truncated = queue.length > 0
  if (truncated) {
    warnings.push(`Mod.io 依赖解析达到节点上限 ${maxNodes}，仍有 ${queue.length} 个节点未展开。`)
  }

  const reusedInstalledDependencies = dependencies.filter(
    (item) => item.installState === 'reused_installed'
  )
  const pendingInstallCount = installPlan.filter((item) => item.installState === 'pending').length

  return {
    success: true,
    source: 'modio',
    sourceLabel: MODIO_SOURCE_LABEL,
    resolverStatus: dependencies.length ? 'resolved' : 'unsupported',
    recursive: dependencies.length > 0,
    maxDepth,
    maxNodes,
    truncated,
    warnings,
    request: {
      gameId,
      modId: root.modId,
      version: root.version
    },
    root,
    dependencyCount: dependencies.length,
    pendingInstallCount,
    reusedInstalledDependencyCount: reusedInstalledDependencies.length,
    dependencies,
    installPlan,
    reusedInstalledDependencies,
    canSubmitInstallTask: false,
    message: dependencies.length
      ? `Mod.io 依赖解析完成，发现 ${dependencies.length} 个依赖。`
      : 'Mod.io 未读取到依赖元数据，暂不能生成递归依赖计划。'
  }
}
