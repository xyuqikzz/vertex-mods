import { nativeText } from '../../services/uiLanguage.js'
import { replaceThunderstoreFiles, withThunderstoreProfileMutation } from '../../services/thunderstoreUpdateTransaction.js'
import { assertThunderstoreChild } from '../../services/thunderstoreFileSafety.js'
import path from 'path'
import fs from 'fs-extra'
import axios from 'axios'
import AdmZip from 'adm-zip'
import crypto from 'crypto'
import { execSync, spawn } from 'child_process'
import { dialog, shell } from 'electron'
import { getGameDataByAppId } from '../../db/games/game.js'
import { findFileParallel, getSteamAppInfo } from './tool.js'
import {
  getThunderstoreProfile,
  getThunderstoreInstalledRecord,
  listThunderstoreInstalledMods,
  getThunderstoreInstalledMap,
  removeAllThunderstoreInstalledModsByProfile,
  removeThunderstoreProfile,
  removeThunderstoreInstalledMod,
  upsertThunderstoreInstalledMod,
  upsertThunderstoreProfile,
  updateThunderstoreInstalledModState
} from '../../db/sources/thunderstore.js'
import { buildOccupiedFilesMessage, inspectFileOccupancy } from '../../utils/fileOccupancy.js'
import { normalizeGameSourceMeta, upsertGameRecord } from '../../db/games/gameRecord.js'
import { createSourceProfilePathId } from './sourceProfilePath.js'
import { getConfiguredThunderstoreStoragePaths } from '../../services/profiles/thunderstoreStorage.js'
import {
  getThunderstoreEcosystemStatus as readThunderstoreEcosystemStatus,
  loadThunderstoreEcosystem
} from './thunderstore-ecosystem/index.js'

const THUNDERSTORE_BASE_URL = 'https://thunderstore.io'
const THUNDERSTORE_PACKAGE_LIST_CACHE_TTL_MS = 1000 * 60 * 10
const THUNDERSTORE_HTTP_HEADERS = {
  // 兼容部分 CDN/边缘节点对默认 axios UA 的风控策略
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vertex/1.0 Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*'
}
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT'
])
const RETRYABLE_NETWORK_MESSAGES = [
  'aborted',
  'socket hang up',
  'network error',
  'timeout',
  'timed out',
  'connection reset'
]
const RETRYABLE_FILE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

const SKIP_ROOT_FILES = new Set([
  'manifest.json',
  'readme.md',
  'readme.txt',
  'changelog.md',
  'changelog.txt',
  'icon.png',
  'license',
  'license.txt',
  'licence',
  'licence.txt'
])
const PROFILE_ROOT_LEVEL_FILES = new Set([
  'doorstop_config.ini',
  'winhttp.dll',
  'winmm.dll',
  'version.dll',
  'libdoorstop_x64.dll',
  'libdoorstop_x86.dll',
  'start_game_bepinex.sh',
  'run_bepinex.sh'
])

const KNOWN_INSTALL_ROOT_DIRS = new Set([
  'bepinex',
  'bepinex_server',
  'plugins',
  'mods',
  'melonloader',
  'userdata',
  'config',
  'doorstop_libs',
  'northstar',
  'gdweave',
  'shimloader',
  'umm',
  'rivet',
  'qmods'
])
const thunderstorePackageListCache = new Map()

function normalizeZipPath(value = '') {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
  return normalized.replace(/\/+$/g, '')
}

function joinZipPath(...parts) {
  const list = parts.map((item) => normalizeZipPath(item)).filter(Boolean)
  if (!list.length) {
    return ''
  }
  return normalizeZipPath(list.join('/'))
}

export async function thunderstoreGetEcosystem(payload = {}) {
  return await loadThunderstoreEcosystem(payload?.forceRefresh === true)
}

export function thunderstoreGetEcosystemStatus() {
  return readThunderstoreEcosystemStatus()
}

function normalizeCommunity(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function normalizeFullName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeFsName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
}

function normalizeLoader(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()

  if (!raw) {
    return ''
  }
  if (raw.includes('bepinex')) {
    return 'bepinex'
  }
  if (raw.includes('northstar')) {
    return 'northstar'
  }
  if (raw.includes('melonloader')) {
    return 'melonloader'
  }
  if (raw.includes('lovely')) {
    return 'lovely'
  }
  if (raw.includes('gdweave')) {
    return 'gdweave'
  }
  if (raw.includes('shimloader')) {
    return 'shimloader'
  }
  if (raw.includes('godot')) {
    return 'godotml'
  }
  if (raw.includes('return-of-modding')) {
    return 'return-of-modding'
  }
  if (raw.includes('umm')) {
    return 'umm'
  }
  if (raw.includes('bepis')) {
    return 'bepisloader'
  }

  return raw
}

function buildFallbackDefaultInstallRule(packageLoader = '') {
  const loader = normalizeLoader(packageLoader)

  let route = 'BepInEx/plugins'
  if (loader === 'melonloader' || loader === 'umm') {
    route = 'Mods'
  } else if (loader === 'northstar' || loader === 'shimloader' || loader === 'godotml') {
    route = 'mods'
  } else if (loader === 'lovely') {
    route = 'mods'
  } else if (loader === 'gdweave') {
    route = 'GDWeave/mods'
  } else if (loader === 'return-of-modding') {
    route = 'returnofmodding'
  }

  return {
    route,
    fullRoute: route,
    defaultFileExtensions: [],
    trackingMethod: 'state',
    isDefaultLocation: true,
    depth: String(route || '')
      .split('/')
      .filter(Boolean).length
  }
}

function flattenInstallRules(rules = [], parentRoute = '') {
  const result = []
  for (const rule of Array.isArray(rules) ? rules : []) {
    const route = normalizeZipPath(rule?.route || '')
    if (!route) {
      continue
    }

    const fullRoute = joinZipPath(parentRoute, route)
    const extensions = Array.isArray(rule?.defaultFileExtensions)
      ? Array.from(
          new Set(
            rule.defaultFileExtensions
              .map((item) =>
                String(item || '')
                  .trim()
                  .toLowerCase()
              )
              .filter(Boolean)
          )
        ).sort((a, b) => b.length - a.length)
      : []

    result.push({
      route,
      fullRoute,
      defaultFileExtensions: extensions,
      trackingMethod: String(rule?.trackingMethod || '')
        .trim()
        .toLowerCase(),
      isDefaultLocation: rule?.isDefaultLocation === true,
      depth: fullRoute.split('/').filter(Boolean).length
    })

    result.push(...flattenInstallRules(rule?.subRoutes, fullRoute))
  }

  return result
}

function getDefaultInstallRule(flatRules = [], packageLoader = '') {
  if (Array.isArray(flatRules) && flatRules.length) {
    const preferred = flatRules.find((item) => item?.isDefaultLocation)
    if (preferred) {
      return preferred
    }
    return flatRules[0]
  }

  return buildFallbackDefaultInstallRule(packageLoader)
}

function normalizePackageIndexForCompare(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function matchesCommunityPackageIndex(packageIndex = '', community = '') {
  const normalizedCommunity = normalizeCommunity(community)
  const needle = `/c/${normalizedCommunity}/api/v1/package-listing-index/`
  return normalizePackageIndexForCompare(packageIndex).includes(needle)
}

async function resolveThunderstoreInstallRuleContext(community = '', packageLoader = '') {
  const normalizedCommunity = normalizeCommunity(community)
  const fallbackLoader = normalizeLoader(packageLoader)

  if (!normalizedCommunity) {
    return {
      community: '',
      gameKey: '',
      packageLoader: fallbackLoader,
      installRules: [],
      flatRules: [],
      defaultRule: getDefaultInstallRule([], fallbackLoader),
      modloaderPackages: []
    }
  }

  try {
    const ecosystem = await loadThunderstoreEcosystem()
    const games = ecosystem?.games || {}

    for (const [gameKey, gameItem] of Object.entries(games)) {
      const variants = Array.isArray(gameItem?.r2modman) ? gameItem.r2modman : []
      const matchedVariant = variants.find((variant) =>
        matchesCommunityPackageIndex(variant?.packageIndex, normalizedCommunity)
      )
      if (!matchedVariant) {
        continue
      }

      const resolvedLoader = normalizeLoader(matchedVariant?.packageLoader || fallbackLoader)
      const flatRules = flattenInstallRules(matchedVariant?.installRules)

      return {
        community: normalizedCommunity,
        gameKey,
        packageLoader: resolvedLoader || fallbackLoader,
        installRules: Array.isArray(matchedVariant?.installRules)
          ? matchedVariant.installRules
          : [],
        flatRules,
        defaultRule: getDefaultInstallRule(flatRules, resolvedLoader || fallbackLoader),
        modloaderPackages: Array.isArray(ecosystem?.modloaderPackages)
          ? ecosystem.modloaderPackages
          : []
      }
    }
  } catch (error) {
    console.warn('[thunderstore] 解析社区安装规则失败，回退默认路径策略', error)
  }

  return {
    community: normalizedCommunity,
    gameKey: '',
    packageLoader: fallbackLoader,
    installRules: [],
    flatRules: [],
    defaultRule: getDefaultInstallRule([], fallbackLoader),
    modloaderPackages: []
  }
}

function findModloaderPackageEntry(modloaderPackages = [], packageFullName = '') {
  const normalizedFullName = normalizeFullName(packageFullName)
  if (!normalizedFullName) {
    return null
  }

  return (
    (Array.isArray(modloaderPackages) ? modloaderPackages : []).find(
      (item) =>
        normalizeFullName(
          item?.packageId || item?.packageID || item?.package_id || item?.fullName || ''
        ) === normalizedFullName
    ) || null
  )
}

function getModloaderPackageLoader(entry = {}) {
  return normalizeLoader(entry?.loader || entry?.packageLoader || entry?.package_loader || '')
}

function parseThunderstoreSemver(version = '') {
  const raw = String(version || '').trim()
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[\w.-]+)?$/)
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function comparePrereleaseIdentifiers(left = '', right = '') {
  const leftText = String(left || '')
  const rightText = String(right || '')
  const leftNumeric = /^\d+$/.test(leftText)
  const rightNumeric = /^\d+$/.test(rightText)

  if (leftNumeric && rightNumeric) {
    return Number(leftText) - Number(rightText)
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1
  }
  return leftText.localeCompare(rightText)
}

function compareThunderstoreSemver(leftVersion = '', rightVersion = '') {
  const left = parseThunderstoreSemver(leftVersion)
  const right = parseThunderstoreSemver(rightVersion)
  if (!left || !right) {
    return null
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] - right[key]
    }
  }

  if (!left.prerelease.length && !right.prerelease.length) {
    return 0
  }
  if (!left.prerelease.length) {
    return 1
  }
  if (!right.prerelease.length) {
    return -1
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < maxLength; i += 1) {
    if (left.prerelease[i] === undefined) {
      return -1
    }
    if (right.prerelease[i] === undefined) {
      return 1
    }
    const result = comparePrereleaseIdentifiers(left.prerelease[i], right.prerelease[i])
    if (result !== 0) {
      return result
    }
  }

  return 0
}

function canReuseInstalledDependency(installedRecord = null, requiredVersion = '') {
  if (!installedRecord || typeof installedRecord !== 'object') {
    return false
  }

  const installedVersion = String(installedRecord?.version || '').trim()
  if (!installedVersion) {
    return false
  }

  const expectedVersion = String(requiredVersion || '').trim()
  if (!expectedVersion) {
    return true
  }

  const compareResult = compareThunderstoreSemver(installedVersion, expectedVersion)
  if (compareResult === null) {
    return installedVersion === expectedVersion
  }

  return compareResult >= 0
}

function resolveEquivalentModloaderPackage(packageMap, packageFullName = '', options = {}) {
  const modloaderPackages = Array.isArray(options?.modloaderPackages)
    ? options.modloaderPackages
    : []
  const installedLookup = options?.installedLookup instanceof Map ? options.installedLookup : null
  const plannedLookup = options?.plannedLookup instanceof Map ? options.plannedLookup : null
  const sourceEntry = findModloaderPackageEntry(modloaderPackages, packageFullName)
  const sourceLoader = getModloaderPackageLoader(sourceEntry)
  const sourceNormalized = normalizeFullName(packageFullName)

  if (!sourceLoader) {
    return null
  }

  for (const entry of modloaderPackages) {
    const candidateFullName = String(
      entry?.packageId || entry?.packageID || entry?.package_id || entry?.fullName || ''
    ).trim()
    const candidateNormalized = normalizeFullName(candidateFullName)
    if (!candidateNormalized || candidateNormalized === sourceNormalized) {
      continue
    }
    if (getModloaderPackageLoader(entry) !== sourceLoader) {
      continue
    }
    if (installedLookup?.has(candidateNormalized)) {
      return {
        fullName: candidateFullName,
        source: 'installed_modloader'
      }
    }
  }

  for (const entry of modloaderPackages) {
    const candidateFullName = String(
      entry?.packageId || entry?.packageID || entry?.package_id || entry?.fullName || ''
    ).trim()
    const candidateNormalized = normalizeFullName(candidateFullName)
    if (!candidateNormalized || candidateNormalized === sourceNormalized) {
      continue
    }
    if (getModloaderPackageLoader(entry) !== sourceLoader) {
      continue
    }
    if (plannedLookup?.has(candidateNormalized)) {
      return {
        fullName: candidateFullName,
        source: 'planned_modloader'
      }
    }
  }

  for (const entry of modloaderPackages) {
    const candidateFullName = String(
      entry?.packageId || entry?.packageID || entry?.package_id || entry?.fullName || ''
    ).trim()
    const candidateNormalized = normalizeFullName(candidateFullName)
    if (!candidateNormalized || candidateNormalized === sourceNormalized) {
      continue
    }
    if (getModloaderPackageLoader(entry) !== sourceLoader) {
      continue
    }
    if (packageMap?.has(candidateNormalized)) {
      return {
        fullName: candidateFullName,
        source: 'community_modloader'
      }
    }
  }

  return null
}

function resolveInstallPlanDependencyTarget(
  packageMap,
  packageFullName = '',
  requiredVersion = '',
  options = {}
) {
  const normalizedFullName = normalizeFullName(packageFullName)
  const installedLookup = options?.installedLookup instanceof Map ? options.installedLookup : null
  const plannedLookup = options?.plannedLookup instanceof Map ? options.plannedLookup : null
  const preferInstalledDependency = options?.preferInstalledDependency === true
  const preferEquivalentModloader = options?.preferEquivalentModloader === true
  const installedRecord = installedLookup?.get(normalizedFullName) || null
  const replacement = resolveEquivalentModloaderPackage(packageMap, packageFullName, options)
  const replacementNormalized = normalizeFullName(replacement?.fullName || '')
  const replacementRecord = replacementNormalized
    ? installedLookup?.get(replacementNormalized) || null
    : null
  const plannedReplacement = replacementNormalized
    ? plannedLookup?.get(replacementNormalized) || null
    : null

  if (preferEquivalentModloader && plannedReplacement) {
    return {
      type: 'planned',
      fullName: String(replacement?.fullName || packageFullName).trim() || packageFullName,
      plannedRecord: plannedReplacement,
      replacement
    }
  }

  if (
    preferEquivalentModloader &&
    canReuseInstalledDependency(replacementRecord, requiredVersion)
  ) {
    return {
      type: 'installed',
      fullName:
        String(replacementRecord?.fullName || replacement?.fullName).trim() || packageFullName,
      installedRecord: replacementRecord,
      replacement
    }
  }

  if (
    preferInstalledDependency &&
    requiredVersion &&
    canReuseInstalledDependency(installedRecord, requiredVersion)
  ) {
    return {
      type: 'installed',
      fullName: String(installedRecord?.fullName || packageFullName).trim() || packageFullName,
      installedRecord
    }
  }

  const packageInfo = packageMap?.get(normalizedFullName)

  if (packageInfo) {
    return {
      type: 'package',
      fullName: String(packageInfo?.full_name || packageFullName).trim() || packageFullName,
      requiredVersion,
      packageInfo
    }
  }

  if (canReuseInstalledDependency(installedRecord, requiredVersion)) {
    return {
      type: 'installed',
      fullName: String(installedRecord?.fullName || packageFullName).trim() || packageFullName,
      installedRecord
    }
  }

  if (!replacement?.fullName) {
    return null
  }

  if (plannedReplacement) {
    return {
      type: 'planned',
      fullName: String(replacement.fullName).trim() || replacement.fullName,
      plannedRecord: plannedReplacement,
      replacement
    }
  }

  if (canReuseInstalledDependency(replacementRecord, requiredVersion)) {
    return {
      type: 'installed',
      fullName:
        String(replacementRecord?.fullName || replacement.fullName).trim() || replacement.fullName,
      installedRecord: replacementRecord,
      replacement
    }
  }

  const replacementPackageInfo = packageMap?.get(replacementNormalized)
  if (replacementPackageInfo) {
    return {
      type: 'package',
      fullName:
        String(replacementPackageInfo?.full_name || replacement.fullName).trim() ||
        replacement.fullName,
      requiredVersion: '',
      packageInfo: replacementPackageInfo,
      replacement
    }
  }

  return null
}

