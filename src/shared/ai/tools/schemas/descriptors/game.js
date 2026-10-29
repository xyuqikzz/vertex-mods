// 游戏上下文与目录绑定工具声明。
import { AI_AGENT_PERMISSION_LEVELS, GAME_ROOT_FALLBACK_SOURCES } from '../shared.js'

export const gameListDescriptor = Object.freeze({
  name: 'vertex.game.list',
  title: '读取本地游戏列表',
  description: '列出客户端本地已绑定/已安装的游戏，包含来源、名称、模组数量。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: 'keyword(选填,按名称过滤), limit(选填,默认20,最大50)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      keyword: { type: 'string', description: '按游戏名称模糊过滤' },
      limit: { type: 'number', description: '返回数量上限', minimum: 1, maximum: 50 }
    }
  }
})

export const gameContextDescriptor = Object.freeze({
  name: 'vertex.game.context',
  title: '读取游戏上下文',
  description:
    '读取指定本地游戏的详细上下文：安装根目录是否配置、部署域列表、各来源模组数量、启用/禁用统计。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: 'gameId(必填,本地游戏记录ID,来自 vertex.game.list)',
  inputSchema: {
    type: 'object',
    required: ['gameId'],
    properties: {
      gameId: { type: 'number', description: '本地游戏记录ID（games.id）' }
    }
  }
})

export const gameDetectRootDescriptor = Object.freeze({
  name: 'vertex.game.detect_root',
  title: '只读检测游戏目录',
  description:
    '根据 AI 生成或用户确认的 game_detect 规则只读检测 Nexus / Mod.io 游戏根目录；不返回完整本机路径，不保存绑定，不写入规则。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  supportedSources: GAME_ROOT_FALLBACK_SOURCES,
  argsHint:
    'sourcePlatform(必填,nexus|modio), ruleJson(必填,含game_detect.candidates), sourceGameId/sourceSlug/domainName/nameId(选填但需至少一个来源身份), selectedDirectory(选填,用户手动选择目录后传入)',
  inputSchema: {
    type: 'object',
    required: ['sourcePlatform', 'ruleJson'],
    properties: {
      sourcePlatform: {
        type: 'string',
        enum: GAME_ROOT_FALLBACK_SOURCES,
        description: '真实业务来源，首版只支持 nexus / modio'
      },
      source: {
        type: 'string',
        enum: GAME_ROOT_FALLBACK_SOURCES,
        description: 'sourcePlatform 的兼容别名'
      },
      sourceGameId: { type: 'string', description: '来源游戏 ID' },
      sourceSlug: {
        type: 'string',
        description: '来源游戏 slug / Nexus domainName / Mod.io nameId'
      },
      domainName: { type: 'string', description: 'Nexus 游戏域名标识' },
      nexusGameId: { type: 'number', minimum: 1, description: 'Nexus 游戏 ID' },
      modioGameId: { type: 'number', minimum: 1, description: 'Mod.io 游戏 ID' },
      nameId: { type: 'string', description: 'Mod.io nameId' },
      selectedDirectory: {
        type: 'string',
        description: '用户手动选择的目录；工具只在该目录内二次检测'
      },
      ruleJson: {
        type: 'object',
        description: '包含 game_detect.candidates 的检测规则 JSON'
      }
    }
  }
})

export const gameBindRootDescriptor = Object.freeze({
  name: 'vertex.game.bind_root',
  title: '保存游戏目录绑定',
  description:
    '保存用户确认的 Nexus / Mod.io 游戏目录绑定，并可用 mergeStrategy=game_detect_only 保存检测型本地规则；需要策略确认，不上传云端配置。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'always',
  allowGrant: false,
  readonly: false,
  enabled: true,
  taskized: false,
  supportedSources: GAME_ROOT_FALLBACK_SOURCES,
  argsHint:
    'sourcePlatform(必填,nexus|modio), detectedRootPath(必填), detectedExePath(必填), sourceGameId/sourceSlug/domainName/nameId(选填但需至少一个来源身份), ruleJson(选填), mergeStrategy(选填,game_detect_only)',
  inputSchema: {
    type: 'object',
    required: ['sourcePlatform', 'detectedRootPath', 'detectedExePath'],
    properties: {
      sourcePlatform: {
        type: 'string',
        enum: GAME_ROOT_FALLBACK_SOURCES,
        description: '真实业务来源，首版只支持 nexus / modio'
      },
      source: {
        type: 'string',
        enum: GAME_ROOT_FALLBACK_SOURCES,
        description: 'sourcePlatform 的兼容别名'
      },
      sourceGameId: { type: 'string', description: '来源游戏 ID' },
      sourceSlug: {
        type: 'string',
        description: '来源游戏 slug / Nexus domainName / Mod.io nameId'
      },
      domainName: { type: 'string', description: 'Nexus 游戏域名标识' },
      nexusGameId: { type: 'number', minimum: 1, description: 'Nexus 游戏 ID' },
      modioGameId: { type: 'number', minimum: 1, description: 'Mod.io 游戏 ID' },
      nameId: { type: 'string', description: 'Mod.io nameId' },
      gameId: { type: 'number', minimum: 1, description: 'Vertex 后端游戏 ID，可选' },
      appId: { type: 'number', minimum: 1, description: 'Steam appId，可选' },
      gameName: { type: 'string', description: '游戏名称，可选' },
      detectedRootPath: { type: 'string', description: '用户确认的游戏根目录' },
      detectedExePath: { type: 'string', description: '检测命中的游戏 exe 路径' },
      ruleJson: {
        type: 'object',
        description: '检测型规则 JSON；mergeStrategy=game_detect_only 时保存 game_detect'
      },
      mergeStrategy: {
        type: 'string',
        enum: ['game_detect_only'],
        description: '只保存或合并 game_detect，保留既有 install_rules'
      },
      reason: { type: 'string', description: '保存原因或用户确认说明' }
    }
  }
})
