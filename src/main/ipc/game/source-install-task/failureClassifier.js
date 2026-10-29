import { FAILURE_STAGE, SOURCE_INSTALL_TASK_ERROR_CODE, toPlainJson, toSafeText } from './contracts.js'

const STAGE_RULES = [
  {
    stage: FAILURE_STAGE.DOWNLOAD_FAILED,
    keywords: ['下载失败', 'download failed', 'network', 'timeout', 'socket', 'und_err']
  },
  {
    stage: FAILURE_STAGE.ARCHIVE_INSPECT_FAILED,
    keywords: ['压缩包', '解压', 'archive', 'zip', 'rar', '7z', 'extract', 'inspect']
  },
  {
    stage: FAILURE_STAGE.RULE_COMPILE_FAILED,
    keywords: ['规则编译', '变量编译', 'compile', 'template', '变量']
  },
  {
    stage: FAILURE_STAGE.RULE_MISSED,
    keywords: ['规则未命中', '未命中安装规则', 'no_install_rules', 'no match', 'rule unmatched', 'rule_not_matched']
  },
  {
    stage: FAILURE_STAGE.PATH_UNSAFE,
    keywords: ['路径不安全', '路径越界', '不安全的安装目标', 'path unsafe', 'outside']
  },
  {
    stage: FAILURE_STAGE.TARGET_INVALID,
    keywords: ['目标路径', '安装目标', '游戏目录不存在', 'target invalid']
  },
  {
    stage: FAILURE_STAGE.DEPENDENCY_FAILED,
    keywords: ['依赖失败', 'dependency failed']
  },
  {
    stage: FAILURE_STAGE.DEPENDENCY_MISSING,
    keywords: ['缺少依赖', 'dependency missing']
  },
  {
    stage: FAILURE_STAGE.CONFLICT_DETECTED,
    keywords: ['冲突', 'conflict', '占用']
  },
  {
    stage: FAILURE_STAGE.RECORD_FAILED,
    keywords: ['记录写入', '写入安装记录', 'record']
  },
  {
    stage: FAILURE_STAGE.HEALTH_CHECK_FAILED,
    keywords: ['健康检查', '安装后校验', 'health']
  },
  {
    stage: FAILURE_STAGE.DEPLOY_FAILED,
    keywords: ['部署', '复制', 'copy', 'deploy', '权限', 'permission', 'eacces', 'eperm']
  }
]

const STAGE_ACTION_MAP = {
  [FAILURE_STAGE.DOWNLOAD_FAILED]: '检查网络后重试，已下载成功的产物会被复用',
  [FAILURE_STAGE.ARCHIVE_INSPECT_FAILED]: '确认压缩包完整性，必要时重新下载后重试',
  [FAILURE_STAGE.RULE_COMPILE_FAILED]: '检查安装规则变量和路径写法后重试',
  [FAILURE_STAGE.RULE_MISSED]: '先让 AI 诊断包内容与规则差异，预演修正方案后再重试；不要仅凭扩展名补复制规则',
  [FAILURE_STAGE.UNSUPPORTED_PACKAGE]: '打开下载位置按作者说明使用外部工具，或选择可安装的模组；补规则和重试不能解决此问题',
  [FAILURE_STAGE.TARGET_INVALID]: '检查游戏目录或安装目标后重试',
  [FAILURE_STAGE.PATH_UNSAFE]: '修正安装规则中的目标路径后重试',
  [FAILURE_STAGE.DEPENDENCY_MISSING]: '先安装缺失依赖，或重新提交包含依赖的安装任务',
  [FAILURE_STAGE.DEPENDENCY_FAILED]: '重试失败依赖，成功后再重试当前任务',
  [FAILURE_STAGE.CONFLICT_DETECTED]: '处理文件冲突后再重试',
  [FAILURE_STAGE.DEPLOY_FAILED]: '检查目录权限和文件占用后重试',
  [FAILURE_STAGE.RECORD_FAILED]: '检查本地数据库状态后重试',
  [FAILURE_STAGE.HEALTH_CHECK_FAILED]: '查看健康检查详情，确认目标目录和关键文件后重试',
  [FAILURE_STAGE.TASK_RECOVERY_REQUIRED]: '可在安装任务中心点击重试',
  [FAILURE_STAGE.UNKNOWN_FAILED]: '查看错误日志后重试，仍失败时提交诊断信息'
}