function buildRecognizedRootSegments(flatRules = []) {
  const result = new Set(Array.from(KNOWN_INSTALL_ROOT_DIRS))

  for (const rule of Array.isArray(flatRules) ? flatRules : []) {
    const fullRoute = normalizeZipPath(rule?.fullRoute || '')
    const route = normalizeZipPath(rule?.route || '')
    const fullRouteFirstSegment = String(fullRoute.split('/')[0] || '')
      .trim()
      .toLowerCase()
    const routeFirstSegment = String(route.split('/')[0] || '')
      .trim()
      .toLowerCase()
    const fullRouteBaseName = path.posix.basename(fullRoute).trim().toLowerCase()

    if (fullRouteFirstSegment) {
      result.add(fullRouteFirstSegment)
    }
    if (routeFirstSegment) {
      result.add(routeFirstSegment)
    }
    if (fullRouteBaseName) {
      result.add(fullRouteBaseName)
    }
  }

  return result
}

function findBestInstallRuleByFileName(fileName = '', flatRules = [], defaultRule = null) {
  const lowerName = String(fileName || '')
    .trim()
    .toLowerCase()
  if (!lowerName) {
    return defaultRule || null
  }

  const matched = []
  for (const rule of Array.isArray(flatRules) ? flatRules : []) {
    const extensions = Array.isArray(rule?.defaultFileExtensions) ? rule.defaultFileExtensions : []
    const hit = extensions.find((ext) => lowerName.endsWith(String(ext || '').toLowerCase()))
    if (hit) {
      matched.push({
        rule,
        extLength: String(hit || '').length
      })
    }
  }

  if (matched.length) {
    matched.sort((a, b) => {
      if (b.extLength !== a.extLength) {
        return b.extLength - a.extLength
      }
      if (b.rule.depth !== a.rule.depth) {
        return b.rule.depth - a.rule.depth
      }
      if (a.rule.isDefaultLocation === b.rule.isDefaultLocation) {
        return 0
      }
      return a.rule.isDefaultLocation ? 1 : -1
    })
    return matched[0].rule
  }

  return defaultRule || null
}

function matchInstallRulePrefix(relativePath = '', flatRules = []) {
  const normalizedPath = normalizeZipPath(relativePath)
  if (!normalizedPath) {
    return null
  }

  const candidates = []
  for (const rule of Array.isArray(flatRules) ? flatRules : []) {
    const sourceList = Array.from(
      new Set(
        [
          normalizeZipPath(rule?.fullRoute || ''),
          normalizeZipPath(rule?.route || ''),
          normalizeZipPath(path.posix.basename(rule?.fullRoute || ''))
        ].filter(Boolean)
      )
    )

    for (const source of sourceList) {
      if (normalizedPath !== source && !normalizedPath.startsWith(`${source}/`)) {
        continue
      }

      const rest = normalizedPath === source ? '' : normalizedPath.slice(source.length + 1)
      candidates.push({
        rule,
        rest,
        score: source.split('/').filter(Boolean).length * 1000 + source.length
      })
    }
  }

  if (!candidates.length) {
    return null
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]
}

function buildArchiveGroupRuleMap(relativeFiles = [], flatRules = [], defaultRule = null) {
  const groupMap = new Map()
  const tempMap = new Map()

  for (const relativePath of Array.isArray(relativeFiles) ? relativeFiles : []) {
    const normalizedPath = normalizeZipPath(relativePath)
    if (!normalizedPath || !normalizedPath.includes('/')) {
      continue
    }

    if (matchInstallRulePrefix(normalizedPath, flatRules)) {
      continue
    }

    const [groupKey] = normalizedPath.split('/')
    if (!groupKey) {
      continue
    }

    const fileName = path.posix.basename(normalizedPath)
    const rule = findBestInstallRuleByFileName(fileName, flatRules, defaultRule)
    if (!tempMap.has(groupKey)) {
      tempMap.set(groupKey, [])
    }
    if (rule?.fullRoute) {
      tempMap.get(groupKey).push(rule)
    }
  }

  for (const [groupKey, ruleList] of tempMap.entries()) {
    if (!ruleList.length) {
      if (defaultRule?.fullRoute) {
        groupMap.set(groupKey, defaultRule)
      }
      continue
    }

    const counter = new Map()
    for (const rule of ruleList) {
      const key = String(rule?.fullRoute || '')
      counter.set(key, {
        count: Number(counter.get(key)?.count || 0) + 1,
        rule
      })
    }

    const resolved = Array.from(counter.values()).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }
      return Number(b.rule?.depth || 0) - Number(a.rule?.depth || 0)
    })[0]

    if (resolved?.rule?.fullRoute) {
      groupMap.set(groupKey, resolved.rule)
    } else if (defaultRule?.fullRoute) {
      groupMap.set(groupKey, defaultRule)
    }
  }

  return groupMap
}

function resolveArchiveEntryInstallRelativePath(relativePath = '', options = {}) {
  const normalizedPath = normalizeZipPath(relativePath)
  if (!normalizedPath) {
    return ''
  }

  const flatRules = Array.isArray(options?.flatRules) ? options.flatRules : []
  const defaultRule = options?.defaultRule || null
  const groupRuleMap = options?.groupRuleMap instanceof Map ? options.groupRuleMap : new Map()
  const keepRootLevelFileAtProfileRoot = options?.keepRootLevelFileAtProfileRoot === true
  const fallbackRootLevelRoute = normalizeZipPath(options?.fallbackRootLevelRoute || '')

  const directRuleMatch = matchInstallRulePrefix(normalizedPath, flatRules)
  if (directRuleMatch?.rule?.fullRoute) {
    return joinZipPath(directRuleMatch.rule.fullRoute, directRuleMatch.rest)
  }

  const fileName = path.posix.basename(normalizedPath)
  const isRootLevel = !normalizedPath.includes('/')
  if (isRootLevel) {
    if (keepRootLevelFileAtProfileRoot) {
      return fileName
    }

    const targetRule = findBestInstallRuleByFileName(fileName, flatRules, defaultRule)
    if (targetRule?.fullRoute) {
      return joinZipPath(targetRule.fullRoute, fileName)
    }
    if (fallbackRootLevelRoute) {
      return joinZipPath(fallbackRootLevelRoute, fileName)
    }
    return normalizedPath
  }

  const [groupKey] = normalizedPath.split('/')
  const groupRule = groupRuleMap.get(groupKey)
  if (groupRule?.fullRoute) {
    return joinZipPath(groupRule.fullRoute, normalizedPath)
  }

  const targetRule = findBestInstallRuleByFileName(fileName, flatRules, defaultRule)
  if (targetRule?.fullRoute) {
    return joinZipPath(targetRule.fullRoute, normalizedPath)
  }

  return normalizedPath
}

function getDefaultExtractDirByLoader(packageLoader, installRoot) {
  const loader = normalizeLoader(packageLoader)
  const root = path.resolve(String(installRoot || ''))
  if (!root) {
    return ''
  }

  if (loader === 'melonloader' || loader === 'umm') {
    return path.join(root, 'Mods')
  }
  if (loader === 'lovely') {
    return path.join(root, 'mods')
  }
  if (loader === 'gdweave') {
    return path.join(root, 'GDWeave', 'mods')
  }

  return path.join(root, 'BepInEx', 'plugins')
}

function shouldKeepRootLevelFileAtProfileRoot(relativePath = '', logContext = {}) {
  const baseName = path.basename(String(relativePath || '')).toLowerCase()
  if (PROFILE_ROOT_LEVEL_FILES.has(baseName)) {
    return true
  }

  if (logContext?.modloaderPackage) {
    return true
  }

  const packageFullName = String(logContext?.packageFullName || '')
    .trim()
    .toLowerCase()
  return packageFullName.includes('bepinexpack')
}

function toSafeInteger(value) {
  const num = Number(value || 0)
  return Number.isFinite(num) ? num : 0
}

function escapeYamlSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''")
}

function buildLegacyProfileExportYaml(profileName = 'default', installedRecords = []) {
  const safeProfileName = escapeYamlSingleQuoted(profileName || 'default')
  const lines = [`profileName: '${safeProfileName}'`]

  if (!Array.isArray(installedRecords) || installedRecords.length <= 0) {
    lines.push('mods: []')
    return `${lines.join('\n')}\n`
  }

  lines.push('mods:')
  for (const record of installedRecords) {
    const fullName = escapeYamlSingleQuoted(record?.fullName || '')
    const version = escapeYamlSingleQuoted(record?.version || '0.0.0')
    lines.push(`  - name: '${fullName}'`)
    lines.push(`    version: '${version}'`)
    lines.push('    enabled: true')
  }

  return `${lines.join('\n')}\n`
}

function buildLegacyProfilePayload(profileName = 'default', installedRecords = []) {
  const yaml = buildLegacyProfileExportYaml(profileName, installedRecords)
  const zip = new AdmZip()
  zip.addFile('export.r2x', Buffer.from(yaml, 'utf8'))
  const base64Zip = zip.toBuffer().toString('base64')
  return `#r2modman\n${base64Zip}`
}

function parseYamlScalar(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return ''
  }

  if (
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) ||
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)
  ) {
    const content = raw.slice(1, -1)
    if (raw.startsWith("'")) {
      return content.replace(/''/g, "'")
    }
    return content
  }

  return raw
}

function parseYamlBoolean(value, fallback = true) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return fallback
}

function parseLegacyProfileExportYaml(yamlContent = '') {
  const lines = String(yamlContent || '').split(/\r?\n/)
  const mods = []
  let inModsSection = false
  let current = null

  const pushCurrent = () => {
    if (!current) {
      return
    }

    const fullName = String(current.fullName || '').trim()
    let version = String(current.version || '').trim()
    if (!version) {
      const major = Number(current.versionMajor || 0)
      const minor = Number(current.versionMinor || 0)
      const patch = Number(current.versionPatch || 0)
      version = `${major}.${minor}.${patch}`
    }
    const enabled = current.enabled !== false

    if (fullName && version) {
      mods.push({
        fullName,
        version,
        enabled
      })
    }
    current = null
  }

  for (const line of lines) {
    const trimmed = String(line || '').trim()
    if (!trimmed) {
      continue
    }

    if (!inModsSection) {
      if (/^mods\s*:/.test(trimmed)) {
        inModsSection = true
      }
      continue
    }

    const isTopLevel = !/^\s/.test(String(line || ''))
    if (isTopLevel && /^[A-Za-z0-9_]+\s*:/.test(trimmed) && !trimmed.startsWith('-')) {
      // 进入新的顶层键，结束 mods 解析。
      break
    }

    const nameInlineMatch = trimmed.match(/^-+\s*name\s*:\s*(.+)$/)
    if (nameInlineMatch) {
      pushCurrent()
      current = {
        fullName: parseYamlScalar(nameInlineMatch[1]),
        version: '',
        enabled: true
      }
      continue
    }

    if (/^-+$/.test(trimmed)) {
      pushCurrent()
      current = {
        fullName: '',
        version: '',
        enabled: true
      }
      continue
    }

    if (!current) {
      continue
    }

    const nameMatch = trimmed.match(/^name\s*:\s*(.+)$/)
    if (nameMatch) {
      current.fullName = parseYamlScalar(nameMatch[1])
      continue
    }

    const versionMatch = trimmed.match(/^version\s*:\s*(.+)$/)
    if (versionMatch) {
      current.version = parseYamlScalar(versionMatch[1])
      continue
    }

    const versionObjectMatch = trimmed.match(/^version\s*:\s*$/)
    if (versionObjectMatch) {
      current.version = ''
      continue
    }

    const majorMatch = trimmed.match(/^major\s*:\s*(-?\d+)$/)
    if (majorMatch) {
      current.versionMajor = Number(majorMatch[1])
      continue
    }
    const minorMatch = trimmed.match(/^minor\s*:\s*(-?\d+)$/)
    if (minorMatch) {
      current.versionMinor = Number(minorMatch[1])
      continue
    }
    const patchMatch = trimmed.match(/^patch\s*:\s*(-?\d+)$/)
    if (patchMatch) {
      current.versionPatch = Number(patchMatch[1])
      continue
    }

    const enabledMatch = trimmed.match(/^enabled\s*:\s*(.+)$/)
    if (enabledMatch) {
      current.enabled = parseYamlBoolean(enabledMatch[1], true)
    }
  }

  pushCurrent()

  // 去重：按 fullName（保留第一个）
  const map = new Map()
  for (const item of mods) {
    const key = normalizeFullName(item?.fullName || '')
    if (!key || map.has(key)) {
      continue
    }
    map.set(key, item)
  }
  return Array.from(map.values())
}

function parseLegacyProfileCodeToMods(profileCode = '') {
  const raw = String(profileCode || '').trim()
  if (!raw) {
    throw new Error('分享码内容不能为空')
  }

  const prefix = '#r2modman'
  if (!raw.startsWith(prefix)) {
    throw new Error('分享码格式无效（缺少 #r2modman 前缀）')
  }

  const base64 = raw.slice(prefix.length).trim()
  if (!base64) {
    throw new Error('分享码格式无效（缺少 base64 内容）')
  }

  let zipBuffer
  try {
    zipBuffer = Buffer.from(base64, 'base64')
  } catch {
    throw new Error('分享码 base64 解码失败')
  }

  let zip
  try {
    zip = new AdmZip(zipBuffer)
  } catch {
    throw new Error('分享码压缩包解析失败')
  }

  const entry =
    zip.getEntry('export.r2x') ||
    zip.getEntries().find((item) => String(item?.entryName || '').toLowerCase() === 'export.r2x')

  if (!entry) {
    throw new Error('分享码中缺少 export.r2x')
  }

  const yamlContent = entry.getData().toString('utf8')
  const mods = parseLegacyProfileExportYaml(yamlContent)
  if (!mods.length) {
    throw new Error('分享码中未解析到可安装模组')
  }

  return mods
}

function parseOwnerAndName(fullName = '') {
  const raw = String(fullName || '').trim()
  const idx = raw.indexOf('-')
  if (idx === -1) {
    return {
      owner: raw || 'unknown',
      name: raw || 'unknown'
    }
  }

  return {
    owner: raw.slice(0, idx) || 'unknown',
    name: raw.slice(idx + 1) || 'unknown'
  }
}

function parseDependencyString(depString = '') {
  const raw = String(depString || '').trim()
  if (!raw) {
    return {
      fullName: '',
      requiredVersion: ''
    }
  }

  const match = raw.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
  if (match) {
    return {
      fullName: match[1],
      requiredVersion: match[2]
    }
  }

  return {
    fullName: raw,
    requiredVersion: ''
  }
}

function normalizePathForCompare(filePath = '') {
  return String(filePath || '')
    .trim()
    .replace(/\//g, '\\')
    .toLowerCase()
}

function isPathInsideRoot(filePath, rootPath) {
  const absFilePath = path.resolve(String(filePath || ''))
  const absRootPath = path.resolve(String(rootPath || ''))
  const normalizedRoot = `${absRootPath}${path.sep}`
  return absFilePath === absRootPath || absFilePath.startsWith(normalizedRoot)
}

function clampPercent(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(num)))
}

function waitForMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)))
  })
}

function getErrorStatusCode(error) {
  const status = Number(error?.response?.status || error?.status || 0)
  return Number.isFinite(status) ? status : 0
}

function getErrorCode(error) {
  return String(error?.code || '')
    .trim()
    .toUpperCase()
}

function isRetryableStatusCode(status) {
  const code = Number(status || 0)
  if (code <= 0) {
    return false
  }

  return code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
}

function isRetryableRequestError(error) {
  if (!error) {
    return false
  }

  if (isRetryableStatusCode(getErrorStatusCode(error))) {
    return true
  }

  const code = String(error?.code || '')
    .trim()
    .toUpperCase()
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true
  }

  const message = String(error?.message || '')
    .trim()
    .toLowerCase()
  if (!message) {
    return false
  }

  return RETRYABLE_NETWORK_MESSAGES.some((keyword) => message.includes(keyword))
}

function isRetryableFileAccessError(error) {
  return RETRYABLE_FILE_CODES.has(getErrorCode(error))
}

function isRetryableDownloadError(error) {
  return isRetryableRequestError(error) || isRetryableFileAccessError(error)
}

async function runWithRetry(task, options = {}) {
  const retries = Math.max(toSafeInteger(options?.retries), 0)
  const maxAttempts = retries + 1
  const baseDelayMs = Math.max(toSafeInteger(options?.baseDelayMs), 0)
  const shouldRetry = typeof options?.shouldRetry === 'function' ? options.shouldRetry : () => false
  const onRetry = typeof options?.onRetry === 'function' ? options.onRetry : null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await task({
        attempt,
        maxAttempts
      })
    } catch (error) {
      const canRetry = attempt < maxAttempts && shouldRetry(error)
      if (!canRetry) {
        throw error
      }

      const delayMs = baseDelayMs > 0 ? baseDelayMs * attempt : 0
      if (onRetry) {
        onRetry({
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          error
        })
      }

      if (delayMs > 0) {
        await waitForMs(delayMs)
      }
    }
  }

  throw new Error('请求重试失败')
}

async function resolveDownloadArchivePath(tempOutputPath, outputPath) {
  if (!tempOutputPath || tempOutputPath === outputPath) {
    return outputPath
  }

  try {
    if (await fs.pathExists(outputPath)) {
      await fs.remove(outputPath)
    }

    await fs.move(tempOutputPath, outputPath, {
      overwrite: true
    })
    return outputPath
  } catch (error) {
    if (isRetryableFileAccessError(error)) {
      console.warn(`[thunderstore] 缓存文件被占用，改为使用临时归档继续安装: ${outputPath}`, error)
      return tempOutputPath
    }

    await fs.remove(tempOutputPath).catch(() => {})
    throw error
  }
}

