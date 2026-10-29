// 真实来源下载与用户目录安装验收。
import { isEnvEnabled, readEnvText, hasAllEnv } from '../inputs.js'
import { createGate, statusFromGatePriority } from '../status.js'
import { hasValidOptionalPositiveInteger, hasSafeOptionalHttpsUrl } from '../inputChecks.js'
import {
  hasSafeOptionalRelativePath,
  hasSafeOptionalPathSegment,
  hasInstallExpectedPathsWhenWildcard,
  hasSafeInstallPattern,
  isDirectoryRootAbsolute,
  isDirectoryRootSafe,
  hasExistingDirectoryRoot,
  hasDirectoryRootSmokeMarker,
  hasSafeInstallExpectedPaths
} from '../pathChecks.js'
import { REAL_DIRECTORY_SMOKE_MARKER_FILE } from '../constants.js'

export const realThunderstoreDownloadInstallReadiness = Object.freeze({
  key: 'real_thunderstore_download_install',
  title: 'Thunderstore 真实下载安装',
  batch: 'install',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_THUNDERSTORE_DOWNLOAD_INSTALL=1',
    '可访问 Thunderstore 包详情 / 包索引和下载 URL',
    '隔离 profile 可写',
    '可选 VERTEX_THUNDERSTORE_BASE_URL 必须是 HTTPS URL',
    '可选 VERTEX_THUNDERSTORE_SMOKE_COMMUNITY 不能包含路径分隔符或 ..',
    '可选 VERTEX_THUNDERSTORE_SMOKE_PACKAGE 不能包含路径分隔符或 ..',
    '可选 VERTEX_THUNDERSTORE_SMOKE_VERSION 不能包含路径分隔符或 ..',
    '可选 VERTEX_THUNDERSTORE_SMOKE_EXPECTED_FILE 必须是相对路径且不含 ..',
    '可选 VERTEX_THUNDERSTORE_SMOKE_PROFILE 不能包含路径分隔符或 ..',
    '可选 VERTEX_THUNDERSTORE_SMOKE_APP_ID 必须是正整数',
    '包详情或包索引返回的包名和版本号必须能组成安全下载文件名',
    '包详情或包索引返回的文件大小必须是正整数'
  ],
  evidence: '真实 Thunderstore 公共包下载后在隔离 profile 完成来源安装任务与 Agent 投影。',
  gates: ({ env }) => [
    createGate(
      '真实 Thunderstore 下载安装开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_THUNDERSTORE_DOWNLOAD_INSTALL')
    ),
    createGate(
      '包索引地址为 HTTPS URL',
      hasSafeOptionalHttpsUrl(env, 'VERTEX_THUNDERSTORE_BASE_URL')
    ),
    createGate(
      '社区标识为安全片段',
      hasSafeOptionalPathSegment(env, 'VERTEX_THUNDERSTORE_SMOKE_COMMUNITY')
    ),
    createGate(
      '包标识为安全片段',
      hasSafeOptionalPathSegment(env, 'VERTEX_THUNDERSTORE_SMOKE_PACKAGE')
    ),
    createGate(
      '请求版本号为安全片段或未配置',
      hasSafeOptionalPathSegment(env, 'VERTEX_THUNDERSTORE_SMOKE_VERSION')
    ),
    createGate(
      '期望安装文件为相对安全路径',
      hasSafeOptionalRelativePath(env, 'VERTEX_THUNDERSTORE_SMOKE_EXPECTED_FILE')
    ),
    createGate(
      '安装 profile 名称为安全片段',
      hasSafeOptionalPathSegment(env, 'VERTEX_THUNDERSTORE_SMOKE_PROFILE')
    ),
    createGate(
      '游戏 AppId 为正整数或未配置',
      hasValidOptionalPositiveInteger(env, 'VERTEX_THUNDERSTORE_SMOKE_APP_ID', 2147483647)
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})

export const userRealDirectoryInstallReadiness = Object.freeze({
  key: 'user_real_directory_install',
  title: '用户真实目录安装',
  batch: 'install',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_USER_DIRECTORY_INSTALL=1',
    'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT',
    'VERTEX_REAL_USER_DIRECTORY_INSTALL_CONFIRM=WRITE_TO_THIS_DIRECTORY',
    '测试目录必须已存在且是目录',
    `测试目录内必须存在 ${REAL_DIRECTORY_SMOKE_MARKER_FILE} 标记文件`,
    '可选 VERTEX_REAL_USER_DIRECTORY_INSTALL_PATTERN 必须是相对路径/通配规则且不含 ..',
    '通配符匹配时 VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS',
    'VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS 必须是相对路径且不含 ..',
    '可选 VERTEX_REAL_USER_DIRECTORY_INSTALL_TARGET_PATH 必须是相对路径且不含 ..'
  ],
  evidence: '只在用户确认的可恢复测试目录验证来源安装任务完成态，默认保护态不写目录。',
  gates: ({ env, featureFlags, directoryRootStatus }) => [
    createGate('写工具总开关可用', featureFlags?.enableAgentWriteTools !== false),
    createGate(
      '真实目录安装开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_USER_DIRECTORY_INSTALL')
    ),
    createGate('已提供可恢复测试目录', hasAllEnv(env, ['VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT'])),
    createGate(
      '测试目录为绝对路径',
      isDirectoryRootAbsolute(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT')
    ),
    createGate(
      '测试目录不是磁盘根或用户主目录',
      isDirectoryRootSafe(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT')
    ),
    createGate(
      '测试目录存在且是目录',
      hasExistingDirectoryRoot(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT', directoryRootStatus)
    ),
    createGate(
      '测试目录包含验收标记文件',
      hasDirectoryRootSmokeMarker(
        env,
        'VERTEX_REAL_USER_DIRECTORY_INSTALL_ROOT',
        directoryRootStatus
      )
    ),
    createGate(
      '已确认允许写入',
      readEnvText(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_CONFIRM') === 'WRITE_TO_THIS_DIRECTORY'
    ),
    createGate(
      '包内匹配规则为相对安全路径',
      hasSafeInstallPattern(
        env,
        'VERTEX_REAL_USER_DIRECTORY_INSTALL_PATTERN',
        'BepInEx/plugins/sample.dll'
      )
    ),
    createGate(
      '通配符匹配已提供期望路径或未使用通配符',
      hasInstallExpectedPathsWhenWildcard(
        env,
        'VERTEX_REAL_USER_DIRECTORY_INSTALL_PATTERN',
        'VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS',
        'BepInEx/plugins/sample.dll'
      )
    ),
    createGate(
      '期望安装路径为相对安全路径',
      hasSafeInstallExpectedPaths(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_EXPECTED_PATHS')
    ),
    createGate(
      '安装目标路径为相对安全路径',
      hasSafeOptionalRelativePath(env, 'VERTEX_REAL_USER_DIRECTORY_INSTALL_TARGET_PATH')
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})
