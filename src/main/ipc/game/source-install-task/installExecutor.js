import { assertInstallSourceAvailable } from '../retiredSourceInstallGuard.js'
import { inspectPackageInstallability } from '../../../services/packageInstallability.js'
import { withDeploymentOperationContext } from '../deploymentScopeMutationLock.js'
import { withDeferredLocalModRefresh } from '../../data/localModRefresh.js'
import { FAILURE_STAGE, SOURCE_INSTALL_TASK_ERROR_CODE, toPlainJson, toSafeText } from './contracts.js'
import {
  getStandardPreflightAuthorization,
  stripStandardPreflightAuthorizationFromPayload,
  verifyStandardPreflightAuthorization
} from '../../../../shared/ai/permissions/ai-agent-install-authorization.js'

function createInvokeEvent(event = null) {
  return {
    ...(event || {}),
    reply(channel, ...args) {
      try {
        if (event?.sender && !event.sender.isDestroyed?.()) {
          event.sender.send(channel, ...args)
        }
      } catch {
        // ignore
      }
    }
  }
}

// PR5/A2：在阶段边界检查取消信号；抛出带 CANCELLED code 的错误，
// 供 orchestrator 的 isTaskControlError 识别并按「已取消」而非「失败」处理。
function throwIfAborted(signal = null) {
  if (signal && signal.aborted) {
    const reason = signal.reason?.message || (typeof signal.reason === 'string' ? signal.reason : '')
    const error = new Error(reason || '安装任务已取消')
    error.code = signal.reason?.code === SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED
      ? SOURCE_INSTALL_TASK_ERROR_CODE.PAUSED
      : SOURCE_INSTALL_TASK_ERROR_CODE.CANCELLED
    throw error
  }
}

function createInstallExecutionError(message = '安装失败', context = {}) {
  const structuredResult =
    context?.installResult && typeof context.installResult === 'object'
      ? context.installResult
      : context?.previewResult && typeof context.previewResult === 'object'
        ? context.previewResult
        : {}
  const nestedResult =
    structuredResult?.error?.details?.result &&
    typeof structuredResult.error.details.result === 'object'
      ? structuredResult.error.details.result
      : {}
  const error = new Error(message)
  error.code = context.errorCode || structuredResult.code || nestedResult.code || ''
  error.stage =
    context.stage ||
    structuredResult.stage ||
    structuredResult.failureStage ||
    nestedResult.stage ||
    nestedResult.failureStage ||
    ''
  error.modId = Number(context.modId || structuredResult.modId || nestedResult.modId || 0)
  error.modName = toSafeText(context.modName || structuredResult.modName || nestedResult.modName)
  error.sourcePath = toSafeText(
    context.sourcePath || structuredResult.sourcePath || nestedResult.sourcePath
  )
  error.systemError = toPlainJson(
    context.systemError || structuredResult.systemError || nestedResult.systemError,
    {}
  )
  error.previewResult = context.previewResult || null
  error.selectionRequest = structuredResult.selectionRequest || nestedResult.selectionRequest || null
  error.installResult = context.installResult || null
  error.inspectToken = context.inspectToken || ''
  return error
}

async function getInstallExecutorDeps(overrides = {}, options = {}) {
  const deps = { ...overrides }

  if (
    options.standard === true &&
    (typeof deps.inspectStandardSourceInstallPlan !== 'function' ||
      typeof deps.installStandardSourcePackage !== 'function')
  ) {
    const standardOrchestrator = await import('../standard/runtime.js')
    deps.inspectStandardSourceInstallPlan =
      deps.inspectStandardSourceInstallPlan || standardOrchestrator.inspectStandardSourceInstallPlan
    deps.installStandardSourcePackage =
      deps.installStandardSourcePackage || standardOrchestrator.installStandardSourcePackage
  }

  if (
    options.thunderstore === true &&
    typeof deps.thunderstoreInstallDownloadedPackages !== 'function'
  ) {
    const thunderstore = await import('../thunderstore.js')
    const thunderstoreStorage = await import('../../../services/profiles/thunderstoreStorage.js')
    deps.thunderstoreInstallDownloadedPackages = thunderstore.thunderstoreInstallDownloadedPackages
    deps.runThunderstoreStorageOperation = thunderstoreStorage.runThunderstoreStorageOperation
  }

  if (
    options.thunderstore === true &&
    typeof deps.runThunderstoreStorageOperation !== 'function'
  ) {
    deps.runThunderstoreStorageOperation = async (operation) => await operation()
  }

  if (options.localData === true && typeof deps.getLocalModData !== 'function') {
    const localData = await import('../../data/utils.js')
    deps.getLocalModData = localData.getLocalModData
  }

  return deps
}

async function refreshLocalModData(invokeEvent, deps = {}) {
  try {
    const localDataDeps =
      typeof deps.getLocalModData === 'function'
        ? deps
        : await getInstallExecutorDeps(deps, { localData: true })
    localDataDeps.getLocalModData(invokeEvent)
  } catch (error) {
    console.error('安装任务中心同步本地模组数据失败', error)
  }
}

export async function executeInstallItem(event, options = {}, dependencyOverrides = {}) {
  return withDeploymentOperationContext({ signal: options.signal, onWait: options.onDeploymentWait,
    onAcquire: options.onDeploymentAcquire }, () => withDeferredLocalModRefresh(
    createInvokeEvent(event),
    (invokeEvent) => executeInstallItemInner(invokeEvent, options, dependencyOverrides),
    (invokeEvent) => refreshLocalModData(invokeEvent, dependencyOverrides)
  ))
}

