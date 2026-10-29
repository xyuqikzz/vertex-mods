import {
  createEmptyDependencyResult,
  isPlainObject,
  normalizeTextList,
  resolveFirstDefinedValue,
  toArrayValue,
  toSafeText
} from './contracts.js'

function normalizeVersion(value = '') {
  const rawVersion = toSafeText(value)
    .replace(/^v/i, '')
    .split('+')[0]
  const prereleaseIndex = rawVersion.indexOf('-')
  const mainVersion = prereleaseIndex >= 0 ? rawVersion.slice(0, prereleaseIndex) : rawVersion
  const prerelease = prereleaseIndex >= 0 ? rawVersion.slice(prereleaseIndex + 1) : ''
  return {
    main: mainVersion
      .split('.')
      .map((item) => Number(item))
      .map((item) => (Number.isFinite(item) ? item : 0)),
    prerelease: prerelease
      ? prerelease.split('.').map((item) => (/^\d+$/.test(item) ? Number(item) : item.toLowerCase()))
      : []
  }
}

function comparePrereleaseIdentifier(left, right) {
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  const leftNumeric = typeof left === 'number'
  const rightNumeric = typeof right === 'number'
  if (leftNumeric && rightNumeric) return left > right ? 1 : -1
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return String(left) > String(right) ? 1 : -1
}

function compareVersion(left = '', right = '') {
  const leftVersion = normalizeVersion(left)
  const rightVersion = normalizeVersion(right)
  const maxLength = Math.max(leftVersion.main.length, rightVersion.main.length)
  for (let index = 0; index < maxLength; index += 1) {
    const gap = (leftVersion.main[index] || 0) - (rightVersion.main[index] || 0)
    if (gap !== 0) return gap > 0 ? 1 : -1
  }
  if (!leftVersion.prerelease.length && !rightVersion.prerelease.length) return 0
  if (!leftVersion.prerelease.length) return 1
  if (!rightVersion.prerelease.length) return -1

  const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const compared = comparePrereleaseIdentifier(
      leftVersion.prerelease[index],
      rightVersion.prerelease[index]
    )
    if (compared !== 0) return compared
  }
  return 0
}

