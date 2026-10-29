import { isPlainObject } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { validateUnknownFields } from './fieldGuards.js'
import { validateMatch } from './matchSchema.js'
import { validateSource } from './sourceSchema.js'
import { validateTarget } from './targetSchema.js'
import { validateConflictPolicy } from './conflictPolicySchema.js'

const ROUTE_FIELDS = new Set([
  'id',
  'routeId',
  'name',
  'description',
  'when',
  'match',
  'source',
  'target',
  'mapping',
  'group',
  'conflict_policy',
  'conflictPolicy',
  'health_expectations',
  'healthExpectations'
])

const MAPPING_FIELDS = new Set([
  'case_sensitive',
  'caseSensitive',
  'replace_prefix',
  'replacePrefix',
  'replace_prefix_from',
  'replacePrefixFrom',
  'replace_prefix_to',
  'replacePrefixTo',
  'strip_prefix',
  'stripPrefix',
  'flatten',
  'preserve_container',
  'preserveContainer',
  'append_package_dir',
  'appendPackageDir',
  'description',
  'name'
])

const GROUP_FIELDS = new Set([
  'type',
  'kind',
  'require_siblings',
  'requireSiblings',
  'members',
  'patterns',
  'extensions',
  'primary',
  'description',
  'name'
])

// E4：校验 route.mapping 结构（对象或对象数组）。
export function validateMapping(mapping, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (mapping === undefined || mapping === null) return
  if (Array.isArray(mapping)) {
    mapping.forEach((item, index) =>
      validateMapping(item, `${pathPrefix}[${index}]`, diagnostics, ruleId)
    )
    return
  }
  if (!isPlainObject(mapping)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_mapping_type', pathPrefix, 'mapping 必须是对象或对象数组', { ruleId })
    return
  }
  validateUnknownFields(mapping, MAPPING_FIELDS, pathPrefix, diagnostics, ruleId)
}

// E4：校验 route.group 结构。
export function validateGroup(group, pathPrefix = '', diagnostics = [], ruleId = '') {
  if (group === undefined || group === null) return
  if (!isPlainObject(group)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_group_type', pathPrefix, 'group 必须是对象', { ruleId })
    return
  }
  validateUnknownFields(group, GROUP_FIELDS, pathPrefix, diagnostics, ruleId)
}

export function validateRoute(
  route = {},
  pathPrefix = '',
  diagnostics = [],
  ruleId = '',
  schemaVersion = 4
) {
  if (!isPlainObject(route)) {
    pushDiagnostic(diagnostics, 'error', 'invalid_route_type', pathPrefix, 'routes 项必须是对象', {
      ruleId
    })
    return
  }
  validateUnknownFields(route, ROUTE_FIELDS, pathPrefix, diagnostics, ruleId)
  if (route.when !== undefined) validateMatch(route.when, `${pathPrefix}.when`, diagnostics, ruleId, schemaVersion)
  if (route.match !== undefined)
    validateMatch(route.match, `${pathPrefix}.match`, diagnostics, ruleId, schemaVersion)
  if (route.source !== undefined)
    validateSource(route.source, `${pathPrefix}.source`, diagnostics, ruleId)
  if (route.target !== undefined)
    validateTarget(route.target, `${pathPrefix}.target`, diagnostics, ruleId, { route: true })
  if (route.mapping !== undefined)
    validateMapping(route.mapping, `${pathPrefix}.mapping`, diagnostics, ruleId)
  if (route.group !== undefined)
    validateGroup(route.group, `${pathPrefix}.group`, diagnostics, ruleId)
  validateConflictPolicy(
    route.conflict_policy ?? route.conflictPolicy,
    `${pathPrefix}.conflict_policy`,
    diagnostics,
    ruleId
  )
}
