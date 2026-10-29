import { hasOwn, isPlainObject } from './compiler/compilerUtils.js'
import { normalizeInstallRuleJsonShape } from './compiler/shapeNormalizer.js'
import {
  compileDefaultDependencyList,
  compileGameDetectNode,
  compileInstallRuleContainer,
  extractRuleVariableMap,
  resolveRuleVariableMap
} from './compiler/variableExpander.js'
import { appendAutoRootDirMatchRule } from './compiler/autoRootDir.js'
import { expandInstallRuleTemplates } from './install-rule-declarations.js'

export { parseInstallRuleJsonText } from './compiler/shapeNormalizer.js'
export {
  CURRENT_RULE_SCHEMA_VERSION,
  detectRuleSchemaVersion,
  migrateInstallRuleSchema
} from './compiler/schemaMigrator.js'

export function compileInstallRuleObject(rawInstallRule = {}) {
  const source = expandInstallRuleTemplates(normalizeInstallRuleJsonShape(rawInstallRule))
  const rawVariableMap = extractRuleVariableMap(source)
  if (!rawVariableMap) {
    return appendAutoRootDirMatchRule(source, {})
  }

  const resolvedVariableMap = resolveRuleVariableMap(rawVariableMap)
  const compiledRule = compileInstallRuleContainer(source, resolvedVariableMap, ['install_rule'])
  const result = {
    ...compiledRule,
    variables: resolvedVariableMap
  }
  if (hasOwn(result, 'vars')) {
    delete result.vars
  }
  return appendAutoRootDirMatchRule(result, resolvedVariableMap)
}

export function compileInstallRuleJson(rawRuleJson = {}) {
  const normalizedRuleJson = expandInstallRuleTemplates(normalizeInstallRuleJsonShape(rawRuleJson))
  const rawVariableMap = extractRuleVariableMap(normalizedRuleJson)
  if (!rawVariableMap) {
    return normalizedRuleJson
  }

  const resolvedVariableMap = resolveRuleVariableMap(rawVariableMap)
  const compiledRuleJson = {
    ...normalizedRuleJson,
    variables: resolvedVariableMap
  }
  if (hasOwn(compiledRuleJson, 'vars')) {
    delete compiledRuleJson.vars
  }

  if (isPlainObject(compiledRuleJson.game_detect)) {
    compiledRuleJson.game_detect = compileGameDetectNode(
      compiledRuleJson.game_detect,
      resolvedVariableMap,
      ['game_detect']
    )
  }
  if (isPlainObject(compiledRuleJson.gameDetect)) {
    compiledRuleJson.gameDetect = compileGameDetectNode(
      compiledRuleJson.gameDetect,
      resolvedVariableMap,
      ['gameDetect']
    )
  }

  if (Array.isArray(compiledRuleJson.install_rules)) {
    compiledRuleJson.install_rules = compiledRuleJson.install_rules.map((item, index) =>
      compileInstallRuleContainer(item, resolvedVariableMap, ['install_rules', index])
    )
  }
  if (Array.isArray(compiledRuleJson.installRules)) {
    compiledRuleJson.installRules = compiledRuleJson.installRules.map((item, index) =>
      compileInstallRuleContainer(item, resolvedVariableMap, ['installRules', index])
    )
  }

  if (Array.isArray(compiledRuleJson.default_dependencies)) {
    compiledRuleJson.default_dependencies = compileDefaultDependencyList(
      compiledRuleJson.default_dependencies,
      resolvedVariableMap,
      ['default_dependencies']
    )
  }
  if (Array.isArray(compiledRuleJson.defaultDependencies)) {
    compiledRuleJson.defaultDependencies = compileDefaultDependencyList(
      compiledRuleJson.defaultDependencies,
      resolvedVariableMap,
      ['defaultDependencies']
    )
  }

  if (isPlainObject(compiledRuleJson.setup)) {
    const setupDefaultDependencies = Array.isArray(compiledRuleJson.setup.default_dependencies)
      ? compiledRuleJson.setup.default_dependencies
      : Array.isArray(compiledRuleJson.setup.defaultDependencies)
        ? compiledRuleJson.setup.defaultDependencies
        : null

    if (setupDefaultDependencies) {
      const compiledSetupDefaultDependencies = compileDefaultDependencyList(
        setupDefaultDependencies,
        resolvedVariableMap,
        ['setup', 'default_dependencies']
      )
      compiledRuleJson.setup = {
        ...compiledRuleJson.setup,
        default_dependencies: compiledSetupDefaultDependencies,
        ...(Array.isArray(compiledRuleJson.setup.defaultDependencies)
          ? { defaultDependencies: compiledSetupDefaultDependencies }
          : {})
      }
    }
  }

  return appendAutoRootDirMatchRule(compiledRuleJson, resolvedVariableMap)
}

export function normalizeAndCompileInstallRuleJson(rawRuleJson = {}) {
  return compileInstallRuleJson(normalizeInstallRuleJsonShape(rawRuleJson))
}
