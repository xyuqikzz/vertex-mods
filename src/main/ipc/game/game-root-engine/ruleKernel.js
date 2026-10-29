import path from 'path'
import {
  compileInstallRuleJson,
  parseInstallRuleJsonText
} from '../../../../shared/installation/install-rule-compiler.js'

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function toArrayValue(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function resolveFirstDefinedValue(...valueList) {
  for (const value of valueList) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function dedupeTextList(value = []) {
  const result = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    const text = toSafeText(item)
    if (text) result.add(text)
  }
  return [...result]
}

function normalizeRulePath(value = '') {
  return toSafeText(value).replace(/^['"]|['"]$/g, '')
}

function normalizeMarkerPathList(value = []) {
  return dedupeTextList(
    toArrayValue(value)
      .map((item) => normalizeRulePath(item))
      .filter(Boolean)
  )
}

export function parseGameRootRuleJson(rawRuleJson, options = {}) {
  try {
    const parsedRule =
      rawRuleJson && typeof rawRuleJson === 'object' && !Array.isArray(rawRuleJson)
        ? rawRuleJson
        : parseInstallRuleJsonText(toSafeText(rawRuleJson))

    if (!parsedRule || typeof parsedRule !== 'object' || Array.isArray(parsedRule)) {
      return {}
    }
    return options.compile === false ? parsedRule : compileInstallRuleJson(parsedRule)
  } catch (error) {
    if (typeof options.onWarning === 'function') {
      options.onWarning(error)
    }
    return {}
  }
}

export function normalizeCandidateMarkers(markers = {}) {
  const target = markers && typeof markers === 'object' ? markers : {}
  return {
    anyPaths: normalizeMarkerPathList([
      ...toArrayValue(resolveFirstDefinedValue(target.any_paths, target.anyPaths)),
      ...toArrayValue(resolveFirstDefinedValue(target.any_files, target.anyFiles)),
      ...toArrayValue(resolveFirstDefinedValue(target.any_dirs, target.anyDirs))
    ]),
    allPaths: normalizeMarkerPathList([
      ...toArrayValue(resolveFirstDefinedValue(target.all_paths, target.allPaths)),
      ...toArrayValue(resolveFirstDefinedValue(target.all_files, target.allFiles)),
      ...toArrayValue(resolveFirstDefinedValue(target.all_dirs, target.allDirs))
    ]),
    nonePaths: normalizeMarkerPathList([
      ...toArrayValue(resolveFirstDefinedValue(target.none_paths, target.nonePaths)),
      ...toArrayValue(resolveFirstDefinedValue(target.none_files, target.noneFiles)),
      ...toArrayValue(resolveFirstDefinedValue(target.none_dirs, target.noneDirs))
    ])
  }
}

export function hasMarkerConstraints(markers = {}) {
  const normalized = normalizeCandidateMarkers(markers)
  return (
    normalized.anyPaths.length > 0 ||
    normalized.allPaths.length > 0 ||
    normalized.nonePaths.length > 0
  )
}

export function normalizeCandidateRootFrom(rootFrom = {}) {
  const target = rootFrom && typeof rootFrom === 'object' ? rootFrom : {}
  return {
    type: toSafeText(
      resolveFirstDefinedValue(target.type, target.root_type, target.rootType),
      'exe_dir'
    ).toLowerCase(),
    up: Math.max(
      toSafeNumber(resolveFirstDefinedValue(target.up, target.levels_up, target.levelsUp), 0),
      0
    )
  }
}

function getCandidateSpecificity(candidate = {}) {
  const markers = normalizeCandidateMarkers(candidate.markers)
  return markers.allPaths.length + markers.anyPaths.length + markers.nonePaths.length
}

function orderCandidates(candidates = [], strategy = '', profile = 'detection') {
  const ordered = [...candidates]
  if (strategy === 'highest_confidence') {
    ordered.sort((left, right) => right.confidence - left.confidence)
  } else if (profile === 'detection' && strategy === 'most_specific') {
    ordered.sort((left, right) => getCandidateSpecificity(right) - getCandidateSpecificity(left))
  } else if (profile === 'detection' && strategy === 'interactive') {
    ordered.sort((left, right) => right.confidence - left.confidence)
  }
  return ordered
}

export function normalizeGameRootDetectionRule(ruleJson = {}, options = {}) {
  const source = ruleJson && typeof ruleJson === 'object' ? ruleJson : {}
  const gameDetect =
    source.game_detect && typeof source.game_detect === 'object'
      ? source.game_detect
      : source.gameDetect && typeof source.gameDetect === 'object'
        ? source.gameDetect
        : {}
  const candidateList = Array.isArray(gameDetect.candidates)
    ? gameDetect.candidates
    : Array.isArray(gameDetect.candidate_list)
      ? gameDetect.candidate_list
      : Array.isArray(gameDetect.candidateList)
        ? gameDetect.candidateList
        : []
  const selectConfig =
    gameDetect.select && typeof gameDetect.select === 'object'
      ? gameDetect.select
      : gameDetect.selector && typeof gameDetect.selector === 'object'
        ? gameDetect.selector
        : {}
  const rawStrategy = toSafeText(
    resolveFirstDefinedValue(selectConfig.strategy, gameDetect.strategy),
    'highest_confidence'
  )
  const strategy = options.profile === 'known' ? rawStrategy.toLowerCase() : rawStrategy
  const candidates = candidateList
    .map((item, index) => {
      const target = item && typeof item === 'object' ? item : {}
      return {
        index,
        name: toSafeText(target.name, `candidate_${index + 1}`),
        type: toSafeText(target.type, 'exe_search').toLowerCase(),
        confidence:
          options.profile === 'known'
            ? Number(target.confidence || 0)
            : toSafeNumber(target.confidence, 0),
        markers: normalizeCandidateMarkers(target.markers),
        exeGlobs: dedupeTextList(
          toArrayValue(resolveFirstDefinedValue(target.exe_globs, target.exeGlobs))
        ),
        rootHints: dedupeTextList(
          toArrayValue(
            resolveFirstDefinedValue(
              target.root_hints,
              target.rootHints,
              target.search_roots,
              target.searchRoots
            )
          )
        ),
        rootFrom: normalizeCandidateRootFrom(
          resolveFirstDefinedValue(target.root_from, target.rootFrom)
        )
      }
    })
    .filter((item) => !!item.type)

  return {
    strategy,
    candidates: orderCandidates(candidates, strategy, options.profile || 'detection')
  }
}

function extractFileNameFromRulePath(value = '') {
  const normalizedPath = toSafeText(value).replace(/\\/g, '/')
  if (!normalizedPath) return ''
  const fileName = normalizedPath.split('/').pop() || ''
  if (!fileName || fileName.includes('*') || fileName.includes('?')) return ''
  return normalizeRulePath(fileName)
}

export function collectCandidateExeHints(candidate = {}) {
  const markers = normalizeCandidateMarkers(candidate.markers)
  const markerHints = [...markers.anyPaths, ...markers.allPaths]
    .map((item) => extractFileNameFromRulePath(item))
    .filter((item) => item.toLowerCase().endsWith('.exe'))
  const globHints = (Array.isArray(candidate.exeGlobs) ? candidate.exeGlobs : [])
    .map((item) => extractFileNameFromRulePath(item))
    .filter(Boolean)
  return dedupeTextList([...markerHints, ...globHints])
}

export function resolveRootFromExePath(exePath = '', rootFrom = {}) {
  const safeExePath = toSafeText(exePath)
  if (!safeExePath) return ''

  const normalizedRootFrom = normalizeCandidateRootFrom(rootFrom)
  let currentPath = normalizedRootFrom.type === 'exe_dir' ? path.dirname(safeExePath) : safeExePath
  for (let index = 0; index < normalizedRootFrom.up; index += 1) {
    const parentPath = path.dirname(currentPath)
    if (!parentPath || parentPath === currentPath) break
    currentPath = parentPath
  }
  return toSafeText(currentPath)
}

export function resolveKnownGameRoot(payload = {}) {
  const exePath = toSafeText(payload.exePath)
  const storedRootPath = toSafeText(payload.storedRootPath)
  const ruleJson = parseGameRootRuleJson(payload.ruleJson, { compile: false })
  const { candidates } = normalizeGameRootDetectionRule(ruleJson, { profile: 'known' })
  let matchedCandidate = null

  if (exePath && candidates.length) {
    const exeName = path.basename(exePath).toLowerCase()
    matchedCandidate =
      candidates.find((item) =>
        collectCandidateExeHints(item)
          .map((hint) => hint.toLowerCase())
          .includes(exeName)
      ) ||
      candidates.find((item) => collectCandidateExeHints(item).length === 0) ||
      candidates[0]
  }

  const ruleRootPath = matchedCandidate
    ? resolveRootFromExePath(exePath, matchedCandidate.rootFrom)
    : ''
  const useExeParentFallback = payload.useExeParentFallback !== false
  const exeParentPath = useExeParentFallback && exePath ? path.dirname(exePath) : ''
  const rootPath = ruleRootPath || storedRootPath || exeParentPath
  const source = ruleRootPath
    ? 'rule'
    : storedRootPath
      ? 'stored'
      : exeParentPath
        ? 'exe_parent'
        : ''

  return {
    rootPath: rootPath ? path.resolve(rootPath) : '',
    source,
    candidateName: ruleRootPath ? matchedCandidate?.name || '' : '',
    candidateType: ruleRootPath ? matchedCandidate?.type || '' : '',
    confidence: ruleRootPath ? toSafeNumber(matchedCandidate?.confidence, 0) : 0
  }
}
