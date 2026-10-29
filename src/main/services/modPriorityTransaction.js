import { withDeploymentScopeMutationLocks } from '../ipc/game/deploymentScopeMutationLock.js'

export async function runModPriorityTransaction({
  ids,
  scopes,
  readPriorities,
  writePriorities,
  restorePriorities,
  reconcile,
  taskId,
  enabled = true
}) {
  return withDeploymentScopeMutationLocks(
    scopes,
    async (scopeLockToken) => {
      const previous = readPriorities(ids)
      const attempted = []
      let result
      try {
        result = writePriorities(ids)
        if (!result?.success) return result
        const reconciles = []
        if (enabled) {
          for (const [index, scope] of result.scopes.entries()) {
            attempted.push(scope)
            const applied = await reconcile({
              scope,
              scopeLockToken,
              mode: 'domain_rebuild',
              taskId: `${taskId}:${index + 1}`,
              reason: 'priority_order_saved'
            })
            reconciles.push(applied)
            if (!applied?.success) throw new Error(applied?.message || '排序部署失败')
          }
        }
        return { ...result, reconcile: reconciles[0], reconciles }
      } catch (error) {
        const recoveryErrors = []
        try {
          restorePriorities(previous)
        } catch (restoreError) {
          recoveryErrors.push(restoreError.message)
        }
        if (!recoveryErrors.length) {
          for (const [index, scope] of attempted.entries()) {
            try {
              const restored = await reconcile({
                scope,
                scopeLockToken,
                mode: 'domain_rebuild',
                taskId: `${taskId}:restore:${index + 1}`,
                reason: 'priority_order_rollback'
              })
              if (!restored?.success) throw new Error(restored?.message || '部署恢复失败')
            } catch (restoreError) {
              recoveryErrors.push(restoreError.message)
            }
          }
        }
        return {
          success: false,
          code: 'priority_order_failed',
          needRecovery: recoveryErrors.length > 0,
          message: recoveryErrors.length
            ? `排序未生效，恢复未完成：${recoveryErrors.join('；')}`
            : `排序未生效，已恢复原顺序：${error.message}`,
          recoveryErrors
        }
      }
    },
    { ownerId: taskId, operation: 'priority_order', errorCode: 'deployment_scope_busy' }
  )
}
