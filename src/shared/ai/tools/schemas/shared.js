// 共享权限等级、来源能力与工具说明片段；主进程和渲染进程均可使用。
import {
  listAiSearchSources,
  listAiDetailSources,
  listAiInstallPlanSources,
  listSourcePlatformsWithoutCapability,
  listSourcePlatformsByCapability,
  listInstallSources
} from '../../../sources/source-platform-registry.js'
import {
  listAgentSourceCredentialSources,
  listAgentSourceCredentialConfigurableSources
} from '../../installation/ai-agent-source-credential.js'

/**
 * AI Agent V2 工具描述与入参校验（主进程 / 渲染进程共享）
 *
 * 每个工具描述包含：
 * - name：工具唯一名（点分命名，AI 与日志使用）
 * - title / description：给模型与 UI 的说明
 * - permissionLevel：read / plan / execute / destructive
 * - dangerous：是否危险操作
 * - requiresConfirmation：never / by_policy / always
 * - readonly / enabled：兼容旧版工具白名单字段
 * - argsHint：注入 system prompt 的入参提示（紧凑文本）
 * - inputSchema：轻量 JSON Schema 子集，调用前强校验
 */
export const AI_AGENT_PERMISSION_LEVELS = Object.freeze({
  READ: 'read',
  PLAN: 'plan',
  EXECUTE: 'execute',
  DESTRUCTIVE: 'destructive'
})

export const AI_MOD_SEARCH_SOURCES = Object.freeze(listAiSearchSources())

export const AI_MOD_DETAIL_SOURCES = Object.freeze(listAiDetailSources())

export const AI_INSTALL_PLAN_SOURCES = Object.freeze(listAiInstallPlanSources())

export const AI_INSTALL_PLAN_UNSUPPORTED_SOURCES = Object.freeze(
  listSourcePlatformsWithoutCapability('ai.installPlan')
)

export const DEPENDENCY_RESOLVE_SOURCES = Object.freeze(
  listSourcePlatformsByCapability('dependencies')
)

export const INSTALL_RULE_CONFIG_SOURCES = Object.freeze(
  listSourcePlatformsByCapability('installRuleConfig')
)

export const GAME_ROOT_FALLBACK_SOURCES = Object.freeze(
  INSTALL_RULE_CONFIG_SOURCES.filter((source) => ['nexus', 'modio'].includes(source))
)

export const INSTALL_SOURCE_FILTERS = Object.freeze(listInstallSources())

export const INSTALL_SOURCE_FILTERS_WITH_CUSTOM = Object.freeze([
  ...INSTALL_SOURCE_FILTERS,
  'custom'
])

export const SOURCE_CREDENTIAL_SOURCES = Object.freeze(listAgentSourceCredentialSources())

export const SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES = Object.freeze(
  listAgentSourceCredentialConfigurableSources()
)

export const SOURCE_CAPABILITY_QUERY_NAMES = Object.freeze([
  'search',
  'detail',
  'install',
  'installPlan',
  'installRuleConfig',
  'dependencies',
  'ai.search',
  'ai.detail',
  'ai.installPlan',
  'ai.pageContext'
])

export const PAGE_CONTEXT_SECTION_NAMES = Object.freeze([
  'displaySource',
  'businessSource',
  'sourceGameId',
  'sourceSlug',
  'sourceLabel',
  'businessSourceLabel',
  'sourceStatus',
  'route',
  'page',
  'game',
  'mod',
  'search',
  'install',
  'installTask',
  'capabilities',
  'auth',
  'sourceState',
  'thunderstore'
])

export function formatSourceEnum(values = []) {
  return values.join('|')
}

export function formatSourceDescription(values = []) {
  return values.join('/')
}

function formatSourceListText(values = []) {
  return values.join(' / ')
}

export function buildModSearchArgsHint() {
  return [
    `source(必填,${formatSourceEnum(AI_MOD_SEARCH_SOURCES)})`,
    'keyword(选填)',
    'limit(选填,默认8,最大20)',
    'page(选填)',
    `来源身份字段按 registry 当前 AI 搜索来源传递（${formatSourceListText(AI_MOD_SEARCH_SOURCES)}）：gameId/sourceGameId/domainName/community/sourceSlug`,
    'sort(选填,按来源 adapter 支持值传递)'
  ].join(', ')
}

export function buildModDetailArgsHint() {
  return [
    `source(必填,${formatSourceEnum(AI_MOD_DETAIL_SOURCES)})`,
    'modId(必填,按来源 adapter 约定传来源模组 ID/标识)',
    'gameId/sourceGameId/domainName/community/sourceSlug(选填,按来源身份要求传递)',
    'fileId(选填,仅来源 adapter 需要时传递)'
  ].join(', ')
}

export function buildModDetailModIdDescription() {
  return `来源模组 ID/标识；当前 AI 详情来源：${formatSourceDescription(
    AI_MOD_DETAIL_SOURCES
  )}。不同来源按 registry/adapter 约定传递。`
}

export function buildSourceCredentialConfigureDescription() {
  return `当 ${formatSourceListText(
    SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES
  )} 缺少 API Key 时，发起客户端安全输入确认卡并保存到本地设置；不要在参数、聊天或日志里传递 API Key 明文。`
}

export function buildInstallRuleSaveConfigDescription() {
  return `把 AI 生成或用户确认的安装规则 JSON 保存为本地安装规则覆盖配置，效果等同于在规则配置页保存自定义规则；当前支持来源：${formatSourceDescription(
    INSTALL_RULE_CONFIG_SOURCES
  )}；不执行安装、不上传云端玩家配置。`
}

export function buildInstallRuleSaveConfigArgsHint() {
  return [
    `sourcePlatform(必填,${formatSourceEnum(INSTALL_RULE_CONFIG_SOURCES)})`,
    'ruleJson(必填,规则JSON对象)',
    'domainName/sourceGameId/sourceSlug/gameId/appId/nameId(选填,按来源安装规则配置要求传递)',
    'nexusGameId/modioGameId/ruleVersion(选填,兼容旧字段)',
    'mergeStrategy(选填,game_detect_only 表示只保存或合并 game_detect)',
    'reason(选填)'
  ].join(', ')
}
