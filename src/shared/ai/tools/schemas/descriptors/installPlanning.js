// 安装依赖、位置证据、规则预演与计划执行工具声明。
import {
  AI_AGENT_PERMISSION_LEVELS,
  DEPENDENCY_RESOLVE_SOURCES,
  GAME_ROOT_FALLBACK_SOURCES,
  AI_INSTALL_PLAN_SOURCES,
  AI_INSTALL_PLAN_UNSUPPORTED_SOURCES
} from '../shared.js'

export const installResolveDependenciesDescriptor = Object.freeze({
  name: 'vertex.install.resolve_dependencies',
  title: '解析安装依赖',
  description:
    '解析候选模组的依赖关系并返回待补装/已复用依赖摘要。Ficsit 支持递归安装计划，其他来源先返回详情元数据中的依赖，不执行下载或安装。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: false,
  enabled: true,
  taskized: false,
  supportedSources: DEPENDENCY_RESOLVE_SOURCES,
  argsHint:
    'candidate(必填,候选模组/详情), context(选填,页面上下文), source(选填,覆盖 candidate.source)',
  inputSchema: {
    type: 'object',
    required: ['candidate'],
    properties: {
      candidate: {
        type: 'object',
        description: '候选模组或来源详情，通常来自 vertex.mod.search / vertex.mod.detail'
      },
      context: {
        type: 'object',
        description: '页面上下文；不传时使用当前对话页面上下文'
      },
      source: {
        type: 'string',
        enum: DEPENDENCY_RESOLVE_SOURCES,
        description: '覆盖候选中的来源'
      }
    }
  }
})

export const installContextAuditDescriptor = Object.freeze({
  name: 'vertex.install.context_audit',
  title: '安装上下文体检',
  description:
    '按 sections 检查候选安装上下文的来源能力、游戏绑定、安装规则、文件选择、授权态和依赖信号；只输出 blockers、warnings 与 nextActions，不执行下载、安装或保存配置。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: false,
  enabled: true,
  taskized: false,
  argsHint:
    'source(选填,真实业务来源), candidate(选填,候选模组/详情), context(选填,页面上下文), sections(选填,source|binding|rule|file|auth|dependencies), sourceGameId/sourceSlug/gameId/steamAppId(选填)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      source: {
        type: 'string',
        description: '真实业务来源；aggregate 不能作为工具来源，缺省时从 candidate/context 推断'
      },
      candidate: {
        type: 'object',
        description: '候选模组或来源详情，通常来自 vertex.mod.search / vertex.mod.detail'
      },
      context: {
        type: 'object',
        description: '页面上下文；不传时使用当前对话页面上下文'
      },
      sections: {
        type: 'array',
        description:
          '检查范围，可包含 source、binding、rule、file、auth、dependencies；不传则检查全部'
      },
      sourceGameId: {
        type: 'string',
        description: '来源游戏 ID，可覆盖 context.game.sourceGameId'
      },
      sourceSlug: {
        type: 'string',
        description: '来源游戏 slug/domain/community，可覆盖 context.game.sourceSlug'
      },
      gameId: {
        type: 'string',
        description: '来源游戏 ID 或本地游戏 ID 的兼容字段'
      },
      steamAppId: {
        type: 'string',
        description: 'Steam App ID，可作为来源游戏身份'
      }
    }
  }
})

