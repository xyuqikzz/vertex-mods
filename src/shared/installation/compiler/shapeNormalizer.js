import { isPlainObject } from './compilerUtils.js'

export function parseInstallRuleJsonText(text = '') {
  const rawText = String(text || '').trim()
  if (!rawText) return {}

  try {
    const parsed = JSON.parse(rawText)
    if (isPlainObject(parsed)) {
      return parsed
    }
  } catch {
    return {}
  }

  return {}
}

export function normalizeInstallRuleJsonShape(rawRuleJson = {}) {
  const source = isPlainObject(rawRuleJson) ? rawRuleJson : {}
  const gameDetect = isPlainObject(source.game_detect)
    ? source.game_detect
    : isPlainObject(source.gameDetect)
      ? source.gameDetect
      : null
  const variables = isPlainObject(source.variables)
    ? source.variables
    : isPlainObject(source.vars)
      ? source.vars
      : null
  const setup = isPlainObject(source.setup) ? source.setup : {}
  const setupDefaultDependencies = Array.isArray(setup.default_dependencies)
    ? setup.default_dependencies
    : Array.isArray(setup.defaultDependencies)
      ? setup.defaultDependencies
      : null
  const installRules = Array.isArray(source.install_rules)
    ? source.install_rules
    : Array.isArray(source.installRules)
      ? source.installRules
      : null
  const defaultDependencies = Array.isArray(source.default_dependencies)
    ? source.default_dependencies
    : Array.isArray(source.defaultDependencies)
      ? source.defaultDependencies
      : null

  const result = {
    ...source,
    ...(variables ? { variables } : {}),
    ...(gameDetect ? { game_detect: gameDetect } : {}),
    ...(installRules ? { install_rules: installRules } : {}),
    ...(defaultDependencies ? { default_dependencies: defaultDependencies } : {}),
    ...(Object.keys(setup).length
      ? {
          setup: {
            ...setup,
            ...(setupDefaultDependencies ? { default_dependencies: setupDefaultDependencies } : {})
          }
        }
      : {}),
    ...(source.schema_version !== undefined
      ? { schema_version: source.schema_version }
      : source.schemaVersion !== undefined
        ? { schema_version: source.schemaVersion }
        : {})
  }

  delete result.rules_v2
  delete result.rulesV2
  delete result.rules_v3
  delete result.rulesV3
  return result
}
