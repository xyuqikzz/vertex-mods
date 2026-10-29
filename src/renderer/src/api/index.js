import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainAdapter } from '../utils/main-network.js'
import { assertActiveSourceApiPath } from '../../../shared/sources/retired-source-policy.js'
import axios from 'axios'
import router from '../router/index.js'
import { useAppStore } from '@renderer/store/appStore.js'
import { useUserStore } from '@renderer/store/userStore.js'
import { $message } from '@renderer/common/message.js'
import { getAccountSessionSignal } from '../utils/account-session.js'

let nextRequestId = 0

/**
 * 全局请求队列管理器
 * 用于跟踪所有正在进行的请求，管理加载状态和错误处理
 */
const requestQueue = {
  requests: [], // 当前所有请求的队列
  listeners: [], // 状态变化监听器
  requestStateListeners: [], // 请求状态监听器（可达/不可达）
  excludeUrls: [
    '/ping/connection/status',
    '/app/force/version',
    '/user/validate',
    '/app/mod/data/list'
  ], // 不需要触发全局错误处理的URL
  currentPage: '', // 当前页面路径

  /**
   * 添加请求到队列
   */
  add(config) {
    const { method = 'GET', url, hideLoading = false } = config
    const requestId = `${method}_${url}_${++nextRequestId}`

    // 安全获取当前路由 path
    const currentRoute = router.currentRoute?.value
    const path = currentRoute ? currentRoute.path : ''

    this.requests.push({
      id: requestId,
      url,
      method,
      timestamp: Date.now(),
      isError: false,
      isServerUnreachable: false,
      pagePath: path,
      hideLoading
    })
    this.notify()
    return requestId
  },

  /**
   * 从队列中移除请求
   */
  remove(requestId, { isError = false, isServerUnreachable = false, isNotify = true } = {}) {
    if (isError) {
      // 标记为错误请求
      const requestIndex = this.requests.findIndex((req) => req.id === requestId)
      if (requestIndex !== -1) {
        const req = this.requests[requestIndex]
        req.isError = true
        req.isServerUnreachable = isServerUnreachable
      }
    } else {
      // 移除当前请求并清理错误状态请求（排除列表除外）
      this.requests = this.requests.filter(
        (req) => req.id !== requestId && (!req.isError || this.isExcluded(req.url))
      )
    }
    if (isNotify) this.notify()
  },

  /**
   * 检查URL是否在排除列表中
   */
  isExcluded(url) {
    return this.excludeUrls.some((excludeUrl) => url?.includes(excludeUrl))
  },

  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback)
      callback(this.isLoading(), [...this.requests])
    }
  },

  removeListener(callback) {
    this.listeners = this.listeners.filter((l) => l !== callback)
  },

  addRequestStateListener(callback) {
    if (typeof callback === 'function') this.requestStateListeners.push(callback)
  },

  removeRequestStateListener(callback) {
    this.requestStateListeners = this.requestStateListeners.filter((l) => l !== callback)
  },

  /**
   * 通知所有监听器当前状态
   */
  isLoading() {
    const page = this.currentPage || router.currentRoute?.value?.path || ''
    return this.requests.some(
      (req) =>
        req.pagePath === page && !req.hideLoading && !req.isError && !this.isExcluded(req.url)
    )
  },

  notify() {
    // 后台探测和其他页面的请求不能阻断当前页面的本地操作。
    const isLoading = this.isLoading()
    // 创建副本以防外部修改
    const queueSnapshot = [...this.requests]
    this.listeners.forEach((cb) => cb(isLoading, queueSnapshot))
  },

  notifyRequestState(payload) {
    const statePayload = {
      timestamp: Date.now(),
      ...payload
    }
    this.requestStateListeners.forEach((cb) => cb(statePayload))
  },

  setCurrentPage(currentPage) {
    this.currentPage = currentPage
    this.notify()
  },

  getConfigByRequestId(requestId) {
    return this.requests.find((request) => request.id === requestId)
  }
}

/**
 * 请求类 - 封装了axios请求和拦截器
 */
export class Request {
  /**
   * 构造函数
   * @param {Object} config - 请求配置
   */
  constructor(config = {}) {
    // 优化点：构造时不立即从Store获取BaseURL，防止Store未初始化
    this.defaultConfig = {
      timeout: 30000,
      withCredentials: true
    }
    // 创建axios实例
    this.instance = axios.create({
      ...this.defaultConfig,
      adapter: createMainAdapter('account'),
      ...config
    })

    // 设置拦截器
    this.setupInterceptors()

    // 设置实例特定的拦截器
    if (config.interceptors) {
      this.setupInstanceInterceptors(config.interceptors)
    }
  }

  isHttpError(error) {
    return !error.response || error.response.status !== 200
  }

