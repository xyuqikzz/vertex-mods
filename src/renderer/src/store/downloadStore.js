import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// 引入依赖
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useLocalDatastore } from '@renderer/store/localDataStore.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import { INSTALL_FLOW_CONFIG } from '../../../shared/installation/install-flow-config.js'
import {
  buildDownloadFailureNotice,
  buildInstallFailureNotice
} from '../../../shared/installation/install-flow-message.js'

export const useDownloadStore = defineStore(
  'downloadStore',
  () => {
    // 状态声明
    const downloadList = ref([]) // 下载任务列表
    const isShowRed = ref(false) // 是否显示红点提示

    const modInInstallQueue = ref([{ id: null, type: null }])
    const modInstallFailed = ref([])
    const modInstallList = ref([])

    const localGameRecord = ref([])
    const currentGameLocalData = ref({})

    // 进度更新节流配置（200ms内最多更新一次）
    const UPDATE_THROTTLE_MS = INSTALL_FLOW_CONFIG.download.uiThrottleMs
    const lastUpdateTime = new Map()
    // 仅在渲染进程内维护的任务钩子与批次状态，不参与持久化
    const taskHookMap = new Map()
    const batchHookMap = new Map()
    const silentFailedTaskIdSet = new Set()

    // 监听下载列表变化
    watch(
      downloadList,
      (newList) => {
        isShowRed.value = newList.length > 0
      },
      { deep: true }
    )

    function createDownloadTaskId() {
      return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
    }

    function normalizeDedupePart(value = '') {
      return String(value ?? '')
        .trim()
        .toLowerCase()
    }

    function pickFirstDedupeText(...values) {
      for (const value of values) {
        const text = normalizeDedupePart(value)
        if (text) {
          return text
        }
      }
      return ''
    }

    function buildDownloadBusinessId(item = {}) {
      const platform = pickFirstDedupeText(item?.sourcePlatform, item?.sourceType, item?.source)
      const gameId = pickFirstDedupeText(
        item?.sourceGameId,
        item?.gameSourceId,
        item?.gameId,
        item?.appId,
        item?.steamAppId,
        item?.sourceGameSlug,
        item?.gameSourceSlug
      )
      const modId = pickFirstDedupeText(
        item?.sourceModId,
        item?.sourceModKey,
        item?.modReference,
        item?.packageFullName,
        item?.fullName,
        item?.modId,
        item?.sourceId
      )

      if (!platform || !gameId || !modId) {
        return ''
      }
      return `${platform}:${gameId}:${modId}`
    }

    function buildDownloadDedupeKey(item = {}) {
      const explicitKey = pickFirstDedupeText(item?.dedupeKey, item?.taskDedupeKey, item?.conflictKey)
      if (explicitKey) {
        return explicitKey
      }

      const businessId = buildDownloadBusinessId(item)
      if (businessId) {
        const fileIdentity = pickFirstDedupeText(
          item?.sourceFileId,
          item?.fileId,
          item?.version,
          item?.modVersion,
          item?.download_url
        )
        return [businessId, fileIdentity].filter(Boolean).join(':')
      }

      const moduleName = normalizeDedupePart(item?.module)
      const downloadUrl = String(item?.download_url || '').trim()
      return moduleName && downloadUrl ? `url:${moduleName}:${downloadUrl}` : ''
    }

    function buildTaskConflictKey(item = {}) {
      return buildDownloadDedupeKey(item)
    }

    function findSameDownloadTask(item = {}) {
      const taskId = String(item?.id || '').trim()
      if (taskId) {
        const sameIdTask =
          downloadList.value.find((task) => String(task.id || '').trim() === taskId) || null
        if (sameIdTask) {
          return sameIdTask
        }
      }

      const conflictKey = buildTaskConflictKey(item)
      if (conflictKey) {
        return downloadList.value.find((task) => buildTaskConflictKey(task) === conflictKey) || null
      }
      return null
    }

    function buildDownloadTask(item = {}) {
      const businessId = buildDownloadBusinessId(item)
      const dedupeKey = buildDownloadDedupeKey(item)
      return {
        id: createDownloadTaskId(),
        file_size: 0,
        speed: 0,
        percentage: 0,
        ...(businessId ? { businessId } : {}),
        ...(dedupeKey ? { dedupeKey } : {}),
        ...item
      }
    }

    function normalizeBatchResult(task, payload = {}, meta = {}) {
      const sanitizedMeta = sanitizeIpcPayload(meta, {})
      return {
        id: String(task?.id || payload?.id || '').trim(),
        filePath: String(payload?.filePath || '').trim(),
        task,
        payload,
        meta: sanitizedMeta
      }
    }

    function clearTaskHookById(taskId = '') {
      const safeTaskId = String(taskId || '').trim()
      if (!safeTaskId) {
        return
      }
      taskHookMap.delete(safeTaskId)
    }

    function clearDownloadBatch(batchId = '') {
      const safeBatchId = String(batchId || '').trim()
      if (!safeBatchId) {
        return
      }

      const batch = batchHookMap.get(safeBatchId)
      if (batch) {
        const taskIds = Array.isArray(batch.taskIds) ? batch.taskIds : []
        taskIds.forEach((taskId) => clearTaskHookById(taskId))
      }
      batchHookMap.delete(safeBatchId)
    }

    async function runTaskSuccessHook(task, payload = {}) {
      const hook = taskHookMap.get(String(task?.id || '').trim())
      if (!hook) {
        return
      }

      if (hook.batchId) {
        await runBatchSuccessHook(hook.batchId, task, payload, hook.meta)
        return
      }

      try {
        if (typeof hook.onSuccess === 'function') {
          await hook.onSuccess(normalizeBatchResult(task, payload, hook.meta))
        }
      } catch (error) {
        console.error('下载成功回调执行失败', error)
      } finally {
        clearTaskHookById(task.id)
      }
    }

    async function runBatchSuccessHook(batchId, task, payload = {}, meta = {}) {
      const safeBatchId = String(batchId || '').trim()
      const batch = batchHookMap.get(safeBatchId)
      if (!batch || batch.failed) {
        clearTaskHookById(task?.id)
        return
      }

      batch.results.push(normalizeBatchResult(task, payload, meta))
      batch.finishedTaskIds.add(String(task?.id || '').trim())
      clearTaskHookById(task?.id)

      if (batch.finishedTaskIds.size < batch.total) {
        return
      }

      const orderedResults = [...batch.results].sort((left, right) => {
        const leftSort = Number(left?.meta?.sortIndex ?? 0)
        const rightSort = Number(right?.meta?.sortIndex ?? 0)
        return leftSort - rightSort
      })

      try {
        if (typeof batch.onComplete === 'function') {
          await batch.onComplete(orderedResults)
        }
      } catch (error) {
        console.error('批量下载完成回调执行失败', error)
        if (typeof batch.onError === 'function') {
          try {
            await batch.onError({
              batchId: safeBatchId,
              message: String(error?.message || uiText('ui.batchCallbackFailed')),
              results: orderedResults
            })
          } catch (batchError) {
            console.error('批量下载错误回调执行失败', batchError)
          }
        }
      } finally {
        clearDownloadBatch(safeBatchId)
      }
    }

    async function runTaskErrorHook(task, message = '', payload = {}) {
      const safeTaskId = String(task?.id || '').trim()
      const hook = taskHookMap.get(safeTaskId)
      if (!hook) {
        return
      }

      if (hook.batchId) {
        await runBatchErrorHook(hook.batchId, task, message, payload, hook.meta)
        return
      }

      try {
        if (typeof hook.onError === 'function') {
          await hook.onError({
            id: safeTaskId,
            task,
            payload,
            meta: hook.meta,
            message: String(message || '').trim()
          })
        }
      } catch (error) {
        console.error('下载失败回调执行失败', error)
      } finally {
        clearTaskHookById(safeTaskId)
      }
    }

    async function runBatchErrorHook(batchId, task, message = '', payload = {}, meta = {}) {
      const safeBatchId = String(batchId || '').trim()
      const batch = batchHookMap.get(safeBatchId)
      if (!batch) {
        clearTaskHookById(task?.id)
        return
      }

      const safeTaskId = String(task?.id || '').trim()
      if (batch.failed) {
        clearTaskHookById(safeTaskId)
        return
      }

      batch.failed = true
      const pendingTaskIds = (Array.isArray(batch.taskIds) ? batch.taskIds : []).filter(
        (taskId) =>
          String(taskId || '').trim() &&
          String(taskId || '').trim() !== safeTaskId &&
          !batch.finishedTaskIds.has(String(taskId || '').trim())
      )

      pendingTaskIds.forEach((taskId) => {
        silentFailedTaskIdSet.add(String(taskId || '').trim())
        ipcRenderer.send('removeDownloadTask', taskId)
      })

      try {
        if (typeof batch.onError === 'function') {
          await batch.onError({
            batchId: safeBatchId,
            id: safeTaskId,
            task,
            payload,
            meta,
            message: String(message || '').trim(),
            results: [...batch.results]
          })
        }
      } catch (error) {
        console.error('批量下载错误回调执行失败', error)
      } finally {
        clearDownloadBatch(safeBatchId)
      }
    }

    /**
     * 添加新的下载任务
     * @param {Object} item - 下载任务项
     * @property {string} task_name - 任务名称(如'图片下载')
     * @property {string} module - 发起模块(如'通用')
     * @property {string} file_type - 具体文件类型
     * @property {string} download_url - 下载链接
     * @property {number} [file_size=0] - 文件大小
     * @property {number} [speed=0] - 下载速度
     * @property {number} [percentage=0] - 下载进度百分比
     * @property {number} [saveType=0] - 保存位置类型 0：Image 1: File 2: Mod 3: App
     @property {Object} fun - 下载完后的执行类型
     *
     */
    function addDownloadItem(item, options = {}) {
      const duplicateTask = findSameDownloadTask(item)
      if (duplicateTask) {
        return false
      }
      if (!item.fun) item.fun = { type: 0 }
      const newItem = buildDownloadTask(item)

      // 多任务场景下使用 push，避免每次扩容都复制整个数组导致卡顿
      downloadList.value.push(newItem)
      if (options && typeof options === 'object') {
        const hasHook =
          typeof options.onSuccess === 'function' || typeof options.onError === 'function'
        if (hasHook || options.batchId) {
          taskHookMap.set(String(newItem.id || '').trim(), {
            batchId: String(options.batchId || '').trim(),
            meta: sanitizeIpcPayload(options.meta, {}),
            onSuccess: options.onSuccess,
            onError: options.onError
          })
        }
      }
      const safeNewItem = sanitizeIpcPayload(newItem, {
        id: String(newItem?.id || '').trim(),
        task_name: String(newItem?.task_name || '').trim(),
        module: String(newItem?.module || '').trim(),
        file_type: String(newItem?.file_type || '').trim(),
        download_url: String(newItem?.download_url || '').trim(),
        file_size: Number(newItem?.file_size || 0),
        speed: Number(newItem?.speed || 0),
        percentage: Number(newItem?.percentage || 0),
        saveType: Number(newItem?.saveType || 0),
        fun: {
          type: Number(newItem?.fun?.type || 0)
        }
      })
      if (options?.skipQueue !== true) {
        ipcRenderer.send('addTasksToQueue', safeNewItem)
      }
      return newItem
    }

    function addDownloadBatch(list = [], options = {}) {
      const safeList = Array.isArray(list) ? list : []
      if (!safeList.length) {
        return {
          success: false,
          message: uiText('ui.noDownloadTasksToAdd')
        }
      }

      const localConflictMap = new Map()
      for (const entry of safeList) {
        const item = entry?.item && typeof entry.item === 'object' ? entry.item : {}
        const duplicateTask = findSameDownloadTask(item)
        if (duplicateTask) {
          return {
            success: false,
            message: uiText('ui.downloadTaskAlreadyExistsValue', { value1: (String(item?.task_name || item?.download_url || uiText('ui.unknownTask'))) }),
            conflict: duplicateTask
          }
        }

        const conflictKey = buildTaskConflictKey(item)
        if (conflictKey && localConflictMap.has(conflictKey)) {
          return {
            success: false,
            message: uiText('ui.duplicateDownloadInBatchValue', { value1: (String(item?.task_name || item?.download_url || uiText('ui.unknownTask'))) }),
            conflict: item
          }
        }
        if (conflictKey) {
          localConflictMap.set(conflictKey, true)
        }
      }

      const batchId =
        String(options?.batchId || '').trim() ||
        `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      batchHookMap.set(batchId, {
        batchId,
        total: safeList.length,
        taskIds: [],
        results: [],
        finishedTaskIds: new Set(),
        failed: false,
        onComplete: options?.onComplete,
        onError: options?.onError
      })

      const createdTasks = []
      for (const entry of safeList) {
        const item = entry?.item && typeof entry.item === 'object' ? entry.item : {}
        const created = addDownloadItem(item, {
          batchId,
          meta: sanitizeIpcPayload(entry?.meta, {})
        })
        if (!created) {
          clearDownloadBatch(batchId)
          return {
            success: false,
            message: uiText('ui.downloadTaskAlreadyExistsValue', { value1: (String(item?.task_name || item?.download_url || uiText('ui.unknownTask'))) }),
            conflict: item
          }
        }
        createdTasks.push(created)
      }

      const batch = batchHookMap.get(batchId)
      if (batch) {
        batch.taskIds = createdTasks.map((task) => String(task?.id || '').trim()).filter(Boolean)
      }

      return {
        success: true,
        batchId,
        tasks: createdTasks
      }
    }

    /**
     * 更新下载任务进度（带节流）
     * @param {string} id - 任务ID
     * @param {Object} data - 进度数据
     */
    function updateDataById(id, data) {
      const now = Date.now()
      const lastUpdate = lastUpdateTime.get(id) || 0

      // 节流：200ms内只更新一次（下载完成时除外）
      if (now - lastUpdate < UPDATE_THROTTLE_MS && data.progress < 100) {
        return
      }
      lastUpdateTime.set(id, now)

      const task = downloadList.value.find((task) => task.id === id)
      if (task) {
        Object.assign(task, {
          file_size: data.totalBytes,
          speed: data.speed,
          percentage: data.progress,
          file_type: data.fileType,
          isPaused: data.isPaused,
          supportsRange: data.supportsRange
        })
      }
    }

    async function downloadSuccessfulById(id, payload = {}) {
      const task = downloadList.value.find((task) => task.id === id)
      if (task) {
        task.speed = 0
        task.percentage = 100
        runTaskSuccessHook(task, payload).catch((error) => {
          console.error('下载成功后置回调执行失败', error)
        })

        setTimeout(() => {
          deleteItemById(id)
        }, INSTALL_FLOW_CONFIG.download.successRemoveDelayMs)
      }
    }

    async function downloadFailedById(id, msg, payload = {}) {
      const task = downloadList.value.find((task) => task.id === id)
      if (task) {
        const safeTaskId = String(id || '').trim()
        const isSilent = silentFailedTaskIdSet.has(safeTaskId)
        if (isSilent) {
          silentFailedTaskIdSet.delete(safeTaskId)
        }
        await runTaskErrorHook(task, msg, payload)
        if (!isSilent) {
          console.warn('下载任务失败详情', {
            task,
            message: msg,
            rawMessage: payload?.rawMessage,
            payload
          })
          $message.warning(buildDownloadFailureNotice(task.task_name, msg, payload))
        }
        deleteItemById(id)
      }
    }

    function deleteItemById(id) {
      downloadList.value = downloadList.value.filter((item) => item.id !== id)
    }

    function cancelDownloadTaskById(id, options = {}) {
      const safeTaskId = String(id || '').trim()
      if (!safeTaskId) {
        return false
      }
      if (options?.silent) {
        silentFailedTaskIdSet.add(safeTaskId)
      }
      ipcRenderer.send('removeDownloadTask', safeTaskId)
      return true
    }

    function cancelAllDownloadTasks(options = {}) {
      const taskIds = downloadList.value
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean)
      taskIds.forEach((taskId) => cancelDownloadTaskById(taskId, options))
      return taskIds.length
    }

    function findLocalGameRecordByContext(data = {}) {
      const localDatastore = useLocalDatastore()
      const safeData = data && typeof data === 'object' ? data : {}
      const localGameList = Array.isArray(localDatastore.localGameList)
        ? localDatastore.localGameList
        : []
      const targetAppId = Number(
        safeData?.appid || safeData?.gameSteamAppId || safeData?.appId || safeData?.steamAppId || 0
      )
      const targetGameId = Number(safeData?.gameId || 0)
      const currentGame = currentGameLocalData.value || {}
      const currentAppId = Number(
        currentGame?.app_id ||
          currentGame?.appid ||
          currentGame?.appId ||
          currentGame?.steam_app_id ||
          0
      )
      const currentGameId = Number(currentGame?.game_id || 0)

      if (
        (targetAppId > 0 && currentAppId === targetAppId) ||
        (targetGameId > 0 && currentGameId === targetGameId)
      ) {
        return currentGame
      }

      return (
        localGameList.find((item) => {
          const appId = Number(
            item?.app_id || item?.appid || item?.appId || item?.steam_app_id || 0
          )
          const gameId = Number(item?.game_id || 0)
          return (
            (targetAppId > 0 && appId === targetAppId) ||
            (targetGameId > 0 && gameId === targetGameId)
          )
        }) || null
      )
    }

    function enrichDownloadContext(data = {}) {
      const safeData = data && typeof data === 'object' ? data : {}
      const localGame = findLocalGameRecordByContext(safeData) || {}
      const gameRootPath = String(
        safeData?.gameRootPath ||
          safeData?.clientRootPath ||
          safeData?.client_root_path ||
          localGame?.client_root_path ||
          ''
      ).trim()
      const clientExePath = String(
        safeData?.clientExePath || safeData?.client_exe_path || localGame?.client_exe_path || ''
      ).trim()

      return {
        ...safeData,
        ...(gameRootPath
          ? {
              gameRootPath,
              clientRootPath: gameRootPath,
              client_root_path: gameRootPath
            }
          : {}),
        ...(clientExePath
          ? {
              clientExePath,
              client_exe_path: clientExePath
            }
          : {})
      }
    }

    function downloadSpecifiedMod(list, data) {
      const localDatastore = useLocalDatastore()
      const modList = localDatastore.localModList
      let ids = []
      list.forEach((item) => {
        modList.forEach((mod) => {
          // option_id 在库中为 TEXT，接口 id 常为 number
          if (String(item.id) === String(mod.option_id)) {
            if (item.installType !== 3 && String(mod.version) === String(item.version)) {
              ids.push(item.id)
            }
          }
        })
      })

      const filteredList = list.filter((item) => !ids.includes(item.id))
      const safeList = sanitizeIpcPayload(filteredList, [])
      const safeData = sanitizeIpcPayload(enrichDownloadContext(data), {})
      ipcRenderer.send(
        'searchLocalModFiles',
        sanitizeIpcPayload(
          {
            list: safeList,
            data: safeData
          },
          {
            list: [],
            data: {}
          }
        )
      )
    }

    useIpc('modInstall-failed', (data) => {
      const { id, taskType, modName, gameName, name, errorMsg, rawErrorMsg } = data
      updateModInInstallQueue({ id, taskType })
      console.error('模组安装失败详情', data)
      $message.error(
        buildInstallFailureNotice(rawErrorMsg || errorMsg, {
          gameName,
          modName: modName || name,
          name
        })
      )
    })

    function updateModInInstallQueue(data) {
      const { id, taskType } = data
      const index = modInInstallQueue.value.findIndex(
        (item) => String(item.id) === String(id) && item.type === taskType
      )
      if (index !== -1) {
        modInInstallQueue.value.splice(index, 1)
      }
    }

    function hasSameTask(id, type) {
      const index = modInInstallQueue.value.findIndex(
        (item) => item.id === id && item.taskType === type
      )
      return !(index === -1)
    }

    function checkDuplicateDownloadTask(optionId, type) {
      const task = modInInstallQueue.value.find(
        (task) => String(task.id) === String(optionId) && task.type === type
      )
      return !!task
    }

    // 暴露状态和方法
    return {
      downloadList,
      isShowRed,
      modInInstallQueue,
      modInstallFailed,
      modInstallList,
      localGameRecord,
      currentGameLocalData,
      addDownloadItem,
      addDownloadBatch,
      clearDownloadBatch,
      updateDataById,
      downloadSuccessfulById,
      downloadFailedById,
      cancelDownloadTaskById,
      cancelAllDownloadTasks,
      downloadSpecifiedMod,
      updateModInInstallQueue,
      hasSameTask,
      checkDuplicateDownloadTask
    }
  },
  {
    persist: false
  }
)
