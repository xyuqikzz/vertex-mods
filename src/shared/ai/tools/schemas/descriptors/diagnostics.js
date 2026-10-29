// 日志、冲突修复与回滚工具声明。
import { AI_AGENT_PERMISSION_LEVELS, INSTALL_SOURCE_FILTERS_WITH_CUSTOM } from '../shared.js'

export const logAnalyzeDescriptor = Object.freeze({
  name: 'vertex.log.analyze',
  title: '分析安装日志',
  description:
    '读取安装任务中心的最近失败任务或指定 jobId，结合 source_install_step_log 与 failureClassifier 输出失败阶段、结构化 errors、suspectedMods、日志摘要和建议动作；只读取已绑定游戏目录或客户端日志目录内的 .log/.txt；其他文件需 selectFiles 打开主进程选择器由用户选择。只读，不执行重试或回滚。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'jobId(选填,指定安装任务), agentTaskId(选填), source(选填), gameKey(选填), state(选填,默认分析最近失败任务), limit(选填,默认3最大5), logLimit(选填,默认50最大200), includeInfoLogs(选填,默认false), logPaths/clientLogPaths/gameLogPaths(选填,授权目录内日志), selectFiles(选填,用户选择外部日志), includeClientLogs(选填,默认true), externalLogLimit(选填,默认同logLimit最大200)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      jobId: { type: 'string', description: '安装任务 jobId；不传则分析最近失败任务' },
      agentTaskId: { type: 'string', description: '关联 Agent 任务 ID 过滤' },
      source: {
        type: 'string',
        enum: INSTALL_SOURCE_FILTERS_WITH_CUSTOM,
        description: '来源过滤'
      },
      gameKey: { type: 'string', description: '安装任务 game_key 过滤' },
      state: { type: 'string', description: '安装任务状态过滤；不传时覆盖常见失败状态' },
      limit: { type: 'number', minimum: 1, maximum: 5 },
      logLimit: { type: 'number', minimum: 1, maximum: 200 },
      includeInfoLogs: { type: 'boolean', description: '是否包含 info 级日志样本' },
      includeClientLogs: {
        type: 'boolean',
        description: '是否尝试采样 App 数据目录常见客户端日志文件，默认 true'
      },
      externalLogLimit: {
        type: 'number',
        minimum: 1,
        maximum: 200,
        description: '外部日志样本数量上限，默认跟随 logLimit'
      },
      logPaths: {
        type: 'array',
        description: '用户显式提供的日志文件路径列表，仅采样 .log/.txt 文件尾部'
      },
      clientLogPaths: {
        type: 'array',
        description: '用户显式提供的客户端日志文件路径列表，仅采样 .log/.txt 文件尾部'
      },
      gameLogPaths: {
        type: 'array',
        description: '用户显式提供的游戏日志文件路径列表，仅采样 .log/.txt 文件尾部'
      },
      selectFiles: {
        type: 'boolean',
        description:
          '打开主进程文件选择器，由用户选择要发送给 AI 的外部日志。未选择的外部路径不能读取。'
      }
    }
  }
})

export const rollbackPlanDescriptor = Object.freeze({
  name: 'vertex.rollback.plan',
  title: '生成回滚计划',
  description:
    '按 Agent taskId、安装 jobId、部署 transactionId 或部署 scope 只读定位部署事务、active 备份条目（或当前中断回滚已确认恢复的条目）、目标模组和部署域，输出文件恢复、默认禁用或显式卸载、最终账本重建的完整确认计划；不产生文件或数据库写入。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'taskId/jobId/transactionId/scope 四选一；modId/installedModId(选填,只回滚指定本地模组关联部署结果)；cleanupPolicy=disable(默认)或uninstall(显式永久清理)；scope 可含 gameId/source/endpointType/deployDomain；limit 不适用，工具最多返回 20 个事务和 200 个备份条目',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      taskId: { type: 'string', description: 'Agent 任务 ID' },
      jobId: { type: 'string', description: '安装任务 jobId' },
      transactionId: { type: 'number', minimum: 1, description: '部署事务 ID' },
      transactionIds: {
        type: 'array',
        description: '部署事务 ID 列表；与 transactionId 兼容'
      },
      modId: {
        type: 'number',
        minimum: 1,
        description: '本地模组 ID；用于把回滚范围限制到指定模组'
      },
      installedModId: {
        type: 'number',
        minimum: 1,
        description: '本地已安装模组 ID，兼容 modId'
      },
      cleanupPolicy: {
        type: 'string',
        enum: ['disable', 'uninstall'],
        description: '回滚后的模组记录处理策略；默认 disable，uninstall 需要破坏性确认'
      },
      scope: {
        type: 'object',
        description: '部署域范围，包含 gameId/source/endpointType/deployDomain'
      },
      gameId: { type: 'number', minimum: 1, description: '部署域 gameId' },
      source: {
        type: 'string',
        enum: INSTALL_SOURCE_FILTERS_WITH_CUSTOM,
        description: '部署来源'
      },
      endpointType: { type: 'number', enum: [0, 1], description: '0=客户端，1=服务端' },
      deployDomain: { type: 'string', description: '部署域名称' }
    }
  }
})

