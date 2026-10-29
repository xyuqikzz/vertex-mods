import path from 'path'
import {
  collectCandidateExeHints,
  hasMarkerConstraints,
  normalizeCandidateMarkers,
  normalizeGameRootDetectionRule,
  parseGameRootRuleJson,
  resolveRootFromExePath
} from './ruleKernel.js'

const DIRECTORY_SCAN_MAX_ENTRIES = 200000

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function isDirectoryEntry(entry = {}) {
  return typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDirectory === true
}

function isFileEntry(entry = {}) {
  return typeof entry.isFile === 'function' ? entry.isFile() : entry.isFile === true
}

function createDetectionRun(environment = {}) {
  const pathExistsCache = new Map()
  const directoryCache = new Map()
  const executableScanCache = new Map()
  let installedGamesPromise = null

  return {
    async pathExists(targetPath = '') {
      const safePath = toSafeText(targetPath)
      if (!safePath) return false
      if (!pathExistsCache.has(safePath)) {
        pathExistsCache.set(safePath, Promise.resolve(environment.pathExists(safePath)))
      }
      return (await pathExistsCache.get(safePath)) === true
    },
    async readDirectory(targetPath = '') {
      const safePath = toSafeText(targetPath)
      if (!directoryCache.has(safePath)) {
        const directoryPromise = Promise.resolve(environment.readDirectory(safePath)).catch(
          (error) => {
            directoryCache.delete(safePath)
            throw error
          }
        )
        directoryCache.set(safePath, directoryPromise)
      }
      return await directoryCache.get(safePath)
    },
    async listInstalledGames() {
      if (!installedGamesPromise) {
        installedGamesPromise = Promise.resolve(environment.listInstalledGames()).then((result) =>
          Array.isArray(result) ? result : []
        )
      }
      return await installedGamesPromise
    },
    async findExecutableByName(fileName = '') {
      const safeFileName = toSafeText(fileName)
      const cacheKey = safeFileName.toLowerCase()
      if (!executableScanCache.has(cacheKey)) {
        executableScanCache.set(
          cacheKey,
          Promise.resolve(environment.findExecutableByName(safeFileName)).then((result) =>
            toSafeText(result)
          )
        )
      }
      return await executableScanCache.get(cacheKey)
    }
  }
}

async function checkMarkerPaths(rootPath = '', markers = {}, run = {}) {
  const normalized = normalizeCandidateMarkers(markers)
  const resolveExists = async (relativePath = '') => {
    return await run.pathExists(path.join(rootPath, relativePath))
  }

  if (normalized.allPaths.length) {
    const allResults = await Promise.all(normalized.allPaths.map(resolveExists))
    if (allResults.some((matched) => matched !== true)) return false
  }
  if (normalized.nonePaths.length) {
    const noneResults = await Promise.all(normalized.nonePaths.map(resolveExists))
    if (noneResults.some((matched) => matched === true)) return false
  }
  if (normalized.anyPaths.length) {
    const anyResults = await Promise.all(normalized.anyPaths.map(resolveExists))
    return anyResults.some((matched) => matched === true)
  }
  return true
}

async function findExecutableInDirectory(rootPath = '', candidate = {}, run = {}) {
  if (!(await run.pathExists(rootPath))) return ''
  const hintSet = new Set(
    collectCandidateExeHints(candidate)
      .map((item) => item.toLowerCase())
      .filter((item) => item.endsWith('.exe'))
  )
  if (!hintSet.size) return ''

  const directoryQueue = [rootPath]
  let queueIndex = 0
  let visitedCount = 0
  while (queueIndex < directoryQueue.length) {
    const currentDirectory = directoryQueue[queueIndex]
    queueIndex += 1
    let entries = []
    try {
      entries = await run.readDirectory(currentDirectory)
    } catch {
      continue
    }

    for (const entry of Array.isArray(entries) ? entries : []) {
      visitedCount += 1
      if (visitedCount > DIRECTORY_SCAN_MAX_ENTRIES) return ''
      const fullPath = path.join(currentDirectory, toSafeText(entry?.name))
      if (isDirectoryEntry(entry)) {
        directoryQueue.push(fullPath)
      } else if (isFileEntry(entry) && hintSet.has(toSafeText(entry?.name).toLowerCase())) {
        return fullPath
      }
    }
  }
  return ''
}

