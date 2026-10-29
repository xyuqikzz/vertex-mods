/**
 * schema/conflictPolicySchema.js — conflict_policy 字段校验
 */
import { toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import {
  MERGE_POLICY_NOT_SUPPORTED_CODE,
  MERGE_POLICY_NOT_SUPPORTED_MESSAGE,
  normalizeConflictPolicy
} from '../conflictPolicyResolver.js'

export function validateConflictPolicy(value, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (value === undefined || value === null || value === '') return
  if (!normalizeConflictPolicy(value)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_conflict_policy',
      pathPrefix,
      `conflict_policy 不支持 ${toSafeText(value)}，可选 overwrite/skip/fail/backup；merge 是已识别但未支持的保留值`,
      { ruleId, suggestion: 'backup' }
    )
    return
  }
  if (normalizeConflictPolicy(value) === 'merge') {
    pushDiagnostic(
      diagnostics,
      'error',
      MERGE_POLICY_NOT_SUPPORTED_CODE,
      pathPrefix,
      MERGE_POLICY_NOT_SUPPORTED_MESSAGE,
      { ruleId }
    )
  }
}
