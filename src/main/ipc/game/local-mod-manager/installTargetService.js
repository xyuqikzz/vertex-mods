import AdmZip from 'adm-zip'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { inspectStandardSourceInstallPlan } from '../standard/orchestrator.js'
import { getLocalModLibraryItem } from '../../../db/mods/localModLibrary.js'
import { getGameRowById } from '../../../db/mods/localModLibrary.js'
import { isArchivePath } from '../local-mod-import/analyzeService.js'
import { isPathInside, toGameRelativePath, validateManualInstallTarget } from './safetyService.js'
import {
  LOCAL_MOD_MANAGER_ERROR_CODE,
  createFailure,
  createSuccess
} from './localModManagerResult.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeSlash(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

function getGameRoot(payload = {}, item = null) {
  const explicit = toSafeText(payload.gameRoot || payload.rootPath || payload.gamePath)
  if (explicit) return path.resolve(explicit)
  const gameId = toSafeNumber(payload.gameId ?? item?.game_id, 0)
  const game = gameId > 0 ? getGameRowById(gameId) : null
  return (
    toSafeText(game?.client_root_path) ||
    (game?.client_exe_path ? path.dirname(game.client_exe_path) : '')
  )
}

function resolveSourceMeta(payload = {}, item = null) {
  const sourceMeta = toSafeObject(payload.sourceMeta)
  const sourcePlatform = toSafeText(
    payload.sourcePlatform || payload.source || item?.source_platform,
    'local'
  )
  const profileName = toSafeText(
    payload.profileName || payload.sourceProfile || item?.source_profile,
    'default'
  )
  return {
    ...sourceMeta,
    source: sourcePlatform === 'vertex' ? 'server' : sourcePlatform,
    appId: toSafeText(payload.appId || payload.appid || sourceMeta.appId),
    profileName,
    targetProfileName: profileName
  }
}

function addFolderToZip(zip, folderPath = '', rootPath = folderPath, prefix = '') {
  if (!fs.existsSync(folderPath)) return
  const names = fs.readdirSync(folderPath)
  for (const name of names) {
    const absolutePath = path.join(folderPath, name)
    const stat = fs.statSync(absolutePath)
    const relativePath = normalizeSlash(path.relative(rootPath, absolutePath))
    const zipPath = normalizeSlash(path.posix.join(prefix, relativePath))
    if (stat.isDirectory()) {
      addFolderToZip(zip, absolutePath, rootPath, prefix)
    } else {
      zip.addLocalFile(absolutePath, path.posix.dirname(zipPath))
    }
  }
}