function emitInstallProgress(event, payload = {}) {
  try {
    event?.sender?.send('thunderstoreInstallProgress', payload)
  } catch (error) {
    console.warn('[thunderstore] 发送安装进度失败', error)
  }
}

async function calculateArchiveDigest(archivePath = '') {
  const safeArchivePath = String(archivePath || '').trim()
  if (!safeArchivePath) {
    return {
      md5: '',
      fileSize: 0
    }
  }

  const stat = await fs.stat(safeArchivePath)
  const hash = crypto.createHash('md5')

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(safeArchivePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  return {
    md5: hash.digest('hex'),
    fileSize: Number(stat?.size || 0)
  }
}

function normalizeDownloadedPackageItem(item = {}) {
  const fullName = String(item?.fullName || item?.packageFullName || '').trim()
  const { owner, name } = parseOwnerAndName(fullName)

  return {
    fullName,
    sourceModpackInstanceId: String(item?.sourceModpackInstanceId || '').trim(),
    sourceModpackOperation: String(item?.sourceModpackOperation || '').trim(),
    version: String(item?.version || item?.versionNumber || '').trim(),
    archivePath: String(item?.archivePath || item?.filePath || '').trim(),
    downloadUrl: String(item?.downloadUrl || '').trim(),
    displayName: String(item?.displayName || item?.name || name || fullName).trim(),
    packageOwner: String(item?.packageOwner || owner || '').trim(),
    packageName: String(item?.packageName || name || '').trim(),
    icon: String(item?.icon || item?.cover || '').trim(),
    description: String(item?.description || '').trim(),
    packageUrl: String(item?.packageUrl || '').trim(),
    dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
    fileSize: Number(item?.fileSize || 0),
    md5: String(item?.md5 || item?.fileMD5 || item?.fileMd5 || '').trim()
  }
}

async function installDownloadedThunderstorePlanItem(event, payload = {}) {
  const jobId = String(payload?.jobId || '').trim()
  const currentIndex = Math.max(Number(payload?.currentIndex || 1), 1)
  const totalCount = Math.max(Number(payload?.totalCount || 1), 1)
  const progressBase = Number(payload?.progressBase || 0)
  const progressWeight = Number(payload?.progressWeight || 1 / totalCount)
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const targetInstallRoot = String(payload?.targetInstallRoot || '').trim()
  const packageLoader = String(payload?.packageLoader || '').trim()
  const installRuleContext =
    payload?.installRuleContext && typeof payload.installRuleContext === 'object'
      ? payload.installRuleContext
      : null
  const item = normalizeDownloadedPackageItem(payload?.item)

  if (!community) {
    throw new Error('community 不能为空')
  }
  if (!targetInstallRoot) {
    throw new Error('安装目录不能为空')
  }
  if (!item.fullName) {
    throw new Error('包名不能为空')
  }
  if (!item.version) {
    throw new Error(`包 ${item.fullName} 缺少版本号`)
  }
  if (!item.archivePath) {
    throw new Error(`包 ${item.fullName} 缺少本地归档路径`)
  }
  if (!(await fs.pathExists(item.archivePath))) {
    throw new Error(`包 ${item.fullName} 的归档文件不存在`)
  }

  const digestInfo =
    item.md5 && item.fileSize > 0
      ? { md5: item.md5, fileSize: item.fileSize }
      : await calculateArchiveDigest(item.archivePath)

  const cacheRoot = getConfiguredThunderstoreStoragePaths().cacheRoot
  await fs.ensureDir(cacheRoot)
  const preparedRoot = await fs.mkdtemp(path.join(cacheRoot, 'update-prepare-'))
  const installedAt = new Date().toISOString()
  try {
    const preparedFiles = await extractZipToTarget(
      item.archivePath,
      preparedRoot,
      (progress) => {
        const stageRate = Number(progress?.percent || 0) / 100
        const globalPercent = (progressBase + stageRate * progressWeight) * 100

        emitInstallProgress(event, {
          jobId,
          stage: 'extract',
          currentIndex,
          totalCount,
          packageFullName: item.fullName,
          percent: clampPercent(globalPercent),
          packagePercent: clampPercent(progress?.percent || 0),
          processedFiles: Number(progress?.processedCount || 0),
          totalFiles: Number(progress?.totalCount || 0),
          message: `正在安装 ${item.fullName} ${item.version}`
        })
      },
      {
        packageFullName: item.fullName,
        versionNumber: item.version,
        packageLoader,
        installRuleContext
      }
    )

    const relativeFiles = preparedFiles.map((file) => path.relative(preparedRoot, file))
    if (!relativeFiles.length) throw new Error('归档没有可安装文件，旧版本保持不变')
    const files = relativeFiles.map((file) => path.resolve(targetInstallRoot, file))
    let sourceModpackIntegrity
    if (item.sourceModpackInstanceId) {
      sourceModpackIntegrity = {
        disabledRelativeRoot: path.relative(targetInstallRoot, getDisabledModRoot(targetInstallRoot, item.fullName)),
        files: []
      }
      for (const relativePath of relativeFiles) {
        sourceModpackIntegrity.files.push({ relativePath,
          ...await calculateArchiveDigest(path.join(preparedRoot, relativePath)) })
      }
    }
    const installedRecords = listThunderstoreInstalledMods({ community, profileName })
    const previous = getThunderstoreInstalledRecord({
      community,
      profileName,
      packageFullName: item.fullName
    })
    const enabled = !previous || isThunderstoreRecordEnabled(previous)
    const physicalRoot = enabled
      ? targetInstallRoot
      : getDisabledModRoot(targetInstallRoot, item.fullName)
    const shared = new Set(
      installedRecords
        .filter((record) => normalizeFullName(record.fullName) !== normalizeFullName(item.fullName))
        .flatMap((record) => record.files || [])
        .map(normalizePathForCompare)
    )
    const obsoleteFiles = (previous?.files || [])
      .filter((file) => !enabled || !shared.has(normalizePathForCompare(file)))
      .map((file) => path.relative(targetInstallRoot, file))
    await replaceThunderstoreFiles({
      root: physicalRoot,
      preparedRoot,
      files: relativeFiles,
      obsoleteFiles,
      preflight: (paths) => {
        const occupancy = inspectFileOccupancy(paths)
        if (occupancy.hasOccupiedFiles)
          throw Object.assign(new Error(buildOccupiedFilesMessage(occupancy.occupiedFiles)), {
            code: 'FILES_OCCUPIED'
          })
      },
      commit: () =>
        upsertThunderstoreInstalledMod({
          community,
          profileName,
          packageFullName: item.fullName,
          packageOwner: item.packageOwner,
          packageName: item.packageName,
          displayName: item.displayName || item.packageName || item.fullName,
          version: item.version,
          downloadUrl: item.downloadUrl,
          fileSize: digestInfo.fileSize,
          cover: item.icon,
          archivePath: item.archivePath,
          targetPath: targetInstallRoot,
          fileMD5: digestInfo.md5,
          dependencies: item.dependencies,
          files,
          metadata: {
            source: 'thunderstore',
            sourceModpackIntegrity,
            fullName: item.fullName,
            packageName: item.packageName,
            packageOwner: item.packageOwner,
            icon: item.icon,
            description: item.description,
            packageUrl: item.packageUrl,
            downloadUrl: item.downloadUrl,
            fileMd5: digestInfo.md5,
            fileSize: digestInfo.fileSize,
            installRoot: targetInstallRoot,
            archivePath: item.archivePath,
            targetPath: targetInstallRoot,
            versionNumber: item.version,
            packageLoader: normalizeLoader(installRuleContext?.packageLoader || packageLoader)
          },
          installedAt,
          enabled
        })
    })
  } finally {
    await fs.remove(preparedRoot).catch(() => {})
  }

  return {
    fullName: item.fullName,
    version: item.version,
    fileSize: digestInfo.fileSize,
    installedAt
  }
}

function normalizeLaunchMode(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  return raw === 'vanilla' ? 'vanilla' : 'modded'
}

function normalizeExecutablePath(value) {
  const raw = String(value || '').trim()
  return raw
}

async function upsertDetectedGameToLibrary(appId = 0, gameExePath = '', sourceMeta = {}) {
  const safeAppId = Number(appId || 0)
  const safeExePath = normalizeExecutablePath(gameExePath)
  if (!safeAppId || !safeExePath) {
    return false
  }

  const exists = await fs.pathExists(safeExePath)
  if (!exists) {
    return false
  }

  const parentPath = path.dirname(safeExePath)
  const safeAppIdText = String(safeAppId)
  const normalizedSourceMeta = normalizeGameSourceMeta(sourceMeta)
  await upsertGameRecord(safeAppIdText, safeExePath, 0, parentPath, normalizedSourceMeta)
  return true
}

function normalizeExeNames(list = []) {
  return Array.isArray(list) ? list.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function getProfileRoot(community, profileName = 'default') {
  const normalizedCommunity = normalizeCommunity(community)
  const normalizedProfileName = String(profileName || 'default').trim() || 'default'
  const storedProfile = getThunderstoreProfile({
    community: normalizedCommunity,
    profileName: normalizedProfileName
  })
  const storedRoot = String(storedProfile?.profileRoot || '').trim()
  if (storedRoot) return storedRoot

  const profileRoot = path.join(
    getConfiguredThunderstoreStoragePaths().profileRoot,
    normalizedCommunity,
    createSourceProfilePathId()
  )
  upsertThunderstoreProfile({
    community: normalizedCommunity,
    profileName: normalizedProfileName,
    packageLoader: '',
    appId: '',
    gameExePath: '',
    profileRoot
  })
  return profileRoot
}

async function fetchCommunityPackageList(community) {
  const id = normalizeCommunity(community)
  if (!id) {
    throw new Error('community 不能为空')
  }

  const now = Date.now()
  const cachedEntry = thunderstorePackageListCache.get(id)
  if (Array.isArray(cachedEntry?.data) && Number(cachedEntry?.expiresAt || 0) > now) {
    return cachedEntry.data
  }

  if (cachedEntry?.pending instanceof Promise) {
    return await cachedEntry.pending
  }

  const url = `${THUNDERSTORE_BASE_URL}/c/${encodeURIComponent(id)}/api/v1/package/`
  const pending = runWithRetry(
    async () => {
      const response = await axios.get(url, {
        timeout: 60000,
        headers: THUNDERSTORE_HTTP_HEADERS,
        validateStatus: () => true
      })

      if (Number(response?.status) === 200 && Array.isArray(response?.data)) {
        return response.data
      }

      const statusCode = Number(response?.status || 0)
      const detail = String(response?.data?.detail || response?.statusText || '').trim()
      const error = new Error(
        `社区模组列表请求失败（HTTP ${statusCode || 0}）${detail ? `: ${detail}` : ''}`
      )
      error.status = statusCode
      throw error
    },
    {
      retries: 2,
      baseDelayMs: 1000,
      shouldRetry: isRetryableRequestError
    }
  )

  thunderstorePackageListCache.set(id, {
    data: Array.isArray(cachedEntry?.data) ? cachedEntry.data : null,
    expiresAt: Number(cachedEntry?.expiresAt || 0),
    pending
  })

  try {
    const packages = await pending
    thunderstorePackageListCache.set(id, {
      data: packages,
      expiresAt: Date.now() + THUNDERSTORE_PACKAGE_LIST_CACHE_TTL_MS,
      pending: null
    })
    return packages
  } catch (error) {
    if (Array.isArray(cachedEntry?.data) && cachedEntry.data.length > 0) {
      console.warn('[thunderstore] 社区包列表刷新失败，回退到缓存数据', {
        community: id,
        error: String(error?.message || '未知错误')
      })
      thunderstorePackageListCache.set(id, {
        data: cachedEntry.data,
        expiresAt: now + 60 * 1000,
        pending: null
      })
      return cachedEntry.data
    }

    thunderstorePackageListCache.delete(id)
    throw error
  }
}

function selectPackageVersion(packageInfo, requiredVersion = '') {
  const versions = Array.isArray(packageInfo?.versions) ? packageInfo.versions : []
  if (!versions.length) {
    return null
  }

  if (requiredVersion) {
    const exact = versions.find(
      (item) => String(item?.version_number || '').trim() === String(requiredVersion).trim()
    )
    return exact || null
  }

  return versions.find((item) => item?.is_active !== false) || versions[0]
}

function buildPackageIndex(packages = []) {
  const map = new Map()
  for (const item of packages) {
    const key = normalizeFullName(item?.full_name || '')
    if (!key) {
      continue
    }
    map.set(key, item)
  }
  return map
}

function buildInstallPlan(packageMap, rootFullName, rootRequiredVersion = '', options = {}) {
  const resolved = new Map()
  const order = []
  const visiting = new Set()
  const community = normalizeCommunity(options?.community)

  function visit(fullName, requiredVersion = '', isDependency = false) {
    const normalized = normalizeFullName(fullName)
    if (!normalized) {
      return
    }

    if (resolved.has(normalized)) {
      return
    }

    if (visiting.has(normalized)) {
      return
    }

    const resolvedTarget = resolveInstallPlanDependencyTarget(
      packageMap,
      fullName,
      requiredVersion,
      {
        ...options,
        plannedLookup: resolved,
        preferInstalledDependency: isDependency,
        preferEquivalentModloader: isDependency
      }
    )
    if (!resolvedTarget) {
      throw new Error(`未找到依赖包: ${fullName}`)
    }

    const resolvedFullName = String(resolvedTarget?.fullName || fullName).trim() || fullName
    const resolvedNormalized = normalizeFullName(resolvedFullName)
    if (!resolvedNormalized) {
      throw new Error(`依赖包名无效: ${fullName}`)
    }
    if (resolved.has(resolvedNormalized) || visiting.has(resolvedNormalized)) {
      return
    }

    if (resolvedTarget?.type === 'installed') {
      if (resolvedTarget?.replacement?.fullName) {
        console.warn(
          `[thunderstore] 社区 ${community || 'unknown'} 的依赖 ${fullName} 已不可直接解析，改用已安装的等效 loader 包 ${resolvedFullName}`
        )
      }
      resolved.set(resolvedNormalized, {
        installedRecord: resolvedTarget.installedRecord,
        satisfiedByInstalled: true
      })
      return
    }

    const pkg = resolvedTarget.packageInfo
    const version = selectPackageVersion(pkg, resolvedTarget.requiredVersion)
    if (!version) {
      throw new Error(`包 ${fullName} 没有可安装版本`)
    }

    if (resolvedTarget?.replacement?.fullName) {
      console.warn(
        `[thunderstore] 社区 ${community || 'unknown'} 的依赖 ${fullName} 已不可直接解析，改用等效 loader 包 ${resolvedFullName}`
      )
    }

    visiting.add(resolvedNormalized)
    const deps = Array.isArray(version?.dependencies) ? version.dependencies : []
    for (const dep of deps) {
      const parsed = parseDependencyString(dep)
      visit(parsed.fullName, parsed.requiredVersion, true)
    }
    visiting.delete(resolvedNormalized)

    resolved.set(resolvedNormalized, {
      packageInfo: pkg,
      versionInfo: version
    })
    order.push(resolvedNormalized)
  }

  visit(rootFullName, rootRequiredVersion, false)
  return order
    .map((name) => resolved.get(name))
    .filter((item) => item?.packageInfo && item?.versionInfo)
}

export async function thunderstoreBuildSourceInstallTaskPlan(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const packageFullName = String(
    payload?.packageFullName || payload?.fullName || payload?.modId || payload?.id || ''
  ).trim()
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const packageLoader = String(payload?.packageLoader || '')
  const appId = toSafeInteger(payload?.appId)
  const versionNumber = String(payload?.versionNumber || payload?.version || '').trim()

  if (!community) {
    throw new Error('community 不能为空')
  }
  if (!packageFullName) {
    throw new Error('packageFullName 不能为空')
  }

  const installRuleContext = await resolveThunderstoreInstallRuleContext(community, packageLoader)
  const packages = await fetchCommunityPackageList(community)
  const packageMap = buildPackageIndex(packages)
  const rootPackage = packageMap.get(normalizeFullName(packageFullName))
  if (!rootPackage) {
    throw new Error(`未找到包: ${packageFullName}`)
  }

  const existingInstalledMap = getThunderstoreInstalledMap({
    community,
    profileName,
    appId
  })
  const existingInstalledLookup = new Map(
    Object.entries(existingInstalledMap).map(([fullName, item]) => [
      normalizeFullName(fullName),
      {
        ...item,
        fullName: String(item?.fullName || fullName).trim() || fullName
      }
    ])
  )
  const installPlan = buildInstallPlan(packageMap, rootPackage.full_name, versionNumber, {
    community,
    installedLookup: existingInstalledLookup,
    modloaderPackages: installRuleContext?.modloaderPackages
  })

  return {
    success: true,
    community,
    packageLoader: String(installRuleContext?.packageLoader || packageLoader || '').trim(),
    installPlan: installPlan.map(({ packageInfo, versionInfo }, index) => {
      const fullName = String(packageInfo?.full_name || '').trim()
      const packageName = String(packageInfo?.name || fullName).trim()
      const packageOwner = String(packageInfo?.owner || '').trim()
      const version = String(versionInfo?.version_number || '').trim()
      return {
        fullName,
        packageFullName: fullName,
        packageOwner,
        packageName,
        displayName: packageName || fullName,
        version,
        downloadUrl: String(versionInfo?.download_url || '').trim(),
        fileSize: Number(versionInfo?.file_size || 0),
        icon: String(versionInfo?.icon || packageInfo?.icon || '').trim(),
        description: String(versionInfo?.description || packageInfo?.description || '').trim(),
        packageUrl: String(packageInfo?.package_url || '').trim(),
        dependencies: Array.isArray(versionInfo?.dependencies) ? versionInfo.dependencies : [],
        sortIndex: index
      }
    })
  }
}

async function resolveInstallTarget(community, profileName = 'default') {
  const installRoot = getProfileRoot(community, profileName)
  await fs.ensureDir(installRoot)
  return {
    mode: 'profile',
    installRoot,
    profileName: String(profileName || 'default').trim() || 'default'
  }
}

async function downloadZip(downloadUrl, outputPath, onProgress, onRetry) {
  try {
    return await runWithRetry(
      async () => {
        const response = await axios.get(downloadUrl, {
          timeout: 180000,
          responseType: 'stream',
          maxRedirects: 5,
          headers: {
            ...THUNDERSTORE_HTTP_HEADERS,
            Accept: 'application/octet-stream,*/*'
          },
          validateStatus: () => true
        })

        if (Number(response?.status) !== 200 || !response?.data) {
          const statusCode = Number(response?.status || 0)
          const detail = String(response?.statusText || '').trim()
          const error = new Error(
            `下载失败（HTTP ${statusCode || 0}）${detail ? `: ${detail}` : ''}`
          )
          error.status = statusCode
          throw error
        }

        await fs.ensureDir(path.dirname(outputPath))
        const tempOutputPath = `${outputPath}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.downloading`

        const totalSize = Number(response.headers?.['content-length'] || 0)
        let downloadedSize = 0
        const hash = crypto.createHash('md5')

        try {
          await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(tempOutputPath)

            response.data.on('data', (chunk) => {
              downloadedSize += chunk.length
              hash.update(chunk)
              if (onProgress) {
                onProgress({
                  downloadedSize,
                  totalSize,
                  percent: totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0
                })
              }
            })

            response.data.on('error', (error) => reject(error))
            writer.on('error', (error) => reject(error))
            writer.on('finish', () => resolve())
            response.data.pipe(writer)
          })
        } catch (error) {
          await fs.remove(tempOutputPath).catch(() => {})
          throw error
        }

        const archivePath = await resolveDownloadArchivePath(tempOutputPath, outputPath)

        return {
          archivePath,
          md5: hash.digest('hex'),
          fileSize: downloadedSize,
          totalSize
        }
      },
      {
        retries: 4,
        baseDelayMs: 2000,
        shouldRetry: isRetryableDownloadError,
        onRetry: (retryInfo) => {
          if (onRetry) {
            onRetry(retryInfo)
          }
        }
      }
    )
  } catch (error) {
    const errorCode = getErrorCode(error)
    const message = String(error?.message || '').trim() || '未知错误'
    const normalizedMessage = message.toLowerCase()
    if (
      errorCode === 'ECONNABORTED' ||
      normalizedMessage === 'aborted' ||
      normalizedMessage.includes('aborted')
    ) {
      throw new Error('下载连接被中断，已自动重试多次仍失败，请稍后重试或检查网络/代理')
    }
    throw new Error(`下载模组包失败：${message}`)
  }
}

