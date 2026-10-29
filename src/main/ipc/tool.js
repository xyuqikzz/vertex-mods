import { deleteFileSync, verifyFileMD5 } from '../utils/fileIntegrity.js'
import { formatChinaTime } from '../utils/dateTime.js'
import { getParentPath } from '../utils/filePath.js'
import { compareVersions } from '../utils/version.js'
import { nativeText } from '../services/uiLanguage.js'
import { exec } from 'child_process'
import { dialog, shell } from 'electron'
import fs from 'fs-extra'
import { promisify } from 'util'
import si from 'systeminformation'
import os from 'os'
import path from 'path'
import crypto from 'node:crypto'

const execPromise = promisify(exec)
import {
  extractAndGetStructureByNodeApi,
  generateFileMD5ByNodeApi
} from '../api/index.js'
import { uninstallFileByJson } from '../utils/uninstall.js'
import {
  assertSafeRemovablePath,
  copyDirectoryBounded,
  isPathInside,
  normalizeComparablePath
} from '../services/storage-migration/cacheMigrationCore.js'

const debounce = (func, delay) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), delay)
  }
}

// 单位转换工具（1024进制）
const formatSize = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + '' + units[i]
}

// mb to gb
function mbToGb(mb) {
  return `${Math.ceil(mb / 1024)}GB`
}

// 获取磁盘基础信息
const getLogicalDrives = async () => {
  const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,Size,FreeSpace | ConvertTo-Json -Compress"`
  const { stdout } = await execPromise(cmd)
  const content = String(stdout || '').trim()
  const parsed = content ? JSON.parse(content) : []
  const records = Array.isArray(parsed) ? parsed : [parsed]
  return records.map((item) => {
    const drive = String(item?.DeviceID || '').trim()
    const driveType = Number(item?.DriveType || 0)
    const totalBytes = Number(item?.Size || 0)
    const freeBytes = Number(item?.FreeSpace || 0)
    const usedBytes = totalBytes - freeBytes
    return {
      drive,
      driveType,
      total: formatSize(totalBytes),
      free: formatSize(freeBytes),
      used: formatSize(usedBytes),
      usage: totalBytes > 0 ? ((usedBytes / totalBytes) * 100).toFixed(2) + '%' : '0.00%',
      raw: { totalBytes, freeBytes, usedBytes, driveType }
    }
  })
}

// 打开系统指定路径（如果是文件就高亮显示）
const openPath = async (event, path) => {
  fs.pathExists(path, async (err, exists) => {
    if (exists) {
      const stats = await fs.stat(path)
      if (stats.isFile()) {
        shell.showItemInFolder(path)
      } else if (stats.isDirectory()) {
        await shell.openPath(path)
      }
    } else {
      event.reply('openFileFail', '路径不存在')
    }
  })
}

// 判空
const isValid = (val) => {
  const INVALID_VALUES = new Set(['none', 'None', 'undefined', 'Undefined'])
  return val != null && !INVALID_VALUES.has(val)
}

// 移除无效字段
const filterInfoList = (list) => {
  return list.filter((item) => isValid(item.data))
}

