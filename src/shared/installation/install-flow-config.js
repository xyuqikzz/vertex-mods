// 下载与安装的内部运行参数；统一在此维护，避免构建环境改变超时和重试行为。
export const INSTALL_FLOW_CONFIG = Object.freeze({
  download: Object.freeze({
    progressIntervalMs: 800,
    uiThrottleMs: 200,
    successRemoveDelayMs: 500,
    launchTimeoutMs: 30000,
    stallTimeoutMs: 300000,
    maxInterruptedResumeRetries: 4,
    resumeBaseDelayMs: 1200,
    probeTimeoutMs: 3500,
    probeCacheTtlMs: 300000
  }),
  install: Object.freeze({
    verifyTimeoutMs: 300000,
    executeTimeoutMs: 900000,
    taskSchedulerRetainMs: 60000,
    previewStagingTtlMs: 600000,
    archiveCleanupRetryDelayMs: 120
  })
})
