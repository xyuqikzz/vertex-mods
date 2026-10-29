// 日志分析工具的读取和诊断编排。
import { resolveLogAccess } from '../../logAccess.js'
import { MAX_ERROR_SUMMARIES, uniqueErrors, createExternalLogErrorSummaries } from './errors.js'
import { toSafeText, toSafeNumber, toSafeBoolean, toPlainJson } from './values.js'
import { sanitizeToolOutput } from './redaction.js'
import {
  normalizePathList,
  getDefaultAppDataPath,
  collectExternalLogSamples
} from './externalLogs.js'
import { uniqueSuspectedMods, createExternalLogSuspectedMods } from './suspectedMods.js'
import { analyzeInstallJobDetail } from './diagnosis.js'
import { getDeps, listRecentFailureJobs } from './store.js'

export async function analyzeLogsTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  const deps = await getDeps(dependencyOverrides)
  const jobId = toSafeText(args.jobId || args.job_id)
  const logLimit = Math.max(1, Math.min(200, toSafeNumber(args.logLimit || args.log_limit, 50)))
  const includeInfoLogs = toSafeBoolean(args.includeInfoLogs || args.include_info_logs, false)
  const jobRefs = jobId ? [{ job_id: jobId }] : listRecentFailureJobs(args, deps)

  if (!jobRefs.length) {
    return {
      success: false,
      errorCode: jobId ? 'job_not_found' : 'no_install_failure_logs',
      message: jobId ? `未找到安装任务：${jobId}` : '未找到可分析的失败安装任务。'
    }
  }

  const analyses = []
  for (const row of jobRefs) {
    const targetJobId = toSafeText(row.job_id || row.jobId)
    const detail = deps.getJobDetail(targetJobId)
    if (!detail) continue
    analyses.push(
      analyzeInstallJobDetail(detail, {
        logLimit,
        includeInfoLogs,
        classifyInstallFailure: deps.classifyInstallFailure
      })
    )
  }

  if (!analyses.length) {
    return {
      success: false,
      errorCode: 'job_detail_not_found',
      message: '安装任务记录存在，但详情已不可读取。'
    }
  }

  const stageCounts = {}
  for (const analysis of analyses) {
    for (const [stage, count] of Object.entries(analysis.failureStageCounts || {})) {
      stageCounts[stage] = (stageCounts[stage] || 0) + count
    }
  }
  const primary = analyses[0]?.primaryFailure || {}
  const logAccess = await resolveLogAccess(
    getDefaultAppDataPath(dependencyOverrides),
    args,
    ctx,
    dependencyOverrides
  )
  const externalLogs = await collectExternalLogSamples(
    {
      ...args,
      logPaths: [...normalizePathList(args.logPaths || args.log_paths), ...logAccess.selectedFiles]
    },
    { ...dependencyOverrides, logAccess }
  )
  const externalErrors = createExternalLogErrorSummaries(externalLogs.samples)
  const externalSuspectedMods = createExternalLogSuspectedMods(
    externalLogs.samples,
    analyses[0]?.job || {}
  )
  const errors = uniqueErrors([
    ...analyses.flatMap((analysis) => analysis.errors || []),
    ...externalErrors
  ]).slice(0, MAX_ERROR_SUMMARIES)
  const suspectedMods = uniqueSuspectedMods([
    ...analyses.flatMap((analysis) => analysis.suspectedMods || []),
    ...externalSuspectedMods
  ])

  return toPlainJson(
    sanitizeToolOutput({
      success: true,
      scope: 'install_task',
      jobCount: analyses.length,
      summary: {
        primaryFailureStage: toSafeText(primary.stage, 'unknown_failed'),
        recoverable: primary.recoverable !== false,
        stageCounts,
        failedItemCount: analyses.reduce(
          (total, item) => total + toSafeNumber(item.summary?.failedItemCount),
          0
        ),
        errorLogCount: analyses.reduce(
          (total, item) => total + toSafeNumber(item.summary?.errorLogCount),
          0
        ),
        warningLogCount: analyses.reduce(
          (total, item) => total + toSafeNumber(item.summary?.warningLogCount),
          0
        ),
        externalLogSourceCount: externalLogs.sources.length,
        externalLogSampleCount: externalLogs.samples.length,
        externalErrorLogCount: externalLogs.samples.filter((item) => item.level === 'error').length,
        externalWarningLogCount: externalLogs.samples.filter((item) => item.level === 'warn')
          .length,
        errorCount: errors.length,
        suspectedModCount: suspectedMods.length
      },
      analyses,
      errors,
      suspectedMods,
      externalLogSamples: externalLogs.samples,
      externalLogSources: externalLogs.sources,
      externalLogWarnings: externalLogs.warnings,
      message:
        externalLogs.samples.length > 0
          ? `已分析 ${analyses.length} 个安装任务日志，并补充读取 ${externalLogs.samples.length} 条外部日志样本。`
          : `已分析 ${analyses.length} 个安装任务日志。`
    }),
    {}
  )
}
