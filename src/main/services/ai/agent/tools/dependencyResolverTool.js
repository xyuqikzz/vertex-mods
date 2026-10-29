import { resolveFicsitDependencies } from './adapters/ficsitAdapter.js'
import { resolveModioDependencies } from './adapters/modioAdapter.js'
import { resolveNexusDependencies } from './adapters/nexusAdapter.js'
import { resolveThunderstoreDependencies } from './adapters/thunderstoreAdapter.js'
import { resolveVamHubDependencies } from './adapters/vamhubAdapter.js'
import { assertSourceCapability, resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'

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

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeSource(value = '') {
  const source = toSafeText(value).toLowerCase()
  if (source === 'mod.io') return 'modio'
  if (source === 'server') return 'vertex'
  return source
}

function resolveSource(args = {}, candidate = {}, context = {}) {
  return normalizeSource(
    args.source ||
      candidate.source ||
      candidate.sourceType ||
      candidate.sourcePlatform ||
      context?.page?.source ||
      context?.game?.source
  )
}

function resolveSourceLabel(source = '') {
  return resolveSourcePlatformLabel(source, '未知来源')
}

function normalizeDependencyReference(dependency = {}, options = {}) {
  if (typeof dependency === 'string') {
    const text = toSafeText(dependency)
    if (!text) return null
    return {
      source: options.source || '',
      id: text,
      name: text,
      version: '',
      optional: false,
      installState: options.installState || 'metadata_only',
      raw: text
    }
  }

  if (!dependency || typeof dependency !== 'object') {
    return null
  }

  const id = pickFirstText(
    dependency.id,
    dependency.modId,
    dependency.mod_id,
    dependency.modReference,
    dependency.mod_reference,
    dependency.packageFullName,
    dependency.fullName,
    dependency.full_name,
    dependency.name
  )
  if (!id) return null

  return {
    source: options.source || '',
    id,
    modId: pickFirstText(dependency.modId, dependency.mod_id),
    modReference: pickFirstText(dependency.modReference, dependency.mod_reference),
    packageFullName: pickFirstText(
      dependency.packageFullName,
      dependency.fullName,
      dependency.full_name
    ),
    name: pickFirstText(dependency.name, dependency.displayName, dependency.modReference, id),
    version: pickFirstText(dependency.version, dependency.version_number, dependency.versionId),
    condition: toSafeText(dependency.condition),
    optional: dependency.optional === true,
    installState: options.installState || toSafeText(dependency.installState, 'metadata_only'),
    dependencyRole: pickFirstText(dependency.dependencyRole, dependency.dependency_role),
    raw: toPlainJson(dependency, {})
  }
}

function normalizeDependencyList(list = [], options = {}) {
  return (Array.isArray(list) ? list : [])
    .map((item) => normalizeDependencyReference(item, options))
    .filter(Boolean)
}

function createUnsupportedResult(source = '', dependencies = [], message = '') {
  return {
    success: true,
    source,
    sourceLabel: resolveSourceLabel(source),
    resolverStatus: dependencies.length ? 'metadata_only' : 'unsupported',
    recursive: false,
    dependencyCount: dependencies.length,
    dependencies,
    installPlan: [],
    reusedInstalledDependencies: [],
    message:
      message ||
      (dependencies.length
        ? '当前来源仅返回详情中的依赖元数据，尚未接入递归依赖解析。'
        : '当前来源尚未接入递归依赖解析，且未读取到依赖元数据。')
  }
}

export async function resolveDependenciesTool(args = {}, ctx = {}) {
  const safeArgs = toPlainJson(args, {})
  const candidate = toPlainJson(safeArgs.candidate, {})
  const context = toPlainJson(safeArgs.context || ctx?.pageContext, {})
  const source = resolveSource(safeArgs, candidate, context)
  const capability = assertSourceCapability(source, 'dependencies')
  if (!capability.ok) return capability

  if (!source) {
    return {
      success: false,
      errorCode: 'missing_source',
      message: '缺少模组来源，无法解析依赖。'
    }
  }

  if (source === 'ficsit') {
    return await resolveFicsitDependencies(
      {
        ...safeArgs,
        candidate,
        context
      },
      ctx
    )
  }

  if (source === 'thunderstore') {
    return await resolveThunderstoreDependencies(
      {
        ...safeArgs,
        candidate,
        context
      },
      ctx
    )
  }

  if (source === 'modio') {
    return await resolveModioDependencies(
      {
        ...safeArgs,
        candidate,
        context
      },
      ctx
    )
  }

  if (source === 'nexus') {
    return await resolveNexusDependencies(
      {
        ...safeArgs,
        candidate,
        context
      },
      ctx
    )
  }

  if (source === 'vamhub') {
    return await resolveVamHubDependencies(
      {
        ...safeArgs,
        candidate,
        context
      },
      ctx
    )
  }

  let dependencies = normalizeDependencyList(candidate.dependencies, {
    source,
    installState: 'metadata_only'
  })
  if (!dependencies.length) {
    let getDetail = ctx?.getModDetail
    if (typeof getDetail !== 'function') {
      const modSourceModule = await import('../../../mod-source/runtime.js')
      getDetail = modSourceModule.getModSourceDetail
    }
    const detailResult = await getDetail({
      ...candidate,
      source,
      context
    })
    dependencies = normalizeDependencyList(detailResult?.record?.dependencies, {
      source,
      installState: 'metadata_only'
    })
  }

  return createUnsupportedResult(source, dependencies)
}
