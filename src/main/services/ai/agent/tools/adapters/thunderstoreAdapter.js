import { resolveSourcePlatformLabel } from '../../../../../../shared/sources/source-platform-registry.js'

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_NODES = 50
const THUNDERSTORE_SOURCE_LABEL = resolveSourcePlatformLabel('thunderstore', 'Thunderstore')

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

function normalizeThunderstoreFullName(value = '') {
  return toSafeText(value).toLowerCase()
}

function parseThunderstorePackageFullName(fullName = '') {
  const raw = toSafeText(fullName)
  if (!raw) {
    return {
      namespace: '',
      packageName: '',
      fullName: ''
    }
  }

  const matched = raw.match(/^([^-\s]+)-(.+)$/)
  if (!matched) {
    return {
      namespace: '',
      packageName: raw,
      fullName: raw
    }
  }

  return {
    namespace: toSafeText(matched[1]),
    packageName: toSafeText(matched[2]),
    fullName: raw
  }
}

function parseThunderstoreDependency(depString = '') {
  const raw = toSafeText(depString)
  if (!raw) {
    return {
      fullName: '',
      requiredVersion: ''
    }
  }

  const match = raw.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
  if (match) {
    return {
      fullName: toSafeText(match[1]),
      requiredVersion: toSafeText(match[2])
    }
  }

  return {
    fullName: raw,
    requiredVersion: ''
  }
}

function toThunderstoreDependencyReference(item = null) {
  if (typeof item === 'string') {
    return toSafeText(item)
  }

  if (!item || typeof item !== 'object') {
    return ''
  }

  const explicitFullName = pickFirstText(
    item.fullName,
    item.full_name,
    item.packageFullName,
    item.package_full_name,
    item.id
  )
  const namespace = pickFirstText(item.namespace, item.packageOwner, item.package_owner, item.owner)
  const packageName = pickFirstText(item.packageName, item.package_name, item.name)
  const fullName =
    explicitFullName || (namespace && packageName ? `${namespace}-${packageName}` : packageName)
  const requiredVersion = pickFirstText(item.requiredVersion, item.version_number, item.version)
  return fullName && requiredVersion ? `${fullName}-${requiredVersion}` : fullName
}

