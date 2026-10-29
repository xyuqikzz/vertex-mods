// DLSS 工具声明。

export const dlssListDescriptor = Object.freeze({
  enabled: true,
  dangerous: false,
  taskized: false,
  name: 'vertex.dlss.list',
  title: '查询 DLSS5 游戏',
  description: '列出已登记游戏和本机游戏库，返回后续检查使用的 reference。',
  argsHint: 'keyword(可选), limit(默认30最多50), discover(默认true)',
  permissionLevel: 'read',
  readonly: true,
  requiresConfirmation: 'never',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 50
      },
      discover: {
        type: 'boolean'
      }
    }
  }
})

export const dlssInspectDescriptor = Object.freeze({
  enabled: true,
  dangerous: false,
  taskized: false,
  name: 'vertex.dlss.inspect',
  title: '检查 DLSS5 安装条件',
  description:
    '检查游戏实际程序、图形 API、兼容性与备份状态；可能更新本地检测记录，不修改游戏文件。',
  argsHint: 'reference(必填，来自list返回)',
  permissionLevel: 'read',
  readonly: true,
  requiresConfirmation: 'never',
  inputSchema: {
    type: 'object',
    required: ['reference'],
    properties: {
      reference: {
        type: 'string'
      }
    }
  }
})

export const dlssPrepareDescriptor = Object.freeze({
  enabled: true,
  dangerous: false,
  taskized: false,
  name: 'vertex.dlss.prepare',
  title: '准备 DLSS5 安装或还原方案',
  description:
    '生成当前会话一次性方案，有效15分钟；不修改游戏文件。游戏检测或选项变化后须重新准备。',
  argsHint:
    'reference(必填，来自inspect), operation(install|restore), executableId(可选，来自inspect)',
  permissionLevel: 'plan',
  readonly: true,
  requiresConfirmation: 'never',
  inputSchema: {
    type: 'object',
    required: ['reference', 'operation'],
    properties: {
      reference: {
        type: 'string'
      },
      operation: {
        type: 'string',
        enum: ['install', 'restore']
      },
      executableId: {
        type: 'string'
      }
    }
  }
})

export const dlssExecuteDescriptor = Object.freeze({
  enabled: true,
  dangerous: true,
  taskized: false,
  name: 'vertex.dlss.execute',
  title: '执行 DLSS5 安装或还原',
  description:
    '仅执行当前会话准备的方案；始终确认，复用游戏工具的备份、兼容性检查、安装确认及还原流程。不自动启动游戏。',
  argsHint: 'planId(必填，来自prepare)',
  permissionLevel: 'destructive',
  readonly: false,
  requiresConfirmation: 'always',
  allowGrant: false,
  inputSchema: {
    type: 'object',
    required: ['planId'],
    properties: {
      planId: {
        type: 'string'
      }
    }
  }
})

export const dlssCheckRuntimeDescriptor = Object.freeze({
  enabled: true,
  dangerous: false,
  taskized: false,
  name: 'vertex.dlss.check_runtime',
  title: '核验 DLSS5 运行状态',
  description: '检查安装文件与运行证据；不会启动游戏，不能把文件存在当作实际画质效果已验证。',
  argsHint: 'reference(必填，来自inspect)',
  permissionLevel: 'read',
  readonly: true,
  requiresConfirmation: 'never',
  inputSchema: {
    type: 'object',
    required: ['reference'],
    properties: {
      reference: {
        type: 'string'
      }
    }
  }
})