  /**
   * 核心请求方法
   */
  async request(config) {
    assertActiveSourceApiPath(config?.url)
    const userStore = useUserStore()
    const requestToken = userStore.token
    const sessionSignal = getAccountSessionSignal()
    config = { ...config, accountToken: requestToken }
    if (requestToken) {
      config.signal = config.signal
        ? AbortSignal.any([config.signal, sessionSignal])
        : sessionSignal
    }
    const requestId = requestQueue.add(config)
    const removeCanceledRequest = () => requestQueue.remove(requestId)
    config.signal?.addEventListener('abort', removeCanceledRequest, { once: true })
    const requestUrl = config?.url || ''
    const requestMethod = String(config?.method || 'GET').toUpperCase()
    const shouldExclude = requestQueue.isExcluded(requestUrl)
    // 优化点：在方法内部获取 store，确保 pinia 已安装

    // 开发环境日志辅助
    // console.log('[Request Config]', config)

    try {
      const response = await this.instance.request(config)
      if (config.signal?.aborted || (requestToken && sessionSignal !== getAccountSessionSignal())) {
        throw new axios.CanceledError('账号会话已变更')
      }
      requestQueue.notifyRequestState({
        type: 'reachable',
        url: requestUrl,
        method: requestMethod,
        excluded: shouldExclude
      })
      requestQueue.remove(requestId)

      // 处理具体的业务响应结构
      let { code, message, data } = response

      if (code === 200) {
        if (config.interceptors?.responseInterceptor) {
          data = config.interceptors.responseInterceptor(data)
        }
        return data
      } else {
        // 业务逻辑错误处理
        if (
          (code === 403 || code === 401) &&
          !config.skipAuthLogout &&
          userStore.token === requestToken
        ) {
          await userStore.logout({ reason: 'expired', redirect: false })
        }

        if (message && !config.silentBusinessError) $message.error(message)

        const error = new Error(message || 'Request failed')
        error.code = code
        error.data = data
        error.isBusinessError = true
        throw error
      }
    } catch (error) {
      if (axios.isCancel(error) || config.signal?.aborted) {
        requestQueue.remove(requestId)
        throw { success: false, code: 'ERR_CANCELED', message: uiText('ui.requestCancelled') }
      }
      if (
        error.response?.status === 401 &&
        !config.skipAuthLogout &&
        userStore.token === requestToken
      ) {
        await userStore.logout({ reason: 'expired', redirect: false })
      }
      // 请求失败不应清空 keep-alive 缓存，否则页面切换会频繁触发重新挂载

      const isBusinessError = Boolean(error?.isBusinessError)
      const isServerUnreachable = !error.response && !isBusinessError
      const reqData = requestQueue.getConfigByRequestId(requestId)

      if (!isBusinessError) {
        requestQueue.notifyRequestState({
          type: isServerUnreachable ? 'unreachable' : 'reachable',
          url: requestUrl,
          method: requestMethod,
          excluded: shouldExclude
        })
      }

      // 错误请求处理
      if (this.isHttpError(error) && !shouldExclude && !config.hideLoading) {
        // 跨页面请求不显示错误
        if (reqData?.pagePath === requestQueue.currentPage) {
          requestQueue.remove(requestId, {
            isError: true,
            isServerUnreachable
          })
        } else {
          requestQueue.remove(requestId)
        }
      } else {
        requestQueue.remove(requestId)
      }

      throw this.formatError(error)
    } finally {
      config.signal?.removeEventListener('abort', removeCanceledRequest)
    }
  }

  // --- 快捷方法 ---
  get(url, config) {
    return this.request({ ...config, method: 'GET', url })
  }

  post(url, data, config) {
    return this.request({ ...config, method: 'POST', url, data })
  }

  put(url, data, config) {
    return this.request({ ...config, method: 'PUT', url, data })
  }

  delete(url, config) {
    return this.request({ ...config, method: 'DELETE', url })
  }

  send(url, method, data, config) {
    return this.request({ ...config, method, url, data })
  }

  /**
   * 设置默认拦截器
   */
  setupInterceptors() {
    // 请求拦截器
    this.instance.interceptors.request.use(
      (config) => {
        // 优化关键点：在拦截器内部获取 Store
        const appStore = useAppStore()
        const AppData = appStore.AppData

        // 动态设置 BaseURL，如果 config 中未指定，则使用 Store 中的配置
        if (!config.baseURL && AppData.requestUrl) {
          config.baseURL = AppData.requestUrl
        }

        config.headers = {
          'vertex-version': AppData.version || '1.0.0', // 防止 undefined
          'Content-Type': 'application/json',
          ...config.headers // 允许外部覆盖
        }

        return config
      },
      (error) => Promise.reject(error)
    )

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => response.data,
      (error) => {
        if (error.response?.status === 401) {
          console.error('Authentication expired, please login again')
          // 这里也可以调用 userStore.logout()，但要注意循环依赖风险
        }
        return Promise.reject(error)
      }
    )
  }

  setupInstanceInterceptors(interceptors) {
    const {
      requestInterceptor,
      requestInterceptorCatch,
      responseInterceptor,
      responseInterceptorCatch
    } = interceptors

    if (requestInterceptor) {
      this.instance.interceptors.request.use(requestInterceptor)
    }
    if (requestInterceptorCatch) {
      this.instance.interceptors.request.use(null, requestInterceptorCatch)
    }
    if (responseInterceptor) {
      this.instance.interceptors.response.use(responseInterceptor)
    }
    if (responseInterceptorCatch) {
      this.instance.interceptors.response.use(null, responseInterceptorCatch)
    }
  }

  formatError(error) {
    return {
      success: false,
      message: error.message,
      code: error.response?.status || error.code || 'NETWORK_ERROR',
      data: error.response?.data
    }
  }
}

/**
 * 请求管理器 - 提供外部访问请求队列的方法
 */
export const requestManager = {
  onLoadingChange: (callback) => requestQueue.addListener(callback),
  removeLoadingListener: (callback) => requestQueue.removeListener(callback),
  onRequestStateChange: (callback) => requestQueue.addRequestStateListener(callback),
  removeRequestStateListener: (callback) => requestQueue.removeRequestStateListener(callback),
  requestQueue
}
