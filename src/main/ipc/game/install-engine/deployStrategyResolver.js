import path from 'path'
import { requiresIndependentDeployment } from '../deploymentFilePolicy.js'
import {
  createEmptyDeployStrategy,
  isPlainObject,
  resolveFirstDefinedValue,
  toSafeText
} from './contracts.js'

const SUPPORTED_DEPLOY_STRATEGIES = new Set([
  'hardlink',
  'symlink',
  'copy',
  'extract',
  'manifest_only'
])
const FILE_DEPLOY_PRIORITY = ['hardlink', 'symlink', 'copy']

function normalizeStrategy(value = '', fallback = 'copy') {
  const text = toSafeText(value).toLowerCase()
  return SUPPORTED_DEPLOY_STRATEGIES.has(text) ? text : fallback
}

function resolveVolumeRoot(value = '') {
  const text = toSafeText(value) || process.cwd()
  const api = /^(?:[a-z]:[\\/]|\\\\)/i.test(text) ? path.win32 : path
  return api.parse(api.resolve(text)).root.toLowerCase()
}

export function inspectDeployCapabilities(plan = {}, context = {}) {
  const explicit = isPlainObject(context.deployCapabilities)
    ? context.deployCapabilities
    : isPlainObject(context.installedCapabilities?.deploy)
      ? context.installedCapabilities.deploy
      : {}
  const sourceRoot = toSafeText(plan.sourceRoot || context.sourceRoot)
  const targetRoot = toSafeText(plan.targetRoot || context.targetRoot || context.gameRoot)
  const sameVolume =
    sourceRoot && targetRoot
      ? resolveVolumeRoot(sourceRoot) === resolveVolumeRoot(targetRoot)
      : false

  return {
    hardlink: explicit.hardlink === true || (sameVolume && explicit.hardlink !== false),
    symlink: explicit.symlink === true,
    copy: explicit.copy !== false,
    extract: explicit.extract !== false,
    manifest_only: explicit.manifest_only === true || explicit.manifestOnly === true,
    sameVolume
  }
}

function resolveCapabilityMissReason(strategy = '', capabilities = {}, context = {}) {
  const explicit = isPlainObject(context.deployCapabilities)
    ? context.deployCapabilities
    : isPlainObject(context.installedCapabilities?.deploy)
      ? context.installedCapabilities.deploy
      : {}

  if (strategy === 'hardlink') {
    if (!capabilities.sameVolume) {
      return '源目录与目标目录不在同一盘符，不能使用硬链接'
    }
    if (explicit.hardlink === false) {
      return '硬链接部署已被配置禁用'
    }
    return '硬链接能力不可用'
  }

  if (strategy === 'symlink') {
    if (explicit.symlink === false) {
      return '符号链接部署已被配置禁用'
    }
    return '符号链接能力未开启或未确认'
  }

  if (strategy === 'copy') {
    return '复制部署能力不可用'
  }

  if (strategy === 'extract') {
    return '原生解压部署能力不可用'
  }

  return '部署能力不可用'
}

function resolveFileDeployPriority() {
  return [...FILE_DEPLOY_PRIORITY]
}

export function resolveDeployStrategy(plan = {}, context = {}) {
  const rawPreferred = resolveFirstDefinedValue(
    plan.deployStrategy?.preferred,
    plan.deployStrategy?.strategy,
    plan.rule?.deploy_strategy,
    plan.rule?.deployStrategy,
    context.deployStrategy,
    context.preferredDeployStrategy
  )
  const normalizedPreferred = normalizeStrategy(rawPreferred, 'hardlink')
  const preferred = FILE_DEPLOY_PRIORITY.includes(normalizedPreferred)
    ? 'hardlink'
    : normalizedPreferred
  const capabilities = inspectDeployCapabilities(plan, context)
  const fileOperations = (plan.operations || []).filter((operation) => operation.kind !== 'dir' && operation.type !== 'mkdir')
  if (FILE_DEPLOY_PRIORITY.includes(normalizedPreferred) && fileOperations.length &&
      fileOperations.every((operation) => requiresIndependentDeployment(operation.targetPath || operation.target || ''))) {
    const actual = capabilities.copy ? 'copy' : 'manual'
    return createEmptyDeployStrategy({ preferred: 'copy', actual, strategy: actual, capabilities,
      reason: capabilities.copy ? '配置及文本文件采用独立复制' : '独立复制能力不可用',
      fallbackReasons: capabilities.copy ? [] : [{ from: 'copy', to: 'manual', reason: '独立复制能力不可用' }] })
  }
  const fallbackReasons = []
  let actual = ''

  if (preferred === 'manifest_only' && capabilities.manifest_only) {
    actual = 'manifest_only'
  }

  if (preferred === 'extract') {
    if (capabilities.extract) {
      actual = 'extract'
    } else {
      fallbackReasons.push({
        from: 'extract',
        to: 'hardlink',
        reason: resolveCapabilityMissReason('extract', capabilities, context)
      })
    }
  }

  if (!actual && FILE_DEPLOY_PRIORITY.includes(preferred)) {
    const priority = resolveFileDeployPriority()
    for (let index = 0; index < priority.length; index += 1) {
      const strategy = priority[index]
      if (capabilities[strategy]) {
        actual = strategy
        break
      }

      const nextStrategy = priority[index + 1] || 'manual'
      fallbackReasons.push({
        from: strategy,
        to: nextStrategy,
        reason: resolveCapabilityMissReason(strategy, capabilities, context)
      })
    }
  }

  if (!actual && preferred === 'manifest_only') {
    fallbackReasons.push({
      from: 'manifest_only',
      to: 'hardlink',
      reason: '仅记录部署能力不可用'
    })
  }

  if (!actual) {
    const priority = resolveFileDeployPriority()
    for (let index = 0; index < priority.length; index += 1) {
      const strategy = priority[index]
      if (capabilities[strategy]) {
        actual = strategy
        break
      }

      const nextStrategy = priority[index + 1] || 'manual'
      const alreadyRecorded = fallbackReasons.some(
        (item) => item.from === strategy && item.to === nextStrategy
      )
      if (!alreadyRecorded) {
        fallbackReasons.push({
          from: strategy,
          to: nextStrategy,
          reason: resolveCapabilityMissReason(strategy, capabilities, context)
        })
      }
    }
  }

  if (!actual) {
    actual = 'manual'
  }

  return createEmptyDeployStrategy({
    preferred,
    actual,
    strategy: actual,
    fallback: fallbackReasons.map((item) => item.to),
    fallbackReasons,
    requiresAdmin: actual === 'symlink' && capabilities.symlink !== true,
    reason: fallbackReasons.length ? fallbackReasons[0].reason : '按部署优先级选择可用方式',
    capabilities
  })
}