export const rollbackExecuteDescriptor = Object.freeze({
  name: 'vertex.rollback.execute',
  title: '执行回滚动作',
  description:
    '执行 rollback.plan 生成的完整 rollback_task：锁定部署域，恢复文件，按计划禁用或卸载目标模组，使用剩余启用模组调用 reconcileDeploy 重建 manifest/owners，全部成功后再归档事务、备份和来源任务状态；任何授权模式下都需要用户确认，阶段失败会返回 repairRequired 和可重试信息。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE,
  dangerous: true,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: true,
  argsHint: 'action(必填,来自 vertex.rollback.plan.actions 的单个动作), reason(选填)',
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'object',
        description: '来自 vertex.rollback.plan.actions 的单个 rollback_task 动作'
      },
      reason: {
        type: 'string',
        description: '执行原因或用户确认说明'
      }
    }
  }
})

export const conflictDetectDescriptor = Object.freeze({
  name: 'vertex.conflict.detect',
  title: '检测模组冲突',
  description:
    '基于本地部署账本（文件清单与归属表）检测指定游戏的同目标路径覆盖冲突；也可接收候选安装预检计划，归因 rule_not_matched 并预测安装前后 candidateWinnerChanges。输出涉及模组、账本生效方、按 priority_order 预测的生效方、结构化 issues、加载顺序风险、repairSuggestion、候选覆盖风险和安装规则未命中诊断。只读，不做任何修复。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint:
    'gameId(必填), endpointType(选填,默认0), deployDomain(选填,不填则检测全部部署域), installPlan/candidatePlan/standardPreflight(选填,用于 rule_not_matched 归因与候选安装前后 winner 预测), candidateModName/candidatePriorityOrder(选填)',
  inputSchema: {
    type: 'object',
    required: ['gameId'],
    properties: {
      gameId: { type: 'number', description: '本地游戏记录ID（games.id）' },
      endpointType: { type: 'number', enum: [0, 1] },
      deployDomain: { type: 'string' },
      installPlan: {
        type: 'object',
        description: '安装预检或安装计划对象，用于归因 missedReasons / rule_not_matched'
      },
      candidatePlan: {
        type: 'object',
        description: '候选安装计划兼容字段，用于归因 rule_not_matched'
      },
      plan: {
        type: 'object',
        description: 'installPlan 的兼容别名'
      },
      standardPreflight: {
        type: 'object',
        description: 'vertex.install.inspect_plan 返回的 standardPreflight 结果'
      },
      candidateModName: {
        type: 'string',
        description: '候选安装包名称，用于候选 winner 展示'
      },
      candidatePriorityOrder: {
        type: 'number',
        description: '候选安装后预期 priority_order；不传则按当前路径最大 priority_order + 1 预测'
      }
    }
  }
})

export const conflictRepairPlanDescriptor = Object.freeze({
  name: 'vertex.conflict.repair_plan',
  title: '生成冲突修复计划',
  description:
    '基于当前冲突检测结果生成 priority_order 调整、domain_rebuild、禁用/卸载冲突模组与缺失依赖补装的结构化修复计划。只生成计划，不保存排序，不执行部署重建、安装任务或卸载。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: false,
  enabled: true,
  taskized: false,
  argsHint:
    'gameId(必填), endpointType(选填,默认0), deployDomain(选填), targetRelativePath(选填), preferredWinnerModId(选填), includeDomainRebuild(选填,默认true), includeDisableMod(选填,默认false), includeUninstallMod(选填,默认false), includeInstallMissing(选填,默认false), agentTaskId(补装依赖时必填，来自安装预检), maxActions(选填,默认20,最大50)',
  inputSchema: {
    type: 'object',
    required: ['gameId'],
    properties: {
      gameId: { type: 'number', description: '本地游戏记录ID（games.id）' },
      endpointType: { type: 'number', enum: [0, 1] },
      deployDomain: { type: 'string' },
      targetRelativePath: { type: 'string', description: '只为指定冲突目标路径生成计划' },
      preferredWinnerModId: {
        type: 'number',
        minimum: 1,
        description: '用户希望最终生效的本地模组ID'
      },
      includeDomainRebuild: {
        type: 'boolean',
        description: '是否同步生成部署域重建动作，默认 true'
      },
      includeDisableMod: {
        type: 'boolean',
        description: '是否生成禁用非目标 winner 模组的动作，默认 false'
      },
      includeUninstallMod: {
        type: 'boolean',
        description: '是否生成卸载非目标 winner 模组的动作，默认 false；比禁用更强，必须显式开启'
      },
      includeInstallMissing: {
        type: 'boolean',
        description: '是否引用当前会话的安装预检计划补装缺失依赖；需提供 agentTaskId，默认 false'
      },
      agentTaskId: {
        type: 'string',
        description: '当前会话安装预检生成的任务 ID，补装依赖时必须提供'
      },
      maxActions: { type: 'number', minimum: 1, maximum: 50 }
    }
  }
})

export const conflictExecuteRepairDescriptor = Object.freeze({
  name: 'vertex.conflict.execute_repair',
  title: '执行冲突修复',
  description:
    '执行冲突修复动作。当前支持 repair_plan 生成的 reorder_priority、domain_rebuild、disable_mod、uninstall_mod 与 install_missing；会修改 priority_order、重建部署域、禁用/卸载模组或提交依赖安装任务。只接受主进程保存的 repairPlanId 和 actionId，执行前必须确认；目标变化或计划过期后需重新生成。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE,
  dangerous: true,
  requiresConfirmation: 'always',
  allowGrant: false,
  readonly: false,
  enabled: true,
  taskized: true,
  argsHint: 'repairPlanId(必填), actionId(必填)，均来自 vertex.conflict.repair_plan',
  inputSchema: {
    type: 'object',
    required: ['repairPlanId', 'actionId'],
    properties: {
      repairPlanId: { type: 'string', description: '主进程生成的修复计划 ID' },
      actionId: { type: 'string', description: '计划中的单个动作 ID' }
    }
  }
})