export const installArchiveInspectDescriptor = Object.freeze({
  name: 'vertex.install.archive.inspect',
  title: '检查压缩包结构',
  description:
    '读取用户已选择或明确提供的 zip/rar/7z 压缩包，复用客户端压缩包结构预览能力，输出条目摘要、识别信号和下一步建议；只读，不提交安装任务、不保存 staging、不返回完整本地路径。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'archivePath 或 archiveRef；offset/limit 分页目录；entryPath 定向读取 ZIP 内 README/清单/配置，textOffset/textLimit 分页正文；引用隔离于会话和游戏。',
  inputSchema: {
    type: 'object',
    required: [],
    anyOf: [{ required: ['archivePath'] }, { required: ['archiveRef'] }, { required: ['jobId'] }],
    properties: {
      archiveRef: {
        type: 'string',
        description: '上次检查返回的稳定包引用，不能跨会话、游戏或配置档案复用'
      },
      jobId: { type: 'string', description: '从安装任务引用已下载包，免传本地路径' },
      itemId: { type: 'string', description: '多安装项任务必须指定任务详情中的 itemId' },
      offset: {
        type: 'integer',
        minimum: 0,
        description: '目录起始条目，使用 summary.nextOffset 继续'
      },
      entryPath: { type: 'string', description: 'ZIP 内的精确相对路径，只读取文本，不执行内容' },
      nestedPath: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
        description:
          '显式逐层进入内层 ZIP，如 ["bundle.zip","plugins.zip"]；后续分页和文本读取保留此数组'
      },
      textOffset: { type: 'integer', minimum: 0 },
      textLimit: { type: 'integer', minimum: 1, maximum: 8000 },
      archivePath: {
        type: 'string',
        description: '用户已选择或明确提供的本地压缩包路径'
      },
      appId: {
        type: 'number',
        minimum: 1,
        description: '本地游戏 appId，可用于复用客户端 staging 规则'
      },
      usageType: {
        type: 'number',
        minimum: 0,
        maximum: 5,
        description: '压缩包用途类型，默认 1'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 200,
        description: '最多返回的结构条目数量'
      },
      maxEntries: {
        type: 'number',
        minimum: 1,
        maximum: 200,
        description: 'limit 的兼容别名'
      }
    }
  }
})

export const installLocationHintsDescriptor = Object.freeze({
  name: 'vertex.install.location_hints',
  title: '解析安装位置线索',
  description:
    '按模组和来源游戏标识主动读取对应详情页正文、所选文件说明，并结合 README 和压缩包摘要提取安装路径与游戏 EXE 线索；只输出 game_relative 或 user_relative 目标，不返回完整本机路径，不写入规则或用户目录。多个目标须核对，临时草案必须预检。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  supportedSources: GAME_ROOT_FALLBACK_SOURCES,
  argsHint:
    'sourcePlatform(必填,nexus|modio), modId(推荐), domainName(Nexus)/sourceGameId(Mod.io), fileId(选填), detailText/readmeText/installation(选填), archiveSummary(选填,来自archive.inspect)；缺失身份时可复用同来源当前模组页面',
  inputSchema: {
    type: 'object',
    required: ['sourcePlatform'],
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
      detailText: {
        type: 'string',
        maxLength: 128000,
        description: '模组详情页或文件说明中的安装文本，超长拒绝而非截断'
      },
      modId: { type: 'string', description: '待安装的具体模组 ID，用于读取对应详情，不是游戏 ID' },
      domainName: { type: 'string', description: 'Nexus 游戏域名标识' },
      sourceSlug: { type: 'string', description: 'Nexus domainName 的兼容字段' },
      sourceGameId: { type: 'string', description: 'Mod.io 来源游戏 ID，不是本地 games.id' },
      gameId: { type: 'string', description: 'Mod.io 来源游戏 ID 的兼容字段' },
      fileId: { type: 'string', description: '已选择的文件 ID，避免分析其他版本文件的安装说明' },
      fetchDetail: {
        type: 'boolean',
        description: '默认 true，具备身份时主动读取详情；false 仅分析已提供的文本'
      },
      readmeText: { type: 'string', maxLength: 128000, description: 'README 文本' },
      installation: { type: 'string', maxLength: 128000, description: '安装说明文本' },
      description: { type: 'string', maxLength: 128000, description: '模组描述文本' },
      archiveSummary: {
        type: 'object',
        description: '压缩包结构摘要，可来自 vertex.install.archive.inspect'
      },
      context: {
        type: 'object',
        description: '页面上下文或候选上下文；用于后续模型判断，不作为路径写入来源'
      }
    }
  }
})

