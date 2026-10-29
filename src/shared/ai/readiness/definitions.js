// 各领域验收场景集合，保留原有展示顺序。
import {
  realModelRequestReadiness,
  realModelPlanCardReadiness,
  realModelNativeToolCallReadiness
} from './definitions/model.js'
import {
  nexusAuthorizedDownloadReadiness,
  nexusAuthorizedInstallReadiness,
  nexusAuthorizedFullAutoReadiness
} from './definitions/nexus.js'
import {
  realThunderstoreDownloadInstallReadiness,
  userRealDirectoryInstallReadiness
} from './definitions/install.js'
import { realUiVisualAcceptanceReadiness, realFullAutoReadiness } from './definitions/ui.js'
import {
  realDestructiveRepairRollbackReadiness,
  realSingleModRollbackTrimReadiness
} from './definitions/repair.js'
import { realExternalLogPathsReadiness } from './definitions/logs.js'

export const READINESS_DEFINITIONS = Object.freeze([
  realModelRequestReadiness,
  realModelPlanCardReadiness,
  realModelNativeToolCallReadiness,
  nexusAuthorizedDownloadReadiness,
  nexusAuthorizedInstallReadiness,
  realThunderstoreDownloadInstallReadiness,
  userRealDirectoryInstallReadiness,
  realUiVisualAcceptanceReadiness,
  realFullAutoReadiness,
  nexusAuthorizedFullAutoReadiness,
  realDestructiveRepairRollbackReadiness,
  realSingleModRollbackTrimReadiness,
  realExternalLogPathsReadiness
])
