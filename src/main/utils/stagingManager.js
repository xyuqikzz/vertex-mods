import path from 'path'
import userPath from '../initPath.js'
import { getVertexFileNodeApi } from '../api/shared/index.js'

const fileApi = getVertexFileNodeApi()

/**
 * 暂存管理器
 *
 * 设计目标：
 * 1. JS 仅负责参数校验、日志输出、异常转换
 * 2. 部署/卸载/空目录清理流程全部交给 N-API
 * 3. 保持现有调用入口和主要日志格式不变
 */
export class StagingManager {
  /**
   * 获取暂存根目录，优先跟随目标游戏所在盘符。
   * @param {string} basePath - 游戏根目录或可执行文件路径
   * @returns {string}
   */
  static getWorkspaceRootPath(basePath = '') {
    const safeBasePath = String(basePath || '').trim()

    try {
      const resolvedBasePath = safeBasePath ? path.resolve(safeBasePath) : path.resolve(userPath)
      const driveRoot = String(path.parse(resolvedBasePath).root || '').trim()
      if (driveRoot) {
        return path.join(driveRoot, 'Vertex', 'dow')
      }
    } catch (error) {
      StagingManager._log('warn', '暂存根目录解析失败，回退到用户目录', error)
    }

    return userPath
  }

  /**
   * 获取指定 Mod 的暂存目录
   * @param {string|number} appId - 游戏 App ID
   * @param {string} fileNameWithoutExt - Mod 唯一目录名
   * @param {string} basePath - 游戏根目录或可执行文件路径
   * @returns {string}
   */
  static getStagingPath(appId, fileNameWithoutExt, basePath = '') {
    return path.join(
      StagingManager.getWorkspaceRootPath(basePath),
      'staging',
      String(appId),
      fileNameWithoutExt
    )
  }

  /**
   * 中文标记：统一的必要输出
   */
  static _log(level, message, extra) {
    const isDebug = process.env.STAGING_MANAGER_DEBUG === '1'
    const isError = level === 'error'
    const isWarn = level === 'warn'
    const isInfo = level === 'info'

    if (!(isError || isWarn || isInfo || isDebug)) return

    const prefixMap = {
      info: '[暂存管理-信息]',
      warn: '[暂存管理-警告]',
      error: '[暂存管理-错误]',
      debug: '[暂存管理-调试]'
    }

    const prefix = prefixMap[level] || '[暂存管理]'

    if (extra !== undefined) {
      if (isError) console.error(prefix, message, extra)
      else if (isWarn) console.warn(prefix, message, extra)
      else console.log(prefix, message, extra)
      return
    }

    if (isError) console.error(prefix, message)
    else if (isWarn) console.warn(prefix, message)
    else console.log(prefix, message)
  }

  /**
   * 中文标记：规范化必填路径参数
   */
  static _resolveRequiredPath(targetPath, fieldName) {
    const safePath = String(targetPath || '').trim()
    if (!safePath) {
      throw new Error(`${fieldName} 不能为空`)
    }
    return path.resolve(safePath)
  }

