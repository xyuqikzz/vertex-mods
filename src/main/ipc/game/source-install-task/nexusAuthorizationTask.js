import {
  buildNexusManualDownloadPageUrl,
  matchNexusDownloadAuthorizationTarget,
  validateNexusManualSelectedFile
} from '../../../../shared/sources/nexus-download-link.js'
import {
  ITEM_STATE,
  JOB_STATE,
  nowIso,
  parseJsonObject,
  stringifyJson,
  toSafeNumber,
  toSafeText
} from './contracts.js'
import { classifyInstallFailure } from './failureClassifier.js'

export const NEXUS_AUTHORIZATION_ERROR_CODE = Object.freeze({
  REQUIRED: 'nexus_authorization_required',
  EXPIRED: 'nexus_authorization_expired',
  TARGET_MISMATCH: 'nexus_authorization_target_mismatch',
  SESSION_MISSING: 'nexus_authorization_session_missing',
  ACCOUNT_MISMATCH: 'nexus_account_mismatch',
  API_KEY_INVALID: 'nexus_api_key_invalid',
  EXCHANGE_FAILED: 'nexus_download_link_exchange_failed',
  MANUAL_FILE_MISMATCH: 'nexus_manual_file_mismatch'
})

export const NEXUS_AUTHORIZATION_ACTION = Object.freeze({
  OPEN: 'open',
  CLOSE: 'close',
  RETRY: 'retry',
  SKIP: 'skip',
  SELECT_LOCAL_FILE: 'select_local_file'
})

function resolveMetadata(input = {}) {
  if (input?.metadata && typeof input.metadata === 'object') return input.metadata
  return parseJsonObject(input?.metadata_json, {})
}

function resolveEntry(metadata = {}) {
  return metadata?.entry && typeof metadata.entry === 'object' ? metadata.entry : {}
}

export function resolveNexusAuthorizationTarget(input = {}) {
  const metadata = resolveMetadata(input)
  const entry = resolveEntry(metadata)
  const entryItem = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  const installPayload =
    metadata?.installPayload && typeof metadata.installPayload === 'object'
      ? metadata.installPayload
      : entry?.meta?.installPayload && typeof entry.meta.installPayload === 'object'
        ? entry.meta.installPayload
        : {}
  const explicit =
    metadata?.nexusAuthorization && typeof metadata.nexusAuthorization === 'object'
      ? metadata.nexusAuthorization
      : metadata?.nexusAuthorizationTarget &&
          typeof metadata.nexusAuthorizationTarget === 'object'
        ? metadata.nexusAuthorizationTarget
        : entry?.meta?.nexusAuthorization && typeof entry.meta.nexusAuthorization === 'object'
          ? entry.meta.nexusAuthorization
          : {}
  const source = toSafeText(
    installPayload.source || installPayload.sourceType || installPayload.sourcePlatform ||
    entryItem.sourcePlatform || entryItem.sourceType || metadata.source || input.source
  ).toLowerCase()
  // Platform IDs and game slugs are shared by all rule-enabled sources.
  // Only Nexus items may enter Nexus account/authorization handling.
  if (source && !['nexus', 'nexusmods'].includes(source)) return null
  const gameDomain = toSafeText(
    explicit.gameDomain ||
      explicit.domainName ||
      installPayload.sourceGameDomain ||
      installPayload.gameSourceSlug ||
      entryItem.sourceGameSlug
  )
  const modId = toSafeNumber(
    explicit.modId || installPayload.modId || entryItem.sourceModId,
    0
  )
  const fileId = toSafeNumber(
    explicit.fileId || installPayload.id || installPayload.fileId || entryItem.sourceFileId,
    0
  )
  if (!gameDomain || modId <= 0 || fileId <= 0) return null

  const fileName = toSafeText(
    explicit.fileName ||
      entryItem.fileName ||
      entryItem.task_name ||
      installPayload.name ||
      input.title
  )
  const fileSize = toSafeNumber(
    explicit.fileSize || entryItem.file_size || entryItem.fileSize || installPayload.fileSize,
    0
  )
  return {
    gameDomain,
    modId,
    fileId,
    fileName,
    fileSize,
    fileSizeExact: explicit.fileSizeExact,
    fileVersion: toSafeText(explicit.fileVersion),
    pageUrl: buildNexusManualDownloadPageUrl({ gameDomain, modId, fileId })
  }
}