async function extractZipToTarget(zipPath, installRoot, onProgress, logContext = {}) {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  const installedFiles = []
  const normalizedRoot = path.resolve(installRoot)
  const packageFullName = String(logContext?.packageFullName || '').trim()
  const defaultExtractDir = getDefaultExtractDirByLoader(logContext?.packageLoader, installRoot)
  const installRuleContext =
    logContext?.installRuleContext && typeof logContext.installRuleContext === 'object'
      ? logContext.installRuleContext
      : null
  const flatRules = Array.isArray(installRuleContext?.flatRules) ? installRuleContext.flatRules : []
  const defaultRule =
    installRuleContext?.defaultRule || getDefaultInstallRule([], logContext?.packageLoader)
  const modloaderPackage = findModloaderPackageEntry(
    installRuleContext?.modloaderPackages,
    packageFullName
  )
  const fallbackRootLevelRoute = normalizeZipPath(
    path.relative(normalizedRoot, path.resolve(defaultExtractDir || normalizedRoot))
  )
  const wrapperPrefix = detectArchiveWrapperPrefix(entries, {
    flatRules,
    modloaderPackage
  })

  const normalizedEntries = entries
    .map((entry) => {
      const entryName = normalizeZipPath(entry?.entryName || '')
      let relative = entryName
      if (wrapperPrefix && relative === wrapperPrefix) {
        relative = ''
      }
      if (wrapperPrefix && relative.startsWith(`${wrapperPrefix}/`)) {
        relative = relative.slice(wrapperPrefix.length + 1)
      }
      relative = normalizeZipPath(relative)
      if (!relative) {
        return null
      }

      const baseName = path.posix.basename(relative).toLowerCase()
      if (SKIP_ROOT_FILES.has(baseName) && !relative.includes('/')) {
        return null
      }

      return {
        entry,
        entryName,
        relative,
        baseName
      }
    })
    .filter(Boolean)

  const extractableEntries = normalizedEntries.filter((item) => !item.entry.isDirectory)
  const groupRuleMap = buildArchiveGroupRuleMap(
    extractableEntries.map((item) => item.relative),
    flatRules,
    defaultRule
  )

  const totalCount = extractableEntries.length
  let processedCount = 0

  for (const item of normalizedEntries) {
    const { entry, relative } = item
    const isRootLevelFile = !entry.isDirectory && !relative.includes('/')
    const keepInProfileRoot = isRootLevelFile
      ? shouldKeepRootLevelFileAtProfileRoot(relative, {
          ...logContext,
          modloaderPackage
        })
      : false
    const targetRelativePath = resolveArchiveEntryInstallRelativePath(relative, {
      flatRules,
      defaultRule,
      groupRuleMap,
      keepRootLevelFileAtProfileRoot: keepInProfileRoot,
      fallbackRootLevelRoute
    })
    const targetPath = path.resolve(path.join(installRoot, targetRelativePath || relative))
    if (targetPath === normalizedRoot || !isPathInsideRoot(targetPath, normalizedRoot)) {
      throw new Error(`归档安装路径超出目标目录：${relative}`)
    }

    if (entry.isDirectory) {
      continue
    }

    await fs.ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, entry.getData())
    installedFiles.push(targetPath)

    processedCount += 1
    if (onProgress) {
      onProgress({
        processedCount,
        totalCount,
        percent: totalCount > 0 ? (processedCount / totalCount) * 100 : 100,
        filePath: targetPath
      })
    }
  }

  return installedFiles
}

function detectArchiveWrapperPrefix(entries = [], options = {}) {
  const flatRules = Array.isArray(options?.flatRules) ? options.flatRules : []
  const modloaderPackage = options?.modloaderPackage || null
  const recognizedRootSegments = buildRecognizedRootSegments(flatRules)

  if (modloaderPackage?.rootFolder) {
    const rootFolder = normalizeZipPath(modloaderPackage.rootFolder)
    if (rootFolder) {
      const allInsideRootFolder = entries.every((entry) => {
        const entryPath = normalizeZipPath(entry?.entryName || '')
        return !entryPath || entryPath === rootFolder || entryPath.startsWith(`${rootFolder}/`)
      })
      if (allInsideRootFolder) {
        return rootFolder
      }
    }
  }

  const firstSegments = []
  for (const entry of entries) {
    const relative = normalizeZipPath(entry?.entryName || '')
    if (!relative || !relative.includes('/')) {
      continue
    }

    const parts = relative.split('/').filter(Boolean)
    if (parts.length < 2) {
      continue
    }

    const leafName = path.basename(relative).toLowerCase()
    if (SKIP_ROOT_FILES.has(leafName) && parts.length <= 2) {
      continue
    }

    firstSegments.push(parts[0])
  }

  const unique = Array.from(new Set(firstSegments))
  if (unique.length !== 1) {
    return ''
  }

  const onlyPrefix = String(unique[0] || '').trim()
  if (!onlyPrefix) {
    return ''
  }

  if (recognizedRootSegments.has(onlyPrefix.toLowerCase())) {
    return ''
  }

  return onlyPrefix
}

async function resolveDoorstopTargetArgument(profileRoot) {
  const configPath = path.join(profileRoot, 'doorstop_config.ini')
  if (!(await fs.pathExists(configPath))) {
    return '--doorstop-target'
  }

  try {
    const versionPath = path.join(profileRoot, '.doorstop_version')
    const [content, versionText] = await Promise.all([
      fs.readFile(configPath, 'utf8').then((value) => String(value || '')),
      fs
        .pathExists(versionPath)
        .then((exists) =>
          exists ? fs.readFile(versionPath, 'utf8').then((value) => String(value || '')) : ''
        )
    ])
    const versionMajor = Number(
      String(versionText)
        .trim()
        .match(/^v?(\d+)/i)?.[1] || 0
    )
    const isPeakDoorstop4 = versionMajor >= 4 && /peak/i.test(versionText)
    const hasDoorstop4Target = /^\s*target_assembly\s*=/im.test(content)

    if (isPeakDoorstop4 && !hasDoorstop4Target) {
      const error = new Error(
        '检测到 PEAK 的 BepInEx 加载器文件版本混用，请重装 BepInExPack_PEAK 后再启动模组版'
      )
      error.code = 'bepinex_loader_version_conflict'
      throw error
    }

    if (hasDoorstop4Target) {
      return '--doorstop-target-assembly'
    }
    if (/^\s*(?:target|targetassembly)\s*=/im.test(content)) {
      return '--doorstop-target'
    }
  } catch (error) {
    if (error?.code === 'bepinex_loader_version_conflict') {
      throw error
    }
    console.warn('[thunderstore] 读取 doorstop_config.ini 失败，使用默认 Doorstop 参数', error)
  }

  return '--doorstop-target'
}

async function resolveBepInExPreloaderDll(profileRoot) {
  const corePath = path.join(profileRoot, 'BepInEx', 'core')
  const fallbackPath = path.join(corePath, 'BepInEx.Preloader.dll')
  if (!(await fs.pathExists(corePath))) {
    return fallbackPath
  }

  try {
    const files = await fs.readdir(corePath)
    const expectedNames = [
      'BepInEx.Unity.Mono.Preloader.dll',
      'BepInEx.Unity.IL2CPP.dll',
      'BepInEx.Preloader.dll',
      'BepInEx.IL2CPP.dll'
    ]

    const exact = expectedNames.find((name) => files.includes(name))
    if (exact) {
      return path.join(corePath, exact)
    }

    const fuzzy = files.find((name) => {
      const lower = String(name || '').toLowerCase()
      return lower.endsWith('.dll') && lower.includes('bepinex') && lower.includes('preloader')
    })
    return fuzzy ? path.join(corePath, fuzzy) : fallbackPath
  } catch (error) {
    console.warn('[thunderstore] 识别 BepInEx 预加载 DLL 失败，使用默认路径', error)
    return fallbackPath
  }
}

async function repairLegacyProfileWrapperLayout(profileRoot) {
  if (!(await fs.pathExists(profileRoot))) {
    return {
      movedFiles: 0,
      wrapperDir: ''
    }
  }

  const suspiciousRootFiles = new Set([
    'doorstop_config.ini',
    'winhttp.dll',
    'winmm.dll',
    'version.dll'
  ])
  const rootEntries = await fs.readdir(profileRoot, { withFileTypes: true })
  let movedFiles = 0
  const repairedDirs = []

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue
    }

    const wrapperDir = String(entry.name || '').trim()
    const wrapperKey = wrapperDir.toLowerCase()
    if (!wrapperDir || KNOWN_INSTALL_ROOT_DIRS.has(wrapperKey) || wrapperKey === '_state') {
      continue
    }

    const wrapperPath = path.join(profileRoot, wrapperDir)
    const childEntries = await fs.readdir(wrapperPath, { withFileTypes: true })
    if (!childEntries.length) {
      continue
    }

    const childLowerSet = new Set(
      childEntries
        .map((child) =>
          String(child?.name || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
    const hasKnownDirs = Array.from(childLowerSet).some((name) => KNOWN_INSTALL_ROOT_DIRS.has(name))
    const hasSuspiciousFiles = Array.from(childLowerSet).some((name) =>
      suspiciousRootFiles.has(name)
    )
    if (!hasKnownDirs && !hasSuspiciousFiles) {
      continue
    }

    for (const child of childEntries) {
      const sourcePath = path.join(wrapperPath, child.name)
      const targetPath = path.join(profileRoot, child.name)

      if (child.isDirectory()) {
        await fs.ensureDir(targetPath)
        await fs.copy(sourcePath, targetPath, {
          overwrite: true,
          errorOnExist: false
        })
        await fs.remove(sourcePath)
      } else {
        await fs.ensureDir(path.dirname(targetPath))
        await fs.copy(sourcePath, targetPath, {
          overwrite: true,
          errorOnExist: false
        })
        await fs.remove(sourcePath)
      }
      movedFiles += 1
    }

    const remains = await fs.readdir(wrapperPath)
    if (!remains.length) {
      await fs.remove(wrapperPath)
    }
    repairedDirs.push(wrapperDir)
  }

  return {
    movedFiles,
    wrapperDir: repairedDirs.join(', ')
  }
}

async function buildLaunchConfigurationByLoader(packageLoader, profileRoot, launchMode = 'modded') {
  const loader = normalizeLoader(packageLoader)
  const mode = normalizeLaunchMode(launchMode)
  const args = []
  const env = {
    THUNDERSTORE_PROFILE: profileRoot
  }
  const notes = []

  if (loader === 'bepinex') {
    const preloaderDll = await resolveBepInExPreloaderDll(profileRoot)
    const doorstopTargetArg = await resolveDoorstopTargetArgument(profileRoot)
    if (mode === 'modded') {
      args.push(
        '--doorstop-enable',
        'true',
        '--doorstop-enabled',
        'true',
        doorstopTargetArg,
        preloaderDll
      )
    } else {
      args.push('--doorstop-enable', 'false', '--doorstop-enabled', 'false')
    }
    env.BEPINEX_ROOT = path.join(profileRoot, 'BepInEx')
    env.BEPINEX_CONFIGS = path.join(profileRoot, 'BepInEx', 'config')
    env.BEPINEX_PLUGINS = path.join(profileRoot, 'BepInEx', 'plugins')
    notes.push(`BepInEx 使用 Doorstop 参数切换模组模式（${doorstopTargetArg}）。`)
  } else if (loader === 'northstar') {
    if (mode === 'modded') {
      args.push('-northstar', `-profile=${path.join(profileRoot, 'BepInEx')}`)
    } else {
      args.push('-vanilla')
    }
    env.NORTHSTAR_PROFILE = profileRoot
    notes.push('Northstar 使用 -northstar/-vanilla 区分模式。')
  } else if (loader === 'melonloader') {
    if (mode === 'modded') {
      args.push('--melonloader.basedir', profileRoot)
    } else {
      args.push('--no-mods')
    }
    env.MELONLOADER_USERDATA = path.join(profileRoot, 'UserData')
    env.MELONLOADER_MODS = path.join(profileRoot, 'Mods')
    notes.push('MelonLoader 仍需游戏目录存在加载器文件。')
  } else if (loader === 'lovely') {
    if (mode === 'modded') {
      args.push('--mod-dir', path.join(profileRoot, 'mods'))
    } else {
      args.push('--vanilla')
    }
    env.LOVELY_MOD_DIR = path.join(profileRoot, 'mods')
    notes.push('Lovely 使用 --mod-dir/--vanilla 参数切换。')
  } else if (loader === 'gdweave') {
    const gdweaveFolder = path.join(profileRoot, 'GDWeave')
    if (mode === 'modded') {
      args.push(`--gdweave-folder-override=${gdweaveFolder}`)
    } else {
      args.push('--gdweave-disable')
    }
    env.GDWEAVE_MOD_DIR = gdweaveFolder
    notes.push('GDWeave 使用覆盖目录参数切换。')
  } else if (loader === 'umm') {
    const ummPreloaderDll = path.join(
      profileRoot,
      'umm',
      'UnityModManager',
      'doorstop_proxy_x64.dll'
    )
    if (mode === 'modded') {
      args.push(
        '--doorstop-enable',
        'true',
        '--doorstop-enabled',
        'true',
        '--doorstop-target',
        ummPreloaderDll
      )
    } else {
      args.push('--doorstop-enable', 'false', '--doorstop-enabled', 'false')
    }
    notes.push('UMM 使用 Doorstop 参数切换。')
  } else if (loader === 'bepisloader') {
    const bepisTarget = path.join(profileRoot, 'BepInEx', 'core', 'BepInEx.Unity.IL2CPP.dll')
    if (mode === 'modded') {
      args.push(
        '--hookfxr-enable',
        '--bepinex-target',
        path.join(profileRoot, 'BepInEx'),
        '--doorstop-enabled',
        'true',
        '--doorstop-target-assembly',
        bepisTarget
      )
    } else {
      args.push('--hookfxr-disable', '--doorstop-enabled', 'false')
    }
    notes.push('BepisLoader 使用 hookfxr + Doorstop 参数切换。')
  } else {
    notes.push('未识别加载器类型，已返回通用 Profile 环境变量。')
  }

  return {
    packageLoader: loader,
    launchMode: mode,
    args,
    env,
    notes
  }
}

async function ensureProfileLoaderReady(packageLoader, profileRoot, launchMode = 'modded') {
  const mode = normalizeLaunchMode(launchMode)
  if (mode !== 'modded') {
    return
  }

  const loader = normalizeLoader(packageLoader)
  if (loader !== 'bepinex' && loader !== 'bepisloader') {
    return
  }

  const doorstopConfigPath = path.join(profileRoot, 'doorstop_config.ini')
  const hasDoorstopConfig = await fs.pathExists(doorstopConfigPath)
  const hasAnyProxyDll = await Promise.all([
    fs.pathExists(path.join(profileRoot, 'winhttp.dll')),
    fs.pathExists(path.join(profileRoot, 'winmm.dll')),
    fs.pathExists(path.join(profileRoot, 'version.dll'))
  ]).then((flags) => flags.some(Boolean))
  const preloaderDllPath = await resolveBepInExPreloaderDll(profileRoot)
  const hasPreloaderDll = await fs.pathExists(preloaderDllPath)

  if (!hasDoorstopConfig || !hasAnyProxyDll || !hasPreloaderDll) {
    throw new Error('未检测到完整 BepInEx 加载器文件，请先安装 BepInExPack（或重装后再启动模组版）')
  }
}

async function isFileIdentical(sourcePath, targetPath) {
  if (!(await fs.pathExists(sourcePath)) || !(await fs.pathExists(targetPath))) {
    return false
  }

  const [sourceStat, targetStat] = await Promise.all([fs.stat(sourcePath), fs.stat(targetPath)])
  return sourceStat.size === targetStat.size && sourceStat.mtimeMs === targetStat.mtimeMs
}

function getExcludedProfileDirs() {
  return new Set([
    'bepinex',
    'bepinex_server',
    'mods',
    'melonloader',
    'plugins',
    'userdata',
    '_state',
    'userlibs',
    'qmods',
    'shimloader',
    'returnofmodding',
    'gdweave',
    'renderer',
    'umm',
    'rivet'
  ])
}

async function copyFileWithMtime(sourcePath, targetPath) {
  if (await isFileIdentical(sourcePath, targetPath)) {
    return false
  }

  await fs.ensureDir(path.dirname(targetPath))
  await fs.copyFile(sourcePath, targetPath)
  const sourceStat = await fs.stat(sourcePath)
  await fs.utimes(targetPath, sourceStat.atime, sourceStat.mtime)
  return true
}

async function copyDirRecursive(sourceDir, targetDir, linkedFiles) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(sourcePath, targetPath, linkedFiles)
      continue
    }
    await copyFileWithMtime(sourcePath, targetPath)
    linkedFiles.push(targetPath)
  }
}

