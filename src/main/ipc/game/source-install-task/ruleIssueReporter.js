import { app } from 'electron'
import { SHARED_RULE_SOURCES } from '../../../../shared/installation/shared-install-rule.js'
import { requestBackendApi } from '../../../utils/require.js'
import {
  FAILURE_STAGE,
  parseJsonObject,
  toPlainJson,
  toSafeNumber,
  toSafeText
} from './contracts.js'

const REPORTABLE_FAILURE_STAGES = new Set([
  FAILURE_STAGE.ARCHIVE_INSPECT_FAILED,
  FAILURE_STAGE.RULE_COMPILE_FAILED,
  FAILURE_STAGE.RULE_MISSED,
  FAILURE_STAGE.TARGET_INVALID,
  FAILURE_STAGE.PATH_UNSAFE,
  FAILURE_STAGE.DEPLOY_FAILED,
  FAILURE_STAGE.HEALTH_CHECK_FAILED
])

const SUPPORTED_REPORT_SOURCES = SHARED_RULE_SOURCES

function firstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) {
      return text
    }
  }
  return ''
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toSafeNumber(value, 0)
    if (number > 0) {
      return number
    }
  }
  return null
}

function normalizeSource(value = '') {
  const source = toSafeText(value, '').toLowerCase()
  if (source === 'mod.io') {
    return 'modio'
  }
  return source
}

function resolvePriority(stage = '') {
  if (stage === FAILURE_STAGE.PATH_UNSAFE) {
    return 'P0'
  }
  if ([FAILURE_STAGE.RULE_MISSED, FAILURE_STAGE.RULE_COMPILE_FAILED].includes(stage)) {
    return 'P2'
  }
  return 'P2'
}

function parseMaybeJson(value = {}, fallback = {}) {
  return parseJsonObject(value, fallback)
}

function resolveSourceGameId(source = '', payload = {}, sourceMeta = {}, installPayload = {}) {
  if (source === 'nexus') {
    return firstNumber(
      installPayload.sourceNexusGameId,
      installPayload.nexusGameId,
      installPayload.sourceGameId,
      sourceMeta.nexusGameId,
      sourceMeta.sourceId,
      payload.sourceGameId
    )
  }
  if (source === 'modio') {
    return firstNumber(
      installPayload.modioGameId,
      installPayload.sourceGameId,
      sourceMeta.modioGameId,
      sourceMeta.sourceId,
      payload.sourceGameId
    )
  }
  return firstText(installPayload.sourceGameId, installPayload.gameSourceId, payload.sourceGameId, sourceMeta.sourceId)
}

function resolveSourceGameSlug(source = '', payload = {}, sourceMeta = {}, installPayload = {}) {
  if (source === 'nexus') {
    return firstText(
      installPayload.sourceGameDomain,
      installPayload.sourceGameSlug,
      sourceMeta.sourceSlug,
      sourceMeta.domainName,
      payload.domainName,
      payload.gameKey
    )
  }
  if (source === 'modio') {
    return firstText(
      installPayload.sourceGameSlug,
      installPayload.gameNameId,
      sourceMeta.sourceSlug,
      payload.gameKey
    )
  }
  return firstText(installPayload.sourceGameSlug, sourceMeta.sourceSlug, payload.gameKey)
}

function resolveArchiveStructure(failure = {}, metadata = {}, installPayload = {}) {
  return (
    failure?.detail?.archiveStructure ||
    failure?.detail?.archiveStructureJson ||
    metadata?.previewResult?.structure ||
    metadata?.previewResult?.archiveStructure ||
    installPayload?.archiveStructure ||
    installPayload?.structure ||
    {}
  )
}

function resolveInstallPlanSnapshot(item = {}, metadata = {}) {
  if (item.installPlan && typeof item.installPlan === 'object') {
    return item.installPlan
  }
  const storedPlan = parseMaybeJson(item.install_plan_json, {})
  if (Object.keys(storedPlan).length > 0) {
    return storedPlan
  }
  const result =
    metadata.lastInstallResult && typeof metadata.lastInstallResult === 'object'
      ? metadata.lastInstallResult
      : {}
  const previewResult =
    result.previewResult && typeof result.previewResult === 'object' ? result.previewResult : {}
  return previewResult.installPlan && typeof previewResult.installPlan === 'object'
    ? previewResult.installPlan
    : {}
}

function shouldReportRuleIssue(source = '', stage = '') {
  return SUPPORTED_REPORT_SOURCES.has(source) && REPORTABLE_FAILURE_STAGES.has(stage)
}

