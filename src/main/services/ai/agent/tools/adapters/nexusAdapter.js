import {
  isNexusRequirementRawExternal,
  resolveNexusRequirementExternalFlag,
  resolveNexusRequirementModId as resolveSharedNexusRequirementModId
} from '../../../../../../shared/sources/nexus-requirement-normalizer.js'
import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_NODES = 50
const NEXUS_SOURCE_LABEL = resolveSourcePlatformLabel('nexus', 'Nexus')

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

function normalizeImageText(value = '') {
  if (!value) {
    return ''
  }
  if (typeof value === 'object') {
    return pickFirstText(
      value.url,
      value.src,
      value.uri,
      value.href,
      value.link,
      value.original,
      value.thumbnail,
      value.image,
      value.logo
    )
  }
  const text = toSafeText(value)
  return text && text !== '[object Object]' ? text : ''
}

function pickFirstImageText(...values) {
  for (const value of values) {
    const text = normalizeImageText(value)
    if (text) return text
  }
  return ''
}

function resolveNexusLogoUrl(record = {}) {
  const mediaImages = Array.isArray(record?.media?.images) ? record.media.images : []
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  return pickFirstImageText(
    record.pictureUrl,
    record.picture_url,
    record.logoUrl,
    record.logo_url,
    record.iconUrl,
    record.icon_url,
    record.coverUrl,
    record.cover_url,
    record.thumbnailUrl,
    record.thumbnail_url,
    record.imageUrl,
    record.image_url,
    record.logo,
    record.icon,
    record.cover,
    record.coverImage,
    record.cover_image,
    record.thumbnail,
    record.image,
    record.avatar,
    mediaImages[0],
    metadata.pictureUrl,
    metadata.picture_url,
    metadata.logo,
    metadata.icon,
    metadata.cover,
    metadata.coverImage,
    metadata.cover_image,
    metadata.thumbnail,
    metadata.image
  )
}

