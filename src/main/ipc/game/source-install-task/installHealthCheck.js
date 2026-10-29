import fs from 'fs'
import path from 'path'
import { HEALTH_STATUS, ITEM_STATE, parseJsonObject, toSafeText } from './contracts.js'

function createCheck(
  key = '',
  status = HEALTH_STATUS.PASSED,
  title = '',
  message = '',
  detail = {}
) {
  return {
    key,
    status,
    title,
    message,
    detail
  }
}

function resolveMetadata(item = {}) {
  if (item.metadata && typeof item.metadata === 'object') {
    return item.metadata
  }
  return parseJsonObject(item.metadata_json, {})
}

function resolveInstallResult(metadata = {}) {
  const result =
    metadata.lastInstallResult && typeof metadata.lastInstallResult === 'object'
      ? metadata.lastInstallResult
      : {}
  return result
}

function resolveStoredInstallPlan(item = {}, metadata = {}) {
  if (item.installPlan && typeof item.installPlan === 'object') {
    return item.installPlan
  }
  const storedPlan = parseJsonObject(item.install_plan_json, {})
  if (Object.keys(storedPlan).length > 0) {
    return storedPlan
  }
  const result = resolveInstallResult(metadata)
  const previewResult =
    result.previewResult && typeof result.previewResult === 'object' ? result.previewResult : {}
  return previewResult.installPlan && typeof previewResult.installPlan === 'object'
    ? previewResult.installPlan
    : {}
}