function normalizeThunderstoreDependencyList(list = [], options = {}) {
  const source = Array.isArray(list) ? list : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const raw = toThunderstoreDependencyReference(item)
    const { fullName, requiredVersion } = parseThunderstoreDependency(raw)
    if (!fullName) continue

    const parsed = parseThunderstorePackageFullName(fullName)
    const key = `${normalizeThunderstoreFullName(fullName)}@${requiredVersion.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    result.push({
      source: 'thunderstore',
      id: fullName,
      packageFullName: fullName,
      fullName,
      namespace: parsed.namespace,
      packageName: parsed.packageName || fullName,
      name: parsed.packageName || fullName,
      version: requiredVersion,
      requiredVersion,
      optional: item?.optional === true,
      installState: options.installState || 'pending',
      dependencyRole: options.dependencyRole || 'required',
      raw: toPlainJson(item, item)
    })
  }

  return result
}

function resolveThunderstoreCommunity(candidate = {}, context = {}) {
  return pickFirstText(
    candidate.community,
    context?.game?.sourceGameId,
    context?.game?.sourceSlug,
    context?.route?.query?.community,
    context?.route?.params?.id
  )
}

function resolveThunderstoreFullName(record = {}) {
  return pickFirstText(
    record.fullName,
    record.full_name,
    record.packageFullName,
    record.modId,
    record.id
  )
}

function normalizeThunderstoreNode(record = {}, options = {}) {
  const fullName = resolveThunderstoreFullName(record)
  if (!fullName) return null

  const parsed = parseThunderstorePackageFullName(fullName)
  const dependencies = normalizeThunderstoreDependencyList(record.dependencies, {
    installState: 'pending'
  })
  const installState = options.installState || 'pending'

  return {
    source: 'thunderstore',
    id: fullName,
    packageFullName: fullName,
    fullName,
    namespace: pickFirstText(record.namespace, parsed.namespace),
    packageName: pickFirstText(record.packageName, parsed.packageName, record.name, fullName),
    name: pickFirstText(record.name, record.title, parsed.packageName, fullName),
    version: pickFirstText(record.version, record.version_number, options.requiredVersion),
    requiredVersion: toSafeText(options.requiredVersion),
    optional: record.optional === true,
    dependencyRole: pickFirstText(record.dependencyRole, record.dependency_role),
    downloadUrl: toSafeText(record.downloadUrl || record.download_url),
    pictureUrl: toSafeText(record.pictureUrl || record.picture_url || record.icon),
    community: toSafeText(options.community || record.community),
    dependencies,
    dependencyCount: dependencies.length,
    installState,
    isRoot: options.isRoot === true,
    depth: toSafeNumber(options.depth, 0),
    sortIndex: toSafeNumber(options.sortIndex, 0),
    raw: toPlainJson(record, {})
  }
}

function createInstalledSet(ctx = {}, context = {}) {
  const source =
    ctx.installedPackageFullNames ||
    ctx.installedThunderstorePackages ||
    context?.installedPackageFullNames ||
    context?.installedThunderstorePackages ||
    []
  return new Set(
    (Array.isArray(source) ? source : [])
      .map((item) =>
        normalizeThunderstoreFullName(
          typeof item === 'string' ? item : item?.fullName || item?.packageFullName || item?.id
        )
      )
      .filter(Boolean)
  )
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

async function fetchThunderstoreDetail({ fullName, community, context, getDetail }) {
  if (!fullName || typeof getDetail !== 'function') return null

  try {
    const result = await getDetail({
      source: 'thunderstore',
      fullName,
      packageFullName: fullName,
      community,
      context
    })
    return result?.record && typeof result.record === 'object' ? result.record : null
  } catch {
    return null
  }
}

export async function resolveThunderstoreDependencies(args = {}, ctx = {}) {
  const candidate = toPlainJson(args.candidate, {})
  const context = toPlainJson(args.context || ctx?.pageContext, {})
  const community = resolveThunderstoreCommunity(candidate, context)
  const maxDepth = Math.max(1, Math.min(3, toSafeNumber(args.maxDepth, DEFAULT_MAX_DEPTH)))
  const maxNodes = Math.max(1, Math.min(50, toSafeNumber(args.maxNodes, DEFAULT_MAX_NODES)))
  const installedSet = createInstalledSet(ctx, context)
  const getDetail = await resolveGetDetail(ctx, {
    allowDynamicImport: Boolean(community)
  })
  const warnings = []

  let rootRecord = candidate
  let root = normalizeThunderstoreNode(rootRecord, {
    isRoot: true,
    community,
    depth: 0,
    sortIndex: 0
  })

  if (!root) {
    return {
      success: false,
      source: 'thunderstore',
      sourceLabel: THUNDERSTORE_SOURCE_LABEL,
      errorCode: 'missing_thunderstore_context',
      message: 'Thunderstore 依赖解析缺少 packageFullName / fullName。'
    }
  }

  if (!root.dependencies.length) {
    const detailRecord = await fetchThunderstoreDetail({
      fullName: root.fullName,
      community,
      context,
      getDetail
    })
    if (detailRecord) {
      rootRecord = {
        ...rootRecord,
        ...detailRecord
      }
      root = normalizeThunderstoreNode(rootRecord, {
        isRoot: true,
        community,
        depth: 0,
        sortIndex: 0
      })
    }
  }

  const visited = new Set([normalizeThunderstoreFullName(root.fullName)])
  const installPlan = [root]
  const dependencies = []
  const queue = root.dependencies.map((dependency) => ({
    dependency,
    depth: 1
  }))

  while (queue.length && installPlan.length < maxNodes) {
    const { dependency, depth } = queue.shift()
    const normalizedFullName = normalizeThunderstoreFullName(dependency.fullName)
    if (!normalizedFullName || visited.has(normalizedFullName)) {
      continue
    }
    visited.add(normalizedFullName)

    const installed = installedSet.has(normalizedFullName)
    let node = normalizeThunderstoreNode(
      {
        ...dependency,
        fullName: dependency.fullName,
        packageFullName: dependency.fullName,
        dependencies: []
      },
      {
        community,
        depth,
        sortIndex: installPlan.length,
        requiredVersion: dependency.requiredVersion || dependency.version,
        installState: installed ? 'reused_installed' : 'pending'
      }
    )

    if (depth <= maxDepth) {
      const detailRecord = await fetchThunderstoreDetail({
        fullName: dependency.fullName,
        community,
        context,
        getDetail
      })
      if (detailRecord) {
        node = normalizeThunderstoreNode(
          {
            ...detailRecord,
            fullName: dependency.fullName,
            packageFullName: dependency.fullName,
            optional: dependency.optional === true,
            dependencyRole: dependency.dependencyRole
          },
          {
            community,
            depth,
            sortIndex: installPlan.length,
            requiredVersion: dependency.requiredVersion || dependency.version,
            installState: installed ? 'reused_installed' : 'pending'
          }
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
      warnings.push(`依赖 ${node.fullName} 已达到递归深度上限 ${maxDepth}，未继续展开子依赖。`)
    }
  }

  const truncated = queue.length > 0
  if (truncated) {
    warnings.push(
      `Thunderstore 依赖解析达到节点上限 ${maxNodes}，仍有 ${queue.length} 个节点未展开。`
    )
  }

  const reusedInstalledDependencies = dependencies.filter(
    (item) => item.installState === 'reused_installed'
  )
  const pendingInstallCount = installPlan.filter((item) => item.installState === 'pending').length

  return {
    success: true,
    source: 'thunderstore',
    sourceLabel: THUNDERSTORE_SOURCE_LABEL,
    resolverStatus: dependencies.length ? 'resolved' : 'unsupported',
    recursive: dependencies.length > 0,
    maxDepth,
    maxNodes,
    truncated,
    warnings,
    request: {
      community,
      packageFullName: root.fullName,
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
      ? `Thunderstore 依赖解析完成，发现 ${dependencies.length} 个依赖。`
      : 'Thunderstore 未读取到依赖元数据，暂不能生成递归依赖计划。'
  }
}