export const installRuleMatchPreviewDescriptor = Object.freeze({
  name: 'vertex.install.rule.match_preview',
  title: '预演安装规则匹配',
  description:
    '用统一安装引擎预演普通、模板及声明式规则，返回精确映射、依赖、配置冲突及组件选择；临时副本隔离，不写 staging 原目录，不提交安装任务，不返回完整本地路径，不代表安装完成。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'ruleJson, stagingPath, gameRoot(必填)；installChoices={binding,selected} 来自 selectionRequest；source 应与最终任务一致；offset/maxResults 分页映射。',
  inputSchema: {
    type: 'object',
    required: ['ruleJson'],
    anyOf: [
      { required: ['stagingPath', 'gameRoot'] },
      { required: ['archiveRef'] },
      { required: ['jobId'] }
    ],
    properties: {
      archiveRef: {
        type: 'string',
        description: 'archive.inspect 的包引用，可替代 stagingPath；复用统一解包器在临时目录预演'
      },
      jobId: { type: 'string', description: '已下载包所属任务，自动读取实际游戏目录和来源' },
      itemId: { type: 'string', description: '任务包含多个安装项时必填' },
      installChoices: {
        type: 'object',
        description:
          '当前引擎 selectionRequest 的 binding 和 selected 数组；偏好不明时一次询问全部组件组'
      },
      source: { type: 'string', description: '真实安装来源，与最终任务一致' },
      offset: {
        type: 'integer',
        minimum: 0,
        description: '映射起始条目，使用 summary.nextOffset 继续'
      },
      installedCapabilities: {
        type: 'object',
        description: '只读诊断中的已安装能力证据；实际任务将自行读取并核对，不作为安装授权'
      },
      ruleJson: {
        type: 'object',
        description: '安装规则 JSON，通常包含 schema_version 和 install_rules'
      },
      stagingPath: {
        type: 'string',
        description: '用户已解包或已准备的包目录；工具只读取，不写入'
      },
      gameRoot: {
        type: 'string',
        description: '游戏根目录，用于解析 target 相对路径边界'
      },
      packageFolderName: {
        type: 'string',
        description: '包目录名或压缩包名，用于 download_relative 等目标规则'
      },
      maxResults: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        description: '最多返回的规则候选匹配结果'
      },
      maxCandidates: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: '最多评估的候选包根数量'
      }
    }
  }
})

export const installInspectPlanDescriptor = Object.freeze({
  name: 'vertex.install.inspect_plan',
  title: '安装预检',
  description:
    '对指定候选模组生成安装计划预览，返回计划摘要、是否可提交及缺失的决策数据；不执行下载或安装。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: false,
  enabled: true,
  taskized: true,
  supportedSources: AI_INSTALL_PLAN_SOURCES,
  unsupportedSources: AI_INSTALL_PLAN_UNSUPPORTED_SOURCES,
  argsHint:
    'candidate 或 agentTaskId(原预检引用)；context 可选；installChoices={binding,selected} 续跑组件选择；archiveRef 可引用已检查的包。',
  inputSchema: {
    type: 'object',
    required: [],
    anyOf: [{ required: ['candidate'] }, { required: ['agentTaskId'] }],
    properties: {
      agentTaskId: {
        type: 'string',
        description: '同会话原预检任务引用；沿用原目标和来源，重新执行预检'
      },
      installChoices: {
        type: 'object',
        description: '引擎 selectionRequest 返回的 binding 和 selected 数组'
      },
      archiveRef: { type: 'string', description: '同会话 archive.inspect 返回的本地包引用' },
      candidate: {
        type: 'object',
        description: '候选模组或来源文件信息，通常来自 vertex.mod.search / vertex.mod.detail'
      },
      context: {
        type: 'object',
        description: '页面上下文；不传时使用当前对话页面上下文'
      }
    }
  }
})

export const installExecutePlanDescriptor = Object.freeze({
  name: 'vertex.install.execute_plan',
  title: '提交安装计划',
  description:
    '按真实目标授权将预检计划提交到任务中心。full_auto 对当前会话的已保存计划自动执行；其他模式复用同目标授权。accepted 只代表已入队，必须查询 task_detail 核验结果。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: true,
  argsHint: 'agentTaskId(选填), installPlan(选填), sourceInstallTaskPayload(选填), reason(选填)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      agentTaskId: { type: 'string', description: '关联的 Agent 任务 ID' },
      installPlan: { type: 'object', description: '完整安装计划卡数据' },
      plan: { type: 'object', description: 'installPlan 的兼容别名' },
      sourceInstallTaskPayload: { type: 'object', description: '安装任务中心 payload' },
      backupPolicy: {
        type: 'string',
        enum: ['session_backup', 'manifest_only', 'none'],
        description: '备份策略；默认由安装任务执行链路处理'
      },
      reason: { type: 'string', description: '提交原因或模型说明' }
    }
  }
})