function resolvePurpose(metadata = {}) {
  const entry = resolveEntry(metadata)
  const entryItem = entry?.item && typeof entry.item === 'object' ? entry.item : entry
  const value = toSafeText(
    metadata.purpose ||
      metadata.downloadPurpose ||
      entryItem.downloadPurpose ||
      metadata.installPayload?.downloadPurpose
  ).toLowerCase()
  return value === 'download_only' ? 'download_only' : 'install'
}

function resolveErrorCode(item = {}) {
  const failure = parseJsonObject(item.failure_json || item.failure, {})
  return toSafeText(failure.code || failure.errorCode || item.failure_stage)
}

function buildSnapshotItem(item = {}, artifact = {}) {
  const metadata = resolveMetadata(item)
  const target = resolveNexusAuthorizationTarget({ ...item, metadata })
  if (!target) return null
  const authorizationState =
    metadata.nexusAuthorizationState && typeof metadata.nexusAuthorizationState === 'object'
      ? metadata.nexusAuthorizationState
      : {}
  const dependencyRef =
    metadata.dependencyRef && typeof metadata.dependencyRef === 'object'
      ? metadata.dependencyRef
      : {}
  const failure = parseJsonObject(item.failure_json || item.failure, {})
  const legacyRuleMiss = /rule_not_matched/i.test(item.error_message || '')
  const failureStage = legacyRuleMiss ? 'rule_missed' : toSafeText(item.failure_stage || failure.stage)
  const downloadReady = Boolean(artifact.file_path && ['downloaded', 'file_ready'].includes(artifact.state))
  const message = failureStage === 'rule_missed'
    ? classifyInstallFailure(new Error('rule_not_matched')).message
    : toSafeText(item.error_message || authorizationState.message)
  return {
    itemId: toSafeText(item.item_id || item.itemId),
    artifactKey: toSafeText(item.artifact_key || item.artifactKey),
    title: toSafeText(item.title, target.fileName || 'Nexus 文件'),
    role: toSafeText(item.item_type || item.itemType, 'main'),
    optional: dependencyRef.optional === true || metadata.optional === true,
    purpose: resolvePurpose(metadata),
    status: toSafeText(item.state),
    progress: Math.max(0, Math.min(100, toSafeNumber(item.progress, 0))),
    message,
    failureStage,
    downloadReady,
    userAction: failureStage === 'rule_missed'
      ? '请先补充该游戏的安装规则，再到任务中心重试；已有下载会被复用。'
      : toSafeText(failure.userAction),
    errorCode: resolveErrorCode(item),
    attemptCount: Math.max(0, toSafeNumber(authorizationState.attemptCount, 0)),
    lastAttemptAt: toSafeText(authorizationState.lastAttemptAt),
    target
  }
}

