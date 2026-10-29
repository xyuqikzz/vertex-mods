// 安装规则文档与保存工具声明。
import {
  AI_AGENT_PERMISSION_LEVELS,
  INSTALL_RULE_CONFIG_SOURCES,
  buildInstallRuleSaveConfigDescription,
  buildInstallRuleSaveConfigArgsHint
} from '../shared.js'

export const installRuleReferenceDocsDescriptor = Object.freeze({
  name: 'vertex.install_rule.reference_docs',
  title: '读取安装规则参考文档',
  description:
    '从前端展示用 Markdown 文档读取最新安装规则参考内容，用于为某个游戏编写或调整安装规则文档/JSON；不修改规则、不执行安装。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'document(默认all，推荐install-rule-reference), keyword(章节内容过滤), maxSections(默认24最大30), sectionOffset(按nextSectionOffset续读，不丢长章节后半部分)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      document: {
        type: 'string',
        enum: [
          'all',
          'install-rule-reference',
          'source-install-rule-user-guide',
          'nexus-rule-reference'
        ],
        description:
          '要读取的前端规则文档；推荐使用 install-rule-reference，nexus-rule-reference 仅保留旧 ID 兼容'
      },
      keyword: { type: 'string', description: '按标题或正文关键词过滤章节' },
      sectionOffset: { type: 'integer', minimum: 0, maximum: 1000 },
      maxSections: { type: 'number', minimum: 1, maximum: 30 }
    }
  }
})

export const installRuleSaveConfigDescriptor = Object.freeze({
  name: 'vertex.install_rule.save_config',
  title: '保存安装规则配置',
  description: buildInstallRuleSaveConfigDescription(),
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'by_policy',
  readonly: false,
  enabled: true,
  taskized: false,
  supportedSources: INSTALL_RULE_CONFIG_SOURCES,
  argsHint: buildInstallRuleSaveConfigArgsHint(),
  inputSchema: {
    type: 'object',
    required: ['sourcePlatform', 'ruleJson'],
    properties: {
      sourcePlatform: {
        type: 'string',
        enum: INSTALL_RULE_CONFIG_SOURCES,
        description: '安装配置来源平台'
      },
      source: {
        type: 'string',
        enum: INSTALL_RULE_CONFIG_SOURCES,
        description: 'sourcePlatform 的兼容别名'
      },
      ruleJson: {
        type: 'object',
        description:
          '安装规则 JSON 对象；常规保存需包含 schema_version 和 install_rules，game_detect_only 可只包含 game_detect'
      },
      domainName: {
        type: 'string',
        description: 'Nexus 游戏域名标识，例如 stardewvalley'
      },
      nexusGameId: {
        type: 'number',
        minimum: 1,
        description: 'Nexus 游戏 ID，可选'
      },
      modioGameId: {
        type: 'number',
        minimum: 1,
        description: 'Mod.io 游戏 ID，sourcePlatform=modio 时必填'
      },
      gameKey: {
        type: 'string',
        description: 'Mod.io 游戏 ID 的兼容字段；保存时会尝试转为数字'
      },
      gameId: {
        type: 'number',
        minimum: 1,
        description: 'Vertex 后端游戏 ID，可选'
      },
      appId: {
        type: 'number',
        minimum: 1,
        description: 'Steam appId，可选'
      },
      nameId: {
        type: 'string',
        description: 'Mod.io nameId，可选'
      },
      ruleVersion: {
        type: 'number',
        minimum: 1,
        description: '规则版本；不传时自动使用当前本地版本 + 1'
      },
      baseRuleVersion: {
        type: 'number',
        minimum: 1,
        description: 'Nexus 云端基线版本，可选'
      },
      baseRuleJson: {
        type: 'object',
        description: 'Nexus 云端基线规则，可选'
      },
      mergeStrategy: {
        type: 'string',
        enum: ['game_detect_only'],
        description: '只保存或合并 game_detect，保留既有 install_rules'
      },
      reason: {
        type: 'string',
        description: '保存原因或用户确认说明'
      }
    }
  }
})
