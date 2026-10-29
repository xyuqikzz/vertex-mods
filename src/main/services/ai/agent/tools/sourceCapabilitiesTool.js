import {
  SOURCE_PLATFORM_DEFINITIONS,
  SOURCE_PLATFORM_ERROR_CODES,
  assertSourceCapability,
  listAiDetailSources,
  listAiInstallPlanSources,
  listAiSearchSources,
  listInstallSources,
  listSourcePlatformsByCapability,
  normalizeSourcePlatform
} from '../../../../../shared/sources/source-platform-registry.js'

const CAPABILITY_ALIASES = Object.freeze({
  aiSearch: 'ai.search',
  aiDetail: 'ai.detail',
  aiInstallPlan: 'ai.installPlan',
  aiPageContext: 'ai.pageContext',
  pageContext: 'ai.pageContext'
})

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function normalizeCapabilityName(capability = '') {
  const text = toSafeText(capability)
  return CAPABILITY_ALIASES[text] || text
}

function readCapability(definition = {}, path = '') {
  const parts = normalizeCapabilityName(path).split('.').filter(Boolean)
  let current = definition?.capabilities
  for (const part of parts) {
    current = current?.[part]
  }
  return current === true
}

function createCapabilitySnapshot(definition = {}) {
  return {
    search: readCapability(definition, 'search'),
    detail: readCapability(definition, 'detail'),
    install: readCapability(definition, 'install'),
    installPlan: readCapability(definition, 'installPlan'),
    installRuleConfig: readCapability(definition, 'installRuleConfig'),
    dependencies: readCapability(definition, 'dependencies'),
    aiSearch: readCapability(definition, 'ai.search'),
    aiDetail: readCapability(definition, 'ai.detail'),
    aiInstallPlan: readCapability(definition, 'ai.installPlan'),
    aiPageContext: readCapability(definition, 'ai.pageContext')
  }
}

function createRegistrySummary() {
  return {
    aiSearchSources: listAiSearchSources(),
    aiDetailSources: listAiDetailSources(),
    aiInstallPlanSources: listAiInstallPlanSources(),
    dependencySources: listSourcePlatformsByCapability('dependencies'),
    installSources: listInstallSources()
  }
}

function createSourceSummary(definition = {}) {
  const key = toSafeText(definition.key)
  return {
    source: key,
    label: toSafeText(definition.label, key),
    status: toSafeText(definition.status),
    isToolSource: key !== 'aggregate' && definition.status !== 'removed',
    capabilities: createCapabilitySnapshot(definition),
    identity: definition.identity
      ? {
          requiredAny: Array.isArray(definition.identity.requiredAny)
            ? [...definition.identity.requiredAny]
            : [],
          preferred: Array.isArray(definition.identity.preferred)
            ? [...definition.identity.preferred]
            : []
        }
      : {}
  }
}

function createCapabilityCheck(source = '', capability = '') {
  const normalizedCapability = normalizeCapabilityName(capability)
  if (!normalizedCapability) return null
  const check = assertSourceCapability(source, normalizedCapability)
  return {
    capability: normalizedCapability,
    supported: check.success === true,
    errorCode: check.success === true ? '' : toSafeText(check.errorCode),
    message: toSafeText(check.message)
  }
}

function createNextActions(definition = {}, capabilityCheck = null) {
  const key = toSafeText(definition.key)
  if (key === 'aggregate') {
    return [
      {
        type: 'resolve_business_source',
        label: '先从聚合记录解析真实业务来源，再调用搜索、详情或安装预检工具。'
      }
    ]
  }
  if (definition.status === 'removed') {
    return [
      {
        type: 'choose_supported_source',
        label: '改用当前 registry 仍处于 active 或 limited 状态的来源。'
      }
    ]
  }
  if (capabilityCheck && capabilityCheck.supported !== true) {
    return [
      {
        type: 'select_supported_capability_source',
        label: '改用 registry 中已开启该能力的来源，或先完成对应来源 adapter 后再启用。'
      }
    ]
  }
  return []
}

export function getSourceCapabilitiesTool(args = {}) {
  const rawSource = toSafeText(args.source)
  const capability = normalizeCapabilityName(args.capability)
  const registry = createRegistrySummary()

  if (!rawSource) {
    return {
      success: true,
      registry,
      sources: Object.values(SOURCE_PLATFORM_DEFINITIONS).map((definition) =>
        createSourceSummary(definition)
      )
    }
  }

  const source = normalizeSourcePlatform(rawSource)
  const definition = SOURCE_PLATFORM_DEFINITIONS[source]
  if (!definition) {
    return {
      success: true,
      source,
      label: rawSource,
      status: '',
      isToolSource: false,
      capabilities: createCapabilitySnapshot({}),
      capabilityCheck: capability
        ? {
            capability,
            supported: false,
            errorCode: SOURCE_PLATFORM_ERROR_CODES.UNSUPPORTED_SOURCE,
            message: `来源 ${source || rawSource || 'unknown'} 未接入 Vertex 来源平台注册表。`
          }
        : null,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.UNSUPPORTED_SOURCE,
      message: `来源 ${source || rawSource || 'unknown'} 未接入 Vertex 来源平台注册表。`,
      registry,
      nextActions: [
        {
          type: 'choose_supported_source',
          label: '改用 Vertex 来源平台注册表中的来源。'
        }
      ]
    }
  }

  const sourceSummary = createSourceSummary(definition)
  const capabilityCheck = createCapabilityCheck(definition.key, capability)
  return {
    success: true,
    ...sourceSummary,
    capabilityCheck,
    supported: capabilityCheck ? capabilityCheck.supported : sourceSummary.isToolSource,
    errorCode: capabilityCheck?.errorCode || '',
    message:
      capabilityCheck?.message ||
      (sourceSummary.isToolSource
        ? ''
        : `${sourceSummary.label} 不是可直接调用的业务工具来源。`),
    registry,
    nextActions: createNextActions(definition, capabilityCheck)
  }
}