// CPU 信息
const getPcCpuInfo = async (event) => {
  try {
    const cpu = await si.cpu()
    return [
      {
        name: cpu.manufacturer + ' ' + cpu.brand,
        infoList: filterInfoList([
          { name: '核心数', data: cpu.physicalCores },
          { name: '线程数', data: cpu.cores },
          { name: '基准频率', data: cpu.speed ? `${cpu.speed}GHz` : null },
          { name: '插槽类型', data: cpu.socket },
          {
            name: '是否开启虚拟化',
            data: cpu.virtualization !== undefined ? (cpu.virtualization ? '是' : '否') : null
          }
        ])
      }
    ]
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

// GPU 信息
const getPcGpuInfo = async (event) => {
  try {
    const gpu = await si.graphics()
    const controllers = gpu.controllers
    const arr = []

    controllers.forEach((item) => {
      const isPhysicalGpu = item.vram ? 1 : 0
      if (isPhysicalGpu) {
        arr.push({
          name: item.model,
          infoList: filterInfoList([
            { name: '显存', data: mbToGb(item.vram) },
            { name: '驱动版本', data: item.driverVersion },
            { name: '显卡最大功耗', data: item.powerLimit ? item.powerLimit + 'W' : null },
            { name: '核心频率', data: item.clockCore ? item.clockCore + 'MHz' : null },
            { name: '显存频率', data: item.clockMemory ? item.clockMemory + 'MHz' : null }
          ])
        })
      } else {
        arr.push({
          name: item.model,
          infoList: filterInfoList([{ name: '类型', data: '虚拟显卡' }])
        })
      }
    })

    return arr
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

// 主板信息
const getPcBaseboardInfo = async (event) => {
  try {
    const baseboard = await si.baseboard()
    return [
      {
        name: baseboard.model,
        infoList: filterInfoList([
          { name: '制造商', data: baseboard.manufacturer },
          { name: '支持最大内存', data: formatSize(baseboard.memMax) },
          { name: '支持最大内存插槽', data: baseboard.memSlots },
          { name: '序列号', data: baseboard.serial }
        ])
      }
    ]
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

// 硬盘信息
const getPcDiskInfo = async (event) => {
  try {
    const disks = await si.diskLayout()
    return disks.map((item) => {
      return {
        name: item.name,
        infoList: filterInfoList([
          { name: '硬盘类型', data: item.type },
          { name: '实际容量', data: formatSize(item.size) }
        ])
      }
    })
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

// 内存信息
const getPcMemoryInfo = async (event) => {
  try {
    const memLayout = await si.memLayout()
    return memLayout.map((item) => {
      return {
        name: item.manufacturer + ' ' + formatSize(item.size),
        infoList: filterInfoList([
          { name: '内存类型', data: item.type },
          { name: '内存频率', data: item.clockSpeed ? item.clockSpeed + 'MHz' : null },
          { name: '序列号', data: item.serialNum },
          { name: '插槽位置', data: item.bank }
        ])
      }
    })
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

async function getFullSystemInfo(event) {
  try {
    const osInfo = await si.osInfo()
    return [
      {
        name: osInfo.distro,
        infoList: filterInfoList([
          {
            name: '版本号',
            data: osInfo.release
          },
          {
            name: '处理器架构',
            data: osInfo.arch
          },
          {
            name: '计算机名',
            data: osInfo.hostname
          },
          {
            name: '产品密钥',
            data: osInfo.serial
          },
          {
            name: '是否开启虚拟化',
            data: `${osInfo.hypervisor ? '是' : '否'}`
          }
        ])
      }
    ]
  } catch (error) {
    event.reply(`scanDeviceInfoFail`, { error })
  }
}

async function restoreMigrationBackup(migration = {}) {
  const { finalTarget, backupPath } = migration
  if (finalTarget && (await fs.pathExists(finalTarget))) {
    await fs.remove(assertSafeRemovablePath(finalTarget))
  }
  if (backupPath && (await fs.pathExists(backupPath))) {
    await fs.move(backupPath, finalTarget, { overwrite: false })
  }
}

async function migrateData(sourceDir, targetDir, options = {}) {
  if (!targetDir) {
    const error = new Error('目标路径不能为空')
    error.code = 'missing_cache_target_path'
    throw error
  }

  const src = sourceDir ? path.resolve(sourceDir) : ''
  const dst = path.resolve(targetDir)
  const baseName = String(options.targetName || path.basename(src || 'cache') || 'cache').trim()
  const finalTarget = path.join(dst, baseName)
  const migrationId = crypto.randomUUID()
  const stagingPath = path.join(dst, `.${baseName}.migrating-${migrationId}`)
  const backupPath = path.join(dst, `.${baseName}.backup-${migrationId}`)
  const sourceExists = Boolean(src && (await fs.pathExists(src)))

  if (src && normalizeComparablePath(src) === normalizeComparablePath(finalTarget)) {
    return {
      changed: false,
      sourcePath: src,
      finalTarget,
      stagingPath: '',
      backupPath: '',
      fileCount: 0,
      sizeMB: '0.00',
      skippedLinkCount: 0
    }
  }

  if (src && isPathInside(finalTarget, src)) {
    const error = new Error('新缓存路径不能位于旧缓存目录内部')
    error.code = 'invalid_nested_cache_target'
    throw error
  }
  if (src && isPathInside(src, finalTarget)) {
    const error = new Error('旧缓存路径不能位于新缓存目录内部')
    error.code = 'invalid_overlapping_cache_source'
    throw error
  }

  await fs.ensureDir(dst)
  const migration = {
    changed: true,
    sourcePath: src,
    finalTarget,
    stagingPath,
    backupPath: '',
    fileCount: 0,
    sizeMB: '0.00',
    skippedLinkCount: 0
  }

  try {
    if (await fs.pathExists(finalTarget)) {
      await copyDirectoryBounded(finalTarget, stagingPath, options)
    } else {
      await fs.ensureDir(stagingPath)
    }

    if (sourceExists) {
      const copied = await copyDirectoryBounded(src, stagingPath, options)
      migration.fileCount = copied.fileCount
      migration.sizeMB = copied.sizeMB
      migration.skippedLinkCount = copied.skippedLinkCount
    }

    if (await fs.pathExists(finalTarget)) {
      await fs.move(finalTarget, backupPath, { overwrite: false })
      migration.backupPath = backupPath
    }
    await fs.move(stagingPath, finalTarget, { overwrite: false })
    migration.stagingPath = ''
    return migration
  } catch (error) {
    try {
      if (await fs.pathExists(stagingPath)) {
        await fs.remove(assertSafeRemovablePath(stagingPath))
      }
      if (migration.backupPath) {
        await restoreMigrationBackup(migration)
      }
    } catch (rollbackError) {
      error.rollbackError = rollbackError
    }
    throw error
  }
}

async function finalizeDataMigration(migration = {}) {
  const warnings = []
  for (const cleanupPath of [migration.backupPath, migration.sourcePath]) {
    if (!cleanupPath || normalizeComparablePath(cleanupPath) === normalizeComparablePath(migration.finalTarget)) {
      continue
    }
    try {
      if (await fs.pathExists(cleanupPath)) {
        await fs.remove(assertSafeRemovablePath(cleanupPath))
      }
    } catch (error) {
      warnings.push(String(error?.message || error))
    }
  }
  return { cleanupWarning: warnings.join('；') }
}

async function rollbackDataMigration(migration = {}) {
  if (!migration?.changed) return
  await restoreMigrationBackup(migration)
  if (migration.stagingPath && (await fs.pathExists(migration.stagingPath))) {
    await fs.remove(assertSafeRemovablePath(migration.stagingPath))
  }
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0')

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1) // 月份是从 0 开始的
  const day = pad(date.getDate())

  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}



function pathExistsSync(targetPath) {
  try {
    const absolutePath = path.resolve(targetPath)
    fs.accessSync(absolutePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 打开文件选择对话框
 * @param {Object} options - 对话框选项
 * @param {string} [options.title='选择文件'] - 对话框标题
 * @param {string} [options.defaultPath=process.cwd()] - 默认路径
 * @param {string[]} [options.filters=[]] - 文件过滤器
 * @param {boolean} [options.multiSelections=false] - 是否允许多选
 * @returns {Promise<string|string[]>} 返回选择的文件路径或路径数组
 */
async function selectFile(options = {}) {
  const result = await dialog.showOpenDialog({
    title: options.title || nativeText('selectFile'),
    defaultPath: options.defaultPath,
    filters: options.filters || [],
    properties: [
      'openFile',
      ...(options.multiSelections ? ['multiSelections'] : []),
      ...(options.properties || [])
    ]
  })

  return result.canceled || result.filePaths.length === 0
    ? null
    : options.multiSelections
      ? result.filePaths
      : result.filePaths[0]
}



async function extractAndGetStructure(zipFilePath, extractPath, usageType = 1, event) {
  return await extractAndGetStructureByNodeApi(zipFilePath, extractPath, usageType, event)
}

function uninstallFiles(json, mod) {
  return uninstallFileByJson(json, mod)
}

async function generateFileMD5(filePath, onProgress) {
  return await generateFileMD5ByNodeApi(filePath, onProgress)
}







function getPath(inputPath) {
  console.log(inputPath)
  return inputPath.replace(/%([^%]+)%/g, (match, varName) => {
    if (customVarHandlers[varName]) {
      return customVarHandlers[varName]()
    }
    return match
  })
}

const customVarHandlers = {
  // %user% → 返回当前用户目录
  user: () => path.join(process.env.USERPROFILE || os.homedir())
}

export {
  debounce,
  formatSize,
  getLogicalDrives,
  openPath,
  getPcCpuInfo,
  getPcGpuInfo,
  getPcBaseboardInfo,
  getPcDiskInfo,
  getPcMemoryInfo,
  getFullSystemInfo,
  migrateData,
  finalizeDataMigration,
  rollbackDataMigration,
  copyDirectoryBounded,
  formatDate,
  sleep,
  formatChinaTime,
  pathExistsSync,
  selectFile,
  getParentPath,
  extractAndGetStructure,
  uninstallFiles,
  generateFileMD5,
  verifyFileMD5,
  deleteFileSync,
  compareVersions,
  getPath
}