function normalizeGameDomainName(value = '') {
  return toSafeText(value)
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function parseNexusModPageLink(value = '') {
  const rawUrl = toSafeText(value)
  if (!rawUrl) {
    return {
      isNexusModLink: false,
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }

  try {
    const url = new URL(rawUrl)
    const hostname = toSafeText(url.hostname).toLowerCase()
    const isNexusHost =
      hostname === 'nexusmods.com' ||
      hostname === 'www.nexusmods.com' ||
      hostname === 'next.nexusmods.com'
    const pathMatch = url.pathname.match(/^\/([^/]+)\/mods\/(\d+)(?:\/|$)/i)

    if (!isNexusHost || !pathMatch) {
      return {
        isNexusModLink: false,
        domainName: '',
        modId: 0,
        fileId: 0
      }
    }

    const fileId = toSafeNumber(
      url.searchParams.get('file_id') || url.searchParams.get('fileId'),
      0
    )

    return {
      isNexusModLink: true,
      domainName: normalizeGameDomainName(pathMatch[1]),
      modId: toSafeNumber(pathMatch[2], 0),
      fileId: fileId > 0 ? fileId : 0
    }
  } catch {
    return {
      isNexusModLink: false,
      domainName: '',
      modId: 0,
      fileId: 0
    }
  }
}

function resolveNexusDomainName(candidate = {}, context = {}) {
  return normalizeGameDomainName(
    pickFirstText(
      candidate.domainName,
      candidate.domain_name,
      candidate.gameDomainName,
      candidate.nexusGameDomain,
      candidate.sourceGameDomain,
      context?.game?.domainName,
      context?.game?.gameDomainName,
      context?.game?.nexusGameDomain,
      context?.game?.sourceSlug,
      context?.route?.query?.domainName,
      context?.route?.query?.gameDomainName,
      context?.route?.query?.nexusGameDomain,
      context?.page?.source === 'nexus' ? context?.route?.params?.id : ''
    )
  )
}

function resolveNexusModId(record = {}, linkMeta = {}) {
  return resolveSharedNexusRequirementModId(record, linkMeta)
}

function resolveNexusFileId(record = {}, linkMeta = {}) {
  return toSafeNumber(
    pickFirstText(record.fileId, record.file_id, record.sourceFileId, linkMeta.fileId),
    0
  )
}

function buildNexusVisitKey(record = {}, fallbackDomainName = '') {
  const linkMeta = parseNexusModPageLink(record.url || record.profileUrl || record.sourcePageUrl)
  const domainName = normalizeGameDomainName(
    record.domainName ||
      record.domain_name ||
      record.gameDomainName ||
      record.nexusGameDomain ||
      linkMeta.domainName ||
      fallbackDomainName
  )
  const modId = resolveNexusModId(record, linkMeta) || linkMeta.modId
  if (!modId) {
    return ''
  }
  return domainName ? `${domainName}:${modId}` : `mod:${modId}`
}

function collectNexusDependencySources(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const groups = [
    source.dependencies,
    source.requirements,
    source.nexusDependencies,
    source.externalDependencies,
    source.requiredMods,
    source.required_mods,
    source.metadata?.dependencies
  ]
  const result = []
  for (const group of groups) {
    if (Array.isArray(group)) {
      result.push(...group)
    }
  }
  return result
}

function normalizeDlcRequirements(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => ({
      id: pickFirstText(item?.id, item?.gameExpansion?.id, index),
      name: pickFirstText(item?.name, item?.gameExpansion?.name, `DLC-${index + 1}`),
      notes: toSafeText(item?.notes),
      raw: toPlainJson(item, {})
    }))
    .filter((item) => item.id || item.name)
}

function normalizeNexusDependencyList(list = [], options = {}) {
  const source = Array.isArray(list) ? list : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const node = normalizeNexusNode(item, {
      ...options,
      isRoot: false,
      installState: options.installState || 'pending'
    })
    if (!node) continue

    const key =
      node.sourceType === 'nexus'
        ? buildNexusVisitKey(node, options.domainName)
        : `external:${node.url || node.name || node.id}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(node)
  }

  return result
}

function normalizeNexusNode(record = {}, options = {}) {
  if (typeof record === 'number' || typeof record === 'string') {
    const linkMeta = parseNexusModPageLink(record)
    const rawId = pickFirstText(record)
    const modId = linkMeta.modId || toSafeNumber(rawId, 0)
    if (!modId && !rawId) return null
    const domainName = normalizeGameDomainName(linkMeta.domainName || options.domainName)
    const externalRequirement = !modId

    return {
      source: 'nexus',
      sourceType: externalRequirement ? 'external' : 'nexus',
      id: modId ? `${domainName || 'nexus'}:${modId}` : rawId,
      modId,
      fileId: linkMeta.fileId || 0,
      domainName,
      fileName: '',
      fileSize: 0,
      downloadUrl: '',
      name: modId ? `Nexus Mod ${modId}` : rawId,
      version: '',
      description: '',
      summary: '',
      notes: '',
      url: linkMeta.isNexusModLink ? rawId : '',
      externalRequirement,
      rawExternalRequirement: externalRequirement,
      optional: false,
      dependencies: [],
      dependencyCount: 0,
      dlcRequirements: [],
      installState: externalRequirement ? 'external' : options.installState || 'pending',
      isRoot: options.isRoot === true,
      depth: toSafeNumber(options.depth, 0),
      sortIndex: toSafeNumber(options.sortIndex, 0),
      sourceModKey: modId ? ['nexus', domainName, modId].filter(Boolean).join(':') : '',
      raw: record
    }
  }

  if (!record || typeof record !== 'object') {
    return null
  }

  const linkMeta = parseNexusModPageLink(
    record.url || record.profileUrl || record.profile_url || record.sourcePageUrl
  )
  const domainName = normalizeGameDomainName(
    pickFirstText(
      record.domainName,
      record.domain_name,
      record.gameDomainName,
      record.nexusGameDomain,
      linkMeta.domainName,
      options.domainName
    )
  )
  const modId = resolveNexusModId(record, linkMeta) || linkMeta.modId
  const id = pickFirstText(record.id, modId ? `${domainName || 'nexus'}:${modId}` : '')
  const rawExternalRequirement = isNexusRequirementRawExternal(record)
  const externalRequirement =
    (record.sourceType === 'external' && modId <= 0 && !linkMeta.isNexusModLink) ||
    resolveNexusRequirementExternalFlag(record, modId, linkMeta)
  const fileId = resolveNexusFileId(record, linkMeta)
  const primaryFile =
    record.primaryFile && typeof record.primaryFile === 'object' ? record.primaryFile : {}
  const logoUrl = resolveNexusLogoUrl(record)
  const dependencies = normalizeNexusDependencyList(collectNexusDependencySources(record), {
    domainName,
    installState: 'pending'
  })
  const dlcRequirements = normalizeDlcRequirements(record.dlcRequirements)

  if (!id && !modId && !record.name && !record.url) {
    return null
  }

  return {
    source: 'nexus',
    sourceType: externalRequirement ? 'external' : 'nexus',
    id: id || pickFirstText(record.url, record.name),
    modId,
    fileId,
    domainName,
    fileName: pickFirstText(
      record.fileName,
      record.file_name,
      primaryFile.name,
      primaryFile.file_name
    ),
    fileSize: toSafeNumber(
      pickFirstText(
        record.fileSize,
        record.file_size,
        primaryFile.size,
        primaryFile.size_bytes,
        primaryFile.size_kb ? toSafeNumber(primaryFile.size_kb, 0) * 1024 : ''
      ),
      0
    ),
    downloadUrl: pickFirstText(
      record.downloadUrl,
      record.download_url,
      record.downloadLink,
      record.download_link
    ),
    name: pickFirstText(
      record.name,
      record.modName,
      record.mod_name,
      modId ? `Nexus Mod ${modId}` : ''
    ),
    version: pickFirstText(
      record.version,
      record.modVersion,
      record.mod_version,
      primaryFile.version
    ),
    pictureUrl: logoUrl,
    picture_url: logoUrl,
    logo: logoUrl,
    icon: logoUrl,
    cover: logoUrl,
    coverImage: logoUrl,
    imageUrl: logoUrl,
    thumbnailUrl: logoUrl,
    description: toSafeText(record.description),
    summary: toSafeText(record.summary),
    notes: toSafeText(record.notes),
    url: toSafeText(record.url || record.profileUrl || record.profile_url),
    externalRequirement,
    rawExternalRequirement,
    optional: record.optional === true,
    dependencies,
    dependencyCount: dependencies.length,
    dlcRequirements,
    installState: externalRequirement ? 'external' : options.installState || 'pending',
    isRoot: options.isRoot === true,
    depth: toSafeNumber(options.depth, 0),
    sortIndex: toSafeNumber(options.sortIndex, 0),
    sourceModKey: modId ? ['nexus', domainName, modId, fileId || ''].filter(Boolean).join(':') : '',
    raw: toPlainJson(record, {})
  }
}

function createInstalledSet(ctx = {}, context = {}) {
  const sources = [
    ctx.installedNexusModIds,
    ctx.installedModIds,
    ctx.installedNexusMods,
    ctx.installedMods,
    context?.installedNexusModIds,
    context?.installedModIds,
    context?.installedNexusMods,
    context?.installedMods
  ]
  const result = new Set()

  for (const source of sources) {
    for (const item of Array.isArray(source) ? source : []) {
      if (typeof item === 'string' || typeof item === 'number') {
        const id = toSafeNumber(item, 0)
        if (id > 0) {
          result.add(`mod:${id}`)
        }
        continue
      }

      if (
        item?.source !== 'nexus' &&
        item?.sourceType !== 'nexus' &&
        item?.sourcePlatform !== 'nexus'
      ) {
        continue
      }

      const key = buildNexusVisitKey(item)
      if (key) {
        result.add(key)
      }
      const modId = resolveNexusModId(item)
      if (modId > 0) {
        result.add(`mod:${modId}`)
      }
    }
  }

  return result
}

function isInstalledNexusNode(node = {}, installedSet = new Set()) {
  const key = buildNexusVisitKey(node, node.domainName)
  if (key && installedSet.has(key)) return true
  return node.modId > 0 && installedSet.has(`mod:${node.modId}`)
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

async function resolveGetRequirements(ctx = {}, options = {}) {
  if (typeof ctx.getNexusRequirements === 'function') {
    return ctx.getNexusRequirements
  }
  if (typeof ctx.getNexusModRequirements === 'function') {
    return ctx.getNexusModRequirements
  }
  if (options.allowDynamicImport !== true) {
    return null
  }
  const modSourceModule = await import('../../../../mod-source/runtime.js')
  return modSourceModule.getNexusModRequirements || null
}

async function fetchNexusDetail({ domainName, modId, context, getDetail }) {
  if (!domainName || !modId || typeof getDetail !== 'function') return null

  try {
    const result = await getDetail({
      source: 'nexus',
      domainName,
      gameDomainName: domainName,
      nexusGameDomain: domainName,
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

async function fetchNexusRequirements({ domainName, modId, context, getRequirements }) {
  if (!domainName || !modId || typeof getRequirements !== 'function') {
    return {
      dependencies: [],
      dlcRequirements: []
    }
  }

  try {
    const result = await getRequirements({
      source: 'nexus',
      domainName,
      gameDomainName: domainName,
      nexusGameDomain: domainName,
      modId,
      id: modId,
      context
    })
    const dependencies = Array.isArray(result)
      ? result
      : Array.isArray(result?.dependencies)
        ? result.dependencies
        : [
            ...(Array.isArray(result?.nexusDependencies) ? result.nexusDependencies : []),
            ...(Array.isArray(result?.externalDependencies) ? result.externalDependencies : [])
          ]
    return {
      modName: pickFirstText(result?.modName),
      totalCount: toSafeNumber(result?.totalCount, dependencies.length),
      dependencies: normalizeNexusDependencyList(dependencies, {
        domainName,
        installState: 'pending'
      }),
      dlcRequirements: normalizeDlcRequirements(result?.dlcRequirements),
      raw: toPlainJson(result, {})
    }
  } catch {
    return {
      dependencies: [],
      dlcRequirements: []
    }
  }
}

function withRequirementResult(node = null, requirementResult = {}) {
  if (!node) return null
  const dependencies = Array.isArray(requirementResult.dependencies)
    ? requirementResult.dependencies
    : node.dependencies
  const dlcRequirements = Array.isArray(requirementResult.dlcRequirements)
    ? requirementResult.dlcRequirements
    : node.dlcRequirements
  return {
    ...node,
    name: pickFirstText(node.name, requirementResult.modName),
    dependencies,
    dependencyCount: dependencies.length,
    dlcRequirements,
    requirementTotalCount: toSafeNumber(requirementResult.totalCount, dependencies.length)
  }
}

function withDetailRecord(node = null, detailRecord = null) {
  if (!node || !detailRecord) return node
  const detailNode = normalizeNexusNode(
    {
      ...detailRecord,
      domainName: node.domainName || detailRecord.domainName,
      modId: node.modId || detailRecord.modId || detailRecord.id,
      fileId: node.fileId || detailRecord.fileId || detailRecord.file_id,
      dependencies: node.dependencies.length ? node.dependencies : detailRecord.dependencies,
      externalRequirement: node.externalRequirement,
      sourceType: node.sourceType
    },
    {
      domainName: node.domainName,
      depth: node.depth,
      sortIndex: node.sortIndex,
      installState: node.installState,
      isRoot: node.isRoot
    }
  )
  return detailNode || node
}

export async function resolveNexusDependencies(args = {}, ctx = {}) {
  const candidate = toPlainJson(args.candidate, {})
  const context = toPlainJson(args.context || ctx?.pageContext, {})
  const domainName = resolveNexusDomainName(candidate, context)
  const maxDepth = Math.max(1, Math.min(3, toSafeNumber(args.maxDepth, DEFAULT_MAX_DEPTH)))
  const maxNodes = Math.max(1, Math.min(50, toSafeNumber(args.maxNodes, DEFAULT_MAX_NODES)))
  const installedSet = createInstalledSet(ctx, context)
  const warnings = []
  let detailResolver = typeof ctx.getModDetail === 'function' ? ctx.getModDetail : null
  let requirementsResolver =
    typeof ctx.getNexusRequirements === 'function'
      ? ctx.getNexusRequirements
      : typeof ctx.getNexusModRequirements === 'function'
        ? ctx.getNexusModRequirements
        : null

  async function ensureDetailResolver() {
    if (!detailResolver) {
      detailResolver = await resolveGetDetail(ctx, {
        allowDynamicImport: Boolean(domainName)
      })
    }
    return detailResolver
  }

  async function ensureRequirementsResolver() {
    if (!requirementsResolver) {
      requirementsResolver = await resolveGetRequirements(ctx, {
        allowDynamicImport: Boolean(domainName)
      })
    }
    return requirementsResolver
  }

  let rootRecord = {
    ...candidate,
    domainName: domainName || candidate.domainName
  }
  let root = normalizeNexusNode(rootRecord, {
    isRoot: true,
    domainName,
    depth: 0,
    sortIndex: 0
  })

  if (!root || !root.modId || !root.domainName) {
    return {
      success: false,
      source: 'nexus',
      sourceLabel: NEXUS_SOURCE_LABEL,
      errorCode: 'missing_nexus_context',
      message: 'Nexus 依赖解析缺少 domainName / modId。',
      missing: [!root?.domainName ? 'domainName' : '', !root?.modId ? 'modId' : ''].filter(Boolean)
    }
  }

  if (!root.dependencies.length) {
    root = withRequirementResult(
      root,
      await fetchNexusRequirements({
        domainName: root.domainName,
        modId: root.modId,
        context,
        getRequirements: await ensureRequirementsResolver()
      })
    )
  }

  if (!root.dependencies.length) {
    root = withDetailRecord(
      root,
      await fetchNexusDetail({
        domainName: root.domainName,
        modId: root.modId,
        context,
        getDetail: await ensureDetailResolver()
      })
    )
  }
  if (
    (root.dependencies.length || root.fileId || root.downloadUrl) &&
    (!root.fileId || !root.downloadUrl)
  ) {
    root = withDetailRecord(
      root,
      await fetchNexusDetail({
        domainName: root.domainName,
        modId: root.modId,
        context,
        getDetail: await ensureDetailResolver()
      })
    )
  }

  const visited = new Set([buildNexusVisitKey(root, root.domainName)])
  const installPlan = [root]
  const dependencies = []
  const queue = root.dependencies.map((dependency) => ({
    dependency,
    depth: 1
  }))

  while (queue.length && installPlan.length < maxNodes) {
    const { dependency, depth } = queue.shift()
    const key =
      dependency.sourceType === 'nexus'
        ? buildNexusVisitKey(dependency, dependency.domainName || root.domainName)
        : `external:${dependency.url || dependency.name || dependency.id}`
    if (!key || visited.has(key)) {
      continue
    }
    visited.add(key)

    let node = normalizeNexusNode(dependency, {
      domainName: dependency.domainName || root.domainName,
      depth,
      sortIndex: installPlan.length,
      installState: 'pending'
    })
    if (!node) continue

    if (node.sourceType === 'nexus' && node.modId > 0) {
      const installed = isInstalledNexusNode(node, installedSet)
      node = {
        ...node,
        installState: installed ? 'reused_installed' : 'pending'
      }

      if (depth <= maxDepth) {
        node = withRequirementResult(
          node,
          await fetchNexusRequirements({
            domainName: node.domainName || root.domainName,
            modId: node.modId,
            context,
            getRequirements: await ensureRequirementsResolver()
          })
        )
        if (!node.dependencies.length || !node.fileId || !node.downloadUrl) {
          node = withDetailRecord(
            node,
            await fetchNexusDetail({
              domainName: node.domainName || root.domainName,
              modId: node.modId,
              context,
              getDetail: await ensureDetailResolver()
            })
          )
        }
      }

      installPlan.push(node)
    }

    dependencies.push(node)

    if (node.sourceType === 'nexus' && depth < maxDepth) {
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
    } else if (node.sourceType === 'nexus' && node.dependencies.length) {
      warnings.push(
        `依赖 ${node.name || node.modId} 已达到递归深度上限 ${maxDepth}，未继续展开子依赖。`
      )
    }
  }

  const truncated = queue.length > 0
  if (truncated) {
    warnings.push(`Nexus 依赖解析达到节点上限 ${maxNodes}，仍有 ${queue.length} 个节点未展开。`)
  }

  const reusedInstalledDependencies = dependencies.filter(
    (item) => item.installState === 'reused_installed'
  )
  const externalDependencies = dependencies.filter((item) => item.sourceType === 'external')
  const allDlcRequirements = normalizeDlcRequirements([
    ...root.dlcRequirements,
    ...dependencies.flatMap((item) => item.dlcRequirements || [])
  ])
  const pendingInstallCount = installPlan.filter((item) => item.installState === 'pending').length

  return {
    success: true,
    source: 'nexus',
    sourceLabel: NEXUS_SOURCE_LABEL,
    resolverStatus: dependencies.length || allDlcRequirements.length ? 'resolved' : 'unsupported',
    recursive: dependencies.length > 0,
    maxDepth,
    maxNodes,
    truncated,
    warnings,
    request: {
      domainName: root.domainName,
      modId: root.modId,
      version: root.version
    },
    root,
    dependencyCount: dependencies.length,
    externalDependencyCount: externalDependencies.length,
    dlcRequirementCount: allDlcRequirements.length,
    pendingInstallCount,
    reusedInstalledDependencyCount: reusedInstalledDependencies.length,
    dependencies,
    installPlan,
    reusedInstalledDependencies,
    externalDependencies,
    dlcRequirements: allDlcRequirements,
    canSubmitInstallTask: false,
    message: dependencies.length
      ? `Nexus 依赖解析完成，发现 ${dependencies.length} 个依赖。`
      : 'Nexus 未读取到依赖元数据，暂不能生成递归依赖计划。'
  }
}