function inferStage(message = '', explicitStage = '') {
  const safeStage = toSafeText(explicitStage)
  if (safeStage) {
    return safeStage
  }
  const lowerMessage = toSafeText(message).toLowerCase()
  const matchedRule = STAGE_RULES.find((rule) =>
    rule.keywords.some((keyword) => lowerMessage.includes(keyword.toLowerCase()))
  )
  return matchedRule?.stage || FAILURE_STAGE.UNKNOWN_FAILED
}

function resolveRecoverable(stage = '') {
  return ![
    FAILURE_STAGE.PATH_UNSAFE,
    FAILURE_STAGE.TARGET_INVALID,
    FAILURE_STAGE.RECORD_FAILED,
    FAILURE_STAGE.UNSUPPORTED_PACKAGE
  ].includes(stage)
}

export function classifyInstallFailure(error = null, context = {}) {
  if (error?.code === SOURCE_INSTALL_TASK_ERROR_CODE.CANCELLED) {
    return {
      stage: FAILURE_STAGE.UNKNOWN_FAILED,
      message: toSafeText(error?.message || context.message, '安装任务已取消'),
      userAction: '任务已取消',
      recoverable: false,
      detail: toPlainJson(
        {
          source: context.source,
          jobId: context.jobId,
          itemId: context.itemId,
          title: context.title,
          artifactKey: context.artifactKey,
          errorName: error?.name || '',
          control: 'cancelled'
        },
        {}
      )
    }
  }
  if (error?.code === SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED) {
    return {
      stage: FAILURE_STAGE.UNKNOWN_FAILED,
      message: toSafeText(error?.message || context.message, '安装任务已暂停'),
      userAction: '任务已暂停',
      recoverable: true,
      detail: toPlainJson(
        {
          source: context.source,
          jobId: context.jobId,
          itemId: context.itemId,
          title: context.title,
          artifactKey: context.artifactKey,
          errorName: error?.name || '',
          control: 'paused'
        },
        {}
      )
    }
  }
  const errorCode = toSafeText(error?.code || context.errorCode || context.error_code)
  const rawMessage = toSafeText(error?.message || context.message, '安装任务失败')
  const lifecycleRecoveryRequired = errorCode === 'install_engine.lifecycle_recovery_required'
  const stage = lifecycleRecoveryRequired
    ? FAILURE_STAGE.DEPLOY_FAILED
    : errorCode === 'install_engine.external_tool_package'
      ? FAILURE_STAGE.UNSUPPORTED_PACKAGE
      : inferStage(`${errorCode} ${rawMessage}`, context.stage || error?.failureStage || error?.stage)
  const message = stage === FAILURE_STAGE.RULE_MISSED
    ? '文件已下载，但未匹配到安装规则。下载文件已保留，可让 AI 检查包类型与安装规则。'
    : rawMessage
  const sourceStagingUnreadable = errorCode === 'source_staging_unreadable'
  return {
    stage,
    message,
    userAction: lifecycleRecoveryRequired
      ? '查看生命周期动作与恢复详情，处理后再重试'
      : sourceStagingUnreadable
        ? '修复源文件保护状态后重试，无需关闭游戏'
        : errorCode === 'workshop_auth_required'
          ? '使用拥有该游戏的 Steam 账号扫码授权后重试'
          : STAGE_ACTION_MAP[stage] || STAGE_ACTION_MAP[FAILURE_STAGE.UNKNOWN_FAILED],
    recoverable: stage === FAILURE_STAGE.UNSUPPORTED_PACKAGE ? false :
      typeof context.recoverable === 'boolean' ? context.recoverable : resolveRecoverable(stage),
    detail: toPlainJson(
      {
        source: context.source,
        jobId: context.jobId,
        itemId: context.itemId,
        title: context.title,
        artifactKey: context.artifactKey,
        errorName: error?.name || '',
        errorCode,
        failureStage: toSafeText(error?.stage || error?.failureStage || context.stage),
        packageSupport: error?.previewResult?.packageSupport || null,
        modId: Number(error?.modId || context.modId || 0),
        modName: toSafeText(error?.modName || context.modName),
        sourcePath: toSafeText(error?.sourcePath || context.sourcePath),
        systemError:
          error?.systemError && typeof error.systemError === 'object'
            ? error.systemError
            : context?.systemError && typeof context.systemError === 'object'
              ? context.systemError
              : {}
      },
      {}
    )
  }
}
