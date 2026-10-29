import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { collectDirectorySnapshot } from '../ipc/game/install-engine/fsSnapshot.js'
import { isPathInside, isRealPathInside } from '../ipc/game/install-engine/pathSafety.js'
import { withDeploymentScopeMutationLocks } from '../ipc/game/deploymentScopeMutationLock.js'

function metadataOf(mod) {
  return typeof mod.metadata_json === 'string' ? JSON.parse(mod.metadata_json || '{}') : mod.metadata_json || {}
}

function assertTarget(root, target) {
  // 落盘和恢复时重新解析，不复用规划缓存。
  if (!isPathInside(root, target) || !isRealPathInside(root, target)) {
    throw new Error('更新目标真实路径越界，已停止操作')
  }
}

async function captureTargets(pairs, backupRoot) {
  const entries = new Map()
  for (const { source, target } of pairs) {
    const snapshot = await collectDirectorySnapshot(source)
    for (const file of snapshot.allFiles) {
      const targetPath = path.resolve(target, file.relativePath)
      const key = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
      if (entries.has(key)) continue
      assertTarget(target, targetPath)
      const stat = await fs.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('更新目标不是普通文件')
      const backupPath = stat ? path.join(backupRoot, String(entries.size)) : ''
      if (backupPath) await fs.copyFile(targetPath, backupPath)
      entries.set(key, { root: target, targetPath, backupPath })
    }
  }
  return [...entries.values()]
}

async function restoreTargets(entries) {
  for (const entry of entries) {
    assertTarget(entry.root, entry.targetPath)
    const stat = await fs.lstat(entry.targetPath).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('恢复目标不是普通文件')
    // 先断开新版本硬链接，避免复制旧内容时改写新暂存源。
    if (stat) await fs.unlink(entry.targetPath)
    if (entry.backupPath) {
      await fs.ensureDir(path.dirname(entry.targetPath))
      assertTarget(entry.root, entry.targetPath)
      await fs.copyFile(entry.backupPath, entry.targetPath)
    }
  }
}

/** 新版本已解压/规划/授权后调用。原记录 ID 和资产 owner 保持不变。 */
export async function runModUpdateTransaction(options, apply, deps) {
  const { previousMod, sourceRoot, targetRoot, useSafeDeployReconcile, activate,
    previousUsesReconcile = useSafeDeployReconcile } = options
  const needsFileSnapshot = !useSafeDeployReconcile || !previousUsesReconcile
  const scope = deps.getScope(previousMod.id) || {
    gameId: previousMod.game_id, source: previousMod.source, endpointType: previousMod.endpoint_type,
    deployDomain: previousMod.deploy_domain || `${previousMod.source}:${previousMod.profile_name || 'default'}`
  }
  return withDeploymentScopeMutationLocks([scope], async (scopeLockToken) => {
    const current = deps.readMod(previousMod.id)
    if (!current || JSON.stringify(current) !== JSON.stringify(previousMod)) {
      throw Object.assign(new Error('安装记录已发生变化，请刷新后重试更新'), { code: 'mod_update_stale' })
    }
    await deps.validateBeforeMutation?.()
    const meta = metadataOf(current)
    const oldSource = String(meta.stagingPath || current.staging_path || '').trim()
    const oldTarget = String(meta.targetPath || current.target_path || '').trim()
    const wasActive = Number(current.is_active ?? 1) === 1
    if (wasActive && (!oldSource || !oldTarget || !(await fs.pathExists(oldSource)))) {
      throw new Error('旧版本暂存文件缺失，无法保证更新失败后的恢复，更新已中止')
    }
    if (oldSource && (isPathInside(oldSource, sourceRoot) || isPathInside(sourceRoot, oldSource) ||
      isRealPathInside(oldSource, sourceRoot) || isRealPathInside(sourceRoot, oldSource))) {
      throw new Error('新旧版本暂存目录重叠，更新已中止')
    }

    let backupRoot = ''
    let entries = []
    let mutationStarted = false
    let recovered = false
    let unlocked = false
    try {
      if (needsFileSnapshot) {
        backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-mod-update-'))
        entries = await captureTargets([
          ...(wasActive ? [{ source: oldSource, target: oldTarget }] : []),
          ...(activate ? [{ source: sourceRoot, target: targetRoot }] : [])
        ], backupRoot)
      }
      const writable = await deps.ensureWritable([current])
      if (!writable?.success) throw new Error(writable?.message || '旧版本文件无法解除保护，更新已中止')
      unlocked = true
      mutationStarted = true
      if (!previousUsesReconcile && wasActive) {
        if (await deps.undeploy(oldSource, oldTarget) === false) throw new Error('旧版本取消部署失败')
      }
      const result = await apply(scopeLockToken)
      recovered = true
      if (activate) {
        try {
          const locked = await deps.lockSource(deps.readMod(current.id))
          if (!locked?.success) deps.warn('更新成功，但新版本源文件保护失败，请在模组管理中重试加锁', locked)
        } catch (error) {
          deps.warn('更新成功，但新版本源文件保护失败，请在模组管理中重试加锁', error)
        }
      }
      // 清理只针对已验证互不重叠的旧暂存；失败不能把成功更新改报为失败。
      if (oldSource && ![oldTarget, targetRoot].filter(Boolean).some((target) =>
        isPathInside(oldSource, target) || isPathInside(target, oldSource) ||
        isRealPathInside(oldSource, target) || isRealPathInside(target, oldSource))) {
        try {
          await deps.cleanupStaging(oldSource)
        } catch (error) {
          deps.warn('更新成功后清理旧暂存失败', error)
        }
      }
      return result
    } catch (error) {
      if (mutationStarted) {
        try {
          deps.restoreMod(current)
          if (useSafeDeployReconcile) {
            const restored = await deps.reconcile({ scope, scopeLockToken, mode: 'update_rollback', reason: 'update_rollback' })
            if (!restored?.success) throw new Error(restored?.message || '旧版本部署恢复失败')
          }
          if (needsFileSnapshot) {
            await restoreTargets(entries)
          }
          recovered = true
        } catch (restoreError) {
          throw Object.assign(new Error(`${error.message}；旧版本恢复失败：${restoreError.message}，已保留恢复文件`), {
            code: 'mod_update_recovery_required', needRecovery: true, cause: error, recoveryPath: backupRoot
          })
        }
      }
      throw error
    } finally {
      try {
        if (unlocked && wasActive && deps.readMod(current.id)?.staging_path === current.staging_path) {
          const locked = await deps.lockSource(current)
          if (!locked?.success) deps.warn('恢复旧版本后重新保护暂存失败', locked)
        }
      } catch (error) {
        deps.warn('恢复旧版本后重新保护暂存失败', error)
      }
      if (backupRoot && (!mutationStarted || recovered)) {
        await fs.remove(backupRoot).catch((error) => deps.warn('清理更新临时备份失败', error))
      }
    }
  }, { ownerId: `mod-update:${previousMod.id}`, operation: 'update', errorCode: 'deployment_scope_busy' })
}
