import { assertInstallSourceAvailable } from '../retiredSourceInstallGuard.js'
import {
  INSTALL_STATES,
  STANDARD_ERROR_CODE,
  STANDARD_INSTALL_EVENT,
  STANDARD_METADATA_SCHEMA_VERSION,
  STANDARD_SOURCE
} from './constants.js'
import { createStandardError, normalizeStandardError, toPublicErrorPayload } from './errors.js'
import { StandardInstallStateMachine } from './events.js'
import { getStandardSourceAdapter } from './registry.js'
import { normalizeSourceKey, resolveSourceFromPayload, toPlainJson } from './payloadValidator.js'
import { standardNativeOperations } from './nativeOperations.js'
import {
  prepareSharedRuleInspection,
  rememberSharedInspection,
  verifySharedRuleBeforeInstall
} from '../sharedRuleClient.js'

function resolveStandardSource(payload = {}, fallback = STANDARD_SOURCE.NEXUS) {
  return normalizeSourceKey(resolveSourceFromPayload(payload, fallback))
}

function normalizeResult(result = {}, extra = {}) {
  const target = result && typeof result === 'object' ? result : {}
  return {
    ...target,
    ...extra,
    metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
    standardInstall: {
      ...(target.standardInstall && typeof target.standardInstall === 'object'
        ? target.standardInstall
        : {}),
      source: extra.standardSource || target.standardSource || '',
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
      nodeApiAccelerated: true
    }
  }
}

export async function inspectStandardSourceInstallPlan(event, payload = {}, options = {}) {
  const source = normalizeSourceKey(options.source || resolveStandardSource(payload, STANDARD_SOURCE.NEXUS))
  const stateMachine = new StandardInstallStateMachine({ event, source })

  try {
    const localLibraryInstall = await assertInstallSourceAvailable(payload)
    const originalRequest = toPlainJson(payload)
    const prepared = localLibraryInstall
      ? { request: originalRequest, document: null }
      : await prepareSharedRuleInspection(source, originalRequest, options)
    const request = prepared.request
    stateMachine.transition(INSTALL_STATES.RESOLVING, {
      eventName: STANDARD_INSTALL_EVENT.REQUEST_VALIDATED,
      progress: 10,
      message: '安装预检参数已校验'
    })

    const adapter = getStandardSourceAdapter(localLibraryInstall ? 'local' : source)
    stateMachine.transition(INSTALL_STATES.READY_INSPECT, {
      eventName: STANDARD_INSTALL_EVENT.DEPENDENCY_RESOLVED,
      progress: 30,
      message: '标准来源适配器已就绪'
    })
    stateMachine.transition(INSTALL_STATES.INSPECTING, {
      eventName: STANDARD_INSTALL_EVENT.INSPECT_STARTED,
      progress: 50,
      message: '正在执行标准安装预检'
    })

    const result = await adapter.inspect({
      event,
      payload: request,
      nativeOperations: standardNativeOperations,
      stateMachine
    })
    if (result?.success === false) {
      throw createStandardError(
        result?.code || STANDARD_ERROR_CODE.PLAN_INVALID,
        result?.message || '标准安装预检失败',
        { recoverable: true, details: { result } }
      )
    }

    stateMachine.transition(INSTALL_STATES.READY_INSTALL, {
      eventName: STANDARD_INSTALL_EVENT.INSPECT_COMPLETED,
      progress: 85,
      message: result?.message || '标准安装预检完成'
    })
    stateMachine.transition(INSTALL_STATES.SUCCESS, {
      eventName: STANDARD_INSTALL_EVENT.RECORD_WRITTEN,
      progress: 100,
      message: '预检结果已写入标准 token 缓存'
    })

    rememberSharedInspection(
      result?.inspectToken || result?.stagingToken,
      source, originalRequest, request, prepared.document
    )
    return normalizeResult(result, {
      success: result?.success !== false,
      sharedRuleDocument: prepared.document,
      taskId: stateMachine.taskId,
      standardSource: source
    })
  } catch (error) {
    const normalizedError = normalizeStandardError(error, STANDARD_ERROR_CODE.PLAN_INVALID)
    stateMachine.fail(normalizedError)
    return {
      success: false,
      message: normalizedError.message,
      error: toPublicErrorPayload(normalizedError),
      selectionRequest: normalizedError.details?.result?.selectionRequest || null,
      taskId: stateMachine.taskId,
      standardSource: source,
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
    }
  }
}

export async function installStandardSourcePackage(event, payload = {}, options = {}) {
  const source = normalizeSourceKey(options.source || resolveStandardSource(payload, STANDARD_SOURCE.NEXUS))
  const stateMachine = new StandardInstallStateMachine({ event, source })

  try {
    if (source === STANDARD_SOURCE.THUNDERSTORE) {
      throw createStandardError(
        STANDARD_ERROR_CODE.SOURCE_SPECIAL_DOMAIN,
        'Thunderstore 属于特殊生态安装域，不进入标准来源安装主线',
        { recoverable: false }
      )
    }

    const localLibraryInstall = await assertInstallSourceAvailable(payload)
    const originalRequest = toPlainJson(payload)
    const request = localLibraryInstall
      ? originalRequest
      : await verifySharedRuleBeforeInstall(source, originalRequest, options)
    const adapter = getStandardSourceAdapter(localLibraryInstall ? 'local' : source)

    stateMachine.transition(INSTALL_STATES.RESOLVING, {
      eventName: STANDARD_INSTALL_EVENT.REQUEST_VALIDATED,
      progress: 10,
      message: '安装请求已校验'
    })
    stateMachine.transition(INSTALL_STATES.READY_INSTALL, {
      eventName: STANDARD_INSTALL_EVENT.DEPENDENCY_RESOLVED,
      progress: 30,
      message: '标准来源安装计划已就绪'
    })
    stateMachine.transition(INSTALL_STATES.INSTALLING, {
      eventName: STANDARD_INSTALL_EVENT.INSTALL_STARTED,
      progress: 50,
      message: '正在执行标准安装流程'
    })

    const result = await adapter.install({
      event,
      payload: request,
      mode: options.mode || 'online',
      nativeOperations: standardNativeOperations,
      stateMachine
    })
    if (result?.success === false) {
      throw createStandardError(
        STANDARD_ERROR_CODE.INSTALL_FAILED,
        result?.message || '标准安装执行失败',
        { recoverable: true, details: { result } }
      )
    }

    stateMachine.transition(INSTALL_STATES.VERIFYING_RESULT, {
      eventName: STANDARD_INSTALL_EVENT.INSTALL_COMPLETED,
      progress: 85,
      message: result?.message || '安装执行完成，正在校验结果'
    })
    stateMachine.transition(INSTALL_STATES.RECORDING, {
      eventName: STANDARD_INSTALL_EVENT.VERIFY_COMPLETED,
      progress: 95,
      message: '安装结果已校验'
    })
    stateMachine.transition(INSTALL_STATES.SUCCESS, {
      eventName: STANDARD_INSTALL_EVENT.RECORD_WRITTEN,
      progress: 100,
      message: result?.message || '安装记录已写入'
    })

    return normalizeResult(result, {
      success: result?.success !== false,
      taskId: stateMachine.taskId,
      standardSource: source
    })
  } catch (error) {
    const normalizedError = normalizeStandardError(error, STANDARD_ERROR_CODE.INSTALL_FAILED)
    stateMachine.fail(normalizedError)
    return {
      success: false,
      message: normalizedError.message,
      error: toPublicErrorPayload(normalizedError),
      taskId: stateMachine.taskId,
      standardSource: source,
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
    }
  }
}
