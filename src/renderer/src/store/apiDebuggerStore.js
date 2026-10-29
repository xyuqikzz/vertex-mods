// API 调试工具状态管理
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'vertex_api_debugger'
const MAX_HISTORY_SIZE = 100

// 从localStorage加载数据
function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

// 保存数据到localStorage
function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('API调试器数据保存失败:', e)
  }
}

export const useApiDebuggerStore = defineStore('apiDebuggerStore', () => {
  // ==================== 状态初始化 ====================
  const savedData = loadFromStorage()

  // 当前请求配置
  const currentRequest = ref({
    url: '/ping/connection/status',
    method: 'GET',
    contentType: 'application/json',
    params: [], // [{key, value, enabled}]
    headers: [], // [{key, value, enabled}]
    body: '', // 用于原始JSON输入的文本
    bodyParams: [], // [{key, value, enabled}] 用于表单式输入
    useAuth: true,
    useBaseUrl: true
  })

  // 当前响应
  const currentResponse = ref({
    status: null,
    statusText: '',
    headers: {},
    data: null,
    size: 0,
    duration: 0,
    error: null
  })

  // 请求历史（持久化）
  const history = ref(savedData?.history || [])

  // 加载状态
  const isLoading = ref(false)

  // 批量测试配置
  const batchConfig = ref({
    enabled: false,
    count: 10,
    interval: 500,
    currentRound: 0,
    isRunning: false,
    shouldStop: false,
    results: [] // [{success, duration, status}]
  })

  // 响应视图模式
  const responseViewMode = ref('pretty') // pretty | raw
  const responseTab = ref('body') // body | headers

  // 历史详情弹窗
  const historyDetailVisible = ref(false)
  const selectedHistoryItem = ref(null)

  // 搜索过滤
  const historySearchKeyword = ref('')

  // ==================== 计算属性 ====================
  // 过滤后的历史记录
  const filteredHistory = computed(() => {
    // 先过滤掉无效的历史记录项
    const validHistory = history.value.filter((item) => item && item.request && item.response)
    if (!historySearchKeyword.value) return validHistory
    const keyword = historySearchKeyword.value.toLowerCase()
    return validHistory.filter(
      (item) =>
        (item.request.url || '').toLowerCase().includes(keyword) ||
        (item.request.method || '').toLowerCase().includes(keyword) ||
        String(item.response.status || '').includes(keyword)
    )
  })

  // 批量测试统计
  const batchStats = computed(() => {
    const results = batchConfig.value.results
    if (!results.length) return null

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount
    const durations = results.map((r) => r.duration)
    const avgDuration = durations.reduce((a, b) => a + b, 0) / results.length
    const minDuration = Math.min(...durations)
    const maxDuration = Math.max(...durations)

    return {
      total: results.length,
      success: successCount,
      fail: failCount,
      successRate: ((successCount / results.length) * 100).toFixed(1),
      avgDuration: Math.round(avgDuration),
      minDuration,
      maxDuration
    }
  })

  // ==================== 监听持久化 ====================
  watch(
    history,
    (newHistory) => {
      saveToStorage({ history: newHistory })
    },
    { deep: true }
  )

  // ==================== 方法定义 ====================

  // 重置响应
  function resetResponse() {
    currentResponse.value = {
      status: null,
      statusText: '',
      headers: {},
      data: null,
      size: 0,
      duration: 0,
      error: null
    }
  }

  // 添加历史记录
  function addHistory(request, response, duration) {
    const historyItem = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      displayTime: new Date().toLocaleString('zh-CN'),
      request: {
        url: request.url,
        fullUrl: request.fullUrl,
        method: request.method,
        contentType: request.contentType,
        params: JSON.parse(JSON.stringify(request.params || [])),
        headers: JSON.parse(JSON.stringify(request.headers || [])),
        bodyParams: JSON.parse(JSON.stringify(request.bodyParams || [])),
        body: request.body
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers || {},
        data: response.data,
        size: response.size || 0
      },
      duration,
      error: response.error || null
    }

    history.value.unshift(historyItem)

    // 限制历史记录数量
    if (history.value.length > MAX_HISTORY_SIZE) {
      history.value = history.value.slice(0, MAX_HISTORY_SIZE)
    }
  }

  // 从历史恢复请求配置
  function restoreFromHistory(item) {
    currentRequest.value = {
      url: item.request.url,
      method: item.request.method,
      contentType: item.request.contentType || 'application/json',
      params: JSON.parse(JSON.stringify(item.request.params || [])),
      headers: JSON.parse(JSON.stringify(item.request.headers || [])),
      bodyParams: JSON.parse(JSON.stringify(item.request.bodyParams || [])),
      body: item.request.body || '',
      useAuth: true,
      useBaseUrl: true
    }
  }

  // 查看历史详情
  function showHistoryDetail(item) {
    selectedHistoryItem.value = item
    historyDetailVisible.value = true
  }

  // 关闭历史详情
  function closeHistoryDetail() {
    historyDetailVisible.value = false
    selectedHistoryItem.value = null
  }

  // 删除单条历史
  function deleteHistoryItem(id) {
    const index = history.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      history.value.splice(index, 1)
    }
  }

  // 清空所有历史
  function clearAllHistory() {
    history.value = []
  }

  // 重置批量测试
  function resetBatchTest() {
    batchConfig.value.currentRound = 0
    batchConfig.value.isRunning = false
    batchConfig.value.shouldStop = false
    batchConfig.value.results = []
  }

  // 停止批量测试
  function stopBatchTest() {
    batchConfig.value.shouldStop = true
  }

  // 添加参数
  function addParam() {
    currentRequest.value.params.push({ key: '', value: '', enabled: true })
  }

  // 删除参数
  function removeParam(index) {
    currentRequest.value.params.splice(index, 1)
  }

  // 添加请求头
  function addHeader() {
    currentRequest.value.headers.push({ key: '', value: '', enabled: true })
  }

  // 删除请求头
  function removeHeader(index) {
    currentRequest.value.headers.splice(index, 1)
  }

  // 添加请求体参数
  function addBodyParam() {
    currentRequest.value.bodyParams.push({ key: '', value: '', enabled: true })
  }

  // 删除请求体参数
  function removeBodyParam(index) {
    currentRequest.value.bodyParams.splice(index, 1)
  }

  // ==================== 导出 ====================
  return {
    // 状态
    currentRequest,
    currentResponse,
    history,
    isLoading,
    batchConfig,
    responseViewMode,
    responseTab,
    historyDetailVisible,
    selectedHistoryItem,
    historySearchKeyword,

    // 计算属性
    filteredHistory,
    batchStats,

    // 方法
    resetResponse,
    addHistory,
    restoreFromHistory,
    showHistoryDetail,
    closeHistoryDetail,
    deleteHistoryItem,
    clearAllHistory,
    resetBatchTest,
    stopBatchTest,
    addParam,
    removeParam,
    addHeader,
    removeHeader,
    addBodyParam,
    removeBodyParam
  }
})
