import { isRef, toRaw, unref } from 'vue'
import { uiMessage } from '../i18n/message.js'
import { $message } from '@renderer/common/message.js'
import { Request } from '@renderer/api/index.js'
// 从环境变量中解构出应用相关的常量
const { VITE_APP_NAME, VITE_APP_VERSION } = import.meta.env

// 定义应用名称和版本常量
const App_Name = VITE_APP_NAME // 应用名称
const App_Version = VITE_APP_VERSION // 应用版本

/**
 * 生成指定范围内的随机整数
 * @param {number} min 最小值（包含）
 * @param {number} max 最大值（包含）
 * @returns {number} 返回范围内的随机整数
 */
function getRandomInteger(min, max) {
  if (min > max) {
    ;[min, max] = [max, min] // 如果最小值大于最大值，交换两者的值
  }
  return Math.floor(Math.random() * (max - min + 1)) + min // 返回随机整数
}

/**
 * 判断一个值是否为负数
 * @param {number} value 需要判断的值
 * @returns {boolean} 如果值为负数，返回true；否则返回false
 */
function isNegative(value) {
  return value < 0
}

/**
 * 将对象的所有嵌套属性转换为原始值（去除Vue的响应式特性）
 * @param {Object|Array} obj 需要转换的对象或数组
 * @returns {Object|Array} 返回转换后的对象或数组
 */
function convertToRaw(obj) {
  if (Array.isArray(obj)) {
    // 如果是数组，递归处理每个元素
    return obj.map((item) => convertToRaw(item))
  } else if (obj !== null && typeof obj === 'object') {
    // 如果是对象，递归处理每个属性
    const rawObj = toRaw(obj) // 使用Vue的toRaw方法去除响应式
    const result = {}
    for (const key in rawObj) {
      if (Object.prototype.hasOwnProperty.call(rawObj, key)) {
        result[key] = convertToRaw(rawObj[key]) // 递归处理嵌套属性
      }
    }
    return result
  }
  // 如果是基本类型，直接返回
  return obj
}

/**
 * 防抖函数：在一定时间内，只执行最后一次调用的函数
 * @param {Function} func 需要防抖的函数
 * @param {number} delay 延迟时间（毫秒）
 * @param {boolean} immediate 是否立即执行函数
 * @returns {Function} 返回防抖后的函数
 */
function debounce(func, delay = 300, immediate = false) {
  let timer = null // 定时器

  return function (...args) {
    const context = this // 保存当前上下文

    if (timer) clearTimeout(timer) // 如果已有定时器，清除它

    if (immediate && !timer) {
      // 如果设置了立即执行，并且没有定时器，则立即执行函数
      func.apply(context, args)
    }

    timer = setTimeout(() => {
      timer = null // 清除定时器
      if (!immediate) {
        // 如果没有设置立即执行，则在延迟后执行函数
        func.apply(context, args)
      }
    }, delay)
  }
}

/**
 * 节流函数：在一定时间内，只执行一次函数
 * @param {Function} func 需要节流的函数
 * @param {number} delay 延迟时间（毫秒）
 * @param {boolean} trailing 是否在延迟结束后执行最后一次调用
 * @returns {Function} 返回节流后的函数
 */
function throttle(func, delay = 300, trailing = true) {
  let lastTime = 0 // 上一次执行函数的时间
  let timer = null // 定时器

  return function (...args) {
    const context = this // 保存当前上下文
    const now = Date.now() // 当前时间

    if (now - lastTime >= delay) {
      // 如果距离上次执行已经超过延迟时间，直接执行函数
      if (timer) {
        clearTimeout(timer) // 清除定时器
        timer = null
      }
      func.apply(context, args) // 执行函数
      lastTime = now // 更新上次执行时间
    } else if (trailing && !timer) {
      // 如果设置了尾调用，并且没有定时器，则设置定时器
      timer = setTimeout(
        () => {
          func.apply(context, args) // 执行函数
          lastTime = Date.now() // 更新上次执行时间
          timer = null // 清除定时器
        },
        delay - (now - lastTime) // 计算剩余延迟时间
      )
    }
  }
}

/**
 * 打乱数组的顺序（Fisher-Yates算法）
 * @param {Array} arr 需要打乱的数组
 * @returns {Array} 返回打乱后的新数组
 */
function shuffleArray(arr) {
  // 复制原数组，避免修改原数据
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)) // 随机选择一个索引
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] // 交换元素
  }
  return shuffled
}

