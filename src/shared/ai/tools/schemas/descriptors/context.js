// 技能、页面与来源能力工具声明。
import {
  AI_AGENT_PERMISSION_LEVELS,
  PAGE_CONTEXT_SECTION_NAMES,
  formatSourceEnum,
  SOURCE_CAPABILITY_QUERY_NAMES,
  SOURCE_CREDENTIAL_SOURCES,
  SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES,
  buildSourceCredentialConfigureDescription
} from '../shared.js'
import { buildAgentSourceCredentialConfirmationInput } from '../../../installation/ai-agent-source-credential.js'

export const skillReadDescriptor = Object.freeze({
  name: 'vertex.skill.read',
  title: '读取技能指引',
  description:
    '根据当前技能目录中的 skillId 读取完整操作指引；只读，不执行其中的操作，不改变权限。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: 'skillId(必填，来自当前技能目录)',
  inputSchema: {
    type: 'object',
    required: ['skillId'],
    properties: { skillId: { type: 'string', description: '技能目录中的 ID' } }
  }
})

export const pageContextDescriptor = Object.freeze({
  name: 'vertex.page.context',
  title: '读取当前页面上下文',
  description:
    '读取当前页面 provider 上报并已脱敏的 AI 页面上下文，返回展示来源、真实业务来源、当前游戏、当前模组、筛选器、安装状态和能力位；不重新解析来源全集，不返回 cookie、API Key、token 或私有路径列表。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: `sections(选填,${formatSourceEnum(
    PAGE_CONTEXT_SECTION_NAMES
  )}；不填返回完整快照), includeQuickSuggestions(选填,默认true)`,
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      sections: {
        type: 'array',
        description: '只返回指定顶层上下文字段；不传则返回完整脱敏快照'
      },
      includeQuickSuggestions: {
        type: 'boolean',
        description: '是否返回当前页面快捷建议，默认 true'
      }
    }
  }
})

export const sourceCapabilitiesDescriptor = Object.freeze({
  name: 'vertex.source.capabilities',
  title: '查询来源能力',
  description:
    '从来源平台注册表查询来源状态、能力、错误码和支持来源列表；用于判断 search/detail/installPlan/dependencies 等能力，aggregate 只作为展示来源，不能直接作为工具来源。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: `source(选填,registry来源或别名；不设enum以允许查询aggregate/modrinth边界状态), capability(选填,${formatSourceEnum(
    SOURCE_CAPABILITY_QUERY_NAMES
  )}；不填返回该来源全部能力)`,
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      source: {
        type: 'string',
        description: '来源平台或别名；aggregate 仅用于查询边界说明，不能作为业务工具来源'
      },
      capability: {
        type: 'string',
        enum: SOURCE_CAPABILITY_QUERY_NAMES,
        description: '要检查的 registry 能力'
      }
    }
  }
})

export const sourceCredentialStatusDescriptor = Object.freeze({
  name: 'vertex.source_credential.status',
  title: '读取来源授权状态',
  description:
    '读取来源授权或配置状态，并返回获取地址和配置建议；不会返回 API Key、Cookie 或 token 明文。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: `source(选填,${formatSourceEnum(SOURCE_CREDENTIAL_SOURCES)}；不填返回全部)`,
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      source: {
        type: 'string',
        enum: SOURCE_CREDENTIAL_SOURCES,
        description: '来源平台'
      }
    }
  }
})

export const sourceCredentialConfigureDescriptor = Object.freeze({
  name: 'vertex.source_credential.configure',
  title: '配置来源 API Key',
  description: buildSourceCredentialConfigureDescription(),
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: false,
  allowGrant: false,
  confirmationInput: buildAgentSourceCredentialConfirmationInput(),
  argsHint: `source(必填,${formatSourceEnum(SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES)}), reason(选填), baseUrl(modio选填), platform(modio选填)；不接受 apiKey 参数，密钥只由客户端确认卡输入`,
  inputSchema: {
    type: 'object',
    required: ['source'],
    additionalProperties: false,
    properties: {
      source: {
        type: 'string',
        enum: SOURCE_CREDENTIAL_CONFIGURABLE_SOURCES,
        description: '来源平台'
      },
      reason: { type: 'string', description: '配置原因或用户确认说明' },
      baseUrl: {
        type: 'string',
        description: 'Mod.io API Base URL，默认 https://api.mod.io/v1'
      },
      platform: {
        type: 'string',
        description: 'Mod.io 平台标识，默认 windows'
      }
    }
  }
})