  /**
   * 中文标记：统一调用原生文件接口
   */
  static async _callNativeFileApi(methodName, ...args) {
    if (!fileApi || typeof fileApi[methodName] !== 'function') {
      throw new Error(`Vertex file_api 未提供原生方法：${methodName}`)
    }

    return new Promise((resolve, reject) => {
      try {
        fileApi[methodName](...args, (err, result) => {
          if (err) {
            reject(err)
            return
          }
          resolve(result)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 中文标记：格式化毫秒显示
   */
  static _formatMs(ms) {
    const safeMs = Number(ms || 0)
    if (safeMs < 1000) return `${safeMs.toFixed(2)}ms`
    return `${(safeMs / 1000).toFixed(3)}s`
  }

  /**
   * 中文标记：读取原生返回的统计对象
   */
  static _normalizeMetrics(result) {
    const metrics = result && typeof result === 'object' ? result.metrics : null
    const phases = metrics && typeof metrics.phases === 'object' ? metrics.phases : {}
    const operations = metrics && typeof metrics.operations === 'object' ? metrics.operations : {}

    return {
      totalMs: Number(metrics?.totalMs || 0),
      phases: {
        ensureTargetRootMs: Number(phases.ensureTargetRootMs || 0),
        linkLoopMs: Number(phases.linkLoopMs || 0),
        unlinkLoopMs: Number(phases.unlinkLoopMs || 0),
        cleanupEmptyDirsMs: Number(phases.cleanupEmptyDirsMs || 0)
      },
      operations: {
        lstatMs: Number(operations.lstatMs || 0),
        readdirMs: Number(operations.readdirMs || 0),
        ensureDirMs: Number(operations.ensureDirMs || 0),
        unlinkMs: Number(operations.unlinkMs || 0),
        linkMs: Number(operations.linkMs || 0),
        copyFileMs: Number(operations.copyFileMs || 0)
      }
    }
  }

  /**
   * 中文标记：输出部署用时统计
   */
  static _logDeployMetrics(result) {
    const metrics = StagingManager._normalizeMetrics(result)
    StagingManager._log(
      'info',
      `部署完成：目录 ${Number(result?.directories || 0)} 个，硬链接 ${Number(result?.linkedFiles || 0)} 个，复制 ${Number(result?.copiedFiles || 0)} 个，覆盖 ${Number(result?.overwrittenFiles || 0)} 个，总耗时 ${StagingManager._formatMs(metrics.totalMs)}`
    )

    StagingManager._log(
      'info',
      `部署用时统计：目标目录准备 ${StagingManager._formatMs(metrics.phases.ensureTargetRootMs)}，主处理 ${StagingManager._formatMs(metrics.phases.linkLoopMs)}，lstat ${StagingManager._formatMs(metrics.operations.lstatMs)}，readdir ${StagingManager._formatMs(metrics.operations.readdirMs)}，ensureDir ${StagingManager._formatMs(metrics.operations.ensureDirMs)}，unlink ${StagingManager._formatMs(metrics.operations.unlinkMs)}，link ${StagingManager._formatMs(metrics.operations.linkMs)}，copyFile ${StagingManager._formatMs(metrics.operations.copyFileMs)}`
    )
  }

  /**
   * 中文标记：输出卸载用时统计
   */
  static _logUndeployMetrics(result) {
    const metrics = StagingManager._normalizeMetrics(result)
    StagingManager._log(
      'info',
      `卸载完成：移除文件 ${Number(result?.removedFiles || 0)} 个，遍历目录 ${Number(result?.directories || 0)} 个，总耗时 ${StagingManager._formatMs(metrics.totalMs)}`
    )

    StagingManager._log(
      'info',
      `卸载用时统计：主处理 ${StagingManager._formatMs(metrics.phases.unlinkLoopMs)}，清理空目录 ${StagingManager._formatMs(metrics.phases.cleanupEmptyDirsMs)}，lstat ${StagingManager._formatMs(metrics.operations.lstatMs)}，readdir ${StagingManager._formatMs(metrics.operations.readdirMs)}，unlink ${StagingManager._formatMs(metrics.operations.unlinkMs)}`
    )
  }

  /**
   * 中文标记：空目录清理薄封装
   */
  static async removeEmptyDirs(dirPath) {
    const safeDirPath = StagingManager._resolveRequiredPath(dirPath, 'dirPath')
    return StagingManager._callNativeFileApi('removeEmptyDirs', safeDirPath)
  }

  /**
   * 部署暂存中的 Mod 到目标游戏目录
   * @param {string} stagingRoot - 暂存目录
   * @param {string} targetRoot - 游戏目录
   * @returns {Promise<boolean>}
   */
  static async deploy(stagingRoot, targetRoot) {
    const safeStagingRoot = StagingManager._resolveRequiredPath(stagingRoot, 'stagingRoot')
    const safeTargetRoot = StagingManager._resolveRequiredPath(targetRoot, 'targetRoot')

    StagingManager._log('info', `开始部署：${safeStagingRoot} -> ${safeTargetRoot}`)

    try {
      const result = await StagingManager._callNativeFileApi(
        'deployStaging',
        safeStagingRoot,
        safeTargetRoot
      )
      StagingManager._logDeployMetrics(result)
      return true
    } catch (error) {
      StagingManager._log('error', '部署失败', error)
      throw error
    }
  }

  /**
   * 卸载已部署的 Mod
   * @param {string} stagingRoot - 暂存目录
   * @param {string} targetRoot - 游戏目录
   * @returns {Promise<boolean>}
   */
  static async undeploy(stagingRoot, targetRoot) {
    const safeStagingRoot = StagingManager._resolveRequiredPath(stagingRoot, 'stagingRoot')
    const safeTargetRoot = StagingManager._resolveRequiredPath(targetRoot, 'targetRoot')

    StagingManager._log('info', `开始卸载：${safeTargetRoot}`)

    try {
      const result = await StagingManager._callNativeFileApi(
        'undeployStaging',
        safeStagingRoot,
        safeTargetRoot
      )

      const skippedReason = String(result?.skippedReason || '').trim()
      if (skippedReason === 'staging_missing') {
        StagingManager._log('warn', `卸载时暂存目录不存在：${safeStagingRoot}`)
        return false
      }

      if (skippedReason === 'target_missing') {
        return true
      }

      StagingManager._logUndeployMetrics(result)
      return true
    } catch (error) {
      StagingManager._log('error', '卸载失败', error)
      throw error
    }
  }

  static async prepareDeploy(options = {}) {
    const target = options && typeof options === 'object' ? options : {}
    if (fileApi && typeof fileApi.prepareDeploy === 'function') {
      return StagingManager._callNativeFileApi('prepareDeploy', target)
    }
    return {
      success: true,
      nativePrepared: false,
      message: '当前原生模块未提供 prepareDeploy，已使用兼容部署链路'
    }
  }

  static async reconcileDeploy(options = {}) {
    const target = options && typeof options === 'object' ? options : {}
    if (fileApi && typeof fileApi.reconcileDeploy === 'function') {
      return StagingManager._callNativeFileApi('reconcileDeploy', target)
    }
    return {
      success: true,
      nativePrepared: false,
      message: '当前原生模块未提供 reconcileDeploy，由主进程协调层执行'
    }
  }

  static async recoverDeploy(options = {}) {
    const target = options && typeof options === 'object' ? options : {}
    if (fileApi && typeof fileApi.recoverDeploy === 'function') {
      return StagingManager._callNativeFileApi('recoverDeploy', target)
    }
    return {
      success: false,
      code: 'NATIVE_RECOVER_UNAVAILABLE',
      message: '当前原生模块未提供 recoverDeploy'
    }
  }

  static async inspectCapabilities(options = {}) {
    const target = options && typeof options === 'object' ? options : {}
    if (fileApi && typeof fileApi.inspectCapabilities === 'function') {
      return StagingManager._callNativeFileApi('inspectCapabilities', target)
    }
    return {
      success: true,
      platform: 'win32',
      hardLink: true,
      copyFallback: true,
      nativeWorker: true,
      message: '当前使用现有 Windows N-API 部署能力'
    }
  }

  static async scanPackageStructure(stagingPath, options = {}) {
    const safeStagingPath = StagingManager._resolveRequiredPath(stagingPath, 'stagingPath')
    if (fileApi && typeof fileApi.scanPackageStructure === 'function') {
      return StagingManager._callNativeFileApi('scanPackageStructure', safeStagingPath, options)
    }
    if (fileApi && typeof fileApi.listPackageRootCandidates === 'function') {
      return StagingManager._callNativeFileApi(
        'listPackageRootCandidates',
        safeStagingPath,
        Number(options?.maxDepth ?? -1)
      )
    }
    return {
      success: false,
      code: 'NATIVE_SCAN_UNAVAILABLE',
      message: '当前原生模块未提供包结构扫描'
    }
  }

  static async buildManifest(stagingPath, options = {}) {
    const safeStagingPath = StagingManager._resolveRequiredPath(stagingPath, 'stagingPath')
    if (fileApi && typeof fileApi.buildManifest === 'function') {
      return StagingManager._callNativeFileApi('buildManifest', safeStagingPath, options)
    }
    return {
      success: false,
      code: 'NATIVE_MANIFEST_UNAVAILABLE',
      stagingPath: safeStagingPath,
      message: '当前原生模块未提供 manifest 构建能力'
    }
  }
}