export function buildNexusAuthorizationTaskSnapshot(detail = {}) {
  const job = detail?.job && typeof detail.job === 'object' ? detail.job : detail
  const items = (Array.isArray(detail?.items) ? detail.items : [])
    .map((item) => buildSnapshotItem(item, detail.artifacts?.find(
      (artifact) => artifact.artifact_key === item.artifact_key
    )))
    .filter(Boolean)
  const waitingStatuses = new Set(['waiting_authorization', 'authenticating'])
  const completedStatuses = new Set(['installed', 'skipped_installed'])
  const failedStatuses = new Set(['failed'])
  const cancelledStatuses = new Set(['cancelled'])
  const skippedStatuses = new Set(['skipped'])
  const waitingCount = items.filter((item) => waitingStatuses.has(item.status)).length

  return {
    jobId: toSafeText(job.job_id || job.jobId),
    title: toSafeText(job.title, 'Nexus 授权任务'),
    source: 'nexus',
    state: toSafeText(job.state),
    currentStep: toSafeText(job.current_step || job.currentStep),
    waitingCount,
    authenticatingCount: items.filter((item) => item.status === 'authenticating').length,
    completedCount: items.filter((item) => completedStatuses.has(item.status) ||
      (item.purpose === 'download_only' && ['file_ready', 'downloaded'].includes(item.status))).length,
    downloadedCount: items.filter((item) => item.downloadReady).length,
    failedCount: items.filter((item) => failedStatuses.has(item.status)).length,
    skippedCount: items.filter((item) => skippedStatuses.has(item.status)).length,
    cancelledCount: items.filter((item) => cancelledStatuses.has(item.status)).length,
    totalCount: items.length,
    canContinue: waitingCount > 0,
    items
  }
}

function mapAuthorizationError(error = {}) {
  const status = Number(error?.status || error?.response?.status || 0)
  const explicitCode = toSafeText(error?.code)
  if (Object.values(NEXUS_AUTHORIZATION_ERROR_CODE).includes(explicitCode)) {
    return {
      code: explicitCode,
      message: toSafeText(error?.message, 'Nexus 授权处理失败')
    }
  }
  if (explicitCode === 'manifest_revision_changed') {
    return {
      code: explicitCode,
      message: toSafeText(error?.message, '整合包远程版本或文件身份已变化，请重新确认安装计划。')
    }
  }
  if (status === 400) {
    return {
      code: NEXUS_AUTHORIZATION_ERROR_CODE.ACCOUNT_MISMATCH,
      message: '浏览器账号与 Vertex 中的 Nexus API Key 账号可能不一致，请检查后重新授权。'
    }
  }
  if (status === 401 || status === 403) {
    return {
      code: NEXUS_AUTHORIZATION_ERROR_CODE.API_KEY_INVALID,
      message: 'Nexus API Key 无效或权限不足，请在设置中检查后重新授权。'
    }
  }
  if (status === 410) {
    return {
      code: NEXUS_AUTHORIZATION_ERROR_CODE.EXPIRED,
      message: 'Nexus 下载授权已过期，请重新打开文件页。'
    }
  }
  return {
    code: NEXUS_AUTHORIZATION_ERROR_CODE.EXCHANGE_FAILED,
    message: toSafeText(error?.message, '已获得授权，但换取 Nexus 下载地址失败。')
  }
}

function createFailure(code = '', message = '') {
  return {
    code,
    stage: 'nexus_authorization',
    message,
    userAction:
      code === 'manifest_revision_changed'
        ? '请返回整合包页面重新预检并确认最新计划'
        : '请在任务中心重新打开 Nexus 文件页完成授权',
    recoverable: true
  }
}

