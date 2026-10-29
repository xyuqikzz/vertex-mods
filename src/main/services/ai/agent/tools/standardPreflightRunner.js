import fs from 'fs'
import { inspectStandardSourceInstallPlan } from '../../../../ipc/game/standard/orchestrator.js'
import { createStandardPreflightRequest } from './installPreflightRequest.js'

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

export function summarizeStandardPreflight(result = {}, requestInfo = {}) {
  const standardInstallPlan =
    result?.standardInstallPlan && typeof result.standardInstallPlan === 'object'
      ? result.standardInstallPlan
      : null
  const legacyInstallPlan =
    result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : null
  const conflictResult =
    standardInstallPlan?.conflictResult && typeof standardInstallPlan.conflictResult === 'object'
      ? standardInstallPlan.conflictResult
      : legacyInstallPlan?.conflictResult && typeof legacyInstallPlan.conflictResult === 'object'
        ? legacyInstallPlan.conflictResult
        : result?.conflictResult && typeof result.conflictResult === 'object'
          ? result.conflictResult
          : null

  return {
    status: result?.success === false ? 'failed' : 'completed',
    success: result?.success !== false,
    source: toSafeText(result?.standardSource || requestInfo.source),
    inspectToken: toSafeText(result?.inspectToken || result?.stagingToken),
    payloadHash: toSafeText(result?.payloadHash),
    matched: result?.matched !== false,
    message: toSafeText(result?.message || result?.reason),
    errorCode: toSafeText(result?.errorCode || result?.error?.code),
    selectionRequest: result?.selectionRequest || null,
    diagnostics: result?.error?.details || result?.diagnostics || null,
    standardTaskId: toSafeText(result?.taskId),
    metadataSchemaVersion: result?.metadataSchemaVersion || '',
    warnings: Array.isArray(standardInstallPlan?.warnings)
      ? standardInstallPlan.warnings
      : Array.isArray(result?.warnings)
        ? result.warnings
        : [],
    risks: Array.isArray(standardInstallPlan?.risks)
      ? standardInstallPlan.risks
      : Array.isArray(result?.risks)
        ? result.risks
        : [],
    conflictResult,
    standardInstallPlan,
    installPlan: legacyInstallPlan,
    request: {
      source: requestInfo.source,
      type: requestInfo.request?.type || 1,
      hasArchive: true
    }
  }
}

export async function runStandardPreflightIfPossible(options = {}) {
  const requestInfo = createStandardPreflightRequest(options)

  if (!requestInfo.available) {
    return {
      status: 'skipped',
      success: false,
      reason: requestInfo.reason,
      missing: requestInfo.missing,
      source: requestInfo.source,
      message: '缺少本地压缩包路径，尚不能执行标准安装预检。'
    }
  }

  if (!fs.existsSync(requestInfo.filePath)) {
    return {
      status: 'skipped',
      success: false,
      reason: 'archive_not_found',
      missing: ['filePath'],
      source: requestInfo.source,
      message: '本地压缩包不存在，尚不能执行标准安装预检。'
    }
  }

  const result = await inspectStandardSourceInstallPlan(
    options.event || null,
    requestInfo.request,
    {
      source: requestInfo.source
    }
  )
  return summarizeStandardPreflight(result, requestInfo)
}
