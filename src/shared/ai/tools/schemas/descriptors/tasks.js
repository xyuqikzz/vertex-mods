// 安装任务查询与控制工具声明。
import { AI_AGENT_PERMISSION_LEVELS } from '../shared.js'

export const installTasksDescriptor = Object.freeze({
  name: 'vertex.install.tasks',
  title: '读取安装任务',
  description: '读取安装任务中心的任务摘要与最近任务列表。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint: 'limit(选填,默认10,最大10)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 10 }
    }
  }
})

export const installTaskDetailDescriptor = Object.freeze({
  name: 'vertex.install.task_detail',
  title: '读取安装任务详情',
  description: '读取单个安装任务的明细：任务项、状态、失败原因。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  argsHint:
    'jobId(必填), offset/limit(任务项分页)。selectionRequests 用于组件续跑；verified=true 表示写后核验通过，accepted 不能作为完成依据。',
  inputSchema: {
    type: 'object',
    required: ['jobId'],
    properties: {
      jobId: { type: 'string', description: '安装任务 jobId' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    }
  }
})

export const installTaskTimelineDescriptor = Object.freeze({
  name: 'vertex.install.task_timeline',
  title: '读取安装任务时间线',
  description:
    '读取单个安装任务的时间线、当前任务项、下载产物摘要和失败摘要；只读，不控制任务、不返回密钥或完整下载地址。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'jobId(必填,任务ID,来自 vertex.install.tasks 或 vertex.install.task_detail), limit(选填,默认80,最大200)',
  inputSchema: {
    type: 'object',
    required: ['jobId'],
    properties: {
      jobId: { type: 'string', description: '安装任务 jobId' },
      limit: { type: 'number', minimum: 1, maximum: 200, description: '最多返回的日志事件数' }
    }
  }
})

export const installFailureDiagnoseDescriptor = Object.freeze({
  name: 'vertex.install.failure_diagnose',
  title: '诊断安装任务失败',
  description:
    '读取单个安装任务详情，复用 failureClassifier 和任务日志生成失败阶段、阻断项、警告、证据和下一步建议；只读，不执行重试、回滚或修复，不返回密钥、完整下载地址或完整本地路径。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'jobId(必填,任务ID,来自 vertex.install.tasks 或 vertex.install.task_timeline), logLimit(选填,默认20最大80), includeInfoLogs(选填,默认false)',
  inputSchema: {
    type: 'object',
    required: ['jobId'],
    properties: {
      jobId: { type: 'string', description: '安装任务 jobId' },
      logLimit: {
        type: 'number',
        minimum: 1,
        maximum: 80,
        description: '诊断证据中的日志样本上限'
      },
      includeInfoLogs: {
        type: 'boolean',
        description: '是否把 info 级日志也纳入证据，默认 false'
      }
    }
  }
})

export const installControlTaskDescriptor = Object.freeze({
  name: 'vertex.install.control_task',
  title: '控制安装任务',
  description: '控制安装任务中心的单个任务：暂停、继续、取消或重试；不删除任务记录、不回滚文件。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'by_policy',
  readonly: false,
  enabled: true,
  taskized: false,
  argsHint:
    'jobId(必填), action(必填,pause|resume|cancel|retry), componentSelections(重试组件选择时，按 itemId 映射到 {binding,selected}，来自任务详情), reason(选填)',
  inputSchema: {
    type: 'object',
    required: ['jobId', 'action'],
    properties: {
      jobId: { type: 'string', description: '安装任务 jobId' },
      componentSelections: {
        type: 'object',
        description:
          'retry 专用：{itemId:{binding,selected:[组件ID]}}；binding 必须来自当前任务 selectionRequest，漂移时重新读取。'
      },
      action: {
        type: 'string',
        enum: ['pause', 'resume', 'cancel', 'retry'],
        description: '安装任务控制动作'
      },
      reason: { type: 'string', description: '执行原因或用户确认说明' }
    }
  }
})
