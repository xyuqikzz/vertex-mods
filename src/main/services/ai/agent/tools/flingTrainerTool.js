import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ensureFlingTrainerExecutable } from '../../../trainers/executable.js'
import { assertTrainerFileAccess } from '../../../trainers/filePolicy.js'
import { trainerFailure } from '../../../../../shared/i18n/trainer-messages.js'

const FLING_HOST = 'flingtrainer.com'
const MODULE_NAME = '风灵月影'

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function hashPath(value = '') {
  const text = toSafeText(value)
  return text ? crypto.createHash('sha1').update(path.resolve(text).toLowerCase()).digest('hex').slice(0, 12) : ''
}

function isFlingUrl(value = '') {
  const text = toSafeText(value)
  if (!text) return false
  try {
    const url = new URL(text)
    return url.hostname === FLING_HOST || url.hostname.endsWith(`.${FLING_HOST}`)
  } catch {
    return false
  }
}

function sanitizeUrl(value = '') {
  const text = toSafeText(value)
  if (!text) return ''
  try {
    const url = new URL(text)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

function getFileType(downloadUrl = '') {
  const pathname = toSafeText(downloadUrl).split('?')[0]
  const match = pathname.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : 'exe'
}

function createDownloadTaskId() {
  return `fling-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function createNoopEventRef() {
  return {
    reply() {}
  }
}

async function resolveFlingApi(dependencyOverrides = {}) {
  if (
    typeof dependencyOverrides.getFlingTrainerList === 'function' &&
    typeof dependencyOverrides.getFlingTrainerDetail === 'function'
  ) {
    return {
      getFlingTrainerList: dependencyOverrides.getFlingTrainerList,
      getFlingTrainerDetail: dependencyOverrides.getFlingTrainerDetail
    }
  }

  const module = await import('../../../trainers/catalog.js')
  return {
    getFlingTrainerList: dependencyOverrides.getFlingTrainerList || module.getFlingTrainerList,
    getFlingTrainerDetail: dependencyOverrides.getFlingTrainerDetail || module.getFlingTrainerDetail
  }
}

async function resolveDownloadQueue(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.addTasksToQueue === 'function') {
    return dependencyOverrides.addTasksToQueue
  }

  const module = await import('../../../../ipc/download/method.js')
  return module.addTasksToQueue
}

async function resolveDbInstance(dependencyOverrides = {}) {
  if (dependencyOverrides.dbInstance) {
    return dependencyOverrides.dbInstance
  }

  const module = await import('../../../../db/dbInstance.js')
  return module.default
}

async function resolveElectronShell(dependencyOverrides = {}) {
  if (dependencyOverrides.shell?.openPath) {
    return dependencyOverrides.shell
  }

  const module = await import('electron')
  return module.shell || module.default?.shell
}

function normalizeTrainerItem(item = {}) {
  return {
    id: toSafeText(item.id || item.detailUrl || item.title),
    title: toSafeText(item.title),
    gameName: toSafeText(item.gameName),
    detailUrl: sanitizeUrl(item.detailUrl),
    coverUrl: sanitizeUrl(item.coverUrl),
    logoUrl: sanitizeUrl(item.logoUrl),
    summary: toSafeText(item.summary).slice(0, 280),
    latestUpdated: toSafeText(item.latestUpdated),
    source: 'fling'
  }
}

function normalizeDownloadItem(item = {}) {
  return {
    name: toSafeText(item.name),
    downloadUrl: sanitizeUrl(item.downloadUrl),
    dateAdded: toSafeText(item.dateAdded),
    fileSize: toSafeText(item.fileSize),
    downloadCount: toSafeText(item.downloadCount)
  }
}

function createPathSummary(filePath = '') {
  const safeFilePath = toSafeText(filePath)
  return {
    configured: !!safeFilePath,
    basename: safeFilePath ? path.basename(safeFilePath) : '',
    extension: safeFilePath ? path.extname(safeFilePath).toLowerCase() : '',
    exists: safeFilePath ? fs.existsSync(safeFilePath) : false,
    pathHash: hashPath(safeFilePath)
  }
}

function normalizeLocalRecord(row = {}) {
  return {
    id: toSafeNumber(row.id, 0),
    taskId: toSafeText(row.task_id),
    taskName: toSafeText(row.task_name),
    module: toSafeText(row.module),
    source: 'fling',
    fileType: toSafeText(row.file_type),
    fileSize: toSafeNumber(row.file_size, 0),
    downloadUrl: sanitizeUrl(row.download_url),
    createdAt: toSafeText(row.created_at),
    filePathSummary: createPathSummary(row.file_path)
  }
}

async function queryFlingDownloadRecords(
  { limit = 20, keyword = '', recordId = 0, taskId = '', downloadUrl = '' } = {},
  dependencyOverrides = {}
) {
  const clauses = ["module = ?", "download_url LIKE ?"]
  const params = [MODULE_NAME, `%${FLING_HOST}%`]
  if (recordId > 0) {
    clauses.push('id = ?')
    params.push(recordId)
  }
  if (taskId) {
    clauses.push('task_id = ?')
    params.push(taskId)
  }
  if (downloadUrl) {
    clauses.push('download_url = ?')
    params.push(downloadUrl)
  }
  if (keyword) {
    clauses.push('(task_name LIKE ? OR file_path LIKE ? OR download_url LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const db = await resolveDbInstance(dependencyOverrides)
  return db.all(
    `
      SELECT id, task_id, task_name, module, file_type, file_size, file_path, download_url, created_at
      FROM download_records
      WHERE ${clauses.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?
    `,
    [...params, Math.max(1, Math.min(toSafeNumber(limit, 20), 50))]
  )
}

async function findLocalRecord(args = {}, dependencyOverrides = {}) {
  const rows = await queryFlingDownloadRecords(
    {
      limit: 1,
      recordId: toSafeNumber(args.recordId || args.id, 0),
      taskId: toSafeText(args.taskId),
      downloadUrl: toSafeText(args.downloadUrl)
    },
    dependencyOverrides
  )
  return Array.isArray(rows) ? rows[0] || null : null
}

export async function searchFlingTrainerTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const flingApi = await resolveFlingApi(dependencyOverrides)
  const result = await flingApi.getFlingTrainerList({
    keyword: toSafeText(args.keyword),
    page: Math.max(toSafeNumber(args.page, 1), 1),
    pageSize: Math.max(1, Math.min(toSafeNumber(args.limit || args.pageSize, 12), 24))
  })
  const records = (Array.isArray(result?.records) ? result.records : []).map((item) =>
    normalizeTrainerItem(item)
  )
  return {
    success: true,
    source: 'fling',
    records,
    total: toSafeNumber(result?.total, records.length),
    current: toSafeNumber(result?.current, 1),
    hasNext: result?.hasNext === true,
    sourceUrl: sanitizeUrl(result?.sourceUrl)
  }
}

export async function getFlingTrainerDetailTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const detailUrl = toSafeText(args.detailUrl)
  if (!isFlingUrl(detailUrl)) {
    return {
      success: false,
      errorCode: 'invalid_fling_detail_url',
      message: '风灵月影详情工具只允许访问 flingtrainer.com 详情页。'
    }
  }

  const flingApi = await resolveFlingApi(dependencyOverrides)
  const result = await flingApi.getFlingTrainerDetail({ detailUrl })
  return {
    success: true,
    source: 'fling',
    record: {
      ...normalizeTrainerItem(result),
      downloads: (Array.isArray(result?.downloads) ? result.downloads : []).map((item) =>
        normalizeDownloadItem(item)
      ),
      sourceUrl: sanitizeUrl(result?.sourceUrl)
    }
  }
}

export async function downloadFlingTrainerTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const detailUrl = toSafeText(args.detailUrl)
  const downloadUrl = toSafeText(args.downloadUrl)
  if (!isFlingUrl(detailUrl) || !isFlingUrl(downloadUrl)) {
    return {
      success: false,
      errorCode: 'invalid_fling_download_url',
      message: '风灵月影下载工具只允许使用 flingtrainer.com 详情页和下载地址。'
    }
  }

  const flingApi = await resolveFlingApi(dependencyOverrides)
  const detail = await flingApi.getFlingTrainerDetail({ detailUrl })
  const downloads = Array.isArray(detail?.downloads) ? detail.downloads : []
  const selected = downloads.find((item) => toSafeText(item.downloadUrl) === downloadUrl)
  if (!selected) {
    return {
      success: false,
      errorCode: 'download_not_found_in_detail',
      message: '下载地址不在官方详情页解析出的下载项中，已拒绝加入下载队列。'
    }
  }

  const taskId = createDownloadTaskId()
  const taskName = toSafeText(selected.name || detail.title || args.title, '风灵月影修改器')
  const sourceId = toSafeText(detail.detailUrl || detailUrl)
  const sourceFileId = toSafeText(selected.downloadUrl || downloadUrl)
  const task = {
    id: taskId,
    task_name: taskName,
    module: MODULE_NAME,
    file_type: getFileType(downloadUrl),
    preferredFileName: taskName,
    download_url: downloadUrl,
    file_size: 0,
    saveType: 1,
    sourcePlatform: 'fling',
    sourceModId: sourceId,
    sourceFileId,
    dedupeKey: `fling:${sourceId}:${sourceFileId}`,
    showOpenInDownloadList: true,
    fun: {
      type: 0
    }
  }

  const addQueueTask = await resolveDownloadQueue(dependencyOverrides)
  addQueueTask(createNoopEventRef(), toPlainJson(task, {}))
  return {
    success: true,
    source: 'fling',
    queued: true,
    task: {
      id: taskId,
      taskName,
      module: MODULE_NAME,
      fileType: task.file_type,
      detailUrl: sanitizeUrl(detailUrl),
      downloadUrl: sanitizeUrl(downloadUrl)
    },
    message: '已加入下载队列，可在下载中心查看进度。'
  }
}

export async function listFlingTrainerLocalRecordsTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const rows = await queryFlingDownloadRecords(
    {
      limit: args.limit || 20,
      keyword: toSafeText(args.keyword)
    },
    dependencyOverrides
  )
  const records = (Array.isArray(rows) ? rows : []).map((item) => normalizeLocalRecord(item))
  return {
    success: true,
    source: 'fling',
    total: records.length,
    records
  }
}

export async function runFlingTrainerTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  if (!toSafeNumber(args.recordId || args.id, 0) && !toSafeText(args.taskId) && !toSafeText(args.downloadUrl)) {
    return {
      success: false,
      errorCode: 'missing_fling_local_record_identity',
      message: '运行 FLiNG 修改器需要传入 local_records 返回的 recordId、taskId 或 downloadUrl。'
    }
  }

  const record = await findLocalRecord(args, dependencyOverrides)
  if (!record) {
    return {
      success: false,
      errorCode: 'fling_local_record_not_found',
      message: '未找到匹配的 FLiNG 本地下载记录。'
    }
  }

  if (toSafeText(record.module) !== MODULE_NAME || !isFlingUrl(record.download_url)) {
    return {
      success: false,
      errorCode: 'invalid_fling_local_record',
      message: '该记录不是受控的 FLiNG 下载记录，已拒绝运行。'
    }
  }

  let filePath = toSafeText(record.file_path)
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      success: false,
      errorCode: 'file_not_found',
      message: '本地修改器文件不存在，请重新下载。'
    }
  }

  let executable
  try {
    assertTrainerFileAccess(filePath, [record])
    executable = await ensureFlingTrainerExecutable(filePath)
  } catch (error) {
    executable = trainerFailure(['invalid_trainer_path', 'untrusted_trainer_file', 'linked_trainer_path'].includes(error.code)
      ? error.code : 'trainer_operation_failed')
  }
  if (!executable.success) {
    const translate = dependencyOverrides.nativeText || (await import('../../../uiLanguage.js')).nativeText
    return {
      ...executable,
      errorCode: executable.errorCode || 'invalid_executable_extension',
      message: translate(executable.messageKey, executable.messageParams)
    }
  }
  filePath = executable.filePath
  if (executable.migrated) {
    const db = await resolveDbInstance(dependencyOverrides)
    db.run(
      'UPDATE download_records SET file_path = ?, file_type = ? WHERE id = ? AND file_path = ?',
      [filePath, 'exe', record.id, executable.previousFilePath]
    )
    record.file_path = filePath
    record.file_type = 'exe'
  }

  const electronShell = await resolveElectronShell(dependencyOverrides)
  const message = await electronShell.openPath(filePath)
  return {
    success: !message,
    source: 'fling',
    record: normalizeLocalRecord(record),
    errorCode: message ? 'open_executable_failed' : '',
    message: message || '已启动 FLiNG 修改器。'
  }
}