export function createNexusAuthorizationTaskService(dependencies = {}) {
  const deps = { ...dependencies }
  const activeSessions = new Map()
  const processingItemKeys = new Set()
  const openingRequests = new Map()

  function requireDependency(name = '') {
    if (typeof deps[name] !== 'function') {
      throw new TypeError(`Nexus 授权任务缺少依赖：${name}`)
    }
    return deps[name]
  }

  function getContext(jobId = '', itemId = '') {
    const detail = requireDependency('getJobDetail')(jobId)
    const item = detail?.items?.find(
      (entry) => toSafeText(entry?.item_id || entry?.itemId) === toSafeText(itemId)
    )
    const target = item ? resolveNexusAuthorizationTarget(item) : null
    return { detail, job: detail?.job || detail, item, target }
  }

  function actionError(context = {}) {
    if (!context.job || !context.item || !context.target) {
      return { success: false, code: 'task_not_found', message: 'Nexus 授权任务条目不存在' }
    }
    if (context.job.state === JOB_STATE.PAUSED) {
      return { success: false, code: 'task_paused', message: '任务已暂停，请先在任务中心恢复任务' }
    }
    if (context.job.state === JOB_STATE.CANCELLED ||
      ![ITEM_STATE.WAITING_AUTHORIZATION, ITEM_STATE.AUTHENTICATING].includes(context.item.state)) {
      return { success: false, code: 'task_state_changed', message: '任务状态已变化，请刷新后重试' }
    }
    return null
  }

  function mergeMetadata(item = {}, patch = {}) {
    if (typeof deps.mergeItemMetadata === 'function') {
      deps.mergeItemMetadata(item, patch)
      return
    }
    const metadata = {
      ...resolveMetadata(item),
      ...patch
    }
    requireDependency('updateItem')(item.item_id, {
      metadata_json: stringifyJson(metadata, '{}')
    })
  }

  function persistWaitingState(context = {}, failure = null) {
    const { item, job } = context
    if (!item || item.state === ITEM_STATE.CANCELLED || job?.state === JOB_STATE.CANCELLED) return
    const patch = {
      state: ITEM_STATE.WAITING_AUTHORIZATION,
      error_message: failure?.message || '',
      failure_stage: failure?.code || '',
      failure_json: stringifyJson(failure || {}, '{}')
    }
    requireDependency('updateItem')(item.item_id, patch)
    const paused = job?.state === JOB_STATE.PAUSED
    requireDependency('updateJob')(job?.job_id || item.job_id, {
      state: paused ? JOB_STATE.PAUSED : JOB_STATE.WAITING_USER_ACTION,
      current_step: paused ? '已暂停' : '等待 Nexus 授权',
      error_message: failure?.message || '',
      failure_stage: failure?.code || '',
      failure_json: stringifyJson(failure || {}, '{}')
    })
    mergeMetadata(item, {
      nexusAuthorizationState: {
        ...(resolveMetadata(item).nexusAuthorizationState || {}),
        message: failure?.message || '等待用户完成 Nexus 网页授权',
        lastAttemptAt: nowIso()
      }
    })
    deps.emitJob?.(job?.job_id || item.job_id)
  }

  async function closeSession(session = {}, restoreWaiting = true) {
    if (!session?.sessionId) return
    session.closed = true
    if (activeSessions.get(session.itemKey) === session) activeSessions.delete(session.itemKey)
    deps.closeHelper?.(session.sessionId)
    await Promise.resolve(deps.unregisterSession?.({ sessionId: session.sessionId })).catch(() => {})
    if (restoreWaiting) {
      const context = getContext(session.jobId, session.itemId)
      if (context.item && context.item.state === ITEM_STATE.AUTHENTICATING) {
        persistWaitingState(context)
      }
    }
  }

  async function closeAllSessions(restoreWaiting = true) {
    for (const session of [...activeSessions.values()]) {
      await closeSession(session, restoreWaiting)
    }
  }

  async function handleRejected(session = {}, rejection = {}) {
    if (activeSessions.get(session.itemKey) !== session || session.processing) return
    await closeSession(session, false)
    const code =
      rejection.reason === 'authorization_expired'
        ? NEXUS_AUTHORIZATION_ERROR_CODE.EXPIRED
        : rejection.reason === 'authorization_missing'
          ? NEXUS_AUTHORIZATION_ERROR_CODE.SESSION_MISSING
          : NEXUS_AUTHORIZATION_ERROR_CODE.TARGET_MISMATCH
    const message =
      toSafeText(rejection.message) ||
      (code === NEXUS_AUTHORIZATION_ERROR_CODE.EXPIRED
        ? 'Nexus 下载授权已过期，请重新打开文件页。'
        : 'Nexus 回调与当前任务条目不匹配，请打开正确的文件页。')
    const context = getContext(session.jobId, session.itemId)
    persistWaitingState(context, createFailure(code, message))
    deps.emitLog?.(session.jobId, session.itemId, 'warn', message, {
      stage: 'nexus_authorization',
      code,
      target: context.target
    })
  }

  async function handleCaptured(session = {}, captured = {}) {
    const sessionId = toSafeText(captured.sessionId || session.sessionId)
    if (!sessionId || session.closed || session.processing) return
    const active = activeSessions.get(session.itemKey)
    if (!active || active.sessionId !== sessionId) return
    session.processing = true
    processingItemKeys.add(session.itemKey)

    const context = getContext(session.jobId, session.itemId)
    if (!context.item || !context.target || context.item.state !== ITEM_STATE.AUTHENTICATING ||
      context.job?.state === JOB_STATE.CANCELLED) {
      processingItemKeys.delete(session.itemKey)
      await closeSession(session, false)
      return
    }
    try {
      const match = matchNexusDownloadAuthorizationTarget(captured.authorization, context.target)
      if (!match.matched) throw Object.assign(new Error(match.message), {
        code: match.reason === 'authorization_expired' ? NEXUS_AUTHORIZATION_ERROR_CODE.EXPIRED : NEXUS_AUTHORIZATION_ERROR_CODE.TARGET_MISMATCH
      })
      if (session.revision !== deps.getCredentialRevision?.()) throw new Error('Nexus 账号已变化，请重新授权')
      await deps.validateTarget?.({
        job: context.job,
        item: context.item,
        target: context.target
      })
      const result = await requireDependency('exchangeDownloadLink')({
        target: context.target,
        authorization: captured.authorization
      })
      const downloadUrl = toSafeText(result?.downloadUrl || result?.url)
      if (!downloadUrl) throw new Error('Nexus 未返回可用下载地址')
      const latestContext = getContext(session.jobId, session.itemId)
      if (
        session.closed || session.revision !== deps.getCredentialRevision?.() ||
        !latestContext.item ||
        latestContext.item.state !== ITEM_STATE.AUTHENTICATING ||
        latestContext.job?.state === JOB_STATE.CANCELLED
      ) {
        return
      }
      const accepted = await requireDependency('onAuthorized')({
        job: latestContext.job,
        item: latestContext.item,
        target: latestContext.target,
        downloadUrl
      })
      deps.emitLog?.(session.jobId, session.itemId, 'info', accepted?.paused
        ? 'Nexus 授权已接收，恢复任务后继续下载'
        : 'Nexus 授权完成，下载已入队', {
        stage: 'nexus_authorization',
        code: '',
        target: context.target
      })
    } catch (error) {
      const latestContext = getContext(session.jobId, session.itemId)
      if (
        session.closed || session.revision !== deps.getCredentialRevision?.() ||
        !latestContext.item ||
        latestContext.item.state !== ITEM_STATE.AUTHENTICATING ||
        latestContext.job?.state === JOB_STATE.CANCELLED
      ) {
        return
      }
      const mapped = mapAuthorizationError(error)
      persistWaitingState(latestContext, createFailure(mapped.code, mapped.message))
      deps.emitLog?.(session.jobId, session.itemId, 'warn', mapped.message, {
        stage: 'nexus_authorization',
        code: mapped.code,
        target: latestContext.target
      })
    } finally {
      processingItemKeys.delete(session.itemKey)
      await closeSession(session, false)
    }
  }

  async function openAuthorization(payload = {}) {
    const jobId = toSafeText(payload.jobId || payload.job_id)
    const itemId = toSafeText(payload.itemId || payload.item_id)
    const context = getContext(jobId, itemId)
    const invalid = actionError(context)
    if (invalid) return invalid
    const itemKey = `${jobId}:${itemId}`
    if (processingItemKeys.has(itemKey)) {
      return {
        success: false,
        code: 'task_state_changed',
        message: 'Nexus 授权正在校验并换取下载地址，请稍候'
      }
    }

    if (activeSessions.has(itemKey)) await closeSession(activeSessions.get(itemKey), true)
    const latestContext = getContext(jobId, itemId)
    const changed = actionError(latestContext)
    if (changed) return changed
    const metadata = resolveMetadata(context.item)
    const previousState = metadata.nexusAuthorizationState || {}
    requireDependency('updateItem')(itemId, {
      state: ITEM_STATE.AUTHENTICATING,
      error_message: '',
      failure_stage: '',
      failure_json: '{}'
    })
    mergeMetadata(context.item, {
      nexusAuthorizationState: {
        attemptCount: Math.max(0, toSafeNumber(previousState.attemptCount, 0)) + 1,
        lastAttemptAt: nowIso(),
        message: '等待浏览器返回 Nexus 下载授权'
      }
    })

    const pending = { jobId, itemId, itemKey, sessionId: '', revision: deps.getCredentialRevision?.() }
    const result = requireDependency('registerSession')(
      {
        owner: 'source-install-task',
        jobId,
        itemId,
        artifactKey: toSafeText(context.item.artifact_key),
        itemKey,
        target: context.target,
        ttlMs: payload.ttlMs
      },
      {
        onCaptured: (captured) => handleCaptured(pending, captured),
        onRejected: (rejection) => handleRejected(pending, rejection)
      }
    )
    if (!result?.success || !result?.sessionId) {
      persistWaitingState(context, createFailure(
        NEXUS_AUTHORIZATION_ERROR_CODE.SESSION_MISSING,
        toSafeText(result?.message, '创建 Nexus 授权会话失败')
      ))
      return {
        success: false,
        code: NEXUS_AUTHORIZATION_ERROR_CODE.SESSION_MISSING,
        message: toSafeText(result?.message, '创建 Nexus 授权会话失败')
      }
    }
    pending.sessionId = result.sessionId
    activeSessions.set(itemKey, pending)
    const mode = payload.mode || 'external'
    if (mode === 'external' && deps.openExternal) {
      try {
        await deps.openExternal(context.target.pageUrl)
      } catch {
        await closeSession(pending, true)
        return { success: false, message: '浏览器未能打开，请复制链接或选择本地文件' }
      }
    }
    if (mode !== 'external' && mode !== 'copy' && deps.openHelper) {
      try {
        await deps.openHelper({ sessionId: pending.sessionId, target: context.target,
          pageUrl: context.target.pageUrl,
          onClosed: () => closeSession(pending, true) })
      } catch {
        await closeSession(pending, true)
        return { success: false, code: 'nexus_helper_failed', message: '下载辅助窗口未能打开，请使用外部浏览器或选择已下载文件' }
      }
    }
    deps.emitLog?.(jobId, itemId, 'info', '已创建 Nexus 授权会话', {
      stage: 'nexus_authorization',
      target: context.target
    })
    deps.emitJob?.(jobId)
    return {
      success: true,
      jobId,
      itemId,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      pageUrl: context.target.pageUrl,
      browserOpened: mode === 'external' && Boolean(deps.openExternal),
      target: context.target
    }
  }

  async function performAction(_event, payload = {}) {
    const action = toSafeText(payload.action).toLowerCase()
    const jobId = toSafeText(payload.jobId || payload.job_id)
    const itemId = toSafeText(payload.itemId || payload.item_id)
    const itemKey = `${jobId}:${itemId}`
    if (action === NEXUS_AUTHORIZATION_ACTION.OPEN) {
      if (openingRequests.has(itemKey)) return await openingRequests.get(itemKey)
      const request = openAuthorization(payload).finally(() => openingRequests.delete(itemKey))
      openingRequests.set(itemKey, request)
      return await request
    }
    const session = activeSessions.get(itemKey)
    if (action === NEXUS_AUTHORIZATION_ACTION.CLOSE) {
      if (session) await closeSession(session, true)
      return { success: true, jobId, itemId, message: '授权面板已关闭，任务仍可继续' }
    }
    const context = getContext(jobId, itemId)
    const invalid = actionError(context)
    if (invalid) return invalid
    if (action === NEXUS_AUTHORIZATION_ACTION.RETRY) {
      persistWaitingState(context)
      return { success: true, jobId, itemId, message: '可以重新授权' }
    }
    if (action === NEXUS_AUTHORIZATION_ACTION.SKIP) {
      const metadata = resolveMetadata(context.item)
      const dependencyRef = metadata.dependencyRef || {}
      if (!(metadata.optional === true || dependencyRef.optional === true)) {
        return { success: false, code: 'task_action_not_allowed', message: '必需文件不能跳过' }
      }
      if (session) await closeSession(session, false)
      const changed = actionError(getContext(jobId, itemId))
      if (changed) return changed
      requireDependency('updateItem')(itemId, {
        state: ITEM_STATE.SKIPPED,
        progress: 100,
        error_message: ''
      })
      await deps.onSkipped?.({ job: context.job, item: context.item })
      deps.emitJob?.(jobId)
      return { success: true, jobId, itemId, message: '已跳过可选依赖' }
    }
    if (action === NEXUS_AUTHORIZATION_ACTION.SELECT_LOCAL_FILE) {
      try {
        await deps.validateTarget?.({
          job: context.job,
          item: context.item,
          target: context.target
        })
      } catch (error) {
        const latest = getContext(jobId, itemId)
        const changed = actionError(latest)
        if (changed) return changed
        const mapped = mapAuthorizationError(error)
        const failure = createFailure(mapped.code, mapped.message)
        persistWaitingState(latest, failure)
        return { success: false, code: failure.code, message: failure.message }
      }
      const beforePicker = actionError(getContext(jobId, itemId))
      if (beforePicker) return beforePicker
      const selection = await requireDependency('selectLocalFile')(_event, {
        job: context.job,
        item: context.item,
        target: context.target
      })
      const latest = getContext(jobId, itemId)
      const afterPicker = actionError(latest)
      if (afterPicker) return afterPicker
      if (selection?.canceled || !selection?.file) {
        return { success: false, canceled: true, jobId, itemId, message: '未选择文件' }
      }
      const validation = validateNexusManualSelectedFile(selection.file, context.target)
      if (!validation.valid) {
        const failure = createFailure(
          NEXUS_AUTHORIZATION_ERROR_CODE.MANUAL_FILE_MISMATCH,
          validation.message
        )
        persistWaitingState(latest, failure)
        return {
          success: false,
          code: failure.code,
          message: failure.message,
          needsConfirmation: validation.needsConfirmation === true,
          validation
        }
      }
      // Confirmation binds to this selected file in the main process. A renderer flag
      // must not silently approve a different file on a second picker invocation.
      if (validation.needsConfirmation) {
        const confirmed = await deps.confirmLocalFile?.({
          file: selection.file, target: context.target, validation
        })
        if (!confirmed) return { success: false, canceled: true, jobId, itemId, message: '已取消使用本地文件' }
      }
      const afterConfirmation = actionError(getContext(jobId, itemId))
      if (afterConfirmation) return afterConfirmation
      if (session) await closeSession(session, false)
      const latestContext = getContext(jobId, itemId)
      const beforeImport = actionError(latestContext)
      if (beforeImport) return beforeImport
      await requireDependency('onLocalFile')({
        job: latestContext.job,
        item: latestContext.item,
        target: latestContext.target,
        file: selection.file,
        validation
      })
      return {
        success: true,
        jobId,
        itemId,
        fileName: toSafeText(selection.file.name),
        fileSize: toSafeNumber(selection.file.size, 0),
        validation
      }
    }
    return { success: false, code: 'task_action_not_allowed', message: '未知的授权任务操作' }
  }

  async function cancelJob(jobId = '') {
    const safeJobId = toSafeText(jobId)
    for (const session of [...activeSessions.values()]) {
      if (session.jobId === safeJobId) await closeSession(session, false)
    }
  }

  return Object.freeze({
    performAction,
    cancelJob,
    closeAllSessions,
    getSnapshot(jobId = '') {
      return buildNexusAuthorizationTaskSnapshot(requireDependency('getJobDetail')(jobId) || {})
    }
  })
}