/**
 * 清理对象中的空值属性
 * @param {Object|Ref<Object>} obj - 要处理的对象或响应式引用
 * @returns {Object} 清理后的新对象
 */
function cleanEmptyProperties(obj) {
  // 如果是响应式引用，获取其值
  const rawObj = isRef(obj) ? unref(obj) : obj

  return Object.entries(rawObj).reduce((acc, [key, value]) => {
    // 检查值是否应该保留
    if (shouldKeepValue(value)) {
      acc[key] = value
    }
    return acc
  }, {})
}

/**
 * 判断值是否应该保留
 * @param {*} value - 要检查的值
 * @returns {boolean} 是否保留
 */
function shouldKeepValue(value) {
  // 保留数字0
  if (value === 0) return true

  // 处理数组
  if (Array.isArray(value)) {
    return value.length > 0
  }

  // 处理对象
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length > 0
  }

  // 保留其他非空值
  return value !== null && value !== undefined && value !== ''
}

/**
 * 将字节大小转换为合适的单位
 * @param {number} bytes - 要转换的字节数
 * @param {number} [decimals=2] - 保留的小数位数，默认为2
 * @returns {string} 带单位的字符串
 */
function formatBytes(bytes, decimals = 0) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  // 计算应该使用的单位索引
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  // 处理小数位数
  const dm = decimals < 0 ? 0 : decimals

  // 返回格式化后的字符串
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i]
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const maxLength = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0

    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 返回是否复制成功
 */
const copyToClipboard = async (text) => {
  try {
    // 现代浏览器推荐方式
    await navigator.clipboard.writeText(text)
    $message.success(uiMessage('ui.copied'))
    return true
  } catch (err) {
    console.error('复制失败:', err)

    // 降级方案
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed' // 避免滚动到底部
      document.body.appendChild(textarea)
      textarea.select()

      const result = document.execCommand('copy')
      document.body.removeChild(textarea)

      if (result) {
        $message.success(uiMessage('ui.copied'))
        return true
      }
    } catch (err2) {
      console.error('降级复制方案失败:', err2)
    }
    return false
  }
}

/**
 * 发送 PUT 请求的工具函数
 * @param {string} url - 请求的URL
 * @param {Object} data - 要发送的数据
 * @param {Object} [headers={}] - 自定义请求头，默认为空对象
 * @returns {Promise} 返回一个Promise对象
 */
const putRequest = async (url, data, headers = {}) => {
  console.log(data)
  try {
    const defaultHeaders = {
      'Content-Type': 'application/octet-stream',
      ...headers
    }
    await fetch(url, {
      method: 'PUT',
      headers: defaultHeaders,
      body: data
    })
  } catch (error) {
    console.error('PUT请求出错:', error)
    throw error // 重新抛出错误以便调用者处理
  }
}

/**
 * 将文件分割为多个分片
 * @param {File} file - 要分割的文件对象
 * @param {number} chunkSize - 每个分片的大小（字节）
 * @returns {Array<Blob>} - 分片数组
 */
function sliceFile(file, chunkSize) {
  const chunks = []
  let start = 0
  let end = chunkSize

  while (start < file.size) {
    // 最后一个分片可能小于chunkSize
    end = Math.min(end, file.size)
    // 使用slice方法创建分片
    const chunk = file.slice(start, end)
    chunks.push(chunk)

    start = end
    end = start + chunkSize
  }

  return chunks
}

function request(url, method, data = {}, config = {}) {
  return new Request().send(url, method, data, config)
}

const areArraysEqual = (arr1, arr2) => {
  if (arr1.length !== arr2.length) return false
  const sorted1 = [...arr1].sort((a, b) => a - b)
  const sorted2 = [...arr2].sort((a, b) => a - b)
  return sorted1.every((val, index) => val === sorted2[index])
}

const arrayPartitioning = (arr, num) => {
  if (!arr || !Array.isArray(arr) || !num || num <= 0) return []
  const chunks = []
  for (let i = 0; i < arr.length; i += num) {
    chunks.push(arr.slice(i, i + num))
  }
  return chunks
}

// 导出所有工具函数和常量
export default {
  App_Name,
  App_Version,
  getRandomInteger,
  isNegative,
  convertToRaw,
  debounce,
  throttle,
  shuffleArray,
  cleanEmptyProperties,
  formatBytes,
  compareVersions,
  copyToClipboard,
  putRequest,
  sliceFile,
  request,
  areArraysEqual,
  arrayPartitioning
}
