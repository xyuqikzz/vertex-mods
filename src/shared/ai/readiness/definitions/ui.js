// 真实界面和全自动流程验收。
import {
  NEXUS_AUTHORIZATION_ENV_KEYS,
  REAL_DIRECTORY_SMOKE_MARKER_FILE,
  AI_AGENT_READINESS_STATUSES
} from '../constants.js'
import { readEnvText, isEnvEnabled, hasAnyEnv, hasAllEnv } from '../inputs.js'
import { createGate, statusFromRealUiGates, statusFromGatePriority } from '../status.js'
import {
  hasInstallExpectedPathsWhenWildcard,
  hasSafeInstallPattern,
  isDirectoryRootAbsolute,
  isDirectoryRootSafe,
  hasExistingDirectoryRoot,
  hasDirectoryRootSmokeMarker,
  hasSafeOptionalRelativePath,
  hasSafeOptionalPathSegment,
  hasSafeInstallExpectedPaths
} from '../pathChecks.js'
import {
  hasCompleteNexusAuthorization,
  hasFreshNexusAuthorization,
  hasNexusApiKey
} from '../inputChecks.js'

export const realUiVisualAcceptanceReadiness = Object.freeze({
  key: 'real_ui_visual_acceptance',
  title: '真实 UI 按钮和视觉状态',
  batch: 'ui',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_NEXUS_AUTH_INSTALL=1 + Nexus API Key + VERTEX_REAL_NEXUS_AUTHORIZATION + VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
    `或 VERTEX_ENABLE_REAL_USER_DIRECTORY_INSTALL=1 + VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT + ${REAL_DIRECTORY_SMOKE_MARKER_FILE} + VERTEX_REAL_USER_DIRECTORY_INSTALL_CONFIRM=WRITE_TO_THIS_DIRECTORY`
  ],
  evidence: '验证计划卡安装按钮、详情入口、预检刷新、Hash 详情和任务面板完成态。',
  gates: (context) => [
    createGate(
      'Nexus 真实授权 UI 验收可执行',
      isEnvEnabled(context.env, 'VERTEX_ENABLE_REAL_NEXUS_AUTH_INSTALL') &&
        hasNexusApiKey(context) &&
        hasAnyEnv(context.env, NEXUS_AUTHORIZATION_ENV_KEYS) &&
        hasCompleteNexusAuthorization(context.env) &&
        hasFreshNexusAuthorization(context.env) &&
        hasAllEnv(context.env, ['VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN']) &&
        hasSafeInstallPattern(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN') &&
        hasInstallExpectedPathsWhenWildcard(
          context.env,
          'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
          'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS'
        ) &&
        hasSafeInstallExpectedPaths(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS') &&
        hasSafeOptionalRelativePath(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_TARGET_PATH') &&
        hasSafeOptionalPathSegment(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_FILE_NAME')
    ),
    createGate(
      '用户测试目录 UI 验收可执行',
      isEnvEnabled(context.env, 'VERTEX_ENABLE_REAL_USER_DIRECTORY_INSTALL') &&
        hasAllEnv(context.env, ['VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT']) &&
        isDirectoryRootAbsolute(context.env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT') &&
        isDirectoryRootSafe(context.env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT') &&
        hasExistingDirectoryRoot(
          context.env,
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT',
          context.directoryRootStatus
        ) &&
        hasDirectoryRootSmokeMarker(
          context.env,
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT',
          context.directoryRootStatus
        ) &&
        readEnvText(context.env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_CONFIRM') ===
          'WRITE_TO_THIS_DIRECTORY' &&
        hasSafeInstallPattern(
          context.env,
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_PATTERN',
          'BepInEx/plugins/sample.dll'
        ) &&
        hasInstallExpectedPathsWhenWildcard(
          context.env,
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_PATTERN',
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS',
          'BepInEx/plugins/sample.dll'
        ) &&
        hasSafeInstallExpectedPaths(
          context.env,
          'VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS'
        ) &&
        hasSafeOptionalRelativePath(context.env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_TARGET_PATH')
    )
  ],
  status: (context, gates) => statusFromRealUiGates(context, gates)
})

export const realFullAutoReadiness = Object.freeze({
  key: 'real_full_auto',
  title: '生产级 full_auto 连续安装',
  batch: 'destructive',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_USER_DIRECTORY_FULL_AUTO=1',
    'VERTEX_ENABLE_AGENT_FULL_AUTO=1',
    'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT',
    'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_CONFIRM=RUN_FULL_AUTO_IN_THIS_DIRECTORY',
    '测试目录必须是绝对路径、已存在且不能是磁盘根或用户主目录',
    `测试目录内必须存在 ${REAL_DIRECTORY_SMOKE_MARKER_FILE} 标记文件`
  ],
  evidence: '仅在用户确认的可恢复测试目录执行一次 full_auto 来源安装，默认保护态不写目录。',
  gates: ({ env, featureFlags, directoryRootStatus }) => [
    createGate('写工具总开关可用', featureFlags?.enableAgentWriteTools !== false),
    createGate('full_auto 开关已开启', featureFlags?.enableAgentFullAuto === true),
    createGate('full_auto 环境开关已开启', isEnvEnabled(env, 'VERTEX_ENABLE_AGENT_FULL_AUTO')),
    createGate(
      '真实目录 full_auto 开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_USER_DIRECTORY_FULL_AUTO')
    ),
    createGate(
      '已提供可恢复测试目录',
      hasAllEnv(env, ['VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT'])
    ),
    createGate(
      '测试目录为绝对路径',
      isDirectoryRootAbsolute(env, 'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT')
    ),
    createGate(
      '测试目录不是磁盘根或用户主目录',
      isDirectoryRootSafe(env, 'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT')
    ),
    createGate(
      '测试目录存在且是目录',
      hasExistingDirectoryRoot(
        env,
        'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '测试目录包含验收标记文件',
      hasDirectoryRootSmokeMarker(
        env,
        'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '已确认允许 full_auto 写入',
      readEnvText(env, 'VERTEX_REAL_USER_DIRECTORY_FULL_AUTO_CONFIRM') ===
        'RUN_FULL_AUTO_IN_THIS_DIRECTORY'
    )
  ],
  status: (_context, gates) => {
    if (gates[0]?.passed === false) return AI_AGENT_READINESS_STATUSES.BLOCKED
    return statusFromGatePriority(gates)
  }
})