function buildRuleIssuePayload({ job = {}, item = {}, failure = {}, artifact = {} }) {
  const jobPayload = parseMaybeJson(job.payload_json, job.payload || {})
  const sourceMeta = parseMaybeJson(jobPayload.sourceMeta, {})
  const metadata = parseMaybeJson(item.metadata_json, item.metadata || {})
  const entry = parseMaybeJson(metadata.entry, {})
  const entryItem = parseMaybeJson(entry.item, {})
  const installPayload = parseMaybeJson(metadata.installPayload, {})
  const installPlan = resolveInstallPlanSnapshot(item, metadata)
  const source = normalizeSource(
    job.source ||
      jobPayload.source ||
      metadata.source ||
      installPayload.source ||
      installPayload.sourceType ||
      sourceMeta.source
  )
  const stage = toSafeText(failure.stage || item.failure_stage)

  if (!shouldReportRuleIssue(source, stage)) {
    return null
  }

  const sourceGameId = resolveSourceGameId(source, jobPayload, sourceMeta, installPayload)
  const sourceModId = firstText(
    installPayload.sourceModId,
    installPayload.modId,
    entryItem.sourceModId,
    entryItem.modId
  )
  const sourceFileId = firstText(
    installPayload.sourceFileId,
    installPayload.fileId,
    installPayload.id,
    entryItem.sourceFileId,
    entryItem.fileId
  )

  if (!sourceGameId || !sourceModId) {
    return null
  }

  const sharedRuleDocument =
    failure.detail?.previewResult?.sharedRuleDocument ||
    metadata.lastInstallResult?.previewResult?.sharedRuleDocument ||
    installPayload.sharedRuleDocument || {}

  return toPlainJson(
    {
      sourcePlatform: source,
      documentId: sharedRuleDocument.documentId || null,
      canonicalGameKey: sharedRuleDocument.canonicalGameKey || '',
      revision: sharedRuleDocument.revision || null,
      contentHash: sharedRuleDocument.contentHash || '',
      modId: sourceModId,
      fileId: sourceFileId,
      gameKey: firstText(job.game_key, jobPayload.gameKey),
      gameId: firstNumber(installPayload.gameId, sourceMeta.gameId, jobPayload.gameId),
      sourceGameId,
      sourceGameSlug: resolveSourceGameSlug(source, jobPayload, sourceMeta, installPayload),
      sourceModId,
      sourceFileId,
      modName: firstText(
        installPayload.modName,
        installPayload.name,
        metadata.displayName,
        item.title
      ),
      archiveName: firstText(
        artifact.file_name,
        installPayload.archiveName,
        installPayload.name,
        item.title
      ),
      archiveSize: toSafeNumber(artifact.file_size || installPayload.fileSize, 0),
      archiveHash: firstText(
        artifact.sha256,
        artifact.md5,
        installPayload.sha256,
        installPayload.fileMd5
      ),
      archiveStructureJson: resolveArchiveStructure(failure, metadata, installPayload),
      failureStage: stage,
      failureMessage: toSafeText(failure.message || item.error_message),
      inspectReason: firstText(
        failure.detail?.reason,
        failure.detail?.inspectReason,
        failure.userAction
      ),
      ruleProfileId: firstNumber(
        installPayload.ruleProfileId,
        installPayload.rule_profile_id,
        sourceMeta.ruleProfileId,
        sourceMeta.profileId
      ),
      ruleVersion: firstNumber(
        installPayload.ruleVersion,
        sourceMeta.ruleVersion,
        jobPayload.ruleVersion
      ),
      clientVersion: app.getVersion(),
      installTaskId: toSafeText(item.job_id || job.job_id),
      artifactKey: toSafeText(item.artifact_key || artifact.artifact_key),
      precheckJson: parseMaybeJson(job.precheck_json, {}),
      installPlanDiagnosticJson: {
        planner: installPlan.planner || {},
        explain: installPlan.explain || {},
        missedReasons: Array.isArray(installPlan.missedReasons) ? installPlan.missedReasons : [],
        conflictResult: installPlan.conflictResult || {},
        dependencyResult: installPlan.dependencyResult || {},
        replaySnapshot: installPlan.replaySnapshot || {}
      },
      priority: resolvePriority(stage)
    },
    {}
  )
}

export async function reportRuleIssueForFailure(context = {}) {
  const payload = buildRuleIssuePayload(context)
  if (!payload) {
    return {
      reported: false,
      reason: 'not_reportable'
    }
  }

  try {
    const response = await requestBackendApi({
      url: '/rule-issue/report',
      method: 'post',
      data: payload
    })
    const result = response?.data || {}
    if (Number(result.code) !== 200) {
      return {
        reported: false,
        reason: 'backend_rejected',
        message: toSafeText(result.message)
      }
    }
    return {
      reported: true,
      ...(result.data || {})
    }
  } catch (error) {
    return {
      reported: false,
      reason: 'request_failed',
      message: toSafeText(error?.message)
    }
  }
}
