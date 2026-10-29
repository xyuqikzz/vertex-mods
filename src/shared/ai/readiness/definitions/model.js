// 真实模型请求、计划卡片与原生工具调用验收。
import { isEnvEnabled, hasRuntimeTool } from '../inputs.js'
import { createGate, createModelRuntimeGates, statusFromGatePriority } from '../status.js'
import {
  hasExpectedTextForCustomMessage,
  hasRequiredEnvForCustomMessage,
  hasValidOptionalMinLengthText,
  hasValidOptionalPlanCardExpectedSource
} from '../inputChecks.js'
import {
  MIN_REAL_MODEL_EXPECTED_TEXT_LENGTH,
  REAL_MODEL_PLAN_CARD_SOURCE_LABEL
} from '../constants.js'

export const realModelRequestReadiness = Object.freeze({
  key: 'real_model_request',
  title: '真实模型请求',
  batch: 'chat',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_MODEL_REQUEST=1',
    '可用模型配置',
    '自定义 VERTEX_ELECTRON_REAL_MODEL_MESSAGE 时必须设置至少 6 个字符的 VERTEX_REAL_MODEL_EXPECTED_TEXT'
  ],
  evidence: '真实模型请求成功返回，且默认保护态不发送请求。',
  gates: ({ runtimeStatus, env }) => [
    ...createModelRuntimeGates(runtimeStatus),
    createGate('真实请求开关已开启', isEnvEnabled(env, 'VERTEX_ENABLE_REAL_MODEL_REQUEST')),
    createGate(
      '自定义提示已配置有效期望文本或使用默认提示',
      hasExpectedTextForCustomMessage(
        env,
        'VERTEX_ELECTRON_REAL_MODEL_MESSAGE',
        'VERTEX_REAL_MODEL_EXPECTED_TEXT'
      )
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})

export const realModelPlanCardReadiness = Object.freeze({
  key: 'real_model_plan_card',
  title: '真实模型计划卡',
  batch: 'chat',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_MODEL_SOURCE_PLAN_CARD=1',
    '可用模型配置',
    'Agent 工具需包含 vertex.mod.search',
    `自定义 VERTEX_ELECTRON_REAL_MODEL_PLAN_CARD_MESSAGE 时必须设置至少 6 个字符的 VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_MOD，并设置有效的 VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_SOURCE(${REAL_MODEL_PLAN_CARD_SOURCE_LABEL})`,
    `可选 VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_SOURCE 必须是 ${REAL_MODEL_PLAN_CARD_SOURCE_LABEL}`
  ],
  evidence: '真实模型生成可提交计划卡，但不提交安装任务。',
  gates: ({ runtimeStatus, env }) => [
    ...createModelRuntimeGates(runtimeStatus),
    createGate('vertex.mod.search 工具已暴露', hasRuntimeTool(runtimeStatus, 'vertex.mod.search')),
    createGate(
      '自定义计划卡提示已配置有效期望模组和来源或使用默认提示',
      hasRequiredEnvForCustomMessage(env, 'VERTEX_ELECTRON_REAL_MODEL_PLAN_CARD_MESSAGE', [
        'VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_MOD',
        'VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_SOURCE'
      ]) &&
        hasValidOptionalMinLengthText(
          env,
          'VERTEX_REAL_MODEL_PLAN_CARD_EXPECTED_MOD',
          MIN_REAL_MODEL_EXPECTED_TEXT_LENGTH
        ) &&
        hasValidOptionalPlanCardExpectedSource(env)
    ),
    createGate(
      '计划卡真实请求开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_MODEL_SOURCE_PLAN_CARD')
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})

export const realModelNativeToolCallReadiness = Object.freeze({
  key: 'real_model_native_tool_call',
  title: '真实模型工具调用质量',
  batch: 'chat',
  requiredInputs: [
    'VERTEX_ENABLE_REAL_MODEL_NATIVE_TOOL_CALL=1',
    '可用模型配置',
    'Agent 工具需包含 vertex.game.list',
    '自定义 VERTEX_ELECTRON_REAL_MODEL_NATIVE_TOOL_MESSAGE 时必须设置至少 6 个字符的 VERTEX_REAL_MODEL_NATIVE_TOOL_EXPECTED_TEXT'
  ],
  evidence: '真实模型能通过 native tool calling 调用只读工具并回写最终回复。',
  gates: ({ runtimeStatus, env }) => [
    ...createModelRuntimeGates(runtimeStatus),
    createGate('vertex.game.list 工具已暴露', hasRuntimeTool(runtimeStatus, 'vertex.game.list')),
    createGate(
      '自定义工具调用提示已配置有效期望文本或使用默认提示',
      hasExpectedTextForCustomMessage(
        env,
        'VERTEX_ELECTRON_REAL_MODEL_NATIVE_TOOL_MESSAGE',
        'VERTEX_REAL_MODEL_NATIVE_TOOL_EXPECTED_TEXT'
      )
    ),
    createGate(
      '工具调用联调开关已开启',
      isEnvEnabled(env, 'VERTEX_ENABLE_REAL_MODEL_NATIVE_TOOL_CALL')
    )
  ],
  status: (_context, gates) => statusFromGatePriority(gates)
})
