const SOURCE_STATUS = Object.freeze({
  ACTIVE: 'active',
  ACTIVE_PENDING_AI: 'active-pending-ai',
  DISPLAY_ONLY: 'display-only',
  LIMITED: 'limited',
  REMOVED: 'removed'
})

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const item of Object.values(value)) {
    deepFreeze(item)
  }
  return value
}

export const SOURCE_PLATFORM_ERROR_CODES = Object.freeze({
  UNSUPPORTED_SOURCE: 'unsupported_source',
  REMOVED_SOURCE: 'removed_source',
  SOURCE_CAPABILITY_DISABLED: 'source_capability_disabled',
  MISSING_SOURCE_IDENTITY: 'missing_source_identity',
  INVALID_AGGREGATE_SOURCE: 'invalid_aggregate_source'
})

export const SOURCE_PLATFORM_DEFINITIONS = deepFreeze({
  vertex: {
    key: 'vertex',
    aliases: ['server'],
    label: 'Vertex',
    status: SOURCE_STATUS.REMOVED,
    retiredOnline: true,
    removedReason: 'Vertex 自有在线模组来源已下线。已安装的历史模组仍可在本地管理中查看和安全卸载。',
    display: {
      showInSourceTabs: false,
      showInGameRepository: true,
      allowAggregateChild: false
    },
    capabilities: {
      search: false,
      detail: false,
      install: false,
      installPlan: false,
      installRuleConfig: false,
      dependencies: false,
      localProfile: true,
      ai: {
        search: false,
        detail: false,
        installPlan: false,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceGameId', 'sourceSlug', 'steamAppId']
    },
    routes: {}
  },
  nexus: {
    key: 'nexus',
    aliases: ['nexusmods', 'nexus-mods'],
    label: 'Nexus',
    status: SOURCE_STATUS.ACTIVE,
    display: {
      showInSourceTabs: true,
      showInGameRepository: true,
      allowAggregateChild: true
    },
    capabilities: {
      search: true,
      detail: true,
      install: true,
      installPlan: true,
      installRuleConfig: true,
      dependencies: true,
      sourceModpack: {
        share: true,
        import: true,
        offline: true
      },
      ai: {
        search: true,
        detail: true,
        installPlan: true,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceSlug', 'sourceGameId', 'steamAppId']
    },
    routes: {
      gameMods: '/app/game/nexus/mod/list/:sourceSlug'
    },
    install: {
      policyKey: 'nexus',
      payloadBuilder: 'nexus'
    },
    download: {
      defaultExtension: ''
    },
    aiPrompt: {
      toolLine:
        'Nexus 来源：source=nexus；搜索和详情需要 domainName，它是 Nexus 游戏域名标识，例如 stardewvalley；详情 modId 是 Nexus modId，fileId 可选。'
    }
  },
  modio: {
    key: 'modio',
    aliases: ['mod.io', 'mod-io'],
    label: 'Mod.io',
    status: SOURCE_STATUS.ACTIVE,
    display: {
      showInSourceTabs: true,
      showInGameRepository: true,
      allowAggregateChild: true
    },
    capabilities: {
      search: true,
      detail: true,
      install: true,
      installPlan: true,
      installRuleConfig: true,
      dependencies: true,
      sourceModpack: {
        share: true,
        import: true,
        offline: true
      },
      ai: {
        search: true,
        detail: true,
        installPlan: true,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceGameId', 'sourceSlug', 'steamAppId']
    },
    routes: {
      gameMods: '/app/game/modio/mod/list/:sourceGameId'
    },
    install: {
      policyKey: 'modio',
      payloadBuilder: 'modio'
    },
    download: {
      defaultExtension: '.zip'
    },
    aiPrompt: {
      toolLine:
        'Mod.io 来源：source=modio；搜索和详情需要 gameId，它是 Mod.io 游戏 ID；详情 modId 是 Mod.io 模组 ID；接口需要用户已配置 Mod.io API Key。'
    }
  },
  ficsit: {
    key: 'ficsit',
    aliases: ['ficsit.app', 'sml'],
    label: 'Ficsit',
    status: SOURCE_STATUS.ACTIVE,
    display: {
      showInSourceTabs: false,
      showInGameRepository: true,
      allowAggregateChild: true
    },
    capabilities: {
      search: true,
      detail: true,
      install: true,
      installPlan: true,
      installRuleConfig: false,
      dependencies: true,
      sourceModpack: {
        share: true,
        import: true,
        offline: true
      },
      ai: {
        search: true,
        detail: true,
        installPlan: true,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceGameId', 'sourceSlug', 'steamAppId']
    },
    routes: {
      gameMods: '/app/game/ficsit/mod/list/:sourceGameId'
    },
    install: {
      policyKey: 'ficsit',
      payloadBuilder: 'ficsit'
    },
    download: {
      defaultExtension: '.zip'
    },
    aiPrompt: {
      toolLine:
        'Ficsit 来源：source=ficsit；搜索不需要游戏 ID，当前接入的是 Ficsit/Satisfactory 全站模组搜索；详情 modId 传 mod_reference，例如 SML。',
      notes: [
        'Ficsit 搜索排序可使用 popularity_desc、downloads_desc、updated_desc、created_desc、name_asc；其他来源排序按工具默认值处理。'
      ]
    }
  },
  thunderstore: {
    key: 'thunderstore',
    aliases: ['thunderstore.io'],
    label: 'Thunderstore',
    status: SOURCE_STATUS.ACTIVE,
    display: {
      showInSourceTabs: true,
      showInGameRepository: true,
      allowAggregateChild: true
    },
    capabilities: {
      search: true,
      detail: true,
      install: true,
      installPlan: true,
      installRuleConfig: false,
      dependencies: true,
      sourceModpack: {
        share: true,
        import: true,
        offline: true
      },
      ai: {
        search: true,
        detail: true,
        installPlan: false,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceSlug', 'sourceGameId', 'steamAppId']
    },
    routes: {
      gameMods: '/app/game/thunderstore/mod/list/:sourceSlug'
    },
    install: {
      policyKey: 'thunderstore',
      payloadBuilder: 'thunderstore'
    },
    download: {
      defaultExtension: '.zip'
    },
    aiPrompt: {
      toolLine:
        'Thunderstore 来源：source=thunderstore；搜索需要 community，它是 Thunderstore 社区标识；详情 modId 传 full_name，格式通常是 namespace-PackageName。',
      notes: [
        'Thunderstore 的 R.E.P.O. 社区标识是 repo，这不是占位符或缺失上下文。',
        'Thunderstore 搜索排序只使用 last-updated、newest、most-downloaded、top-rated；不要主动传 -downloads、downloads、download_count 这类旧排序值。'
      ]
    }
  },
  vamhub: {
    key: 'vamhub',
    aliases: ['vam', 'vam-hub', 'vam hub'],
    label: 'VAM-Hub',
    status: SOURCE_STATUS.ACTIVE_PENDING_AI,
    display: {
      showInSourceTabs: true,
      showInGameRepository: true,
      allowAggregateChild: true
    },
    capabilities: {
      search: true,
      detail: true,
      install: true,
      installPlan: true,
      installRuleConfig: false,
      dependencies: true,
      sourceModpack: {
        share: true,
        import: true,
        offline: true
      },
      ai: {
        search: false,
        detail: false,
        installPlan: false,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceGameId', 'sourceSlug', 'steamAppId']
    },
    routes: {
      gameMods: '/app/game/vamhub/mod/list/:sourceGameId'
    },
    install: {
      policyKey: 'vamhub',
      payloadBuilder: 'vamhub'
    },
    download: {
      defaultExtension: '.var'
    },
    aiPrompt: {
      toolLine:
        'VAM-Hub 来源：source=vamhub；搜索可传 keyword；详情 modId 可传 packageName/resourceId；安装预检需要候选包含 downloadUrl，并且页面上下文或候选中需要 gameRoot/installRoot。',
      notes: [
        'VAM-Hub 可能依赖 Cookie 才能解析下载链接；工具结果不得返回 Cookie、token 或授权明文。'
      ]
    }
  },
  gamebanana: {
    key: 'gamebanana',
    aliases: ['gamebanana.com'],
    label: 'Banana',
    status: SOURCE_STATUS.LIMITED,
    browseMode: 'api',
    display: { showInSourceTabs: true, showInGameRepository: true, allowAggregateChild: false },
    capabilities: {
      search: true, detail: true, download: true, install: true, installPlan: true,
      installRuleConfig: false, dependencies: false,
      ai: { search: false, detail: false, installPlan: false, pageContext: false }
    },
    capabilityMessages: { install: 'Banana 使用游戏公共安装规则；无规则时仅下载。' },
    download: { defaultExtension: '' }
  },
  'steam-workshop': {
    key: 'steam-workshop',
    aliases: ['workshop', 'steamworkshop', 'steam-community'],
    label: 'Steam',
    status: SOURCE_STATUS.LIMITED,
    browseMode: 'website',
    website: 'https://steamcommunity.com/workshop/',
    display: { showInSourceTabs: true, showInGameRepository: true, allowAggregateChild: false },
    capabilities: {
      search: true, detail: true, download: true, install: true, installPlan: true,
      installRuleConfig: false, dependencies: false,
      ai: { search: false, detail: false, installPlan: false, pageContext: false }
    },
    capabilityMessages: { install: 'Steam 使用游戏公共安装规则；无规则时仅下载。' }
  },
  custom: {
    key: 'custom',
    aliases: [],
    label: '自定义来源',
    status: SOURCE_STATUS.LIMITED,
    display: {
      showInSourceTabs: false,
      showInGameRepository: false,
      allowAggregateChild: false
    },
    capabilities: {
      search: false,
      detail: false,
      install: false,
      installPlan: true,
      installRuleConfig: false,
      dependencies: false,
      ai: {
        search: false,
        detail: false,
        installPlan: true,
        pageContext: true
      }
    },
    identity: {
      requiredAny: ['sourceGameId', 'sourceSlug', 'steamAppId'],
      preferred: ['sourceGameId', 'sourceSlug', 'steamAppId']
    }
  },
  aggregate: {
    key: 'aggregate',
    aliases: [],
    label: '聚合来源',
    status: SOURCE_STATUS.DISPLAY_ONLY,
    display: {
      showInSourceTabs: true,
      showInGameRepository: false,
      allowAggregateChild: false
    },
    capabilities: {
      search: false,
      detail: false,
      install: false,
      installPlan: false,
      installRuleConfig: false,
      dependencies: false,
      ai: {
        search: false,
        detail: false,
        installPlan: false,
        pageContext: false
      }
    }
  },
  modrinth: {
    key: 'modrinth',
    aliases: ['modrinth4'],
    label: 'Modrinth',
    status: SOURCE_STATUS.REMOVED,
    removedReason: '平台已从当前来源体系移除，仅用于旧数据识别和提示。',
    display: {
      showInSourceTabs: false,
      showInGameRepository: false,
      allowAggregateChild: false
    },
    capabilities: {
      search: false,
      detail: false,
      install: false,
      installPlan: false,
      installRuleConfig: false,
      dependencies: false,
      ai: {
        search: false,
        detail: false,
        installPlan: false,
        pageContext: false
      }
    },
    legacy: {
      recognizeOnly: true
    }
  }
})

const SOURCE_ALIAS_MAP = Object.freeze(
  Object.entries(SOURCE_PLATFORM_DEFINITIONS).reduce((result, [key, definition]) => {
    result[key] = key
    for (const alias of definition.aliases || []) {
      result[String(alias).trim().toLowerCase()] = key
    }
    return result
  }, {})
)

const CAPABILITY_ALIASES = Object.freeze({
  aiSearch: 'ai.search',
  aiDetail: 'ai.detail',
  aiInstallPlan: 'ai.installPlan',
  aiPageContext: 'ai.pageContext',
  pageContext: 'ai.pageContext'
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeCapabilityName(capability = '') {
  const text = toSafeText(capability)
  return CAPABILITY_ALIASES[text] || text
}

function readCapability(definition, capability = '') {
  const normalized = normalizeCapabilityName(capability)
  const parts = normalized.split('.').filter(Boolean)
  let current = definition?.capabilities
  for (const part of parts) {
    current = current?.[part]
  }
  return current === true
}

function listDefinitions() {
  return Object.values(SOURCE_PLATFORM_DEFINITIONS)
}

function listSourceKeysByPredicate(predicate) {
  return listDefinitions()
    .filter((definition) => predicate(definition))
    .map((definition) => definition.key)
}

function buildCapabilityDisabledMessage(definition, capability = '') {
  const normalized = normalizeCapabilityName(capability)
  return (
    definition?.capabilityMessages?.[normalized] ||
    `${definition?.label || definition?.key || '该来源'} 未开启 ${normalized} 能力。`
  )
}

export function normalizeSourcePlatform(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (!text) return ''
  return SOURCE_ALIAS_MAP[text] || text
}

export function getSourcePlatformDefinition(source = '') {
  const key = normalizeSourcePlatform(source)
  return SOURCE_PLATFORM_DEFINITIONS[key] || null
}

export function resolveSourcePlatformLabel(source = '', fallback = '') {
  const key = normalizeSourcePlatform(source)
  const label = toSafeText(getSourcePlatformDefinition(key)?.label)
  return label || toSafeText(fallback) || key || toSafeText(source)
}

export function isActiveSourcePlatform(source = '') {
  return getSourcePlatformDefinition(source)?.status === SOURCE_STATUS.ACTIVE
}

export function isRemovedSourcePlatform(source = '') {
  return getSourcePlatformDefinition(source)?.status === SOURCE_STATUS.REMOVED
}

export function resolveBusinessSource(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const displaySource = normalizeSourcePlatform(
    pickFirstText(
      source.displaySource,
      source.display_source,
      source.sourcePlatform,
      source.source_platform,
      source.source
    )
  )

  if (displaySource === 'aggregate') {
    return normalizeSourcePlatform(
      pickFirstText(
        source.businessSource,
        source.business_source,
        source.targetSourcePlatform,
        source.target_source_platform
      )
    )
  }

  return normalizeSourcePlatform(
    pickFirstText(
      source.businessSource,
      source.business_source,
      source.sourcePlatform,
      source.source_platform,
      source.source,
      displaySource
    )
  )
}

export function listActiveSourcePlatforms() {
  return listSourceKeysByPredicate(
    (definition) => definition.status === SOURCE_STATUS.ACTIVE && definition.key !== 'aggregate'
  )
}

export function listAggregateChildSources() {
  return listSourceKeysByPredicate(
    (definition) =>
      definition.key !== 'aggregate' &&
      definition.status !== SOURCE_STATUS.REMOVED &&
      definition.display?.allowAggregateChild === true
  )
}

export function listSourcePlatformsByCapability(capability = '') {
  return listSourceKeysByPredicate(
    (definition) =>
      definition.key !== 'aggregate' &&
      definition.status !== SOURCE_STATUS.REMOVED &&
      readCapability(definition, capability)
  )
}

export function listSourcePlatformsWithoutCapability(capability = '') {
  return listSourceKeysByPredicate(
    (definition) =>
      definition.key !== 'aggregate' &&
      definition.status !== SOURCE_STATUS.REMOVED &&
      !readCapability(definition, capability)
  )
}

export function listAiSearchSources() {
  return listSourcePlatformsByCapability('ai.search')
}

export function listAiDetailSources() {
  return listSourcePlatformsByCapability('ai.detail')
}

export function listAiInstallPlanSources() {
  return listSourcePlatformsByCapability('ai.installPlan')
}

export function listInstallSources() {
  return listSourcePlatformsByCapability('install')
}

export function listSourceModpackShareSources() {
  return listSourcePlatformsByCapability('sourceModpack.share')
}

export function listSourceModpackImportSources() {
  return listSourcePlatformsByCapability('sourceModpack.import')
}

export function listOfflinePackSources() {
  return listSourcePlatformsByCapability('sourceModpack.offline')
}

export function assertSourceCapability(source = '', capability = '') {
  const key = normalizeSourcePlatform(source)
  const definition = getSourcePlatformDefinition(key)
  if (!definition) {
    return {
      success: false,
      ok: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.UNSUPPORTED_SOURCE,
      source: key,
      message: `来源 ${key || 'unknown'} 未接入 Vertex 来源平台注册表。`
    }
  }

  if (definition.status === SOURCE_STATUS.REMOVED) {
    return {
      success: false,
      ok: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.REMOVED_SOURCE,
      source: definition.key,
      message: definition.removedReason || `${definition.label} 已从当前来源体系移除。`
    }
  }

  if (!readCapability(definition, capability)) {
    return {
      success: false,
      ok: false,
      errorCode: SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source: definition.key,
      message: buildCapabilityDisabledMessage(definition, capability)
    }
  }

  return {
    success: true,
    ok: true,
    source: definition.key,
    capability: normalizeCapabilityName(capability),
    message: ''
  }
}

export function normalizeSourceGameIdentity(source = '', record = {}) {
  const target = record && typeof record === 'object' ? record : {}
  const normalizedSource = normalizeSourcePlatform(source || resolveBusinessSource(target))
  const sourceGameId = pickFirstText(
    target.sourceGameId,
    target.source_game_id,
    target.nexusGameId,
    target.nexus_game_id,
    target.modioGameId,
    target.modio_game_id,
    target.gameId,
    target.game_id,
    target.sourceId,
    target.source_id
  )
  const sourceSlug = pickFirstText(
    target.sourceSlug,
    target.source_slug,
    target.sourceGameSlug,
    target.source_game_slug,
    target.domainName,
    target.domain_name,
    target.gameDomainName,
    target.game_domain_name,
    target.nexusGameDomain,
    target.nexus_game_domain,
    target.community,
    target.nameId,
    target.name_id,
    target.slug
  )
  const steamAppId = pickFirstText(
    target.steamAppId,
    target.steam_app_id,
    target.appId,
    target.app_id
  )

  return {
    source: normalizedSource,
    sourceGameId,
    sourceSlug,
    steamAppId,
    hasIdentity: !!(sourceGameId || sourceSlug || steamAppId)
  }
}

function pickIdentityValue(identity = {}, preferred = []) {
  for (const key of preferred) {
    const value = toSafeText(identity[key])
    if (value) return value
  }
  return pickFirstText(identity.sourceGameId, identity.sourceSlug, identity.steamAppId)
}

export function buildGameKey(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const displaySource = normalizeSourcePlatform(
    pickFirstText(
      source.displaySource,
      source.display_source,
      source.sourcePlatform,
      source.source_platform,
      source.source
    )
  )
  const businessSource = resolveBusinessSource(source)
  const definition = getSourcePlatformDefinition(businessSource)
  const identity = normalizeSourceGameIdentity(businessSource, source)
  const identityValue = pickIdentityValue(identity, definition?.identity?.preferred || [])
  if (!businessSource || !identityValue) return ''
  return [displaySource || businessSource, businessSource, identityValue].join(':')
}

export function buildCanonicalGameKey(record = {}) {
  const businessSource = resolveBusinessSource(record)
  const definition = getSourcePlatformDefinition(businessSource)
  const identity = normalizeSourceGameIdentity(businessSource, record)
  const identityValue = pickIdentityValue(identity, definition?.identity?.preferred || [])
  if (!businessSource || !identityValue) return ''
  return [businessSource, identityValue].join(':')
}

export function getSourcePlatformCapabilityFlags(source = '') {
  const definition = getSourcePlatformDefinition(source)
  return {
    aiSearch: readCapability(definition, 'ai.search'),
    aiDetail: readCapability(definition, 'ai.detail'),
    aiInstallPlan: readCapability(definition, 'ai.installPlan'),
    install: readCapability(definition, 'install'),
    search: readCapability(definition, 'search'),
    detail: readCapability(definition, 'detail'),
    dependencies: readCapability(definition, 'dependencies')
  }
}

export function getSourceDefaultExtension(source = '') {
  const definition = getSourcePlatformDefinition(source)
  const value = toSafeText(definition?.download?.defaultExtension)
  return value
}

export function buildAiSourcePromptLines() {
  const searchLabels = listAiSearchSources()
    .map((source) => getSourcePlatformDefinition(source)?.label)
    .filter(Boolean)
    .join('、')
  const promptLines = [
    `你可以帮助用户在 ${searchLabels} 等 registry 声明 AI 搜索能力的来源中检索和比较模组。`,
    'Vertex 自有在线模组来源（vertex/server）已下线，不可搜索、查询在线详情、下载、安装、更新或解析在线依赖；历史记录只使用本地管理工具。',
    'aggregate 不是工具来源；如果页面记录 displaySource/sourcePlatform=aggregate，必须先解析 businessSource/targetSourcePlatform。',
    'modrinth 已移除，只能提示来源已移除，不能搜索、详情、安装或生成安装计划。',
    'VAM-Hub 只有在 registry 明确开启 AI search/detail/installPlan 能力后才能查询或生成 AI 安装计划。',
    '来源不支持某能力时，返回用户可理解的话，并附带机器错误码 source_capability_disabled。'
  ]

  for (const source of listAiSearchSources()) {
    const definition = getSourcePlatformDefinition(source)
    if (definition?.aiPrompt?.toolLine) {
      promptLines.push(definition.aiPrompt.toolLine)
    }
    for (const note of definition?.aiPrompt?.notes || []) {
      promptLines.push(note)
    }
  }

  promptLines.push(
    '来源工具返回 400 或 request_failed 时，先根据工具 message 和接口参数排查，不要在未验证前断言当前游戏标识错误。'
  )

  return promptLines
}

export function listBrowsableSourcePlatforms() {
  return Object.values(SOURCE_PLATFORM_DEFINITIONS).filter((definition) =>
    definition.status !== SOURCE_STATUS.REMOVED && definition.display?.showInSourceTabs === true && definition.key !== 'aggregate'
  ).map((definition) => ({ key: definition.key, label: definition.label }))
}

// 固定入口，不由服务端开关、排序或下发新平台。聚合页仍使用已有游戏目录数据。
export function listModCenterSources() {
  return filterBrowsableSourceEntries([
    { key: 'thunderstore' },
    { key: 'nexus' },
    { key: 'modio' },
    { key: 'gamebanana' },
    { key: 'steam-workshop' },
    { key: 'aggregate', children: ['nexus', 'modio', 'ficsit', 'thunderstore', 'vamhub'] }
  ])
}

export function filterBrowsableSourceEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const definition = getSourcePlatformDefinition(entry?.key)
    if (!definition || definition.status === SOURCE_STATUS.REMOVED || !definition.display?.showInSourceTabs) return []
    return [{ ...entry, key: definition.key, label: definition.label, ...(Array.isArray(entry.children) ? { children: entry.children.filter((source) => {
      const child = getSourcePlatformDefinition(source)
      return child?.status !== SOURCE_STATUS.REMOVED && child?.display?.allowAggregateChild === true
    }) } : {}) }]
  })
}
