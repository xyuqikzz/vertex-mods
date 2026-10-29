// 真实外部日志路径验收。
import {
  MIN_REAL_EXTERNAL_LOG_EXPECTED_MOD_LENGTH,
  MIN_REAL_EXTERNAL_LOG_EXPECTED_ERROR_TEXT_LENGTH
} from '../constants.js'
import { isEnvEnabled, hasAnyEnv } from '../inputs.js'
import { createGate, statusFromGatePriority } from '../status.js'
import {
  hasAllowedExternalLogExtensions,
  hasAbsoluteExternalLogPaths,
  hasSafeExternalLogPaths,
  hasExistingExternalLogFiles
} from '../pathChecks.js'
import {
  hasValidOptionalForbiddenText,
  hasValidOptionalPositiveInteger,
  hasValidOptionalMinLengthText
} from '../inputChecks.js'

export const realExternalLogPathsReadiness = Object.freeze({
  key: 'real_external_log_paths',
  title: '真实外部日志诊断',
  batch: 'log',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_EXTERNAL_LOG_PATHS=1',
    'VERTEX_REAL_EXTERNAL_LOG_PATHS / VERTEX_REAL_EXTERNAL_LOG_PATH',
    '日志路径必须指向存在的 .log/.txt 文件，且不能是磁盘根或用户主目录',
    '可选 VERTEX_REAL_EXTERNAL_LOG_EXPECTED_MOD 至少 3 个字符',
    '可选 VERTEX_REAL_EXTERNAL_LOG_EXPECTED_ERROR_TEXT 至少 6 个字符',
    '可选 VERTEX_REAL_EXTERNAL_LOG_MIN_ERROR_COUNT 必须是 1..100 的正整数',
    '可选 VERTEX_REAL_EXTERNAL_LOG_LIMIT 必须是 1..50 的正整数',
    '可选 VERTEX_REAL_EXTERNAL_LOG_LINE_LIMIT 必须是 1..300 的正整数',
    '可选 VERTEX_REAL_EXTERNAL_LOG_FORBIDDEN_OUTPUT_TEXT / VERTEX_REAL_EXTERNAL_LOG_FORBIDDEN_OUTPUT_TEXTS 每项至少 6 个字符'
  ],
  evidence:
    '只读取显式 .log / .txt，输出不包含完整原始路径；可选期望错误文本和敏感文本断言需具备有效长度。',
  gates: ({ env, externalLogFileStatus }) => [
    createGate(
      '真实日志读取开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_EXTERNAL_LOG_PATHS')
    ),
    createGate(
      '已提供日志路径',
      hasAnyEnv(env, ['VERTEX_REAL_EXTERNAL_LOG_PATHS', 'VERTEX_REAL_EXTERNAL_LOG_PATH'])
    ),
    createGate('日志路径为 .log/.txt 文件', hasAllowedExternalLogExtensions(env)),
    createGate('日志路径为绝对路径', hasAbsoluteExternalLogPaths(env)),
    createGate('日志路径不是磁盘根或用户主目录', hasSafeExternalLogPaths(env)),
    createGate('日志文件存在且是文件', hasExistingExternalLogFiles(env, externalLogFileStatus)),
    createGate('敏感文本脱敏断言有效或未配置', hasValidOptionalForbiddenText(env)),
    createGate(
      '期望疑似模组断言有效或未配置',
      hasValidOptionalMinLengthText(
        env,
        'VERTEX_REAL_EXTERNAL_LOG_EXPECTED_MOD',
        MIN_REAL_EXTERNAL_LOG_EXPECTED_MOD_LENGTH
      )
    ),
    createGate(
      '期望错误文本断言有效或未配置',
      hasValidOptionalMinLengthText(
        env,
        'VERTEX_REAL_EXTERNAL_LOG_EXPECTED_ERROR_TEXT',
        MIN_REAL_EXTERNAL_LOG_EXPECTED_ERROR_TEXT_LENGTH
      )
    ),
    createGate(
      '最小错误数量断言有效或未配置',
      hasValidOptionalPositiveInteger(env, 'VERTEX_REAL_EXTERNAL_LOG_MIN_ERROR_COUNT', 100)
    ),
    createGate(
      '外部日志读取数量有效或未配置',
      hasValidOptionalPositiveInteger(env, 'VERTEX_REAL_EXTERNAL_LOG_LIMIT', 50)
    ),
    createGate(
      '外部日志单文件行数有效或未配置',
      hasValidOptionalPositiveInteger(env, 'VERTEX_REAL_EXTERNAL_LOG_LINE_LIMIT', 300)
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})
