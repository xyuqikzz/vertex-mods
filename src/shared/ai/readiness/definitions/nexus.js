// Nexus 授权下载、安装与全自动验收。
import { NEXUS_AUTHORIZATION_ENV_KEYS, AI_AGENT_READINESS_STATUSES } from '../constants.js'
import { isEnvEnabled, hasAnyEnv, hasAllEnv } from '../inputs.js'
import { createGate, statusFromGatePriority } from '../status.js'
import {
  hasValidOptionalBooleanFlag,
  hasCompleteNexusAuthorization,
  hasFreshNexusAuthorization,
  hasNexusApiKey
} from '../inputChecks.js'
import {
  hasInstallExpectedPathsWhenWildcard,
  hasSafeInstallPattern,
  hasSafeOptionalRelativePath,
  hasSafeOptionalPathSegment,
  hasSafeInstallExpectedPaths
} from '../pathChecks.js'

export const nexusAuthorizedDownloadReadiness = Object.freeze({
  key: 'nexus_authorized_download',
  title: 'Nexus 授权换链',
  batch: 'nexus',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_NEXUS_AUTH_DOWNLOAD=1',
    'VERTEX_REAL_NEXUS_AUTHORIZATION',
    '授权必须包含 gameDomain/modId/fileId/key/expires 且未过期',
    '可选 VERTEX_REAL_NEXUS_AUTH_PROBE_DOWNLOAD 必须是 0 或 1'
  ],
  evidence: '真实授权换链成功，输出不包含 key、expires、原始授权 URL 或下载 token。',
  gates: ({ env }) => [
    createGate('真实换链开关已开启', isEnvEnabled(env, 'VERTEX_ENABLE_REAL_NEXUS_AUTH_DOWNLOAD')),
    createGate('已提供授权 URL', hasAnyEnv(env, NEXUS_AUTHORIZATION_ENV_KEYS)),
    createGate('授权包含 gameDomain/modId/fileId/key/expires', hasCompleteNexusAuthorization(env)),
    createGate('授权未过期', hasFreshNexusAuthorization(env)),
    createGate(
      '下载探测开关有效或未配置',
      hasValidOptionalBooleanFlag(env, 'VERTEX_REAL_NEXUS_AUTH_PROBE_DOWNLOAD')
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})

export const nexusAuthorizedInstallReadiness = Object.freeze({
  key: 'nexus_authorized_install',
  title: 'Nexus 授权安装完成态',
  batch: 'nexus',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_NEXUS_AUTH_INSTALL=1',
    'NEXUS_API_KEY / VITE_NEXUS_API_KEY 或客户端 Nexus API 配置',
    'VERTEX_REAL_NEXUS_AUTHORIZATION',
    '授权必须包含 gameDomain/modId/fileId/key/expires 且未过期',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN 必须是相对路径/通配规则且不含 ..',
    '通配符匹配时 VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS 必须是相对路径且不含 ..',
    '可选 VERTEX_REAL_NEXUS_AUTH_INSTALL_TARGET_PATH 必须是相对路径且不含 ..',
    '可选 VERTEX_REAL_NEXUS_AUTH_INSTALL_FILE_NAME 不能包含路径分隔符或 ..'
  ],
  evidence: '真实授权换链后在隔离 profile 完成来源安装任务与 Agent 投影。',
  gates: (context) => [
    createGate(
      '真实授权安装开关已开启',
      isEnvEnabled(context.env, 'VERTEX_ENABLE_REAL_NEXUS_AUTH_INSTALL')
    ),
    createGate('Nexus API Key 已配置', hasNexusApiKey(context)),
    createGate('已提供授权 URL', hasAnyEnv(context.env, NEXUS_AUTHORIZATION_ENV_KEYS)),
    createGate(
      '授权包含 gameDomain/modId/fileId/key/expires',
      hasCompleteNexusAuthorization(context.env)
    ),
    createGate('授权未过期', hasFreshNexusAuthorization(context.env)),
    createGate(
      '已提供包内匹配规则',
      hasAllEnv(context.env, ['VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN'])
    ),
    createGate(
      '包内匹配规则为相对安全路径',
      hasSafeInstallPattern(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN')
    ),
    createGate(
      '通配符匹配已提供期望路径或未使用通配符',
      hasInstallExpectedPathsWhenWildcard(
        context.env,
        'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
        'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS'
      )
    ),
    createGate(
      '期望安装路径为相对安全路径',
      hasSafeInstallExpectedPaths(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS')
    ),
    createGate(
      '安装目标路径为相对安全路径',
      hasSafeOptionalRelativePath(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_TARGET_PATH')
    ),
    createGate(
      '安装文件名为安全片段',
      hasSafeOptionalPathSegment(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_FILE_NAME')
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})

export const nexusAuthorizedFullAutoReadiness = Object.freeze({
  key: 'nexus_authorized_full_auto',
  title: 'Nexus 授权 full_auto 完成态',
  batch: 'destructive',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_NEXUS_AUTH_FULL_AUTO=1',
    'VERTEX_ENABLE_AGENT_FULL_AUTO=1',
    'NEXUS_API_KEY / VITE_NEXUS_API_KEY 或客户端 Nexus API 配置',
    'VERTEX_REAL_NEXUS_AUTHORIZATION',
    '授权必须包含 gameDomain/modId/fileId/key/expires 且未过期',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN 必须是相对路径/通配规则且不含 ..',
    '通配符匹配时 VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS',
    'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS 必须是相对路径且不含 ..',
    '可选 VERTEX_REAL_NEXUS_AUTH_INSTALL_TARGET_PATH 必须是相对路径且不含 ..',
    '可选 VERTEX_REAL_NEXUS_AUTH_INSTALL_FILE_NAME 不能包含路径分隔符或 ..'
  ],
  evidence:
    '隔离 Nexus 授权下载已覆盖 full_auto 完成态；真实 Nexus 授权 full_auto 需显式开关后执行换链、来源安装、会话备份和工具日志校验。',
  gates: (context) => [
    createGate('写工具总开关可用', context.featureFlags?.enableAgentWriteTools !== false),
    createGate('full_auto 开关已开启', context.featureFlags?.enableAgentFullAuto === true),
    createGate(
      'full_auto 环境开关已开启',
      isEnvEnabled(context.env, 'VERTEX_ENABLE_AGENT_FULL_AUTO')
    ),
    createGate(
      '真实 Nexus full_auto 开关已开启',
      isEnvEnabled(context.env, 'VERTEX_ENABLE_REAL_NEXUS_AUTH_FULL_AUTO')
    ),
    createGate('Nexus API Key 已配置', hasNexusApiKey(context)),
    createGate('已提供授权 URL', hasAnyEnv(context.env, NEXUS_AUTHORIZATION_ENV_KEYS)),
    createGate(
      '授权包含 gameDomain/modId/fileId/key/expires',
      hasCompleteNexusAuthorization(context.env)
    ),
    createGate('授权未过期', hasFreshNexusAuthorization(context.env)),
    createGate(
      '已提供包内匹配规则',
      hasAllEnv(context.env, ['VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN'])
    ),
    createGate(
      '包内匹配规则为相对安全路径',
      hasSafeInstallPattern(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN')
    ),
    createGate(
      '通配符匹配已提供期望路径或未使用通配符',
      hasInstallExpectedPathsWhenWildcard(
        context.env,
        'VERTEX_REAL_NEXUS_AUTH_INSTALL_PATTERN',
        'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS'
      )
    ),
    createGate(
      '期望安装路径为相对安全路径',
      hasSafeInstallExpectedPaths(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_EXPECTED_PATHS')
    ),
    createGate(
      '安装目标路径为相对安全路径',
      hasSafeOptionalRelativePath(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_TARGET_PATH')
    ),
    createGate(
      '安装文件名为安全片段',
      hasSafeOptionalPathSegment(context.env, 'VERTEX_REAL_NEXUS_AUTH_INSTALL_FILE_NAME')
    )
  ],
  status: (_context, gates) => {
    if (gates[0]?.passed === false) return AI_AGENT_READINESS_STATUSES.BLOCKED
    return statusFromGatePriority(gates)
  }
})
