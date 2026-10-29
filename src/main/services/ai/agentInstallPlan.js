// 兼容入口：实现按职责拆分，调用方继续使用此模块。
export { resolveAiAgentSourceInstallTaskPayload } from './install-plan/sourceTasks.js'
export { createAiAgentInstallPlanPreview } from './install-plan/preview.js'
export { resolveAiAgentAutoInstallPlan } from './install-plan/autoPlan.js'
