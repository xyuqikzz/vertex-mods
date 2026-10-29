import {
  createEmptyTransactionPlan,
  createInstallPlanId,
  isPlainObject,
  toSafeNumber,
  toSafeText
} from './contracts.js'

function resolveChangeSummary(changeSet = {}) {
  const summary = isPlainObject(changeSet.summary) ? changeSet.summary : {}
  return {
    addCount: toSafeNumber(summary.addCount ?? summary.add, 0),
    overwriteCount: toSafeNumber(summary.overwriteCount ?? summary.overwrite, 0),
    skipSameHashCount: toSafeNumber(summary.skipSameHashCount ?? summary.skip, 0),
    mkdirCount: toSafeNumber(summary.mkdirCount ?? summary.mkdir, 0),
    backupRequiredCount: toSafeNumber(summary.backupRequiredCount ?? summary.risk, 0)
  }
}

function resolveRollbackPolicy(changeSet = {}, conflictResult = {}, deployStrategy = {}) {
  const summary = resolveChangeSummary(changeSet)
  if (conflictResult.blockInstall === true || conflictResult.level === 'blocker') {
    return 'blocked'
  }
  if (deployStrategy.actual === 'manual') {
    return 'manual'
  }
  if (summary.overwriteCount > 0 || summary.backupRequiredCount > 0) {
    return 'backup'
  }
  if (summary.addCount > 0 || summary.mkdirCount > 0 || summary.skipSameHashCount > 0) {
    return 'manifest'
  }
  return 'none'
}

export function buildTransactionPlan(payload = {}) {
  const plan = isPlainObject(payload.plan) ? payload.plan : {}
  const changeSet = isPlainObject(payload.changeSet) ? payload.changeSet : plan.changeSet || {}
  const conflictResult = isPlainObject(payload.conflictResult)
    ? payload.conflictResult
    : plan.conflictResult || {}
  const deployStrategy = isPlainObject(payload.deployStrategy)
    ? payload.deployStrategy
    : plan.deployStrategy || {}
  const context = isPlainObject(payload.context) ? payload.context : {}
  const summary = resolveChangeSummary(changeSet)
  const rollbackPolicy = resolveRollbackPolicy(changeSet, conflictResult, deployStrategy)
  const rollbackAvailable = ['manifest', 'backup'].includes(rollbackPolicy)
  const backupRequired = rollbackPolicy === 'backup'

  return createEmptyTransactionPlan({
    transactionId:
      toSafeText(plan.transactionPlan?.transactionId || plan.transaction?.transactionId) ||
      createInstallPlanId('install_tx'),
    jobId: toSafeText(context.jobId || plan.jobId),
    itemId: toSafeText(context.itemId || plan.itemId),
    source: toSafeText(plan.source || context.source),
    state: rollbackPolicy === 'blocked' ? 'blocked' : 'prepared',
    required: rollbackPolicy !== 'none',
    rollbackPolicy,
    rollbackAvailable,
    backupRequired,
    recoveryHint:
      rollbackPolicy === 'blocked'
        ? '安装规划已阻断，请先处理冲突'
        : rollbackAvailable
          ? '安装失败时可按变更集自动恢复'
          : rollbackPolicy === 'manual'
            ? '部署能力不足，失败后需要人工核对目标目录'
            : '当前计划没有需要回滚的文件变更',
    changeSet: {
      summary,
      entryCount: Array.isArray(changeSet.entries) ? changeSet.entries.length : 0
    },
    backupPlan: {
      required: backupRequired,
      overwriteCount: summary.overwriteCount
    },
    rollbackPlan: {
      policy: rollbackPolicy,
      available: rollbackAvailable
    }
  })
}
