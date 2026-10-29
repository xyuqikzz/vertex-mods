// 修改器与脚本工具声明。
import { AI_AGENT_PERMISSION_LEVELS } from '../shared.js'
import { AGENT_SCRIPT_MAX_LENGTH, AGENT_SCRIPT_MAX_TIMEOUT_MS } from '../../ai-agent-script.js'

export const trainerFlingSearchDescriptor = Object.freeze({
  name: 'vertex.trainer.fling.search',
  title: '搜索风灵月影修改器',
  description: '搜索 flingtrainer.com 的风灵月影修改器列表；只读，不下载、不运行。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: 'keyword(选填), page(选填,默认1), limit(选填,默认12最大24)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      keyword: { type: 'string', description: '游戏或 Trainer 关键词' },
      page: { type: 'number', minimum: 1 },
      limit: { type: 'number', minimum: 1, maximum: 24 }
    }
  }
})

export const trainerFlingDetailDescriptor = Object.freeze({
  name: 'vertex.trainer.fling.detail',
  title: '读取风灵月影详情',
  description: '读取 flingtrainer.com 官方详情页和可下载版本；只读，不下载、不运行。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: 'detailUrl(必填,flingtrainer.com详情页URL)',
  inputSchema: {
    type: 'object',
    required: ['detailUrl'],
    properties: {
      detailUrl: {
        type: 'string',
        description: 'flingtrainer.com 官方详情页 URL'
      }
    }
  }
})

export const trainerFlingDownloadDescriptor = Object.freeze({
  name: 'vertex.trainer.fling.download',
  title: '下载风灵月影修改器',
  description:
    '将 flingtrainer.com 官方详情页解析出的下载项加入下载队列；不绕过下载中心，不写任意目录。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.EXECUTE,
  dangerous: false,
  requiresConfirmation: 'by_policy',
  readonly: false,
  enabled: true,
  taskized: false,
  argsHint: 'detailUrl(必填), downloadUrl(必填,必须来自detail工具返回的downloads), reason(选填)',
  inputSchema: {
    type: 'object',
    required: ['detailUrl', 'downloadUrl'],
    properties: {
      detailUrl: { type: 'string', description: 'flingtrainer.com 官方详情页 URL' },
      downloadUrl: {
        type: 'string',
        description: '官方详情页解析出的下载 URL，必须属于 flingtrainer.com'
      },
      title: { type: 'string', description: '下载任务名称，可选' },
      reason: { type: 'string', description: '下载原因或用户确认说明' }
    }
  }
})

export const trainerFlingLocalRecordsDescriptor = Object.freeze({
  name: 'vertex.trainer.fling.local_records',
  title: '查询本地风灵月影记录',
  description: '查询下载中心里已完成的风灵月影下载记录；只返回脱敏路径摘要，不返回完整本机路径。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.READ,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint: 'keyword(选填), limit(选填,默认20最大50)',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      keyword: { type: 'string', description: '按任务名、下载地址或文件名过滤' },
      limit: { type: 'number', minimum: 1, maximum: 50 }
    }
  }
})

export const trainerFlingRunDescriptor = Object.freeze({
  name: 'vertex.trainer.fling.run',
  title: '运行风灵月影修改器',
  description:
    '仅运行本地 FLiNG 下载记录中的 .exe 文件；拒绝任意路径、非 FLiNG 记录和非 .exe 文件，始终需要用户确认。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE,
  dangerous: true,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: false,
  allowGrant: false,
  argsHint: 'recordId/taskId/downloadUrl 三选一，必须来自 vertex.trainer.fling.local_records',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      recordId: { type: 'number', minimum: 1, description: '下载记录 ID' },
      id: { type: 'number', minimum: 1, description: 'recordId 兼容字段' },
      taskId: { type: 'string', description: '下载任务 taskId' },
      downloadUrl: { type: 'string', description: '本地下载记录中的 FLiNG 下载 URL' },
      reason: { type: 'string', description: '运行原因或用户确认说明' }
    }
  }
})

export const scriptPrepareDescriptor = Object.freeze({
  name: 'vertex.script.prepare',
  title: '准备本地脚本',
  description:
    '准备 BAT 或 PowerShell 脚本的不可变快照，不执行。返回 scriptId，有效期 30 分钟，只能由当前会话运行一次。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.PLAN,
  dangerous: false,
  requiresConfirmation: 'never',
  readonly: true,
  enabled: true,
  taskized: false,
  argsHint:
    'type=bat|ps1，scriptContent=完整脚本，workingDirectory=可选的已存在绝对目录，timeoutMs=1000~300000，reason=用途',
  inputSchema: {
    type: 'object',
    required: ['type', 'scriptContent', 'reason'],
    properties: {
      type: { type: 'string', enum: ['bat', 'ps1'] },
      scriptContent: {
        type: 'string',
        maxLength: AGENT_SCRIPT_MAX_LENGTH,
        description: '完整脚本内容，超长拒绝，不截断执行。禁止含凭据。'
      },
      workingDirectory: {
        type: 'string',
        maxLength: 4096,
        description: '已确认存在的绝对目录；省略时在独立临时目录运行。'
      },
      timeoutMs: {
        type: 'number',
        minimum: 1000,
        maximum: AGENT_SCRIPT_MAX_TIMEOUT_MS,
        description: '默认 60000 毫秒，超时停止进程树。'
      },
      reason: { type: 'string', description: '脚本用途和会修改的内容。' }
    }
  }
})

export const scriptRunDescriptor = Object.freeze({
  name: 'vertex.script.run',
  title: '运行本地脚本',
  description:
    '运行 prepare 返回的脚本快照，始终需要用户确认。返回 stdout、stderr、退出码和耗时，支持超时及取消，不自动提权。',
  permissionLevel: AI_AGENT_PERMISSION_LEVELS.DESTRUCTIVE,
  dangerous: true,
  requiresConfirmation: 'always',
  readonly: false,
  enabled: true,
  taskized: false,
  allowGrant: false,
  argsHint:
    'scriptId 必须来自本会话 vertex.script.prepare；失败或取消后需要重新准备，不可自动重试。',
  inputSchema: {
    type: 'object',
    required: ['scriptId'],
    properties: { scriptId: { type: 'string', description: '待执行脚本的一次性标识。' } }
  }
})
