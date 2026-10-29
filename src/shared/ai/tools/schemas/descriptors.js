// 工具声明按领域维护；显式保留原有工具顺序。
import {
  skillReadDescriptor,
  pageContextDescriptor,
  sourceCapabilitiesDescriptor,
  sourceCredentialStatusDescriptor,
  sourceCredentialConfigureDescriptor
} from './descriptors/context.js'
import {
  dlssListDescriptor,
  dlssInspectDescriptor,
  dlssPrepareDescriptor,
  dlssExecuteDescriptor,
  dlssCheckRuntimeDescriptor
} from './descriptors/dlss.js'
import {
  gameListDescriptor,
  gameContextDescriptor,
  gameDetectRootDescriptor,
  gameBindRootDescriptor
} from './descriptors/game.js'
import {
  modInstalledListDescriptor,
  modInstalledDetailDescriptor,
  modSearchDescriptor,
  modDetailDescriptor,
  localModAnalyzeDescriptor,
  modUpdateCheckDescriptor,
  modLifecyclePlanDescriptor,
  modLifecycleExecuteDescriptor
} from './descriptors/mods.js'
import {
  installTasksDescriptor,
  installTaskDetailDescriptor,
  installTaskTimelineDescriptor,
  installFailureDiagnoseDescriptor,
  installControlTaskDescriptor
} from './descriptors/tasks.js'
import {
  installRuleReferenceDocsDescriptor,
  installRuleSaveConfigDescriptor
} from './descriptors/rules.js'
import {
  logAnalyzeDescriptor,
  rollbackPlanDescriptor,
  rollbackExecuteDescriptor,
  conflictDetectDescriptor,
  conflictRepairPlanDescriptor,
  conflictExecuteRepairDescriptor
} from './descriptors/diagnostics.js'
import {
  installResolveDependenciesDescriptor,
  installContextAuditDescriptor,
  installArchiveInspectDescriptor,
  installLocationHintsDescriptor,
  installRuleMatchPreviewDescriptor,
  installInspectPlanDescriptor,
  installExecutePlanDescriptor
} from './descriptors/installPlanning.js'
import {
  trainerFlingSearchDescriptor,
  trainerFlingDetailDescriptor,
  trainerFlingDownloadDescriptor,
  trainerFlingLocalRecordsDescriptor,
  trainerFlingRunDescriptor,
  scriptPrepareDescriptor,
  scriptRunDescriptor
} from './descriptors/utilities.js'

export const AI_AGENT_TOOL_DESCRIPTORS = Object.freeze([
  skillReadDescriptor,
  dlssListDescriptor,
  dlssInspectDescriptor,
  dlssPrepareDescriptor,
  dlssExecuteDescriptor,
  dlssCheckRuntimeDescriptor,
  gameListDescriptor,
  gameContextDescriptor,
  gameDetectRootDescriptor,
  gameBindRootDescriptor,
  modInstalledListDescriptor,
  modInstalledDetailDescriptor,
  modSearchDescriptor,
  modDetailDescriptor,
  installTasksDescriptor,
  installTaskDetailDescriptor,
  installTaskTimelineDescriptor,
  installFailureDiagnoseDescriptor,
  pageContextDescriptor,
  sourceCapabilitiesDescriptor,
  sourceCredentialStatusDescriptor,
  sourceCredentialConfigureDescriptor,
  installControlTaskDescriptor,
  installRuleReferenceDocsDescriptor,
  installRuleSaveConfigDescriptor,
  logAnalyzeDescriptor,
  rollbackPlanDescriptor,
  rollbackExecuteDescriptor,
  installResolveDependenciesDescriptor,
  installContextAuditDescriptor,
  installArchiveInspectDescriptor,
  installLocationHintsDescriptor,
  installRuleMatchPreviewDescriptor,
  installInspectPlanDescriptor,
  installExecutePlanDescriptor,
  trainerFlingSearchDescriptor,
  trainerFlingDetailDescriptor,
  trainerFlingDownloadDescriptor,
  trainerFlingLocalRecordsDescriptor,
  trainerFlingRunDescriptor,
  scriptPrepareDescriptor,
  scriptRunDescriptor,
  localModAnalyzeDescriptor,
  modUpdateCheckDescriptor,
  modLifecyclePlanDescriptor,
  modLifecycleExecuteDescriptor,
  conflictDetectDescriptor,
  conflictRepairPlanDescriptor,
  conflictExecuteRepairDescriptor
])