async function linkProfileFilesToGame(profileRoot, gameRoot, packageLoader) {
  const linkedFiles = []
  const excludedDirs = getExcludedProfileDirs()
  const loader = normalizeLoader(packageLoader)
  const entries = await fs.readdir(profileRoot, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(profileRoot, entry.name)

    if (entry.isDirectory()) {
      const key = String(entry.name || '').toLowerCase()
      if (excludedDirs.has(key)) {
        continue
      }
      const targetDir = path.join(gameRoot, entry.name)
      await copyDirRecursive(sourcePath, targetDir, linkedFiles)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const lowerName = String(entry.name || '').toLowerCase()
    if (lowerName === 'mods.yml') {
      continue
    }

    let targetRoot = gameRoot
    if (loader === 'rivet' && lowerName === 'version.dll') {
      targetRoot = path.join(gameRoot, 'Release')
    }

    if (
      loader === 'shimloader' &&
      ['ue4ss.dll', 'dwmapi.dll', 'ue4ss-settings.ini'].includes(lowerName)
    ) {
      targetRoot = path.join(gameRoot, 'Binaries', 'Win64')
    }

    const targetPath = path.join(targetRoot, entry.name)
    await copyFileWithMtime(sourcePath, targetPath)
    linkedFiles.push(targetPath)
  }

  return linkedFiles
}

async function spawnGameProcess(gameExePath, args = [], env = {}) {
  return await new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(gameExePath, args, {
      detached: true,
      windowsVerbatimArguments: false,
      stdio: 'ignore',
      cwd: path.dirname(gameExePath),
      env: {
        ...process.env,
        ...env
      }
    })

    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })

    setTimeout(() => {
      if (settled) return
      settled = true
      child.unref()
      resolve({
        pid: Number(child.pid || 0)
      })
    }, 260)
  })
}

async function spawnSteamGameProcess(appId, args = [], env = {}) {
  const appIdNum = toSafeInteger(appId)
  if (appIdNum <= 0) {
    return null
  }

  const steamExePath = await resolveSteamExePath()
  if (!steamExePath) {
    return null
  }

  return await new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(steamExePath, ['-applaunch', String(appIdNum), ...args], {
      detached: true,
      windowsVerbatimArguments: false,
      stdio: 'ignore',
      cwd: path.dirname(steamExePath),
      env: {
        ...process.env,
        ...env
      }
    })

    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })

    setTimeout(() => {
      if (settled) return
      settled = true
      child.unref()
      resolve({
        pid: Number(child.pid || 0),
        steamExePath
      })
    }, 260)
  })
}

async function resolveGameLaunchInfo(appId, community = '') {
  const appIdNum = toSafeInteger(appId)
  if (appIdNum <= 0) {
    return {
      appId: 0,
      gameExePath: '',
      installed: false
    }
  }

  const game = getGameDataByAppId(appIdNum, {
    source: community ? 'thunderstore' : '',
    sourceId: community,
    sourceSlug: community,
    appId: appIdNum
  })
  const exePath = String(game?.client_exe_path || '')
  const installed = !!(exePath && (await fs.pathExists(exePath)))

  return {
    appId: appIdNum,
    gameExePath: installed ? exePath : '',
    installed,
    game: game || null
  }
}

async function resolveStoredProfileLaunchInfo(community, profileName) {
  const profile = getThunderstoreProfile({
    community,
    profileName
  })
  if (!profile) {
    return {
      appId: 0,
      gameExePath: '',
      installed: false,
      profile
    }
  }

  const storedExePath = normalizeExecutablePath(profile.gameExePath)
  const installed = !!(storedExePath && (await fs.pathExists(storedExePath)))

  return {
    appId: Number(profile.appId || 0),
    gameExePath: installed ? storedExePath : '',
    installed,
    profile
  }
}

function getDefaultSteamRoots() {
  const fromRegistry = []
  try {
    const hkcu = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString('utf8')
    const hkcuMatch = hkcu.match(/SteamPath\s+REG_\w+\s+(.+)/i)
    if (hkcuMatch?.[1]) {
      fromRegistry.push(String(hkcuMatch[1]).trim().replace(/\//g, '\\'))
    }
  } catch (error) {
    void error
  }

  try {
    const hklm = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString('utf8')
    const hklmMatch = hklm.match(/InstallPath\s+REG_\w+\s+(.+)/i)
    if (hklmMatch?.[1]) {
      fromRegistry.push(String(hklmMatch[1]).trim().replace(/\//g, '\\'))
    }
  } catch (error) {
    void error
  }

  const candidates = [
    ...fromRegistry,
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    'C:\\Steam'
  ]
  return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)))
}

async function resolveSteamExePath() {
  const roots = getDefaultSteamRoots()
  for (const root of roots) {
    const steamExePath = path.join(root, 'Steam.exe')
    if (await fs.pathExists(steamExePath)) {
      return steamExePath
    }
  }
  return ''
}

async function parseSteamLibraryFolders(steamRoot) {
  const filePath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  if (!(await fs.pathExists(filePath))) {
    return []
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const libraries = []
    const pathRegex = /"path"\s*"([^"]+)"/g
    let match = pathRegex.exec(content)
    while (match) {
      const raw = String(match[1] || '')
      const normalized = raw.replace(/\\\\/g, '\\').trim()
      if (normalized) {
        libraries.push(normalized)
      }
      match = pathRegex.exec(content)
    }
    return Array.from(new Set(libraries))
  } catch (error) {
    console.warn('[thunderstore] 解析 Steam 库目录失败', error)
    return []
  }
}

async function resolveExeFromInstallLocation(installLocation, exeNames = []) {
  const root = String(installLocation || '').trim()
  if (!root || !(await fs.pathExists(root))) {
    return ''
  }

  const normalizedExeNames = normalizeExeNames(exeNames)
  for (const exeName of normalizedExeNames) {
    const directPath = path.join(root, exeName)
    if (await fs.pathExists(directPath)) {
      return directPath
    }
  }

  for (const exeName of normalizedExeNames) {
    const found = await findFileParallel(root, exeName)
    if (found?.status && found?.path) {
      return found.path
    }
  }

  return ''
}

async function tryResolveFromSteamAppInfo(appId, exeNames = []) {
  const appInfo = await getSteamAppInfo(String(appId || ''))
  const installLocation = String(appInfo?.InstallLocation || '').trim()
  if (!installLocation) {
    return ''
  }

  return await resolveExeFromInstallLocation(installLocation, exeNames)
}

async function tryResolveFromSteamLibraries(steamFolderName = '', exeNames = []) {
  const normalizedFolderName = String(steamFolderName || '').trim()
  if (!normalizedFolderName) {
    return ''
  }

  const roots = getDefaultSteamRoots()
  const libraries = new Set()
  for (const root of roots) {
    libraries.add(root)
    const extra = await parseSteamLibraryFolders(root)
    for (const lib of extra) {
      libraries.add(lib)
    }
  }

  for (const lib of libraries) {
    const installLocation = path.join(lib, 'steamapps', 'common', normalizedFolderName)
    const resolved = await resolveExeFromInstallLocation(installLocation, exeNames)
    if (resolved) {
      return resolved
    }
  }

  return ''
}

async function autoDetectGameExecutable(
  appId,
  exeNames = [],
  steamFolderName = '',
  community = ''
) {
  const fromDb = await resolveGameLaunchInfo(appId, community)
  if (fromDb?.gameExePath) {
    return {
      appId: fromDb.appId,
      gameExePath: fromDb.gameExePath,
      source: 'local-db'
    }
  }

  const fromSteamAppInfo = await tryResolveFromSteamAppInfo(appId, exeNames)
  if (fromSteamAppInfo) {
    return {
      appId: toSafeInteger(appId),
      gameExePath: fromSteamAppInfo,
      source: 'steam-app-info'
    }
  }

  const fromLibrary = await tryResolveFromSteamLibraries(steamFolderName, exeNames)
  if (fromLibrary) {
    return {
      appId: toSafeInteger(appId),
      gameExePath: fromLibrary,
      source: 'steam-library'
    }
  }

  return {
    appId: toSafeInteger(appId),
    gameExePath: '',
    source: 'none'
  }
}

/**
 * 模仿 r2modman 的 setGameDirIfUnset：
 * 1. 先使用已保存路径
 * 2. 再用调用方传入路径
 * 3. 最后尝试基于 appId 自动识别
 * 任一步成功都会回写独立 Profile 配置。
 */
async function setGameExecutableIfUnset(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const packageLoader = String(payload?.packageLoader || '')
  const profileRoot = String(payload?.profileRoot || getProfileRoot(community, profileName))
  const appId = toSafeInteger(payload?.appId)
  const preferredGameExePath = normalizeExecutablePath(payload?.gameExePath)
  const exeNames = normalizeExeNames(payload?.exeNames)
  const steamFolderName = String(payload?.steamFolderName || '').trim()

  const storedInfo = await resolveStoredProfileLaunchInfo(community, profileName)
  if (storedInfo.gameExePath) {
    return {
      appId: storedInfo.appId || appId || 0,
      gameExePath: storedInfo.gameExePath
    }
  }

  const preferredExists = !!(preferredGameExePath && (await fs.pathExists(preferredGameExePath)))
  if (preferredExists) {
    upsertThunderstoreProfile({
      community,
      profileName,
      packageLoader,
      appId,
      gameExePath: preferredGameExePath,
      profileRoot
    })
    return {
      appId,
      gameExePath: preferredGameExePath
    }
  }

  const resolvedAuto = await autoDetectGameExecutable(appId, exeNames, steamFolderName)
  if (resolvedAuto.gameExePath) {
    upsertThunderstoreProfile({
      community,
      profileName,
      packageLoader,
      appId: resolvedAuto.appId,
      gameExePath: resolvedAuto.gameExePath,
      profileRoot
    })
    return {
      appId: resolvedAuto.appId,
      gameExePath: resolvedAuto.gameExePath
    }
  }

  return {
    appId: appId || 0,
    gameExePath: ''
  }
}

/**
 * 模仿 r2modman 的 throwIfNoGameDir。
 */
function throwIfNoGameExecutable(gameExePath) {
  if (!String(gameExePath || '').trim()) {
    throw new Error('未识别到可启动的游戏可执行文件，请先选择游戏 EXE')
  }
}

export async function thunderstoreSelectGameExecutable(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const preferPath = normalizeExecutablePath(payload?.preferPath)

  const profileRoot = getProfileRoot(community, profileName)
  await fs.ensureDir(profileRoot)

  const result = await dialog.showOpenDialog({
    title: nativeText('selectGameExecutable'),
    defaultPath: preferPath || undefined,
    filters: [{ name: '可执行文件', extensions: ['exe'] }],
    properties: ['openFile']
  })

  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return {
      canceled: true,
      gameExePath: ''
    }
  }

  const gameExePath = normalizeExecutablePath(result.filePaths[0])
  const exists = !!(gameExePath && (await fs.pathExists(gameExePath)))
  if (!exists) {
    throw new Error('选择的可执行文件不存在')
  }

  const currentProfile = getThunderstoreProfile({
    community,
    profileName
  })

  upsertThunderstoreProfile({
    community,
    profileName,
    packageLoader: String(currentProfile?.packageLoader || payload?.packageLoader || ''),
    appId: Number(currentProfile?.appId || payload?.appId || 0),
    gameExePath,
    profileRoot: String(currentProfile?.profileRoot || profileRoot)
  })

  return {
    canceled: false,
    gameExePath
  }
}

export async function thunderstoreDetectInstalledGame(payload = {}) {
  const steamAppIds = Array.isArray(payload?.steamAppIds) ? payload.steamAppIds : []
  const exeNames = normalizeExeNames(payload?.exeNames)
  const steamFolderName = String(payload?.steamFolderName || '').trim()
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const sourceMeta = normalizeGameSourceMeta(
    payload?.sourceMeta || {
      source: 'thunderstore',
      sourceId: community,
      name: payload?.displayName || payload?.name || community,
      backgroundImage: payload?.backgroundImage || payload?.coverImage || ''
    }
  )

  const profileInfo = await resolveStoredProfileLaunchInfo(community, profileName)
  if (profileInfo?.gameExePath) {
    try {
      await upsertDetectedGameToLibrary(profileInfo.appId, profileInfo.gameExePath, sourceMeta)
    } catch (error) {
      console.error('[thunderstore] 读取档案后写入我的游戏失败', error)
    }

    return {
      installed: true,
      appId: profileInfo.appId || 0,
      exePath: profileInfo.gameExePath,
      source: 'profile'
    }
  }

  for (const rawId of steamAppIds) {
    const detected = await autoDetectGameExecutable(rawId, exeNames, steamFolderName, community)
    if (detected?.gameExePath) {
      const profileRoot = getProfileRoot(community, profileName)
      await fs.ensureDir(profileRoot)
      upsertThunderstoreProfile({
        community,
        profileName,
        packageLoader: String(payload?.packageLoader || ''),
        appId: detected.appId || 0,
        gameExePath: detected.gameExePath,
        profileRoot
      })

      try {
        await upsertDetectedGameToLibrary(detected.appId, detected.gameExePath, sourceMeta)
      } catch (error) {
        console.error('[thunderstore] 自动写入我的游戏失败', error)
      }

      return {
        installed: true,
        appId: detected.appId,
        exePath: detected.gameExePath,
        source: detected.source
      }
    }
  }

  return {
    installed: false,
    appId: 0
  }
}

export async function thunderstoreGetInstallState(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const installed = getThunderstoreInstalledMap({
    community,
    profileName
  })

  return {
    community,
    profileName,
    installed
  }
}

function isThunderstoreRecordEnabled(record = {}) {
  return Number(record?.installState ?? record?.isActive ?? 0) === 1
}

function getDisabledModRoot(profileRoot, packageFullName = '') {
  return path.join(
    String(profileRoot || ''),
    '_state',
    'disabled_mods',
    normalizeFsName(packageFullName || 'package') || 'package'
  )
}

function getRecordRelativeFilePath(profileRoot, filePath) {
  const normalizedRoot = path.resolve(String(profileRoot || ''))
  const normalizedFilePath = path.resolve(String(filePath || ''))
  if (!normalizedRoot || !isPathInsideRoot(normalizedFilePath, normalizedRoot)) {
    return ''
  }

  return normalizeZipPath(path.relative(normalizedRoot, normalizedFilePath))
}

function resolveRecordInstallRoot(record = {}, fallbackRoot = '') {
  const installRoot = String(
    record?.metadata?.installRoot || record?.metadata?.targetPath || fallbackRoot || ''
  ).trim()
  return path.resolve(installRoot)
}