async function tryMatchLocalGame(candidate = {}, run = {}) {
  const installedGames = await run.listInstalledGames()
  const exeHints = collectCandidateExeHints(candidate).map((item) => item.toLowerCase())
  for (const game of installedGames) {
    const exePath = toSafeText(game?.client_exe_path)
    if (!exePath || !(await run.pathExists(exePath))) continue
    if (exeHints.length && !exeHints.includes(path.basename(exePath).toLowerCase())) continue

    const rootPath = resolveRootFromExePath(exePath, candidate.rootFrom)
    if (!rootPath || !(await run.pathExists(rootPath))) continue
    if (!(await checkMarkerPaths(rootPath, candidate.markers, run))) continue
    return {
      rootPath,
      exePath,
      appId: toSafeNumber(game?.app_id, 0),
      gameId: toSafeNumber(game?.game_id, 0),
      source: 'local_game_list'
    }
  }
  return null
}

async function tryMatchPathMarkers(candidate = {}, run = {}) {
  if (!hasMarkerConstraints(candidate.markers)) return null
  const installedGames = await run.listInstalledGames()
  for (const game of installedGames) {
    const exePath = toSafeText(game?.client_exe_path)
    if (!exePath) continue
    const rootPath = resolveRootFromExePath(exePath, candidate.rootFrom)
    if (!rootPath || !(await run.pathExists(rootPath))) continue
    if (!(await checkMarkerPaths(rootPath, candidate.markers, run))) continue
    return {
      rootPath,
      exePath,
      appId: toSafeNumber(game?.app_id, 0),
      gameId: toSafeNumber(game?.game_id, 0),
      source: 'path_marker_local'
    }
  }
  return null
}

async function tryMatchRootHint(candidate = {}, run = {}) {
  for (const rootHint of Array.isArray(candidate.rootHints) ? candidate.rootHints : []) {
    if (!path.isAbsolute(rootHint)) continue
    const rootPath = path.resolve(rootHint)
    if (!(await run.pathExists(rootPath))) continue
    if (!(await checkMarkerPaths(rootPath, candidate.markers, run))) continue
    return {
      rootPath,
      exePath: await findExecutableInDirectory(rootPath, candidate, run),
      appId: 0,
      gameId: 0,
      source: 'root_hint'
    }
  }
  return null
}

async function tryMatchDriveScan(candidate = {}, run = {}) {
  const exeHints = collectCandidateExeHints(candidate).filter((item) =>
    item.toLowerCase().endsWith('.exe')
  )
  for (const exeName of exeHints) {
    const exePath = await run.findExecutableByName(exeName)
    if (!exePath) continue
    const rootPath = resolveRootFromExePath(exePath, candidate.rootFrom)
    if (!rootPath || !(await run.pathExists(rootPath))) continue
    if (!(await checkMarkerPaths(rootPath, candidate.markers, run))) continue
    return { rootPath, exePath, appId: 0, gameId: 0, source: 'drive_scan' }
  }
  return null
}

async function tryMatchSelectedDirectory(candidate = {}, selectedDirectory = '', run = {}) {
  if (hasMarkerConstraints(candidate.markers)) {
    if (await checkMarkerPaths(selectedDirectory, candidate.markers, run)) {
      return {
        rootPath: selectedDirectory,
        exePath: await findExecutableInDirectory(selectedDirectory, candidate, run),
        appId: 0,
        gameId: 0,
        source: 'manual_directory'
      }
    }
  }

  const exePath = await findExecutableInDirectory(selectedDirectory, candidate, run)
  if (!exePath) return null
  const rootPath = resolveRootFromExePath(exePath, candidate.rootFrom)
  if (!rootPath || !(await run.pathExists(rootPath))) return null
  if (!(await checkMarkerPaths(rootPath, candidate.markers, run))) return null
  return { rootPath, exePath, appId: 0, gameId: 0, source: 'manual_directory' }
}