function normalizeExpectedPath(value = '') {
  return toSafeText(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')
}

function isPathInsideOrEqual(rootPath = '', candidatePath = '') {
  if (!rootPath || !candidatePath) return false
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveExpectedPath(relativePath = '', installPlan = {}, job = {}) {
  const expectedPath = normalizeExpectedPath(relativePath)
  const targetRoot = toSafeText(installPlan.targetRoot)
  if (!expectedPath || !targetRoot) {
    return ''
  }

  const targetRelativePath = normalizeExpectedPath(installPlan.targetRelativePath)
  const expectedPathKey = expectedPath.toLowerCase()
  const targetRelativePathKey = targetRelativePath.toLowerCase()
  const includesTargetPrefix =
    !!targetRelativePathKey &&
    (expectedPathKey === targetRelativePathKey ||
      expectedPathKey.startsWith(`${targetRelativePathKey}/`))
  const gameRoot = toSafeText(job.game_root || job.gameRoot)
  const targetBaseType = toSafeText(installPlan.targetBaseType).toLowerCase()
  const usesGameRoot =
    includesTargetPrefix &&
    !!gameRoot &&
    (targetBaseType === 'game' || (!targetBaseType && isPathInsideOrEqual(gameRoot, targetRoot)))
  const baseRoot = usesGameRoot ? gameRoot : targetRoot

  return path.resolve(baseRoot, ...expectedPath.split('/'))
}

function collectExpectedPathChecks(item = {}, installPlan = {}, job = {}, physicalPath = (value) => value) {
  const targetRoot = toSafeText(installPlan.targetRoot)
  const healthExpectations =
    installPlan.healthExpectations && typeof installPlan.healthExpectations === 'object'
      ? installPlan.healthExpectations
      : {}
  const checks = []
  if (!targetRoot) {
    return checks
  }

  const requiredFiles = Array.isArray(healthExpectations.requiredFiles)
    ? healthExpectations.requiredFiles
    : []
  const requiredDirs = Array.isArray(healthExpectations.requiredDirs)
    ? healthExpectations.requiredDirs
    : []

  requiredFiles.slice(0, 20).forEach((relativePath, index) => {
    const fullPath = physicalPath(resolveExpectedPath(relativePath, installPlan, job))
    checks.push(
      createCheck(
        `expected_file:${item.item_id}:${index}`,
        fs.existsSync(fullPath) ? HEALTH_STATUS.PASSED : HEALTH_STATUS.FAILED,
        '规划文件',
        fs.existsSync(fullPath) ? '规划要求文件已落地' : '规划要求文件缺失',
        { path: fullPath, relativePath }
      )
    )
  })

  requiredDirs.slice(0, 20).forEach((relativePath, index) => {
    const fullPath = physicalPath(resolveExpectedPath(relativePath, installPlan, job))
    const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null
    checks.push(
      createCheck(
        `expected_dir:${item.item_id}:${index}`,
        stat?.isDirectory() ? HEALTH_STATUS.PASSED : HEALTH_STATUS.FAILED,
        '规划目录',
        stat?.isDirectory() ? '规划要求目录已落地' : '规划要求目录缺失',
        { path: fullPath, relativePath }
      )
    )
  })

  return checks
}

function collectDeployStrategyChecks(item = {}, installPlan = {}) {
  const deployStrategy =
    installPlan.deployStrategy && typeof installPlan.deployStrategy === 'object'
      ? installPlan.deployStrategy
      : {}
  if (!deployStrategy.actual) {
    return []
  }
  const fallbackReasons = Array.isArray(deployStrategy.fallbackReasons)
    ? deployStrategy.fallbackReasons
    : []
  const reasonText = fallbackReasons
    .map((item) => toSafeText(item.reason))
    .filter(Boolean)
    .join('；')
  return [
    createCheck(
      `deploy_strategy:${item.item_id}`,
      fallbackReasons.length ? HEALTH_STATUS.WARNING : HEALTH_STATUS.PASSED,
      '部署方式',
      fallbackReasons.length
        ? `部署方式已降级为 ${deployStrategy.actual}${reasonText ? `：${reasonText}` : ''}`
        : `部署方式为 ${deployStrategy.actual}`,
      deployStrategy
    )
  ]
}

function normalizeDeployFallbackReasons(value = []) {
  return Array.isArray(value)
    ? value
        .map((item) => ({
          from: toSafeText(item?.from),
          to: toSafeText(item?.to),
          reason: toSafeText(item?.reason)
        }))
        .filter((item) => item.from || item.to || item.reason)
    : []
}

function mergeDeployExecutionIntoPlan(installPlan = {}, installResult = {}) {
  const reconcileResult =
    installResult.reconcileResult && typeof installResult.reconcileResult === 'object'
      ? installResult.reconcileResult
      : {}
  const deployMethods = Array.isArray(reconcileResult.deployMethods)
    ? reconcileResult.deployMethods
    : []
  const firstMethod = deployMethods.find((item) => toSafeText(item?.method))
  if (!firstMethod) {
    return installPlan
  }

  const deployStrategy =
    installPlan.deployStrategy && typeof installPlan.deployStrategy === 'object'
      ? installPlan.deployStrategy
      : {}
  const executionFallbackReasons = deployMethods.flatMap((entry) => normalizeDeployFallbackReasons(entry.fallbackReasons))
  const hasExecutionEvidence = deployMethods.every((entry) => Array.isArray(entry.fallbackReasons))
  const planFallbackReasons = normalizeDeployFallbackReasons(deployStrategy.fallbackReasons)
  const actual = toSafeText(firstMethod.method)

  return {
    ...installPlan,
    deployStrategy: {
      ...deployStrategy,
      strategy: actual,
      actual,
      fallbackReasons: hasExecutionEvidence || executionFallbackReasons.length
        ? executionFallbackReasons
        : planFallbackReasons,
      executionMethods: deployMethods
    }
  }
}

function collectTargetChecks(item = {}, job = {}) {
  const metadata = resolveMetadata(item)
  const result = resolveInstallResult(metadata)
  const previewResult =
    result.previewResult && typeof result.previewResult === 'object' ? result.previewResult : {}
  const installResult =
    result.installResult && typeof result.installResult === 'object' ? result.installResult : {}
  const baseInstallPlan =
    Object.keys(resolveStoredInstallPlan(item, metadata)).length > 0
      ? resolveStoredInstallPlan(item, metadata)
      : previewResult && typeof previewResult === 'object'
        ? previewResult
        : {}
  const installPlan = mergeDeployExecutionIntoPlan(baseInstallPlan, installResult)
  const installedRecords = Array.isArray(installResult.installedRecords) ? installResult.installedRecords : []
  const updateId = Number(metadata.installPayload?.updateTargetModId || 0)
  const installedRecord = updateId
    ? installedRecords.find((record) => Number(record.id) === updateId)
    : installedRecords.length === 1 ? installedRecords[0]
      : installedRecords.find((record) => record.sourceRoot === installPlan.sourceRoot && record.targetRoot === installPlan.targetRoot)
  // First-time offline imports are also inactive. Only execution evidence may select staging checks.
  const disabledUpdate = Number(installedRecord?.id) > 0 && installedRecord?.active === false
  const plannedOperations = Array.isArray(installPlan.operations) ? installPlan.operations : []
  // 禁用更新只替换自身暂存，不应要求部署文件存在或把其他模组的文件当成本次结果。
  const physicalPath = (target) => {
    if (!disabledUpdate) return target
    const root = toSafeText(installedRecord.targetRoot)
    const sourceRoot = toSafeText(installedRecord.sourceRoot)
    if (!sourceRoot || !target || !isPathInsideOrEqual(root, target)) return ''
    const operation = plannedOperations.find((entry) =>
      path.resolve(toSafeText(entry.to || entry.target || entry.targetPath) || root).toLowerCase() === path.resolve(target).toLowerCase())
    let relativeSource
    if (operation?.sourcePath && installPlan.sourceRoot &&
        isPathInsideOrEqual(installPlan.sourceRoot, operation.sourcePath)) {
      relativeSource = path.relative(installPlan.sourceRoot, operation.sourcePath)
    }
    // 多路由的 sourceRelativePath 可能仍指原始压缩包；实际物化路径优先。
    if (relativeSource === undefined) relativeSource = operation?.sourceRelativePath
    // 旧计划没有源映射时保留原有直映射；有显式映射时绝不重复拼接目标单元名。
    const resolved = path.resolve(sourceRoot, relativeSource ?? path.relative(root, target))
    if (!isPathInsideOrEqual(sourceRoot, resolved)) return ''
    try {
      if (fs.existsSync(resolved) && !isPathInsideOrEqual(fs.realpathSync(sourceRoot), fs.realpathSync(resolved))) return ''
    } catch { return '' }
    return resolved
  }
  const targetRoot = disabledUpdate ? toSafeText(installedRecord.sourceRoot) : toSafeText(
    installPlan.targetRoot ||
      installResult.installRoot ||
      installResult.targetRoot ||
      installResult.targetPath
  )
  const checks = []
  if (metadata.installPayload?.deferActivation === true && !disabledUpdate) {
    checks.push(createCheck(`inactive_record:${item.item_id}`, HEALTH_STATUS.FAILED, '入库记录',
      '暂不启用的安装缺少对应的禁用记录，无法核验暂存文件'))
    return checks
  }

  if (!targetRoot) {
    checks.push(
      createCheck(
        `target_exists:${item.item_id}`,
        disabledUpdate ? HEALTH_STATUS.FAILED : HEALTH_STATUS.WARNING,
        '目标目录',
        '安装结果未返回目标目录，无法确认落地位置'
      )
    )
    return checks
  }

  checks.push(
    createCheck(
      `target_exists:${item.item_id}`,
      fs.existsSync(targetRoot) ? HEALTH_STATUS.PASSED : HEALTH_STATUS.FAILED,
      disabledUpdate ? '暂存目录' : '目标目录',
      fs.existsSync(targetRoot) ? '校验目录存在' : '校验目录不存在',
      { path: targetRoot }
    )
  )

  const operations = Array.isArray(installPlan.operations) ? installPlan.operations : []
  const changeSet =
    installPlan.changeSet && typeof installPlan.changeSet === 'object'
      ? installPlan.changeSet
      : parseJsonObject(item.change_set_json, {})
  const changeEntries = Array.isArray(changeSet.entries)
    ? changeSet.entries
    : Array.isArray(changeSet.items)
      ? changeSet.items
      : []
  const deployTargets = (changeEntries.length ? changeEntries : operations)
    .map((operation) => ({
      path: physicalPath(toSafeText(operation.to || operation.target || operation.targetPath)),
      kind: toSafeText(operation.kind || (operation.type === 'mkdir' ? 'dir' : 'file'))
    }))
    .filter((item) => item.path || disabledUpdate)
    .slice(0, 20)

  deployTargets.forEach((target, index) => {
    const stat = fs.existsSync(target.path) ? fs.statSync(target.path) : null
    const passed = target.kind === 'dir' ? stat?.isDirectory() === true : !!stat
    checks.push(
      createCheck(
        `deployed_${target.kind}:${item.item_id}:${index}`,
        passed ? HEALTH_STATUS.PASSED : HEALTH_STATUS.FAILED,
        disabledUpdate ? '暂存产物' : target.kind === 'dir' ? '部署目录' : '部署产物',
        passed
          ? target.kind === 'dir'
            ? '部署目录可访问'
            : '部署产物可访问'
          : target.kind === 'dir'
            ? '部署目录不可访问'
            : '部署产物不可访问',
        { path: target.path }
      )
    )
  })

  checks.push(...collectExpectedPathChecks(item, installPlan, job, physicalPath))
  if (!disabledUpdate) checks.push(...collectDeployStrategyChecks(item, installPlan))

  return checks
}

export function runInstallHealthCheck(options = {}) {
  const job = options.job || {}
  const items = Array.isArray(options.items) ? options.items : []
  const checks = []

  if (!items.length) {
    checks.push(createCheck('items', HEALTH_STATUS.FAILED, '安装项', '任务没有安装项'))
  }

  for (const item of items) {
    const title = toSafeText(item.title, '安装项')
    const installed = [ITEM_STATE.INSTALLED, ITEM_STATE.SKIPPED_INSTALLED].includes(item.state)
    checks.push(
      createCheck(
        `item_record:${item.item_id}`,
        installed ? HEALTH_STATUS.PASSED : HEALTH_STATUS.FAILED,
        '安装记录',
        installed ? `安装项已完成：${title}` : `安装项未完成：${title}`,
        { state: item.state }
      )
    )

    if (item.state === ITEM_STATE.INSTALLED) {
      checks.push(...collectTargetChecks(item, job))
    }
  }

  const failedChecks = checks.filter((item) => item.status === HEALTH_STATUS.FAILED)
  const warningChecks = checks.filter((item) => item.status === HEALTH_STATUS.WARNING)
  const status = failedChecks.length
    ? HEALTH_STATUS.FAILED
    : warningChecks.length
      ? HEALTH_STATUS.WARNING
      : HEALTH_STATUS.PASSED

  return {
    status,
    summary:
      status === HEALTH_STATUS.FAILED
        ? '安装后校验发现异常'
        : status === HEALTH_STATUS.WARNING
          ? '安装后校验存在警告'
          : '安装后校验通过',
    checks,
    jobId: toSafeText(job.job_id || job.jobId)
  }
}
