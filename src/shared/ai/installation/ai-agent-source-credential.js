import {
  listInstallSources,
  normalizeSourcePlatform,
  resolveSourcePlatformLabel
} from '../../sources/source-platform-registry.js'

const SOURCE_CREDENTIAL_POLICIES = Object.freeze({
  nexus: Object.freeze({
    credentialType: 'api_key',
    required: true,
    configurable: true,
    inputLabel: 'Nexus API Key',
    inputPlaceholder: '粘贴 Nexus Personal API Key',
    helpUrl: 'https://www.nexusmods.com/settings/api-keys',
    helpText: '登录 Nexus Mods 后进入 API Keys 页面，复制 Personal API Key。'
  }),
  modio: Object.freeze({
    credentialType: 'api_key',
    required: true,
    configurable: true,
    inputLabel: 'Mod.io API Key',
    inputPlaceholder: '粘贴 Mod.io apikey',
    helpUrl: 'https://mod.io/me/access',
    helpText: '登录 Mod.io 后进入 Access 页面，复制 API path 对应的 apikey。'
  }),
  ficsit: Object.freeze({
    credentialType: 'public',
    required: false,
    configurable: false,
    helpUrl: 'https://ficsit.app',
    helpText: 'Ficsit 当前使用公开查询与下载能力，不需要配置 API Key。'
  }),
  thunderstore: Object.freeze({
    credentialType: 'public',
    required: false,
    configurable: false,
    helpUrl: 'https://thunderstore.io',
    helpText: 'Thunderstore 当前使用公开查询与下载能力，不需要配置 API Key。'
  }),
  vamhub: Object.freeze({
    credentialType: 'cookie',
    required: true,
    configurable: false,
    helpUrl: 'https://hub.virtamate.com',
    helpText: 'VAM-Hub 需要在客户端 VAM-Hub 页面配置 Cookie；Cookie 不会进入模型上下文。'
  })
})

export const AI_AGENT_SOURCE_CREDENTIAL_SOURCES = Object.freeze(
  listInstallSources().filter((source) => source !== 'vertex' && SOURCE_CREDENTIAL_POLICIES[source])
)

export const AI_AGENT_SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES = Object.freeze(
  AI_AGENT_SOURCE_CREDENTIAL_SOURCES.filter(
    (source) => SOURCE_CREDENTIAL_POLICIES[source]?.configurable === true
  )
)

function buildSourceCredentialGuide(source = '') {
  const policy = SOURCE_CREDENTIAL_POLICIES[source]
  if (!policy) return null
  return Object.freeze({
    source,
    label: resolveSourcePlatformLabel(source, source),
    ...policy
  })
}

export const AI_AGENT_SOURCE_CREDENTIAL_GUIDES = Object.freeze(
  AI_AGENT_SOURCE_CREDENTIAL_SOURCES.reduce((result, source) => {
    const guide = buildSourceCredentialGuide(source)
    if (guide) {
      result[source] = guide
    }
    return result
  }, {})
)

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

export function normalizeAgentSourceCredentialSource(source = '') {
  const value = normalizeSourcePlatform(toSafeText(source))
  return AI_AGENT_SOURCE_CREDENTIAL_SOURCES.includes(value) ? value : ''
}

export function normalizeAgentSourceCredentialConfigurableSource(source = '') {
  const value = normalizeSourcePlatform(toSafeText(source))
  return AI_AGENT_SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES.includes(value) ? value : ''
}

export function listAgentSourceCredentialSources() {
  return [...AI_AGENT_SOURCE_CREDENTIAL_SOURCES]
}

export function listAgentSourceCredentialConfigurableSources() {
  return [...AI_AGENT_SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES]
}

export function getAgentSourceCredentialGuide(source = '') {
  const normalizedSource = normalizeAgentSourceCredentialSource(source)
  return normalizedSource ? { ...AI_AGENT_SOURCE_CREDENTIAL_GUIDES[normalizedSource] } : null
}

function formatCredentialTypeLabel(type = '') {
  if (type === 'api_key') return 'API Key'
  if (type === 'cookie') return 'Cookie'
  return toSafeText(type, '授权信息')
}

function formatCredentialGuideLabel(guide = {}) {
  const label = toSafeText(guide.label || guide.source)
  const typeLabel = formatCredentialTypeLabel(guide.credentialType)
  return [label, typeLabel].filter(Boolean).join(' ')
}

function listCredentialGuides(sources = []) {
  return sources
    .map((source) => getAgentSourceCredentialGuide(source))
    .filter((guide) => guide && typeof guide === 'object')
}

export function buildAgentSourceCredentialPromptLines() {
  const configurableGuides = listCredentialGuides(listAgentSourceCredentialConfigurableSources())
  const localPageGuides = listCredentialGuides(listAgentSourceCredentialSources()).filter(
    (guide) => guide.required === true && guide.configurable !== true
  )
  const configurableSourcesText = configurableGuides
    .map((guide) => guide.label)
    .filter(Boolean)
    .join(' / ')
  const configurableCredentialText = configurableGuides
    .map((guide) => formatCredentialGuideLabel(guide))
    .filter(Boolean)
    .join(' / ')
  const localPageCredentialText = localPageGuides
    .map((guide) => formatCredentialGuideLabel(guide))
    .filter(Boolean)
    .join(' / ')

  return [
    [
      '如果来源授权或配置状态不明确，先调用 vertex.source_credential.status 查看状态；',
      configurableSourcesText
        ? `当前可通过 vertex.source_credential.configure 发起客户端安全输入确认卡的来源：${configurableSourcesText}。`
        : '当前没有来源支持通过 vertex.source_credential.configure 发起客户端安全输入确认卡。',
      localPageCredentialText
        ? `${localPageCredentialText} 只能引导用户到客户端对应来源页面配置。`
        : ''
    ]
      .filter(Boolean)
      .join(''),
    [
      '你不能要求用户在聊天里提供密钥、Cookie 或 token 明文；',
      configurableCredentialText
        ? `需要配置 ${configurableCredentialText} 时，必须使用 vertex.source_credential.configure 的客户端确认卡。`
        : '来源密钥不能通过聊天收集。',
      localPageCredentialText
        ? `${localPageCredentialText} 只能通过客户端页面配置。`
        : ''
    ]
      .filter(Boolean)
      .join('')
  ]
}

export function buildAgentSourceCredentialConfirmationInput() {
  return {
    kind: 'source_credential',
    secretFields: ['apiKey'],
    fields: [
      {
        name: 'apiKey',
        type: 'password',
        required: true
      }
    ],
    sourceGuides: AI_AGENT_SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES.reduce((result, source) => {
      result[source] = AI_AGENT_SOURCE_CREDENTIAL_GUIDES[source]
      return result
    }, {})
  }
}
