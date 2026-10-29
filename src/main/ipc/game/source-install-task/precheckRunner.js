import fs from 'fs'
import path from 'path'
import { PRECHECK_STATUS, parseJsonObject, toSafeText } from './contracts.js'
import { resolveNexusAuthorizationTarget } from './nexusAuthorizationTask.js'
import { normalizeWorkshopTarget } from '../../../../shared/sources/steam-workshop.js'

function createCheck(
  key = '',
  status = PRECHECK_STATUS.PASSED,
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

function getPathSegments(value = '') {
  return toSafeText(value).replace(/\\/g, '/').split('/').filter(Boolean)
}

function collectPathSafetyChecks(item = {}) {
  const metadata = resolveMetadata(item)
  const installPayload =
    metadata.installPayload && typeof metadata.installPayload === 'object'
      ? metadata.installPayload
      : {}
  const checks = []
  const pathFields = [
    ['targetRelativePath', installPayload.targetRelativePath],
    ['target_relative_path', installPayload.target_relative_path],
    ['relativePath', installPayload.relativePath],
    ['relative_path', installPayload.relative_path]
  ]

  for (const [field, value] of pathFields) {
    const text = toSafeText(value)
    if (!text) {
      continue
    }
    const segments = getPathSegments(text)
    if (path.isAbsolute(text) || /^[A-Za-z]:/.test(text) || segments.includes('..')) {
      checks.push(
        createCheck(
          `path_safe:${item.item_id}:${field}`,
          PRECHECK_STATUS.BLOCKED,
          '路径安全',
          '安装规则包含不安全的相对路径',
          { field, value: text }
        )
      )
    }
  }

  return checks
}

function resolveItemInstallPlan(item = {}) {
  if (item.installPlan && typeof item.installPlan === 'object') {
    return item.installPlan
  }
  const storedPlan = parseJsonObject(item.install_plan_json, {})
  if (Object.keys(storedPlan).length > 0) {
    return storedPlan
  }
  const metadata = resolveMetadata(item)
  const installPayload =
    metadata.installPayload && typeof metadata.installPayload === 'object'
      ? metadata.installPayload
      : {}
  if (installPayload.installPlan && typeof installPayload.installPlan === 'object') {
    return installPayload.installPlan
  }
  const lastInstallResult =
    metadata.lastInstallResult && typeof metadata.lastInstallResult === 'object'
      ? metadata.lastInstallResult
      : {}
  const previewResult =
    lastInstallResult.previewResult && typeof lastInstallResult.previewResult === 'object'
      ? lastInstallResult.previewResult
      : {}
  return previewResult.installPlan && typeof previewResult.installPlan === 'object'
    ? previewResult.installPlan
    : {}
}

function collectInstallPlanChecks(item = {}) {
  const plan = resolveItemInstallPlan(item)
  const checks = []
  if (!Object.keys(plan).length) {
    return checks
  }

  const conflictResult =
    plan.conflictResult && typeof plan.conflictResult === 'object' ? plan.conflictResult : {}
  if (conflictResult.blockInstall === true || conflictResult.level === 'blocker') {
    checks.push(
      createCheck(
        `plan_conflict:${item.item_id}`,
        PRECHECK_STATUS.BLOCKED,
        '安装冲突',
        '安装规划检测到阻断冲突',
        conflictResult
      )
    )
  } else if (conflictResult.requiresUserConfirm === true || conflictResult.level === 'warning') {
    checks.push(
      createCheck(
        `plan_conflict:${item.item_id}`,
        PRECHECK_STATUS.WARNING,
        '安装冲突',
        '安装规划存在需要确认的冲突',
        conflictResult
      )
    )
  }

  const dependencyResult =
    plan.dependencyResult && typeof plan.dependencyResult === 'object' ? plan.dependencyResult : {}
  if (dependencyResult.status === 'blocked') {
    checks.push(
      createCheck(
        `plan_dependency:${item.item_id}`,
        PRECHECK_STATUS.BLOCKED,
        '安装依赖',
        '安装规划检测到缺失或互斥依赖',
        dependencyResult
      )
    )
  } else if (dependencyResult.status === 'warning') {
    checks.push(
      createCheck(
        `plan_dependency:${item.item_id}`,
        PRECHECK_STATUS.WARNING,
        '安装依赖',
        '安装规划存在可选依赖提示',
        dependencyResult
      )
    )
  }

  const transaction = plan.transactionPlan || plan.transaction || {}
  if (transaction.rollbackPolicy === 'manual') {
    checks.push(
      createCheck(
        `plan_transaction:${item.item_id}`,
        PRECHECK_STATUS.WARNING,
        '回滚策略',
        '当前安装计划需要人工恢复确认',
        transaction
      )
    )
  } else if (transaction.rollbackPolicy === 'blocked') {
    checks.push(
      createCheck(
        `plan_transaction:${item.item_id}`,
        PRECHECK_STATUS.BLOCKED,
        '回滚策略',
        '当前安装计划因冲突阻断，不能执行',
        transaction
      )
    )
  }

  return checks
}

export function runInstallPrecheck(options = {}) {
  const job = options.job || {}
  const items = Array.isArray(options.items) ? options.items : []
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : []
  const artifactMap = new Map(artifacts.map((item) => [toSafeText(item.artifact_key), item]))
  const checks = []

  if (items.length > 0) {
    checks.push(
      createCheck('items', PRECHECK_STATUS.PASSED, '安装项', `共 ${items.length} 个安装项`)
    )
  } else {
    checks.push(createCheck('items', PRECHECK_STATUS.BLOCKED, '安装项', '任务没有可安装项'))
  }

  const gameRoot = toSafeText(job.game_root || job.gameRoot)
  const hasInstallItems = items.some((item) => resolveMetadata(item).purpose !== 'download_only')
  if (hasInstallItems && !gameRoot) {
    checks.push(
      createCheck(
        'game_root',
        PRECHECK_STATUS.WARNING,
        '游戏目录',
        '任务未提供游戏目录，后续安装规则可能需要自行解析'
      )
    )
  } else if (hasInstallItems && fs.existsSync(gameRoot)) {
    checks.push(
      createCheck('game_root', PRECHECK_STATUS.PASSED, '游戏目录', '游戏目录存在', {
        path: gameRoot
      })
    )
  } else if (hasInstallItems) {
    checks.push(
      createCheck('game_root', PRECHECK_STATUS.BLOCKED, '游戏目录', '游戏目录不存在', {
        path: gameRoot
      })
    )
  }

  for (const item of items) {
    const artifactKey = toSafeText(item.artifact_key)
    const artifact = artifactMap.get(artifactKey)
    const title = toSafeText(item.title, '安装项')
    const metadata = resolveMetadata(item)
    const installPayload =
      metadata.installPayload && typeof metadata.installPayload === 'object'
        ? metadata.installPayload
        : {}

    if (!artifact) {
      checks.push(
        createCheck(
          `artifact:${item.item_id}`,
          PRECHECK_STATUS.BLOCKED,
          '下载产物',
          `缺少下载产物记录：${title}`,
          { itemId: item.item_id, artifactKey }
        )
      )
    } else if (toSafeText(artifact.file_path)) {
      const fileExists = fs.existsSync(artifact.file_path)
      checks.push(
        createCheck(
          `artifact_file:${item.item_id}`,
          fileExists ? PRECHECK_STATUS.PASSED : PRECHECK_STATUS.WARNING,
          '下载文件',
          fileExists ? `下载文件可复用：${title}` : `下载文件缺失，将尝试重新下载：${title}`,
          { path: artifact.file_path, artifactKey }
        )
      )
    } else if (toSafeText(artifact?.download_url || artifact?.file_path)) {
      checks.push(
        createCheck(
          `artifact_source:${item.item_id}`,
          PRECHECK_STATUS.PASSED,
          '下载地址',
          `下载产物具备来源：${title}`,
          { artifactKey }
        )
      )
    } else if (metadata.source === 'steam-workshop' && metadata.entry?.item?.workshopDownload) {
      try {
        normalizeWorkshopTarget(metadata.entry.item.workshopDownload)
        checks.push(createCheck(`workshop:${item.item_id}`, PRECHECK_STATUS.PASSED, 'Steam下载', 'Steam 下载目标已准备'))
      } catch {
        checks.push(createCheck(`workshop:${item.item_id}`, PRECHECK_STATUS.BLOCKED, 'Steam下载', 'Steam 下载目标无效'))
      }
    } else if (resolveNexusAuthorizationTarget({ ...item, metadata })) {
      checks.push(
        createCheck(
          `artifact_authorization:${item.item_id}`,
          PRECHECK_STATUS.PASSED,
          'Nexus 下载授权',
          `下载目标已记录，可从任务中心完成授权：${title}`,
          { artifactKey }
        )
      )
    } else {
      checks.push(
        createCheck(
          `artifact_source:${item.item_id}`,
          PRECHECK_STATUS.BLOCKED,
          '下载地址',
          `缺少下载地址或本地文件：${title}`,
          { artifactKey }
        )
      )
    }

    if (metadata.purpose === 'download_only') continue

    if (Object.keys(installPayload).length > 0) {
      checks.push(
        createCheck(
          `install_payload:${item.item_id}`,
          PRECHECK_STATUS.PASSED,
          '安装上下文',
          `安装上下文已准备：${title}`
        )
      )
    } else {
      checks.push(
        createCheck(
          `install_payload:${item.item_id}`,
          PRECHECK_STATUS.WARNING,
          '安装上下文',
          `安装上下文为空：${title}`
        )
      )
    }

    checks.push(...collectPathSafetyChecks(item))
    checks.push(...collectInstallPlanChecks(item))
  }

  const warnings = checks.filter((item) => item.status === PRECHECK_STATUS.WARNING)
  const blockers = checks.filter((item) => item.status === PRECHECK_STATUS.BLOCKED)
  const status = blockers.length
    ? PRECHECK_STATUS.BLOCKED
    : warnings.length
      ? PRECHECK_STATUS.WARNING
      : PRECHECK_STATUS.PASSED

  return {
    status,
    summary:
      status === PRECHECK_STATUS.BLOCKED
        ? '预检发现阻断问题'
        : status === PRECHECK_STATUS.WARNING
          ? '预检通过但存在警告'
          : hasInstallItems ? '可以自动安装' : '可以开始下载',
    checks,
    warnings,
    blockers
  }
}