function createMatchRecord(candidate = {}, matched = {}) {
  return {
    ...matched,
    candidateName: candidate.name,
    candidateType: candidate.type,
    confidence: toSafeNumber(candidate.confidence, 0)
  }
}

function selectBestMatch(matchRecords = []) {
  return [...matchRecords].sort((left, right) => right.confidence - left.confidence)[0]
}

function parseRuleAndCandidates(ruleJson) {
  const compiledRule = parseGameRootRuleJson(ruleJson, {
    onWarning(error) {
      console.warn('[INSTALL-RULE-DETECT] 规则 JSON 解析或编译失败', error)
    }
  })
  const normalized = normalizeGameRootDetectionRule(compiledRule, { profile: 'detection' })
  if (normalized.strategy === 'interactive') {
    console.warn('game_detect strategy=interactive 当前未实现，回退 highest_confidence', {
      strategy: normalized.strategy
    })
  }
  return normalized
}

export function createGameRootDetectionEngine(environment = {}) {
  const requiredMethods = [
    'pathExists',
    'readDirectory',
    'listInstalledGames',
    'findExecutableByName'
  ]
  for (const methodName of requiredMethods) {
    if (typeof environment[methodName] !== 'function') {
      throw new TypeError(`游戏根目录识别环境缺少方法: ${methodName}`)
    }
  }

  return {
    async detectGameRoot(payload = {}) {
      const { candidates, strategy } = parseRuleAndCandidates(payload?.ruleJson)
      if (!candidates.length) return { success: false, reason: 'no_candidates', strategy }
      const run = createDetectionRun(environment)
      const matchRecords = []
      for (const candidate of candidates) {
        let matched = null
        if (candidate.type === 'path_marker') {
          matched = await tryMatchPathMarkers(candidate, run)
        } else if (candidate.type === 'root_hint') {
          matched = await tryMatchRootHint(candidate, run)
        } else {
          if (candidate.type !== 'exe_search') {
            console.warn('未知 game_detect candidate.type，回退 exe_search', {
              type: candidate.type,
              candidateName: candidate.name
            })
          }
          matched = await tryMatchLocalGame(candidate, run)
          if (!matched) matched = await tryMatchDriveScan(candidate, run)
        }
        if (!matched) continue

        const record = createMatchRecord(candidate, matched)
        matchRecords.push(record)
        if (
          strategy === 'highest_confidence' ||
          strategy === 'first_match' ||
          strategy === 'most_specific' ||
          strategy === 'interactive'
        ) {
          return { success: true, strategy, ...record }
        }
      }

      if (!matchRecords.length) return { success: false, reason: 'not_found', strategy }
      return { success: true, strategy, ...selectBestMatch(matchRecords) }
    },

    async detectGameRootFromDirectory(payload = {}) {
      const selectedDirectory = toSafeText(payload?.selectedDirectory)
      const { candidates, strategy } = parseRuleAndCandidates(payload?.ruleJson)
      if (!selectedDirectory) return { success: false, reason: 'missing_directory', strategy }

      const run = createDetectionRun(environment)
      if (!(await run.pathExists(selectedDirectory))) {
        return { success: false, reason: 'directory_not_found', strategy }
      }
      if (!candidates.length) return { success: false, reason: 'no_candidates', strategy }

      const matchRecords = []
      for (const candidate of candidates) {
        const matched = await tryMatchSelectedDirectory(candidate, selectedDirectory, run)
        if (!matched) continue
        const record = createMatchRecord(candidate, matched)
        matchRecords.push(record)
        if (strategy === 'highest_confidence') {
          return { success: true, strategy, selectedDirectory, ...record }
        }
      }

      if (!matchRecords.length) {
        return { success: false, reason: 'not_found', strategy, selectedDirectory }
      }
      return {
        success: true,
        strategy,
        selectedDirectory,
        ...selectBestMatch(matchRecords)
      }
    }
  }
}