async function createPreviewArchiveForPath(sourcePath = '') {
  const resolved = path.resolve(sourcePath)
  const stat = await fs.stat(resolved)
  if (stat.isFile() && isArchivePath(resolved)) {
    return {
      archivePath: resolved,
      cleanup: async () => {}
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-local-mod-target-'))
  const archivePath = path.join(tempRoot, 'preview.zip')
  const zip = new AdmZip()
  if (stat.isDirectory()) {
    addFolderToZip(zip, resolved, resolved)
  } else {
    zip.addLocalFile(resolved)
  }
  zip.writeZip(archivePath)
  return {
    archivePath,
    cleanup: async () => {
      await fs.remove(tempRoot)
    }
  }
}

function resolveTargetPathsFromPlan(plan = {}) {
  const result = new Set()
  if (toSafeText(plan.targetRoot)) {
    result.add(path.resolve(plan.targetRoot))
  }
  for (const operation of Array.isArray(plan.operations) ? plan.operations : []) {
    const targetPath = toSafeText(operation?.targetPath)
    if (targetPath) {
      result.add(path.dirname(path.resolve(targetPath)))
    }
  }
  for (const route of Array.isArray(plan.routes) ? plan.routes : []) {
    const targetRoot = toSafeText(route?.targetRoot)
    if (targetRoot) {
      result.add(path.resolve(targetRoot))
    }
  }
  return [...result]
}

function summarizeRuleTarget(preview = {}, payload = {}, item = null) {
  const plan =
    preview?.installPlan && typeof preview.installPlan === 'object' ? preview.installPlan : {}
  const gameRoot = getGameRoot(payload, item)
  const targetPaths = resolveTargetPathsFromPlan(plan)
  const firstTargetPath = targetPaths[0] || ''
  const targetRelativePath =
    toSafeText(plan.targetRelativePath) ||
    (gameRoot && firstTargetPath && isPathInside(gameRoot, firstTargetPath)
      ? toGameRelativePath(gameRoot, firstTargetPath)
      : '')

  if (!preview?.matched || (!firstTargetPath && !targetRelativePath)) {
    return null
  }

  return {
    mode: 'rule',
    ruleId: toSafeText(plan.ruleId || plan.matchedRuleId),
    ruleName: toSafeText(plan.ruleName || plan.ruleId || '安装规则匹配'),
    targetPath: firstTargetPath,
    targetBaseType: toSafeText(plan.targetBaseType || 'game', 'game'),
    targetRelativePath,
    resolvedBy: 'install_rule',
    installPlan: plan,
    targetPaths
  }
}

export async function normalizeLocalModInstallTarget(payload = {}, item = null) {
  const installTarget = toSafeObject(payload.installTarget)
  const mode = toSafeText(installTarget.mode).toLowerCase()
  const gameRoot = getGameRoot(payload, item)

  if (mode === 'manual') {
    const validation = validateManualInstallTarget(installTarget.targetPath, {
      ...payload,
      gameRoot
    })
    if (!validation.safe) {
      return createFailure(validation.code, validation.message, {
        installTarget
      })
    }
    return createSuccess('已使用手动安装目标', {
      installTarget: {
        mode: 'manual',
        ruleId: '',
        ruleName: '',
        targetPath: validation.path,
        targetBaseType: isPathInside(gameRoot, validation.path) ? 'game' : 'custom',
        targetRelativePath:
          toSafeText(installTarget.targetRelativePath) ||
          toGameRelativePath(gameRoot, validation.path),
        resolvedBy: 'user'
      }
    })
  }

  if (mode === 'rule' && toSafeText(installTarget.targetPath || installTarget.targetRelativePath)) {
    return createSuccess('已使用安装规则目标', {
      installTarget: {
        ...installTarget,
        mode: 'rule',
        resolvedBy: installTarget.resolvedBy || 'install_rule'
      }
    })
  }

  return createFailure(
    LOCAL_MOD_MANAGER_ERROR_CODE.MANUAL_TARGET_REQUIRED,
    '没有匹配到明确安装目标，请选择安装文件夹',
    {
      installTarget: {
        mode: 'unresolved'
      }
    }
  )
}

export async function resolveLocalModInstallTarget(event, payload = {}) {
  const item =
    payload?.id || payload?.libraryItemId
      ? getLocalModLibraryItem(payload.id ?? payload.libraryItemId)
      : null
  const sourcePath = toSafeText(
    payload.sourcePath ||
      payload.path ||
      item?.metadata?.archivedSourcePath ||
      item?.metadata?.sourceRoot ||
      item?.library_root_path
  )
  if (!sourcePath || !(await fs.pathExists(sourcePath))) {
    return createFailure(LOCAL_MOD_MANAGER_ERROR_CODE.PATH_MISSING, '安装来源不存在')
  }

  const sourceMeta = resolveSourceMeta(payload, item)
  const gameRoot = getGameRoot(payload, item)
  const appId = toSafeText(payload.appId || payload.appid || sourceMeta.appId)
  const gameId = toSafeNumber(payload.gameId ?? item?.game_id, 0)
  const previewArchive = await createPreviewArchiveForPath(sourcePath)

  try {
    const preview = await inspectStandardSourceInstallPlan(
      event,
      {
        filePath: previewArchive.archivePath,
        data: {
          ...sourceMeta,
          appid: appId,
          appId,
          gameId,
          source: sourceMeta.source,
          sourceType: sourceMeta.source,
          sourcePlatform: sourceMeta.source,
          sourceMeta,
          usageType: 1
        },
        type: 1
      },
      {
        source: sourceMeta.source || 'nexus'
      }
    )
    const ruleTarget = summarizeRuleTarget(preview, { ...payload, gameRoot }, item)
    if (ruleTarget) {
      return createSuccess('已匹配安装规则目标', {
        installTarget: ruleTarget,
        preview
      })
    }

    return createFailure(
      preview?.reason === 'no_install_rules'
        ? LOCAL_MOD_MANAGER_ERROR_CODE.INSTALL_RULE_MISSING
        : LOCAL_MOD_MANAGER_ERROR_CODE.MANUAL_TARGET_REQUIRED,
      '没有匹配到明确安装目标，请选择安装文件夹',
      {
        installTarget: {
          mode: 'unresolved',
          resolvedBy: ''
        },
        preview
      }
    )
  } finally {
    await previewArchive.cleanup()
  }
}

export async function validateInstallTargetFolder(payload = {}) {
  const item =
    payload?.id || payload?.libraryItemId
      ? getLocalModLibraryItem(payload.id ?? payload.libraryItemId)
      : null
  const gameRoot = getGameRoot(payload, item)
  const validation = validateManualInstallTarget(payload.targetPath || payload.path, {
    ...payload,
    gameRoot
  })
  if (!validation.safe) {
    return createFailure(validation.code, validation.message)
  }
  return createSuccess('安装目标文件夹可用', {
    installTarget: {
      mode: 'manual',
      targetPath: validation.path,
      targetBaseType: isPathInside(gameRoot, validation.path) ? 'game' : 'custom',
      targetRelativePath: toGameRelativePath(gameRoot, validation.path),
      resolvedBy: 'user'
    }
  })
}
