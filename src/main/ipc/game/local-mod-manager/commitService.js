import path from 'path'
import { createLocalManagedBinding } from './bindingService.js'
import { saveLocalModToLibrary, createLocalModInstallTask } from './libraryService.js'
import { LOCAL_MOD_MANAGER_ERROR_CODE, createFailure } from './localModManagerResult.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function parseItems(payload = {}) {
  if (Array.isArray(payload.items)) {
    return payload.items
  }
  if (payload.path || payload.sourcePath) {
    return [{ path: payload.path || payload.sourcePath }]
  }
  return []
}

function createSourcePayload(payload = {}, item = {}) {
  const analysis = toSafeObject(item.analysis)
  const itemPath = toSafeText(item.path || item.sourcePath || analysis.path)
  const displayName =
    toSafeText(item.displayName) ||
    toSafeText(analysis.displayName) ||
    (itemPath ? path.basename(itemPath, path.extname(itemPath)) : '')
  return {
    ...payload,
    sourcePath: itemPath,
    path: itemPath,
    analysis,
    displayName,
    version: toSafeText(item.version),
    author: toSafeText(item.author),
    tags: Array.isArray(item.tags) ? item.tags : ['local'],
    note: toSafeText(item.note),
    metadata: {
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
      sourceUrl: toSafeText(item.sourceUrl || payload.metadata?.sourceUrl),
      note: toSafeText(item.note || payload.metadata?.note)
    }
  }
}

async function commitLibraryMode(payload = {}, withTask = false, event = null) {
  const items = parseItems(payload)
  const assets = []
  const tasks = []
  const failed = []
  const warnings = []

  for (const item of items) {
    const sourcePayload = createSourcePayload(payload, item)
    const libraryResult = await saveLocalModToLibrary({
      ...sourcePayload,
      managementMode: withTask ? 'library_install_task' : 'library'
    })
    if (!libraryResult?.success) {
      failed.push({
        path: sourcePayload.path,
        code: libraryResult?.code || '',
        message: libraryResult?.message || '导入资产失败'
      })
      continue
    }
    const asset = libraryResult.data
    assets.push(asset)

    if (!withTask) {
      continue
    }

    const taskResult = await createLocalModInstallTask(event, {
      ...payload,
      id: asset?.id,
      libraryItemId: asset?.id,
      installTarget: item.installTarget || payload.installTarget,
      sourcePlatform: payload.sourcePlatform || payload.source || asset?.source_platform,
      profileName: payload.profileName || payload.sourceProfile || asset?.source_profile,
      autoStart: payload.autoStart === true
    })
    if (taskResult?.success) {
      tasks.push(taskResult)
    } else {
      failed.push({
        path: sourcePayload.path,
        code: taskResult?.code || LOCAL_MOD_MANAGER_ERROR_CODE.TASK_CREATE_FAILED,
        message: taskResult?.message || '安装任务创建失败'
      })
      warnings.push({
        path: sourcePayload.path,
        message: '资产已保存，但安装任务未创建'
      })
    }
  }

  return {
    success: failed.length === 0,
    message: failed.length
      ? `已处理 ${assets.length} 个本地模组，失败 ${failed.length} 个`
      : withTask
        ? `已保存 ${assets.length} 个本地模组并加入安装任务`
        : `已保存 ${assets.length} 个本地模组资产`,
    code: failed.length ? LOCAL_MOD_MANAGER_ERROR_CODE.PARTIAL_FAILED : '',
    data: {
      assets,
      bindings: [],
      tasks,
      installTargets: [],
      failed,
      warnings
    }
  }
}

async function commitBindingMode(payload = {}) {
  const items = parseItems(payload)
  const files = []
  const folders = []
  for (const item of items) {
    const analysis = toSafeObject(item.analysis)
    const itemPath = toSafeText(item.path || item.sourcePath || analysis.path)
    if (!itemPath) continue
    const type = toSafeText(item.type || analysis.sourceType).toLowerCase()
    if (type === 'folder') {
      folders.push(itemPath)
    } else {
      files.push(itemPath)
    }
  }

  if (!files.length && !folders.length) {
    return createFailure(LOCAL_MOD_MANAGER_ERROR_CODE.PATH_MISSING, '请选择需要接管的本地路径')
  }

  const result = await createLocalManagedBinding({
    ...payload,
    files,
    folders,
    name:
      toSafeText(payload.name || payload.displayName) ||
      toSafeText(items[0]?.displayName || items[0]?.analysis?.displayName),
    sourceUrl: toSafeText(payload.metadata?.sourceUrl),
    note: toSafeText(payload.metadata?.note)
  })

  return {
    success: result?.success === true,
    message: result?.message || (result?.success ? '原地接管完成' : '原地接管失败'),
    code: result?.success ? '' : result?.code || LOCAL_MOD_MANAGER_ERROR_CODE.PARTIAL_FAILED,
    data: {
      assets: [],
      bindings: result?.success ? [result] : [],
      tasks: [],
      installTargets: [],
      failed: result?.success ? [] : [{ message: result?.message || '原地接管失败' }],
      warnings: []
    }
  }
}

export async function commitLocalModManagement(event, payload = {}) {
  const mode = toSafeText(payload.managementMode, 'library').toLowerCase()
  if (mode === 'library') {
    return await commitLibraryMode(payload, false, event)
  }
  if (mode === 'library_install_task') {
    return await commitLibraryMode(payload, true, event)
  }
  if (mode === 'bind_existing') {
    return await commitBindingMode(payload)
  }
  return createFailure('unsupported_management_mode', '不支持的本地模组接管模式')
}
