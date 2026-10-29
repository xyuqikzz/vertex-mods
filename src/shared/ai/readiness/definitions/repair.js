// 破坏性修复与单模组回滚验收。
import { AI_AGENT_READINESS_STATUSES, REAL_DIRECTORY_SMOKE_MARKER_FILE } from '../constants.js'
import { readEnvText, isEnvEnabled, hasAllEnv } from '../inputs.js'
import { createGate, statusFromGatePriority } from '../status.js'
import {
  isDirectoryRootAbsolute,
  isDirectoryRootSafe,
  hasExistingDirectoryRoot,
  hasDirectoryRootSmokeMarker
} from '../pathChecks.js'

export const realDestructiveRepairRollbackReadiness = Object.freeze({
  key: 'real_destructive_repair_rollback',
  title: '真实目录冲突修复 / 卸载 / 回滚',
  batch: 'destructive',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_DESTRUCTIVE_REPAIR_ROLLBACK=1',
    'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
    'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_CONFIRM=MODIFY_AND_ROLLBACK_THIS_DIRECTORY',
    '测试目录必须是绝对路径、已存在且不能是磁盘根或用户主目录',
    `测试目录内必须存在 ${REAL_DIRECTORY_SMOKE_MARKER_FILE} 标记文件`
  ],
  evidence:
    '仅在用户确认的可恢复测试目录执行禁用、部署域重建、卸载和文件级回滚，默认保护态不写目录。',
  gates: ({ env, featureFlags, directoryRootStatus }) => [
    createGate('写工具总开关可用', featureFlags?.enableAgentWriteTools !== false),
    createGate(
      '真实修复/回滚开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_DESTRUCTIVE_REPAIR_ROLLBACK')
    ),
    createGate(
      '已提供可恢复测试目录',
      hasAllEnv(env, ['VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT'])
    ),
    createGate(
      '测试目录为绝对路径',
      isDirectoryRootAbsolute(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT')
    ),
    createGate(
      '测试目录不是磁盘根或用户主目录',
      isDirectoryRootSafe(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT')
    ),
    createGate(
      '测试目录存在且是目录',
      hasExistingDirectoryRoot(
        env,
        'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '测试目录包含验收标记文件',
      hasDirectoryRootSmokeMarker(
        env,
        'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '已确认允许破坏性操作',
      readEnvText(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_CONFIRM') ===
        'MODIFY_AND_ROLLBACK_THIS_DIRECTORY'
    )
  ],
  status: (_context, gates) => {
    if (gates[0]?.passed === false) return AI_AGENT_READINESS_STATUSES.BLOCKED
    return statusFromGatePriority(gates)
  }
})

export const realSingleModRollbackTrimReadiness = Object.freeze({
  key: 'real_single_mod_rollback_trim',
  title: '真实单模组回滚裁剪',
  batch: 'destructive',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_DESTRUCTIVE_REPAIR_ROLLBACK=1',
    'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
    'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_CONFIRM=MODIFY_AND_ROLLBACK_THIS_DIRECTORY',
    '测试目录必须是绝对路径、已存在且不能是磁盘根或用户主目录',
    `测试目录内必须存在 ${REAL_DIRECTORY_SMOKE_MARKER_FILE} 标记文件`
  ],
  evidence: '本地临时文件回归验证同事务双模组只恢复目标模组；用户真实目录仍需显式授权后执行。',
  gates: ({ env, featureFlags, directoryRootStatus }) => [
    createGate('写工具总开关可用', featureFlags?.enableAgentWriteTools !== false),
    createGate(
      '真实修复/回滚开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_DESTRUCTIVE_REPAIR_ROLLBACK')
    ),
    createGate(
      '已提供可恢复测试目录',
      hasAllEnv(env, ['VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT'])
    ),
    createGate(
      '测试目录为绝对路径',
      isDirectoryRootAbsolute(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT')
    ),
    createGate(
      '测试目录不是磁盘根或用户主目录',
      isDirectoryRootSafe(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT')
    ),
    createGate(
      '测试目录存在且是目录',
      hasExistingDirectoryRoot(
        env,
        'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '测试目录包含验收标记文件',
      hasDirectoryRootSmokeMarker(
        env,
        'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '已确认允许破坏性操作',
      readEnvText(env, 'VERTEX_REAL_DESTRUCTIVE_REPAIR_ROLLBACK_CONFIRM') ===
        'MODIFY_AND_ROLLBACK_THIS_DIRECTORY'
    )
  ],
  status: (_context, gates) => {
    if (gates[0]?.passed === false) return AI_AGENT_READINESS_STATUSES.BLOCKED
    return statusFromGatePriority(gates)
  }
})