function buildThunderstoreSharedFileSet(
  installedRecords = [],
  excludedFullNameSet = new Set(),
  options = {}
) {
  const enabledOnly = !!options?.enabledOnly
  const result = new Set()

  for (const item of Array.isArray(installedRecords) ? installedRecords : []) {
    const fullName = normalizeFullName(item?.fullName || '')
    if (!fullName || excludedFullNameSet.has(fullName)) {
      continue
    }
    if (enabledOnly && !isThunderstoreRecordEnabled(item)) {
      continue
    }

    for (const filePath of Array.isArray(item?.files) ? item.files : []) {
      const compareKey = normalizePathForCompare(path.resolve(String(filePath || '')))
      if (compareKey) {
        result.add(compareKey)
      }
    }
  }

  return result
}

function collectThunderstoreRecordActionFilePaths(
  record,
  sourceRoot,
  installRootFallback,
  sharedFileSet = new Set()
) {
  const files = Array.isArray(record?.files) ? record.files : []
  const normalizedInstallRoot = resolveRecordInstallRoot(record, installRootFallback)
  const normalizedSourceRoot = path.resolve(String(sourceRoot || normalizedInstallRoot || ''))
  const result = []

  for (const rawFilePath of files) {
    const recordedPath = path.resolve(String(rawFilePath || ''))
    const relativePath = getRecordRelativeFilePath(normalizedInstallRoot, recordedPath)
    if (!relativePath) {
      continue
    }

    const logicalProfilePath = path.resolve(path.join(normalizedInstallRoot, relativePath))
    const compareKey = normalizePathForCompare(logicalProfilePath)
    if (compareKey && sharedFileSet.has(compareKey)) {
      continue
    }

    const actualPath = path.resolve(path.join(normalizedSourceRoot, relativePath))
    if (!isPathInsideRoot(actualPath, normalizedSourceRoot)) {
      continue
    }

    result.push(actualPath)
  }

  return result
}

function inspectThunderstoreRecordsOccupancy(
  targetRecords = [],
  installedRecords = [],
  profileRoot = '',
  action = 'disable'
) {
  const safeTargetRecords = Array.isArray(targetRecords) ? targetRecords.filter(Boolean) : []
  const safeInstalledRecords = Array.isArray(installedRecords) ? installedRecords : []
  const normalizedProfileRoot = path.resolve(String(profileRoot || ''))
  const targetFullNameSet = new Set(
    safeTargetRecords.map((item) => normalizeFullName(item?.fullName || '')).filter(Boolean)
  )
  const candidateFiles = []

  if (
    String(action || '')
      .trim()
      .toLowerCase() === 'uninstall'
  ) {
    const sharedFileSet = buildThunderstoreSharedFileSet(safeInstalledRecords, targetFullNameSet)
    for (const record of safeTargetRecords) {
      candidateFiles.push(
        ...collectThunderstoreRecordActionFilePaths(
          record,
          normalizedProfileRoot,
          normalizedProfileRoot,
          sharedFileSet
        )
      )

      const disabledRoot = getDisabledModRoot(normalizedProfileRoot, record?.fullName || '')
      candidateFiles.push(
        ...collectThunderstoreRecordActionFilePaths(
          record,
          disabledRoot,
          normalizedProfileRoot,
          new Set()
        )
      )
    }
  } else {
    const sharedFileSet = buildThunderstoreSharedFileSet(safeInstalledRecords, targetFullNameSet, {
      enabledOnly: true
    })

    for (const record of safeTargetRecords) {
      if (!isThunderstoreRecordEnabled(record)) {
        continue
      }

      candidateFiles.push(
        ...collectThunderstoreRecordActionFilePaths(
          record,
          normalizedProfileRoot,
          normalizedProfileRoot,
          sharedFileSet
        )
      )
    }
  }

  const inspectResult = inspectFileOccupancy(candidateFiles)
  return {
    ...inspectResult,
    success: !inspectResult.hasOccupiedFiles,
    message: inspectResult.hasOccupiedFiles
      ? buildOccupiedFilesMessage(inspectResult.occupiedFiles)
      : ''
  }
}

async function moveInstalledRecordFiles(record, profileRoot, targetRoot, options = {}) {
  const files = Array.isArray(record?.files) ? record.files : []
  const normalizedProfileRoot = path.resolve(String(profileRoot || ''))
  const normalizedTargetRoot = path.resolve(String(targetRoot || ''))
  const normalizedInstallRoot = resolveRecordInstallRoot(
    record,
    String(options?.installRoot || '').trim() || normalizedTargetRoot
  )
  const sharedFileSet = options?.sharedFileSet instanceof Set ? options.sharedFileSet : new Set()
  const skipIfTargetExists = !!options?.skipIfTargetExists
  // 禁用目录也必须位于实际安装根内，检查其中间祖先，不能仅检查禁用目录的子路径。
  assertThunderstoreChild(normalizedInstallRoot, normalizedProfileRoot, { allowRoot: true })
  assertThunderstoreChild(normalizedInstallRoot, normalizedTargetRoot, { allowRoot: true })
  const result = {
    movedFilesCount: 0,
    skippedSharedFilesCount: 0,
    skippedUnsafeFilesCount: 0,
    missingFilesCount: 0
  }

  const planned = []
  for (const rawFilePath of files) {
    const recordedPath = path.resolve(String(rawFilePath || ''))
    const relativePath = getRecordRelativeFilePath(normalizedInstallRoot, recordedPath)
    if (!relativePath) {
      result.skippedUnsafeFilesCount += 1
      continue
    }

    const sourcePath = path.resolve(path.join(normalizedProfileRoot, relativePath))
    if (!isPathInsideRoot(sourcePath, normalizedProfileRoot)) {
      result.skippedUnsafeFilesCount += 1
      continue
    }

    const logicalProfilePath = path.resolve(path.join(normalizedInstallRoot, relativePath))
    const compareKey = normalizePathForCompare(logicalProfilePath)
    if (sharedFileSet.has(compareKey)) {
      result.skippedSharedFilesCount += 1
      continue
    }

    const targetPath = path.resolve(path.join(normalizedTargetRoot, relativePath))
    if (!isPathInsideRoot(targetPath, normalizedTargetRoot)) {
      result.skippedUnsafeFilesCount += 1
      continue
    }

    assertThunderstoreChild(normalizedInstallRoot, sourcePath)
    assertThunderstoreChild(normalizedInstallRoot, targetPath)
    if (skipIfTargetExists && await fs.pathExists(sourcePath) && await fs.pathExists(targetPath)) {
      const [sourceDigest, targetDigest] = await Promise.all([
        calculateArchiveDigest(sourcePath), calculateArchiveDigest(targetPath)
      ])
      if (sourceDigest.md5 !== targetDigest.md5 || sourceDigest.fileSize !== targetDigest.fileSize)
        throw Object.assign(new Error('启用目标已有不同内容的同名文件，已保留禁用版本，请先处理冲突'), {
          code: 'thunderstore_file_conflict'
        })
    }
    planned.push({ sourcePath, targetPath })
  }

  // 全量检查冲突后再移动，避免后面的同名冲突留下半启用状态。
  for (const { sourcePath, targetPath } of planned) {
    assertThunderstoreChild(normalizedInstallRoot, sourcePath)
    assertThunderstoreChild(normalizedInstallRoot, targetPath)

    if (!(await fs.pathExists(sourcePath))) {
      if (skipIfTargetExists && (await fs.pathExists(targetPath))) {
        continue
      }
      result.missingFilesCount += 1
      continue
    }

    if (skipIfTargetExists && (await fs.pathExists(targetPath))) {
      const [sourceDigest, targetDigest] = await Promise.all([
        calculateArchiveDigest(sourcePath), calculateArchiveDigest(targetPath)
      ])
      if (sourceDigest.md5 !== targetDigest.md5 || sourceDigest.fileSize !== targetDigest.fileSize)
        throw Object.assign(new Error('启用目标文件在检查后变化，已保留禁用版本'), { code: 'thunderstore_file_conflict' })
      assertThunderstoreChild(normalizedInstallRoot, sourcePath)
      assertThunderstoreChild(normalizedInstallRoot, targetPath)
      await fs.unlink(sourcePath)
      await removeEmptyParentDirs(sourcePath, normalizedProfileRoot)
      result.movedFilesCount += 1
      continue
    }

    await fs.ensureDir(path.dirname(targetPath))
    assertThunderstoreChild(normalizedInstallRoot, sourcePath)
    assertThunderstoreChild(normalizedInstallRoot, targetPath)
    await fs.move(sourcePath, targetPath, { overwrite: true })
    result.movedFilesCount += 1
    await removeEmptyParentDirs(sourcePath, normalizedProfileRoot)
  }

  return result
}

function mergeNumericResults(results = []) {
  const merged = {}
  for (const item of Array.isArray(results) ? results : []) {
    if (!item || typeof item !== 'object') {
      continue
    }
    for (const [key, value] of Object.entries(item)) {
      if (!Number.isFinite(Number(value))) {
        continue
      }
      merged[key] = Number(merged[key] || 0) + Number(value || 0)
    }
  }
  return merged
}

function collectRecursiveDependants(installedRecords = [], packageFullNames = []) {
  const queue = [
    ...new Set(
      (Array.isArray(packageFullNames) ? packageFullNames : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ]
  const seen = new Set(queue.map((item) => normalizeFullName(item)))
  const result = []

  while (queue.length > 0) {
    const currentFullName = String(queue.shift() || '').trim()
    const direct = collectDependentPackageNames(installedRecords, currentFullName)
    for (const dependantFullName of direct) {
      const normalized = normalizeFullName(dependantFullName)
      if (!normalized || seen.has(normalized)) {
        continue
      }
      seen.add(normalized)
      result.push(dependantFullName)
      queue.push(dependantFullName)
    }
  }

  return result
}

function getRecordByFullName(installedRecords = [], packageFullName = '') {
  const targetNormalized = normalizeFullName(packageFullName)
  return installedRecords.find(
    (item) => normalizeFullName(item?.fullName || '') === targetNormalized
  )
}

function collectDisabledDependencyPackageNames(installedRecords = [], record = null) {
  const dependencies = Array.isArray(record?.dependencies) ? record.dependencies : []
  const result = []

  for (const dep of dependencies) {
    const parsed = parseDependencyString(dep)
    if (!parsed?.fullName) {
      continue
    }

    const depRecord = getRecordByFullName(installedRecords, parsed.fullName)
    if (depRecord && !isThunderstoreRecordEnabled(depRecord)) {
      result.push(depRecord.fullName)
    }
  }

  return Array.from(new Set(result))
}

function collectRecursiveDependencies(installedRecords = [], packageFullNames = []) {
  const result = []
  const seen = new Set()

  function visit(fullName) {
    const normalized = normalizeFullName(fullName)
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)

    const record = getRecordByFullName(installedRecords, fullName)
    const dependencies = Array.isArray(record?.dependencies) ? record.dependencies : []
    for (const dep of dependencies) {
      const parsed = parseDependencyString(dep)
      if (!parsed?.fullName) {
        continue
      }
      visit(parsed.fullName)
    }

    if (record) {
      result.push(record.fullName)
    }
  }

  for (const fullName of Array.isArray(packageFullNames) ? packageFullNames : []) {
    visit(fullName)
  }

  return result
}

async function setSingleThunderstoreRecordEnabled(
  record,
  enabled,
  profileRoot,
  installedRecords = [],
  context = {}
) {
  const disabledRoot = getDisabledModRoot(profileRoot, record?.fullName || '')
  const sharedFileSet = new Set()

  if (!enabled) {
    for (const item of installedRecords) {
      if (!isThunderstoreRecordEnabled(item)) {
        continue
      }
      if (normalizeFullName(item?.fullName || '') === normalizeFullName(record?.fullName || '')) {
        continue
      }

      for (const filePath of Array.isArray(item?.files) ? item.files : []) {
        sharedFileSet.add(normalizePathForCompare(path.resolve(String(filePath || ''))))
      }
    }
  }

  const moveResult = enabled
    ? await moveInstalledRecordFiles(record, disabledRoot, profileRoot, {
        installRoot: profileRoot,
        skipIfTargetExists: true
      })
    : await moveInstalledRecordFiles(record, profileRoot, disabledRoot, {
        installRoot: profileRoot,
        sharedFileSet
      })

  updateThunderstoreInstalledModState({
    community: context.community,
    profileName: context.profileName,
    appId: context.appId,
    packageFullName: record?.fullName,
    enabled,
    metadata: {
      disabledRoot,
      lastStateChangedAt: new Date().toISOString()
    }
  })

  return moveResult
}

function collectDependentPackageNames(installedRecords = [], targetFullName = '') {
  const targetNormalized = normalizeFullName(targetFullName)
  if (!targetNormalized) {
    return []
  }

  const list = []
  for (const record of installedRecords) {
    const currentFullName = String(record?.fullName || '')
    if (!currentFullName || normalizeFullName(currentFullName) === targetNormalized) {
      continue
    }

    const dependencies = Array.isArray(record?.dependencies) ? record.dependencies : []
    const isDependent = dependencies.some((dep) => {
      const parsed = parseDependencyString(dep)
      return normalizeFullName(parsed.fullName) === targetNormalized
    })

    if (isDependent) {
      list.push(currentFullName)
    }
  }
  return list
}

async function removeEmptyParentDirs(startPath, stopPath) {
  const stopAbs = path.resolve(String(stopPath || ''))
  let current = path.dirname(path.resolve(String(startPath || '')))

  while (current && current !== stopAbs && isPathInsideRoot(current, stopAbs)) {
    assertThunderstoreChild(stopAbs, current)
    const children = await fs.readdir(current)
    if (children.length > 0) {
      break
    }
    assertThunderstoreChild(stopAbs, current)
    await fs.rmdir(current)
    current = path.dirname(current)
  }
}

async function removeInstalledFilesByRecord(
  record,
  profileRoot,
  sharedFileSet = new Set(),
  options = {}
) {
  const files = Array.isArray(record?.files) ? record.files : []
  const normalizedProfileRoot = resolveRecordInstallRoot(record, profileRoot)
  const normalizedSourceRoot = path.resolve(
    String(options?.sourceRoot || '').trim() || normalizedProfileRoot
  )
  assertThunderstoreChild(normalizedProfileRoot, normalizedSourceRoot, { allowRoot: true })
  const result = {
    removedFilesCount: 0,
    skippedSharedFilesCount: 0,
    skippedUnsafeFilesCount: 0,
    missingFilesCount: 0
  }

  for (const rawFilePath of files) {
    const recordedPath = path.resolve(String(rawFilePath || ''))
    const relativePath = getRecordRelativeFilePath(normalizedProfileRoot, recordedPath)
    if (!relativePath) {
      result.skippedUnsafeFilesCount += 1
      continue
    }

    const logicalProfilePath = path.resolve(path.join(normalizedProfileRoot, relativePath))
    const compareKey = normalizePathForCompare(logicalProfilePath)
    if (sharedFileSet.has(compareKey)) {
      result.skippedSharedFilesCount += 1
      continue
    }

    const filePath = path.resolve(path.join(normalizedSourceRoot, relativePath))
    if (!isPathInsideRoot(filePath, normalizedSourceRoot)) {
      result.skippedUnsafeFilesCount += 1
      continue
    }

    assertThunderstoreChild(normalizedProfileRoot, filePath)
    if (!(await fs.pathExists(filePath))) {
      result.missingFilesCount += 1
      continue
    }

    const stat = await fs.lstat(filePath)
    if (!stat.isFile()) throw new Error('模组卸载目标不是普通文件，已停止删除')
    assertThunderstoreChild(normalizedProfileRoot, filePath)
    await fs.unlink(filePath)
    result.removedFilesCount += 1
    await removeEmptyParentDirs(filePath, normalizedSourceRoot)
  }

  return result
}

export async function thunderstoreGetInstalledMods(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  if (!community) {
    throw new Error('community 不能为空')
  }

  const installedRecords = listThunderstoreInstalledMods({
    community,
    profileName
  })

  return {
    community,
    profileName,
    total: installedRecords.length,
    records: installedRecords.map((item) => {
      const disabledDependencyPackageNames = isThunderstoreRecordEnabled(item)
        ? collectDisabledDependencyPackageNames(installedRecords, item)
        : []
      return {
        ...item,
        dependencyCount: Array.isArray(item?.dependencies) ? item.dependencies.length : 0,
        disabledDependencyCount: disabledDependencyPackageNames.length,
        disabledDependencyPackageNames,
        fileCount: Array.isArray(item?.files) ? item.files.length : 0
      }
    })
  }
}

export async function thunderstoreCheckModFileOccupancy(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const packageFullNames = Array.isArray(payload?.packageFullNames)
    ? payload.packageFullNames
    : [payload?.packageFullName]
  const action = String(payload?.action || 'disable')
    .trim()
    .toLowerCase()
  const appId = toSafeInteger(payload?.appId)

  if (!community) {
    throw new Error('community 不能为空')
  }

  const installedRecords = listThunderstoreInstalledMods({
    community,
    profileName,
    appId
  })
  const targetNameSet = new Set(
    packageFullNames.map((item) => normalizeFullName(item || '')).filter(Boolean)
  )
  const targetRecords = installedRecords.filter((item) =>
    targetNameSet.has(normalizeFullName(item?.fullName || ''))
  )

  if (!targetRecords.length) {
    return {
      success: false,
      message: '未找到需要检测的模组'
    }
  }

  const profileInfo = getThunderstoreProfile({
    community,
    profileName
  })
  const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
  await fs.ensureDir(profileRoot)

  const result = inspectThunderstoreRecordsOccupancy(
    targetRecords,
    installedRecords,
    profileRoot,
    action === 'uninstall' ? 'uninstall' : 'disable'
  )

  return {
    success: result.success,
    message: result.message,
    totalCount: result.totalCount,
    occupiedFiles: result.occupiedFiles
  }
}

export async function thunderstoreSetModEnabled(payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const packageFullName = String(payload?.packageFullName || '').trim()
    const enabled = !!payload?.enabled
    const force = !!payload?.force
    const appId = toSafeInteger(payload?.appId)

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!packageFullName) {
      throw new Error('packageFullName 不能为空')
    }

    const installedRecords = listThunderstoreInstalledMods({
      community,
      profileName,
      appId
    })
    const targetRecord = getRecordByFullName(installedRecords, packageFullName)
    if (!targetRecord) {
      throw new Error('未找到对应模组记录')
    }

    const profileInfo = getThunderstoreProfile({
      community,
      profileName
    })
    const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
    await fs.ensureDir(profileRoot)

    const currentEnabled = isThunderstoreRecordEnabled(targetRecord)
    if (currentEnabled === enabled) {
      return {
        success: true,
        code: 'NOOP',
        community,
        profileName,
        packageFullName,
        changedPackageNames: []
      }
    }

    if (!enabled) {
      const dependantPackageNames = collectRecursiveDependants(installedRecords, [
        packageFullName
      ]).filter((fullName) => {
        const record = getRecordByFullName(installedRecords, fullName)
        return record && isThunderstoreRecordEnabled(record)
      })

      if (dependantPackageNames.length > 0 && !force) {
        return {
          success: false,
          code: 'DEPENDANTS_ENABLED',
          community,
          profileName,
          packageFullName,
          dependantPackageNames,
          message: `以下模组依赖当前模组：${dependantPackageNames.join('、')}`
        }
      }

      const targets = [targetRecord]

      const occupancyResult = inspectThunderstoreRecordsOccupancy(
        targets,
        installedRecords,
        profileRoot,
        'disable'
      )
      if (!occupancyResult.success) {
        return {
          success: false,
          code: 'FILES_OCCUPIED',
          community,
          profileName,
          packageFullName,
          occupiedFiles: occupancyResult.occupiedFiles,
          message: occupancyResult.message
        }
      }

      const changedPackageNames = []
      for (const record of targets) {
        await setSingleThunderstoreRecordEnabled(record, false, profileRoot, installedRecords, {
          community,
          profileName,
          appId
        })
        changedPackageNames.push(record.fullName)
        record.installState = 0
        record.isActive = 0
      }

      return {
        success: true,
        community,
        profileName,
        packageFullName,
        changedPackageNames,
        dependantPackageNames,
        message:
          dependantPackageNames.length > 0 ? '模组已禁用，依赖它的模组仍保持启用' : '模组已禁用'
      }
    }

    const dependencyPackageNames = collectDisabledDependencyPackageNames(
      installedRecords,
      targetRecord
    )
    if (dependencyPackageNames.length > 0 && !force) {
      return {
        success: false,
        code: 'DEPENDENCIES_DISABLED',
        community,
        profileName,
        packageFullName,
        dependencyPackageNames,
        message: `以下依赖尚未启用：${dependencyPackageNames.join('、')}`
      }
    }

    const enableOrder = collectRecursiveDependencies(installedRecords, [packageFullName]).filter(
      (fullName) => {
        const record = getRecordByFullName(installedRecords, fullName)
        return record && !isThunderstoreRecordEnabled(record)
      }
    )

    const changedPackageNames = []
    for (const fullName of enableOrder) {
      const record = getRecordByFullName(installedRecords, fullName)
      if (!record) {
        continue
      }
      await setSingleThunderstoreRecordEnabled(record, true, profileRoot, installedRecords, {
        community,
        profileName,
        appId
      })
      changedPackageNames.push(record.fullName)
      record.installState = 1
      record.isActive = 1
    }

    return {
      success: true,
      community,
      profileName,
      packageFullName,
      changedPackageNames,
      message: changedPackageNames.length > 1 ? '模组及依赖已启用' : '模组已启用'
    }
  })
}