function matchVersionRange(version = '', range = '') {
  const safeRange = toSafeText(range)
  const safeVersion = toSafeText(version)
  if (!safeRange) return true
  if (!safeVersion) return false
  if (safeRange === '*') return true
  const match = safeRange.match(/^(>=|<=|>|<|=|\^|~)?\s*(.+)$/)
  if (!match) return true
  const operator = match[1] || '='
  const targetVersion = match[2]
  const numericVersion = /^v?\d+(?:\.\d+){0,7}(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/i
  if (!numericVersion.test(safeVersion) || !numericVersion.test(targetVersion)) {
    return operator === '=' && safeVersion === targetVersion
  }
  const compared = compareVersion(safeVersion, targetVersion)
  if (operator === '>=') return compared >= 0
  if (operator === '<=') return compared <= 0
  if (operator === '>') return compared > 0
  if (operator === '<') return compared < 0
  // O6：^ 和 ~ 正确实现上界（semver 规范）。
  // ^1.5.0 → >=1.5.0 <2.0.0；^0.5.0 → >=0.5.0 <0.6.0（0.x 特殊：锁定 minor）。
  // ~1.5.0 → >=1.5.0 <1.6.0（锁定 patch 递增）。
  if (operator === '^') {
    if (compared < 0) return false
    const targetMain = parseVersionMain(targetVersion)
    const [major, minor] = targetMain
    const upperBound =
      major === 0
        ? minor === 0 ? `0.0.${(targetMain[2] || 0) + 1}` : `${major}.${minor + 1}.0`
        : `${(major || 0) + 1}.0.0`
    return compareVersion(safeVersion, upperBound) < 0
  }
  if (operator === '~') {
    if (compared < 0) return false
    const targetMain = parseVersionMain(targetVersion)
    const [major, minor] = targetMain
    const upperBound = `${major || 0}.${(minor || 0) + 1}.0`
    return compareVersion(safeVersion, upperBound) < 0
  }
  return compared === 0
}

// O6：解析版本的主版本号数组 [major, minor, patch]，忽略 prerelease。
function parseVersionMain(version = '') {
  const normalized = normalizeVersion(version)
  return [
    Number(normalized.main[0] || 0),
    Number(normalized.main[1] || 0),
    Number(normalized.main[2] || 0)
  ]
}

function normalizeDependency(item = {}, defaultKind = 'required') {
  if (!isPlainObject(item)) {
    const name = toSafeText(item)
    return name ? { id: name, name, kind: defaultKind, optional: defaultKind === 'optional' } : null
  }
  const name = toSafeText(resolveFirstDefinedValue(item.name, item.id, item.modId, item.key))
  if (!name) return null
  const rawKind = toSafeText(
    resolveFirstDefinedValue(item.kind, item.type, item.dependencyRole, item.dependency_role)
  ).toLowerCase()
  const kind =
    rawKind === 'optional' || item.optional === true
      ? 'optional'
      : rawKind === 'conflict' || rawKind === 'incompatible' || item.incompatible === true
        ? 'conflict'
        : defaultKind
  const versionRange = toSafeText(
    resolveFirstDefinedValue(item.versionRange, item.version_range, item.range, item.version)
  )
  return {
    ...item,
    id: toSafeText(item.id || item.key || name),
    name,
    kind,
    optional: kind === 'optional',
    versionRange,
    hasVersionRange: !!versionRange
  }
}

function collectDependencies(plan = {}, context = {}) {
  const rule = isPlainObject(context.rule) ? context.rule : {}
  const required = [
    ...toArrayValue(plan.dependencies),
    ...toArrayValue(rule.dependencies),
    ...toArrayValue(rule.requires),
    ...toArrayValue(rule.required)
  ].map((item) => normalizeDependency(item, 'required'))
  const optional = [
    ...toArrayValue(rule.optionalDependencies),
    ...toArrayValue(rule.optional_dependencies),
    ...toArrayValue(rule.optional)
  ].map((item) => normalizeDependency(item, 'optional'))
  const conflicts = [
    ...toArrayValue(rule.conflicts),
    ...toArrayValue(rule.incompatible),
    ...toArrayValue(rule.incompatibles)
  ].map((item) => normalizeDependency(item, 'conflict'))

  return [...required, ...optional, ...conflicts].filter(Boolean)
}

function buildInstalledIndex(context = {}) {
  const records = [
    ...toArrayValue(context.installed),
    ...toArrayValue(context.installedMods),
    ...toArrayValue(context.queue),
    ...toArrayValue(context.queuedItems),
    ...toArrayValue(context.installedCapabilities?.records)
  ]
  const provides = [
    ...normalizeTextList(context.provides),
    ...normalizeTextList(context.packageProfile?.provides),
    ...normalizeTextList(context.installedCapabilities?.provides)
  ]
  const index = new Map()

  for (const name of provides) {
    index.set(name.toLowerCase(), { name, version: '' })
  }

  for (const record of records) {
    if (!isPlainObject(record)) continue
    const names = normalizeTextList([
      record.id,
      record.key,
      record.name,
      record.modName,
      record.sourceModKey,
      record.source_mod_key
    ])
    for (const name of names) {
      index.set(name.toLowerCase(), {
        name,
        version: toSafeText(record.version || record.modVersion || record.mod_version)
      })
    }
  }

  return index
}

function isDependencySatisfied(dependency = {}, installedIndex = new Map()) {
  if (Array.isArray(dependency.alternatives) && dependency.alternatives.some((id) => {
    const alternative = installedIndex.get(toSafeText(id).toLowerCase())
    return alternative && matchVersionRange(alternative.version, dependency.versionRange)
  })) return true
  const record =
    installedIndex.get(toSafeText(dependency.id).toLowerCase()) ||
    installedIndex.get(toSafeText(dependency.name).toLowerCase())
  if (!record) return false
  return matchVersionRange(record.version, dependency.versionRange)
}

export function solveInstallDependencies(plan = {}, context = {}) {
  const dependencies = collectDependencies(plan, context)
  const installedIndex = buildInstalledIndex(context)
  const required = dependencies.filter((item) => item.kind === 'required')
  const optional = dependencies.filter((item) => item.kind === 'optional')
  const conflictRules = dependencies.filter((item) => item.kind === 'conflict')
  const missing = required.filter((item) => !isDependencySatisfied(item, installedIndex))
  const conflicts = conflictRules.filter((item) => isDependencySatisfied(item, installedIndex))
  const waiting = optional.filter((item) => !isDependencySatisfied(item, installedIndex))
  const installOrder = [
    ...required.filter((item) => !missing.includes(item)).map((item) => item.name),
    toSafeText(plan.packageProfile?.name || plan.ruleId || plan.packageType || 'current')
  ].filter(Boolean)

  return createEmptyDependencyResult({
    status:
      missing.length || conflicts.length ? 'blocked' : waiting.length ? 'warning' : 'resolved',
    required,
    optional,
    conflicts,
    missing,
    waiting,
    provides: normalizeTextList(plan.packageProfile?.provides),
    installOrder,
    loadOrderHints: normalizeTextList(context.loadOrderHints || plan.packageProfile?.loadOrderHints)
  })
}
