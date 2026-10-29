// 模组查询、更新与生命周期工具声明。
import {
  AI_AGENT_PERMISSION_LEVELS,
  INSTALL_SOURCE_FILTERS,
  formatSourceDescription,
  AI_MOD_SEARCH_SOURCES,
  buildModSearchArgsHint,
  AI_MOD_DETAIL_SOURCES,
  buildModDetailArgsHint,
  buildModDetailModIdDescription,
  formatSourceEnum
} from '../shared.js'

export const modInstalledListDescriptor = Object.freeze({
  name: 'vertex.mod.installed_list',
  title: '读取已安装模组列表',
  description: '列出指定本地游戏已安装的模组，包含来源、版本、启用状态、优先级、部署域。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint:
    'gameId(必填), endpointType(选填,0客户端/1服务端,默认0), deployDomain(选填), source(选填), keyword(选填), limit(选填,默认50,最大100)',
  inputSchema: {
    type: 'object',
    required: ['gameId'],
    properties: {
      gameId: { type: 'number', description: '本地游戏记录ID（games.id）' },
      endpointType: { type: 'number', description: '0=客户端，1=服务端', enum: [0, 1] },
      deployDomain: { type: 'string', description: '部署域过滤' },
      source: {
        type: 'string',
        description: `来源过滤（${formatSourceDescription(INSTALL_SOURCE_FILTERS)}）`
      },
      keyword: { type: 'string', description: '按模组名称模糊过滤' },
      limit: { type: 'number', minimum: 1, maximum: 100 }
    }
  }
})

export const modInstalledDetailDescriptor = Object.freeze({
  name: 'vertex.mod.installed_detail',
  title: '读取已安装模组详情',
  description: '读取单个已安装模组的完整信息：元数据、依赖、部署文件清单摘要。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: 'installedModId(必填,本地模组记录ID,来自 vertex.mod.installed_list)',
  inputSchema: {
    type: 'object',
    required: ['installedModId'],
    properties: {
      installedModId: { type: 'number', description: '本地模组记录ID（mods.id）' }
    }
  }
})

export const modSearchDescriptor = Object.freeze({
  name: 'vertex.mod.search',
  title: '搜索模组',
  description: `在 registry 声明 AI 搜索能力的来源（${formatSourceDescription(
    AI_MOD_SEARCH_SOURCES
  )}）中搜索模组。`,
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: buildModSearchArgsHint(),
  inputSchema: {
    type: 'object',
    required: ['source'],
    properties: {
      source: {
        type: 'string',
        enum: AI_MOD_SEARCH_SOURCES,
        description: '模组来源'
      },
      keyword: { type: 'string', description: '搜索关键词' },
      limit: { type: 'number', minimum: 1, maximum: 20 },
      page: { type: 'number', minimum: 1 },
      gameId: { type: 'string', description: 'Vertex 本地游戏 ID 或 Mod.io 游戏 ID' },
      domainName: { type: 'string', description: 'Nexus 游戏域名标识，例如 stardewvalley' },
      community: { type: 'string', description: 'Thunderstore 社区标识，例如 repo' },
      sort: {
        type: 'string',
        description:
          '排序方式。Ficsit: popularity_desc/downloads_desc/updated_desc/created_desc/name_asc；Thunderstore: last-updated/newest/most-downloaded/top-rated'
      }
    }
  }
})

export const modDetailDescriptor = Object.freeze({
  name: 'vertex.mod.detail',
  title: '读取模组详情',
  description: '读取来源模组的详情：版本、作者、简介、文件与下载信息。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: buildModDetailArgsHint(),
  inputSchema: {
    type: 'object',
    required: ['source', 'modId'],
    properties: {
      source: {
        type: 'string',
        enum: AI_MOD_DETAIL_SOURCES
      },
      modId: {
        type: 'string',
        description: buildModDetailModIdDescription()
      },
      gameId: { type: 'string', description: 'Vertex 本地游戏 ID 或 Mod.io 游戏 ID' },
      domainName: { type: 'string', description: 'Nexus 游戏域名标识' },
      community: { type: 'string', description: 'Thunderstore 社区标识' },
      fileId: { type: 'string', description: '明确指定的来源文件 ID，可选；不存在时不能退回最新' },
      version: {
        type: 'string',
        description: 'Nexus 明确指定的版本；默认最新正式版，固定版本不存在时返回错误'
      },
      fileOffset: {
        type: 'integer',
        minimum: 0,
        description: '文件/版本目录分页起点，使用 catalogs 的 nextOffset 续读'
      },
      fileLimit: { type: 'integer', minimum: 1, maximum: 30 }
    }
  }
})

