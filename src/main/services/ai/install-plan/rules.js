// 安装规则编译与默认依赖读取。
import { normalizeAndCompileInstallRuleJson } from '../../../../shared/installation/install-rule-compiler.js'
import { isPlainObject, toPlainJson, toSafeText } from './values.js'

export function compileInstallRuleForAi(installRule = {}) {
  if (!isPlainObject(installRule) || !Object.keys(installRule).length) {
    return {}
  }

  try {
    return normalizeAndCompileInstallRuleJson(installRule)
  } catch {
    return toPlainJson(installRule, {})
  }
}

export function collectInstallRuleDefaultDependencies(installRule = {}) {
  const compiledRule = compileInstallRuleForAi(installRule)
  const setup = isPlainObject(compiledRule?.setup) ? compiledRule.setup : {}
  const setupDependencies = Array.isArray(setup.default_dependencies)
    ? setup.default_dependencies
    : Array.isArray(setup.defaultDependencies)
      ? setup.defaultDependencies
      : []
  const directDependencies = Array.isArray(compiledRule.default_dependencies)
    ? compiledRule.default_dependencies
    : Array.isArray(compiledRule.defaultDependencies)
      ? compiledRule.defaultDependencies
      : []
  const seen = new Set()
  const result = []

  for (const dependency of [...setupDependencies, ...directDependencies]) {
    if (!isPlainObject(dependency)) continue
    const provider = isPlainObject(dependency.provider) ? dependency.provider : {}
    const key = [
      dependency.id,
      dependency.name,
      dependency.source,
      provider.owner,
      provider.repo,
      provider.domainName || provider.domain_name,
      provider.modId || provider.mod_id,
      provider.fileId || provider.file_id,
      provider.assetName || provider.asset_name,
      provider.downloadUrl || provider.download_url
    ]
      .map((item) => toSafeText(item).toLowerCase())
      .filter(Boolean)
      .join(':')
    const dedupeKey = key || `default-dependency-${result.length}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push(toPlainJson(dependency, {}))
  }

  return result
}