async function executeInstallItemInner(event, options = {}, dependencyOverrides = {}) {
  const filePath = toSafeText(options.filePath)
  const source = toSafeText(options.source, 'nexus')
  const installPayload = toPlainJson(options.installPayload, {})
  await assertInstallSourceAvailable({ source, filePath, installPayload })
  const type = Number(options.type || 1)
  const signal = options.signal || null

  if (!filePath) {
    throw new Error('缺少待安装文件路径')
  }

  throwIfAborted(signal)

  let packageSupport
  try {
    packageSupport = await inspectPackageInstallability(filePath, { signal })
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  if (packageSupport.supported === false) {
    throw createInstallExecutionError(packageSupport.message, {
      stage: FAILURE_STAGE.UNSUPPORTED_PACKAGE,
      errorCode: packageSupport.code,
      previewResult: { packageSupport }
    })
  }

  if (source === 'steam-workshop') {
    const { stat, rm } = await import('node:fs/promises')
    if ((await stat(filePath)).isDirectory()) {
      const { prepareWorkshopInstallArchive } = await import('../../../services/workshop/installArchive.js')
      let archive = ''
      try {
        archive = await prepareWorkshopInstallArchive(filePath, { signal })
        // 仅目录需要转换；生成的压缩包继续走同一预检与安装路径。
        return await executeInstallItemInner(event, { ...options, filePath: archive }, dependencyOverrides)
      } catch (error) {
        throwIfAborted(signal)
        throw error
      } finally {
        if (archive) {
          await rm(archive, { force: true }).catch((error) =>
            console.warn('清理 Steam 临时安装包失败', error.message)
          )
        }
      }
    }
  }

  if (source === 'mixed' || installPayload.sourceAdapter === 'mixed') {
    throw new Error('混合来源任务必须先按平台拆分')
  }

  const invokeEvent = event
  if (source === 'thunderstore' || installPayload.sourceAdapter === 'thunderstore') {
    const deps = await getInstallExecutorDeps(dependencyOverrides, { thunderstore: true })
    throwIfAborted(signal)
    const installResult = await deps.runThunderstoreStorageOperation(() =>
      deps.thunderstoreInstallDownloadedPackages(invokeEvent, {
        community: installPayload.community || installPayload.sourceGameId,
        appId: installPayload.appId || installPayload.gameId,
        packageLoader: installPayload.packageLoader,
        profileName: installPayload.profileName,
        items: [
          {
            ...installPayload,
            filePath,
            archivePath: filePath
          }
        ]
      })
    )

    if (!installResult?.success) {
      throw new Error(String(installResult?.message || 'Thunderstore 安装失败'))
    }

    return {
      previewResult: {
        success: true,
        matched: true
      },
      installResult,
      inspectToken: ''
    }
  }

  const deps = await getInstallExecutorDeps(dependencyOverrides, { standard: true })
  const standardPreflightAuthorization = getStandardPreflightAuthorization(installPayload)
  const standardInstallPayload = stripStandardPreflightAuthorizationFromPayload(installPayload)
  const previewResult = await deps.inspectStandardSourceInstallPlan(
    invokeEvent,
    {
      filePath,
      data: standardInstallPayload,
      source,
      type
    },
    { source }
  )

  if (!previewResult?.success) {
    throw createInstallExecutionError(String(previewResult?.message || '安装预案生成失败'), {
      previewResult
    })
  }

  if (previewResult?.matched === false) {
    throw createInstallExecutionError(
      String(previewResult?.reason || '安装规则未命中，已保留下载文件'),
      {
        stage: FAILURE_STAGE.RULE_MISSED,
        previewResult
      }
    )
  }

  const inspectToken = toSafeText(previewResult?.inspectToken || previewResult?.stagingToken)
  const authorizationCheck = verifyStandardPreflightAuthorization(
    previewResult,
    standardPreflightAuthorization
  )
  if (!authorizationCheck.valid) {
    throw createInstallExecutionError(authorizationCheck.message, {
      previewResult,
      inspectToken,
      errorCode: authorizationCheck.errorCode
    })
  }

  const executePayload = {
    filePath,
    data: inspectToken
      ? {
          ...standardInstallPayload,
          standardInspectToken: inspectToken
        }
      : standardInstallPayload,
    source,
    type,
    ...(inspectToken ? { inspectToken } : {})
  }

  // PR5/A2：实际落盘部署前的最后检查点——若期间被取消，则不再启动安装。
  throwIfAborted(signal)
  const installResult = await deps.installStandardSourcePackage(invokeEvent, executePayload, {
    source
  })
  if (!installResult?.success) {
    throw createInstallExecutionError(String(installResult?.message || '安装失败'), {
      previewResult,
      installResult,
      inspectToken
    })
  }

  return {
    previewResult,
    installResult,
    inspectToken,
    standardPreflightAuthorization: authorizationCheck.verified
      ? {
          verified: true,
          payloadHash: authorizationCheck.actualPayloadHash,
          source: authorizationCheck.source,
          authorizedAt: standardPreflightAuthorization?.authorizedAt || ''
        }
      : null
  }
}