export const localModAnalyzeDescriptor = Object.freeze({
  name: 'vertex.local_mod.analyze',
  title: '分析本地 Mod 来源',
  description:
    '分析用户已选择或明确提供的本地 Mod 文件、文件夹或压缩包，输出结构信号、风险、重复状态和推荐处理方式；只读，不导入库、不创建安装任务、不启用/禁用/删除文件，且不返回完整本地路径。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'paths(必填,用户已选择或明确提供的本地 Mod 文件/文件夹/压缩包路径数组,最多20), gameRoot(选填,用于安全校验), rootPath/gamePath(选填兼容字段)',
  inputSchema: {
    type: 'object',
    required: ['paths'],
    properties: {
      paths: {
        type: 'array',
        description: '用户已选择或明确提供的本地 Mod 文件、文件夹或压缩包路径数组，最多 20 个'
      },
      gameRoot: {
        type: 'string',
        description: '当前游戏根目录，用于阻止接管高风险根目录'
      },
      rootPath: {
        type: 'string',
        description: 'gameRoot 的兼容字段'
      },
      gamePath: {
        type: 'string',
        description: 'gameRoot 的兼容字段'
      }
    }
  }
})

export const modUpdateCheckDescriptor = Object.freeze({
  name: 'vertex.mod.update_check',
  title: '检查已安装模组更新',
  description:
    '只读检查本地已安装模组是否存在远端版本变化：读取 mods/games 记录，按 registry 校验 ai.detail 能力，调用来源详情 adapter 比较版本；不提交安装计划，不执行更新、启用、禁用、卸载或文件写入。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: `installedModId(必填), source(选填,${formatSourceEnum(
    AI_MOD_DETAIL_SOURCES
  )}), domainName/gameId/community/sourceGameId/sourceSlug(选填,本地游戏记录缺失时补来源身份)`,
  inputSchema: {
    type: 'object',
    required: ['installedModId'],
    properties: {
      installedModId: {
        type: 'number',
        minimum: 1,
        description: '本地已安装模组 ID'
      },
      source: {
        type: 'string',
        enum: AI_MOD_DETAIL_SOURCES,
        description: `来源过滤（${formatSourceDescription(AI_MOD_DETAIL_SOURCES)}）`
      },
      domainName: {
        type: 'string',
        description: 'Nexus 游戏域名；本地游戏记录缺失 source_slug 时可传'
      },
      gameId: {
        type: 'string',
        description: 'Mod.io 或来源游戏 ID；本地游戏记录缺失 source_id 时可传'
      },
      community: {
        type: 'string',
        description: 'Thunderstore community；本地游戏记录缺失 source_slug 时可传'
      },
      sourceGameId: {
        type: 'string',
        description: '来源游戏 ID 兼容字段'
      },
      sourceSlug: {
        type: 'string',
        description: '来源游戏 slug 兼容字段'
      }
    }
  }
})

export const modLifecyclePlanDescriptor = Object.freeze({
  name: 'vertex.mod.lifecycle_plan',
  title: '生成已安装模组生命周期计划',
  description:
    '针对本地已安装模组生成启用、禁用、卸载或重排优先级的执行 action；PLAN 级，不调用 toggleModState/uninstallModById/saveModPriorityOrder，不修改文件或数据库。update_mod 只做更新检查和安装预检引导，不产出 lifecycle_execute action，避免绕过各来源安装流程。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'actionType(必填,enable_mod|disable_mod|uninstall_mod|reorder_priority|update_mod), installedModId(启用/禁用/卸载/更新必填), ids(重排必填,至少2个), force(卸载选填), reason(选填)',
  inputSchema: {
    type: 'object',
    required: ['actionType'],
    properties: {
      actionType: {
        type: 'string',
        enum: ['enable_mod', 'disable_mod', 'uninstall_mod', 'reorder_priority', 'update_mod'],
        description: '生命周期动作类型'
      },
      installedModId: {
        type: 'number',
        minimum: 1,
        description: '本地已安装模组 ID，启用/禁用/卸载/更新时必填'
      },
      ids: {
        type: 'array',
        description: '重排后的本地已安装模组 ID 顺序，reorder_priority 时至少 2 个'
      },
      force: {
        type: 'boolean',
        description: '卸载时是否强制忽略默认依赖占用保护；默认 false'
      },
      reason: {
        type: 'string',
        description: '计划原因或用户确认说明'
      }
    }
  }
})

export const modLifecycleExecuteDescriptor = Object.freeze({
  name: 'vertex.mod.lifecycle_execute',
  title: '执行已安装模组生命周期动作',
  description:
    '执行 vertex.mod.lifecycle_plan 产出的单个可执行 action，复用 toggleModState、uninstallModById 或 saveModPriorityOrder，并记录 Agent task；会启用/禁用/卸载模组或修改 priority_order，必须用户确认后执行，不支持 update_mod，更新需走 vertex.install.inspect_plan。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE,
  dangerous: true,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: true,
  allowGrant: false,
  argsHint: 'action(必填,来自 vertex.mod.lifecycle_plan.actions 的单个 action), reason(选填)',
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'object',
        description: '来自 vertex.mod.lifecycle_plan.actions 的单个生命周期 action'
      },
      reason: {
        type: 'string',
        description: '执行原因或用户确认说明'
      }
    }
  }
})
