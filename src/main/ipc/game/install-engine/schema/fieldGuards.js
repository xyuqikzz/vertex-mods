import { pushDiagnostic } from './diagnostics.js'

export const TYPO_SUGGESTIONS = {
  mathc: 'match',
  matchs: 'match',
  macth: 'match',
  soruce: 'source',
  soucre: 'source',
  traget: 'target',
  targe: 'target',
  route: 'routes'
}

export function validateUnknownFields(
  payload = {},
  allowedFields = new Set(),
  pathPrefix = '',
  diagnostics = [],
  ruleId = ''
) {
  for (const key of Object.keys(payload)) {
    if (allowedFields.has(key)) continue
    const suggestion = TYPO_SUGGESTIONS[key]
    pushDiagnostic(
      diagnostics,
      suggestion ? 'error' : 'warning',
      suggestion ? 'field_typo' : 'unknown_field',
      pathPrefix ? `${pathPrefix}.${key}` : key,
      suggestion
        ? `字段 ${key} 可能是拼写错误，推荐使用 ${suggestion}`
        : `未知字段 ${key} 将按兼容策略保留`,
      { ruleId, suggestion }
    )
  }
}