export async function thunderstoreSetAllModsEnabled(payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const enabled = !!payload?.enabled
    const appId = toSafeInteger(payload?.appId)

    if (!community) {
      throw new Error('community 不能为空')
    }

    const installedRecords = listThunderstoreInstalledMods({
      community,
      profileName,
      appId
    })
    const targetRecords = installedRecords.filter(
      (record) => isThunderstoreRecordEnabled(record) !== enabled
    )
    const changedSet = new Set()

    if (!enabled && targetRecords.length > 0) {
      const profileInfo = getThunderstoreProfile({
        community,
        profileName
      })
      const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
      await fs.ensureDir(profileRoot)

      const occupancyResult = inspectThunderstoreRecordsOccupancy(
        targetRecords,
        installedRecords,
        profileRoot,
        'disable'
      )
      if (!occupancyResult.success) {
        return {
          success: false,
          code: 'FILES_OCCUPIED',
          community,
          profileName,
          enabled,
          occupiedFiles: occupancyResult.occupiedFiles,
          message: occupancyResult.message
        }
      }
    }

    for (const record of targetRecords) {
      const result = await thunderstoreSetModEnabled({
        community,
        profileName,
        packageFullName: record.fullName,
        enabled,
        force: true,
        appId
      })
      for (const fullName of Array.isArray(result?.changedPackageNames)
        ? result.changedPackageNames
        : []) {
        changedSet.add(fullName)
      }
    }

    return {
      success: true,
      community,
      profileName,
      enabled,
      changedPackageNames: Array.from(changedSet),
      changedCount: changedSet.size
    }
  })
}

export async function thunderstoreGetUpdates(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const appId = toSafeInteger(payload?.appId)

  if (!community) {
    throw new Error('community 不能为空')
  }

  const packages = await fetchCommunityPackageList(community)
  const packageMap = buildPackageIndex(packages)
  const installedRecords = listThunderstoreInstalledMods({
    community,
    profileName,
    appId
  })

  const updates = []
  for (const record of installedRecords) {
    const packageInfo = packageMap.get(normalizeFullName(record?.fullName || ''))
    if (!packageInfo) {
      continue
    }
    const latestVersion = selectPackageVersion(packageInfo)
    const latestVersionNumber = String(latestVersion?.version_number || '').trim()
    const currentVersion = String(record?.version || '').trim()
    const compareResult = compareThunderstoreSemver(latestVersionNumber, currentVersion)
    if (!latestVersionNumber || !currentVersion || compareResult === null || compareResult <= 0) {
      continue
    }

    updates.push({
      fullName: record.fullName,
      currentVersion,
      latestVersion: latestVersionNumber,
      packageName: String(packageInfo?.name || record?.packageName || record?.fullName || ''),
      packageOwner: String(packageInfo?.owner || record?.packageOwner || ''),
      packageUrl: String(packageInfo?.package_url || ''),
      icon: String(latestVersion?.icon || packageInfo?.icon || ''),
      description: String(latestVersion?.description || packageInfo?.description || '')
    })
  }

  return {
    success: true,
    community,
    profileName,
    total: updates.length,
    updates
  }
}

export async function thunderstoreUpdatePackage(event, payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const packageFullName = String(payload?.packageFullName || '').trim()
    const appId = toSafeInteger(payload?.appId)
    const versionNumber = String(payload?.versionNumber || '').trim()
    const allowDowngrade = payload?.allowDowngrade === true

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!packageFullName) {
      throw new Error('packageFullName 不能为空')
    }

    const currentRecord = getThunderstoreInstalledRecord({
      community,
      profileName,
      packageFullName,
      appId
    })
    if (!currentRecord) {
      throw new Error('未找到已安装模组，无法更新')
    }

    let targetVersion = versionNumber
    if (!targetVersion) {
      const packages = await fetchCommunityPackageList(community)
      const packageMap = buildPackageIndex(packages)
      const packageInfo = packageMap.get(normalizeFullName(packageFullName))
      const latestVersion = selectPackageVersion(packageInfo)
      targetVersion = String(latestVersion?.version_number || '').trim()
    }

    if (!targetVersion) {
      throw new Error('未找到可用更新版本')
    }
    const currentVersion = String(currentRecord?.version || '').trim()
    const compareResult = compareThunderstoreSemver(targetVersion, currentVersion)
    if (
      currentVersion === targetVersion ||
      (!allowDowngrade && (compareResult === null || compareResult <= 0))
    ) {
      return {
        success: true,
        code: 'NO_UPDATE',
        community,
        profileName,
        packageFullName,
        currentVersion,
        versionNumber: targetVersion,
        reason: currentVersion === targetVersion ? 'same_version' : 'target_not_newer'
      }
    }

    const profileInfo = getThunderstoreProfile({
      community,
      profileName
    })

    return await thunderstoreInstallPackage(event, {
      community,
      profileName,
      packageFullName,
      versionNumber: targetVersion,
      appId: appId || toSafeInteger(profileInfo?.appId),
      packageLoader:
        String(payload?.packageLoader || '').trim() ||
        String(profileInfo?.packageLoader || currentRecord?.metadata?.packageLoader || '').trim()
    })
  })
}

const THUNDERSTORE_CONFIG_FILE_EXTS = new Set([
  '.cfg',
  '.ini',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.toml',
  '.txt'
])

function shouldIncludeThunderstoreConfigFile(relativePath = '') {
  const normalized = normalizeZipPath(relativePath)
  if (!normalized) {
    return false
  }

  const lowerPath = normalized.toLowerCase()
  if (
    lowerPath.startsWith('_state/') ||
    lowerPath.startsWith('cache/') ||
    lowerPath.startsWith('bepinex/plugins/') ||
    lowerPath.startsWith('mods/') ||
    lowerPath.startsWith('userlibs/')
  ) {
    return false
  }

  if (lowerPath === 'doorstop_config.ini' || lowerPath.endsWith('/doorstop_config.ini')) {
    return true
  }

  const ext = path.extname(lowerPath)
  return THUNDERSTORE_CONFIG_FILE_EXTS.has(ext)
}

async function collectThunderstoreConfigFiles(profileRoot, currentDir, result = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    const relativePath = normalizeZipPath(path.relative(profileRoot, absolutePath))
    if (!relativePath) {
      continue
    }

    const lowerName = String(entry.name || '').toLowerCase()
    if (entry.isDirectory()) {
      if (['_state', 'cache'].includes(lowerName)) {
        continue
      }
      await collectThunderstoreConfigFiles(profileRoot, absolutePath, result)
      continue
    }

    if (!entry.isFile() || !shouldIncludeThunderstoreConfigFile(relativePath)) {
      continue
    }

    const stat = await fs.stat(absolutePath)
    if (Number(stat?.size || 0) > 1024 * 1024 * 2) {
      continue
    }

    result.push({
      relativePath,
      fileName: path.basename(absolutePath),
      size: Number(stat?.size || 0),
      updatedAt: stat?.mtime?.toISOString?.() || ''
    })
  }

  return result
}

function resolveThunderstoreConfigAbsolutePath(profileRoot, relativePath = '') {
  const normalizedRelativePath = normalizeZipPath(relativePath)
  if (!normalizedRelativePath || !shouldIncludeThunderstoreConfigFile(normalizedRelativePath)) {
    throw new Error('配置文件路径不合法')
  }

  const absolutePath = path.resolve(path.join(profileRoot, normalizedRelativePath))
  const normalizedProfileRoot = path.resolve(profileRoot)
  if (!absolutePath.startsWith(normalizedProfileRoot)) {
    throw new Error('配置文件路径越界')
  }

  return absolutePath
}

export async function thunderstoreGetConfigFiles(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileInfo = getThunderstoreProfile({
    community,
    profileName
  })
  const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
  await fs.ensureDir(profileRoot)

  const files = await collectThunderstoreConfigFiles(profileRoot, profileRoot, [])
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  return {
    success: true,
    community,
    profileName,
    profileRoot,
    total: files.length,
    files
  }
}

export async function thunderstoreReadConfigFile(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const relativePath = String(payload?.relativePath || '').trim()
  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileInfo = getThunderstoreProfile({
    community,
    profileName
  })
  const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
  await fs.ensureDir(profileRoot)

  const absolutePath = resolveThunderstoreConfigAbsolutePath(profileRoot, relativePath)
  if (!(await fs.pathExists(absolutePath))) {
    throw new Error('配置文件不存在')
  }

  const content = await fs.readFile(absolutePath, 'utf8')
  return {
    success: true,
    community,
    profileName,
    relativePath: normalizeZipPath(relativePath),
    content
  }
}

export async function thunderstoreWriteConfigFile(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const relativePath = String(payload?.relativePath || '').trim()
  const content = String(payload?.content ?? '')
  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileInfo = getThunderstoreProfile({
    community,
    profileName
  })
  const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
  await fs.ensureDir(profileRoot)

  const absolutePath = resolveThunderstoreConfigAbsolutePath(profileRoot, relativePath)
  await fs.ensureDir(path.dirname(absolutePath))
  await fs.writeFile(absolutePath, content, 'utf8')

  return {
    success: true,
    community,
    profileName,
    relativePath: normalizeZipPath(relativePath)
  }
}

export async function thunderstoreOpenConfigFile(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const relativePath = String(payload?.relativePath || '').trim()
  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileInfo = getThunderstoreProfile({
    community,
    profileName
  })
  const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
  const absolutePath = resolveThunderstoreConfigAbsolutePath(profileRoot, relativePath)

  const errorText = await shell.openPath(absolutePath)
  if (errorText) {
    throw new Error(errorText)
  }

  return {
    success: true,
    community,
    profileName,
    relativePath: normalizeZipPath(relativePath)
  }
}

export async function thunderstoreShareProfile(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  if (!community) {
    throw new Error('community 不能为空')
  }

  const installedRecords = listThunderstoreInstalledMods({
    community,
    profileName
  })

  if (!installedRecords.length) {
    throw new Error('当前 Profile 没有可分享的已安装模组')
  }

  const sharePayload = buildLegacyProfilePayload(profileName, installedRecords)
  const response = await axios.post(
    `${THUNDERSTORE_BASE_URL}/api/experimental/legacyprofile/create/`,
    sharePayload,
    {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      validateStatus: () => true
    }
  )

  const shareCode = String(response?.data?.key || '').trim()
  if (Number(response?.status) !== 200 || !shareCode) {
    const detail = String(response?.data?.detail || response?.statusText || '').trim()
    throw new Error(detail || '分享码创建失败')
  }

  return {
    success: true,
    community,
    profileName,
    key: shareCode,
    installedCount: installedRecords.length
  }
}

export async function thunderstoreResolveProfileCode(payload = {}) {
  const shareCode = String(payload?.code || '').trim()
  if (!shareCode) {
    throw new Error('code 不能为空')
  }

  const url = `${THUNDERSTORE_BASE_URL}/api/experimental/legacyprofile/get/${encodeURIComponent(shareCode)}/`
  const response = await axios.get(url, {
    timeout: 60000,
    responseType: 'text',
    validateStatus: () => true
  })

  if (Number(response?.status) !== 200) {
    const detail = String(response?.data?.detail || response?.statusText || '').trim()
    throw new Error(detail || `读取分享码失败（HTTP ${response?.status || 0}）`)
  }

  const content = String(response?.data || '').trim()
  const mods = parseLegacyProfileCodeToMods(content)
  return {
    success: true,
    code: shareCode,
    mods
  }
}

export async function thunderstoreUninstallPackage(payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const packageFullName = String(payload?.packageFullName || '').trim()
    const force = !!payload?.force

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!packageFullName) {
      throw new Error('packageFullName 不能为空')
    }

    const targetRecord = getThunderstoreInstalledRecord({
      community,
      profileName,
      packageFullName
    })
    if (!targetRecord) {
      return {
        success: true,
        removed: false,
        community,
        profileName,
        packageFullName,
        message: '未找到安装记录'
      }
    }

    const installedRecords = listThunderstoreInstalledMods({
      community,
      profileName
    })
    const dependentPackageNames = collectDependentPackageNames(installedRecords, packageFullName)
    if (dependentPackageNames.length > 0 && !force) {
      return {
        success: false,
        code: 'DEPENDENCIES_REQUIRED',
        community,
        profileName,
        packageFullName,
        dependentPackageNames,
        message: `以下模组依赖当前模组：${dependentPackageNames.join('、')}`
      }
    }

    const profileInfo = getThunderstoreProfile({
      community,
      profileName
    })
    const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))
    const disabledRoot = getDisabledModRoot(profileRoot, targetRecord?.fullName || '')
    await fs.ensureDir(profileRoot)

    const occupancyResult = inspectThunderstoreRecordsOccupancy(
      [targetRecord],
      installedRecords,
      profileRoot,
      'uninstall'
    )
    if (!occupancyResult.success) {
      return {
        success: false,
        code: 'FILES_OCCUPIED',
        community,
        profileName,
        packageFullName,
        occupiedFiles: occupancyResult.occupiedFiles,
        message: occupancyResult.message
      }
    }

    const sharedFileSet = new Set()
    const targetNormalized = normalizeFullName(packageFullName)
    for (const item of installedRecords) {
      const currentName = normalizeFullName(item?.fullName || '')
      if (!currentName || currentName === targetNormalized) {
        continue
      }
      const files = Array.isArray(item?.files) ? item.files : []
      for (const filePath of files) {
        const absPath = path.resolve(String(filePath || ''))
        sharedFileSet.add(normalizePathForCompare(absPath))
      }
    }

    const removeResult = mergeNumericResults([
      await removeInstalledFilesByRecord(targetRecord, profileRoot, sharedFileSet, {
        sourceRoot: profileRoot
      }),
      await removeInstalledFilesByRecord(targetRecord, profileRoot, new Set(), {
        sourceRoot: disabledRoot
      })
    ])
    const removedRows = removeThunderstoreInstalledMod({
      community,
      profileName,
      packageFullName
    })

    return {
      success: true,
      removed: removedRows > 0,
      community,
      profileName,
      packageFullName,
      dependentPackageNames,
      ...removeResult
    }
  })
}

export async function thunderstoreDeleteProfile(payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const removeMods = payload?.removeMods !== false

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!profileName) {
      throw new Error('profileName 不能为空')
    }
    const isDefaultProfile =
      payload?.isDefault === true ||
      (payload?.isDefault !== false && String(profileName).toLowerCase() === 'default')
    if (isDefaultProfile) {
      throw new Error('默认配置不支持删除')
    }

    const installedRecords = listThunderstoreInstalledMods({
      community,
      profileName,
      appId: payload?.appId || ''
    })
    if (installedRecords.length > 0 && !removeMods) {
      return {
        success: false,
        code: 'PROFILE_HAS_MODS',
        community,
        profileName,
        installedCount: installedRecords.length,
        message: '当前配置仍包含模组，不能仅删除配置'
      }
    }

    const profileInfo = getThunderstoreProfile({
      community,
      profileName
    })
    const profileRoot = String(profileInfo?.profileRoot || getProfileRoot(community, profileName))

    if (await fs.pathExists(profileRoot)) {
      await fs.remove(profileRoot)
    }

    const removedModRows = removeAllThunderstoreInstalledModsByProfile({
      community,
      profileName,
      appId: payload?.appId || ''
    })
    const removedProfileRows = removeThunderstoreProfile({
      community,
      profileName
    })

    return {
      success: true,
      community,
      profileName,
      removedModRows,
      removedProfileRows,
      installedCount: installedRecords.length,
      removedProfileRoot: profileRoot,
      message:
        installedRecords.length > 0
          ? `已删除配置 ${profileName}，并移除 ${installedRecords.length} 个模组`
          : `已删除配置 ${profileName}`
    }
  })
}

export async function thunderstoreBuildLaunchArgs(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const packageLoader = String(payload?.packageLoader || '')
  const appId = toSafeInteger(payload?.appId)

  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileRoot = getProfileRoot(community, profileName)
  await fs.ensureDir(profileRoot)

  const gameInfo = await resolveGameLaunchInfo(appId, community)
  const storedInfo = await resolveStoredProfileLaunchInfo(community, profileName)
  const finalGameExePath = gameInfo.gameExePath || storedInfo.gameExePath
  const finalInstalled = !!finalGameExePath
  const finalAppId = gameInfo.appId || storedInfo.appId || 0
  const moddedConfig = await buildLaunchConfigurationByLoader(packageLoader, profileRoot, 'modded')
  const vanillaConfig = await buildLaunchConfigurationByLoader(
    packageLoader,
    profileRoot,
    'vanilla'
  )

  return {
    community,
    profileName,
    profileRoot,
    appId: finalAppId,
    gameExePath: finalGameExePath,
    gameInstalled: finalInstalled,
    packageLoader: moddedConfig.packageLoader,
    launchArgs: moddedConfig.args,
    moddedLaunchArgs: moddedConfig.args,
    vanillaLaunchArgs: vanillaConfig.args,
    env: moddedConfig.env,
    notes: moddedConfig.notes
  }
}

export async function thunderstoreLaunchGame(payload = {}) {
  const community = normalizeCommunity(payload?.community)
  const profileName = String(payload?.profileName || 'default').trim() || 'default'
  const packageLoader = String(payload?.packageLoader || '')
  const appId = toSafeInteger(payload?.appId)
  const launchMode = normalizeLaunchMode(payload?.launchMode)
  const preferredGameExePath = normalizeExecutablePath(payload?.gameExePath)
  const exeNames = normalizeExeNames(payload?.exeNames)
  const steamFolderName = String(payload?.steamFolderName || '').trim()

  if (!community) {
    throw new Error('community 不能为空')
  }

  const profileRoot = getProfileRoot(community, profileName)
  if (!(await fs.pathExists(profileRoot))) {
    throw new Error('当前 Profile 不存在，请先安装至少一个模组')
  }

  // 对齐 r2modman：setGameDirIfUnset -> throwIfNoGameDir -> (modded) linkProfileFiles -> launch
  const resolvedGame = await setGameExecutableIfUnset({
    community,
    profileName,
    packageLoader,
    appId,
    gameExePath: preferredGameExePath,
    exeNames,
    steamFolderName,
    profileRoot
  })
  const gameExePath = resolvedGame.gameExePath
  throwIfNoGameExecutable(gameExePath)

  const layoutRepairResult = await repairLegacyProfileWrapperLayout(profileRoot)
  if (layoutRepairResult.movedFiles > 0) {
    console.info(
      `[thunderstore] 已修复旧版 Profile 目录结构: ${layoutRepairResult.wrapperDir}, 移动 ${layoutRepairResult.movedFiles} 个条目`
    )
  }

  await ensureProfileLoaderReady(packageLoader, profileRoot, launchMode)

  const launchConfig = await buildLaunchConfigurationByLoader(
    packageLoader,
    profileRoot,
    launchMode
  )
  const gameRoot = path.dirname(gameExePath)

  let linkedFiles = []
  if (launchMode === 'modded') {
    linkedFiles = await linkProfileFilesToGame(profileRoot, gameRoot, packageLoader)
  }

  let processInfo = null
  let launchSource = 'direct'
  let steamExePath = ''

  try {
    const steamProcessInfo = await spawnSteamGameProcess(
      resolvedGame.appId || appId,
      launchConfig.args,
      launchConfig.env
    )
    if (steamProcessInfo) {
      processInfo = steamProcessInfo
      launchSource = 'steam'
      steamExePath = String(steamProcessInfo?.steamExePath || '')
    }
  } catch (error) {
    console.warn('[thunderstore] Steam 启动失败，将回退到直启 EXE', error)
  }

  if (!processInfo) {
    processInfo = await spawnGameProcess(gameExePath, launchConfig.args, launchConfig.env)
  }

  upsertThunderstoreProfile({
    community,
    profileName,
    packageLoader,
    appId: resolvedGame.appId || 0,
    gameExePath,
    profileRoot
  })

  return {
    success: true,
    launchMode,
    appId: resolvedGame.appId || 0,
    gameExePath,
    profileRoot,
    launchArgs: launchConfig.args,
    env: launchConfig.env,
    packageLoader: launchConfig.packageLoader,
    linkedFilesCount: linkedFiles.length,
    pid: processInfo?.pid || 0,
    launchSource,
    steamExePath
  }
}

export async function thunderstoreInstallPackage(event, payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const packageFullName = String(payload?.packageFullName || '').trim()
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const packageLoader = String(payload?.packageLoader || '')
    const appId = toSafeInteger(payload?.appId)
    const versionNumber = String(payload?.versionNumber || '').trim()

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!packageFullName) {
      throw new Error('packageFullName 不能为空')
    }

    const jobId = `${community}:${normalizeFsName(packageFullName)}:${Date.now()}`
    emitInstallProgress(event, {
      jobId,
      stage: 'prepare',
      percent: 0,
      message: '正在准备安装任务...'
    })

    try {
      const installRuleContext = await resolveThunderstoreInstallRuleContext(
        community,
        packageLoader
      )
      const resolvedPackageLoader = String(
        installRuleContext?.packageLoader || packageLoader || ''
      ).trim()
      const packages = await fetchCommunityPackageList(community)
      const packageMap = buildPackageIndex(packages)
      const rootPackage = packageMap.get(normalizeFullName(packageFullName))
      const existingInstalledMap = getThunderstoreInstalledMap({
        community,
        profileName,
        appId
      })
      const existingInstalledLookup = new Map(
        Object.entries(existingInstalledMap).map(([fullName, item]) => [
          normalizeFullName(fullName),
          {
            ...item,
            fullName: String(item?.fullName || fullName).trim() || fullName
          }
        ])
      )
      if (!rootPackage) {
        throw new Error(`未找到包: ${packageFullName}`)
      }

      const installPlan = buildInstallPlan(packageMap, rootPackage.full_name, versionNumber, {
        community,
        installedLookup: existingInstalledLookup,
        modloaderPackages: installRuleContext?.modloaderPackages
      })
      if (!installPlan.length) {
        throw new Error(`包 ${packageFullName} 没有可安装计划`)
      }

      const target = await resolveInstallTarget(community, profileName)
      const gameInfo = await resolveGameLaunchInfo(appId, community)

      upsertThunderstoreProfile({
        community,
        profileName,
        packageLoader: resolvedPackageLoader,
        appId: gameInfo.appId,
        gameExePath: gameInfo.gameExePath,
        profileRoot: target.installRoot
      })

      const installedMap = getThunderstoreInstalledMap({
        community,
        profileName
      })
      const installedLookup = new Map(
        Object.entries(installedMap).map(([fullName, item]) => [normalizeFullName(fullName), item])
      )

      emitInstallProgress(event, {
        jobId,
        stage: 'plan',
        percent: 0,
        totalCount: installPlan.length,
        message: `安装计划已生成，共 ${installPlan.length} 个包`
      })

      const installedPackages = []
      const skippedPackages = []

      for (let i = 0; i < installPlan.length; i++) {
        const planItem = installPlan[i]
        const packageInfo = planItem.packageInfo
        const versionInfo = planItem.versionInfo
        const fullName = String(packageInfo?.full_name || '')
        const currentVersion = String(versionInfo?.version_number || '')

        const existed = installedLookup.get(normalizeFullName(fullName))
        if (existed?.version && String(existed.version) === currentVersion) {
          skippedPackages.push({
            fullName,
            version: currentVersion,
            reason: 'already_installed'
          })

          emitInstallProgress(event, {
            jobId,
            stage: 'skip',
            currentIndex: i + 1,
            totalCount: installPlan.length,
            percent: clampPercent(((i + 1) / installPlan.length) * 100),
            packageFullName: fullName,
            message: `已跳过 ${fullName}，当前版本已安装`
          })
          continue
        }

        const zipUrl = String(versionInfo?.download_url || '')
        if (!zipUrl) {
          throw new Error(`包 ${fullName} 缺少下载链接`)
        }

        const cacheFileName = `${normalizeFsName(fullName)}-${normalizeFsName(currentVersion)}.zip`
        const cachePath = path.join(
          getConfiguredThunderstoreStoragePaths().cacheRoot,
          community,
          cacheFileName
        )

        const downloadBase = i / installPlan.length
        const extractBase = (i + 0.5) / installPlan.length

        const { archivePath, md5, fileSize } = await downloadZip(
          zipUrl,
          cachePath,
          (progress) => {
            const stageRate = Number(progress?.percent || 0) / 100
            const globalPercent = (downloadBase + stageRate * (0.5 / installPlan.length)) * 100

            emitInstallProgress(event, {
              jobId,
              stage: 'download',
              currentIndex: i + 1,
              totalCount: installPlan.length,
              packageFullName: fullName,
              percent: clampPercent(globalPercent),
              packagePercent: clampPercent(progress?.percent || 0),
              downloadedBytes: Number(progress?.downloadedSize || 0),
              totalBytes: Number(progress?.totalSize || 0),
              message: `正在下载 ${fullName} ${currentVersion}`
            })
          },
          (retryInfo) => {
            emitInstallProgress(event, {
              jobId,
              stage: 'download',
              currentIndex: i + 1,
              totalCount: installPlan.length,
              packageFullName: fullName,
              percent: clampPercent(downloadBase * 100),
              message: `下载中断，准备重试（${retryInfo.nextAttempt}/${retryInfo.maxAttempts}）`
            })
          }
        )

        const installedItem = await installDownloadedThunderstorePlanItem(event, {
          jobId,
          currentIndex: i + 1,
          totalCount: installPlan.length,
          progressBase: extractBase,
          progressWeight: 0.5 / installPlan.length,
          community,
          profileName,
          targetInstallRoot: target.installRoot,
          packageLoader: resolvedPackageLoader,
          installRuleContext,
          item: {
            fullName,
            version: currentVersion,
            archivePath,
            downloadUrl: zipUrl,
            displayName: String(versionInfo?.name || packageInfo?.name || fullName),
            packageOwner: String(packageInfo?.owner || '').trim(),
            packageName: String(packageInfo?.name || '').trim(),
            icon: String(versionInfo?.icon || packageInfo?.icon || ''),
            description: String(versionInfo?.description || packageInfo?.description || ''),
            packageUrl: String(packageInfo?.package_url || ''),
            dependencies: Array.isArray(versionInfo?.dependencies) ? versionInfo.dependencies : [],
            fileSize,
            md5
          }
        })

        installedPackages.push(installedItem)
      }

      emitInstallProgress(event, {
        jobId,
        stage: 'done',
        percent: 100,
        totalCount: installPlan.length,
        installedCount: installedPackages.length,
        skippedCount: skippedPackages.length,
        message: '安装完成'
      })

      return {
        success: true,
        jobId,
        community,
        mode: target.mode,
        installRoot: target.installRoot,
        profileName: target.profileName,
        appId: gameInfo.appId,
        installedPackages,
        skippedPackages
      }
    } catch (error) {
      emitInstallProgress(event, {
        jobId,
        stage: 'error',
        percent: 0,
        message: error?.message || '安装失败'
      })
      throw error
    }
  })
}

export async function thunderstoreInstallDownloadedPackages(event, payload = {}) {
  return withThunderstoreProfileMutation(payload, async () => {
    const community = normalizeCommunity(payload?.community)
    const profileName = String(payload?.profileName || 'default').trim() || 'default'
    const packageLoader = String(payload?.packageLoader || '')
    const appId = toSafeInteger(payload?.appId)
    const inputItems = Array.isArray(payload?.items) ? payload.items : []

    if (!community) {
      throw new Error('community 不能为空')
    }
    if (!inputItems.length) {
      throw new Error('items 不能为空')
    }

    const items = inputItems.map((item) => normalizeDownloadedPackageItem(item)).filter(Boolean)
    const jobId = `${community}:downloaded:${Date.now()}`

    emitInstallProgress(event, {
      jobId,
      stage: 'prepare',
      percent: 0,
      totalCount: items.length,
      message: '下载完成，正在准备安装...'
    })

    try {
      const installRuleContext = await resolveThunderstoreInstallRuleContext(
        community,
        packageLoader
      )
      const resolvedPackageLoader = String(
        installRuleContext?.packageLoader || packageLoader || ''
      ).trim()
      const target = await resolveInstallTarget(community, profileName)
      const gameInfo = await resolveGameLaunchInfo(appId, community)

      upsertThunderstoreProfile({
        community,
        profileName,
        packageLoader: resolvedPackageLoader,
        appId: gameInfo.appId,
        gameExePath: gameInfo.gameExePath,
        profileRoot: target.installRoot
      })

      const installedMap = getThunderstoreInstalledMap({
        community,
        profileName
      })
      const installedLookup = new Map(
        Object.entries(installedMap).map(([fullName, item]) => [normalizeFullName(fullName), item])
      )

      const installedPackages = []
      const skippedPackages = []

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        const fullName = String(item?.fullName || '')
        const currentVersion = String(item?.version || '')
        const existed = installedLookup.get(normalizeFullName(fullName))

        if (existed?.version && String(existed.version) === currentVersion &&
            !(item.sourceModpackInstanceId && item.sourceModpackOperation === 'replace')) {
          skippedPackages.push({
            fullName,
            version: currentVersion,
            reason: 'already_installed'
          })

          emitInstallProgress(event, {
            jobId,
            stage: 'skip',
            currentIndex: i + 1,
            totalCount: items.length,
            percent: clampPercent(((i + 1) / items.length) * 100),
            packageFullName: fullName,
            message: `已跳过 ${fullName}，当前版本已安装`
          })
          continue
        }

        const installedItem = await installDownloadedThunderstorePlanItem(event, {
          jobId,
          currentIndex: i + 1,
          totalCount: items.length,
          progressBase: i / items.length,
          progressWeight: 1 / items.length,
          community,
          profileName,
          targetInstallRoot: target.installRoot,
          packageLoader: resolvedPackageLoader,
          installRuleContext,
          item
        })

        installedPackages.push(installedItem)
        installedLookup.set(normalizeFullName(fullName), {
          version: currentVersion
        })
      }

      emitInstallProgress(event, {
        jobId,
        stage: 'done',
        percent: 100,
        totalCount: items.length,
        installedCount: installedPackages.length,
        skippedCount: skippedPackages.length,
        message: '安装完成'
      })

      return {
        success: true,
        jobId,
        community,
        mode: target.mode,
        installRoot: target.installRoot,
        profileName: target.profileName,
        appId: gameInfo.appId,
        installedPackages,
        skippedPackages
      }
    } catch (error) {
      emitInstallProgress(event, {
        jobId,
        stage: 'error',
        percent: 0,
        totalCount: items.length,
        message: error?.message || '安装失败'
      })
      throw error
    }
  })
}
