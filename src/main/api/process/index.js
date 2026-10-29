import { getVertexProcessNodeApi } from '../shared/index.js'

export { isProtocolTarget } from '../shared/index.js'

export function launchTargetByNodeApi(target, args = [], callback = () => {}) {
  const processApi = getVertexProcessNodeApi()
  const launchMethod =
    typeof processApi.launchTarget === 'function' ? processApi.launchTarget : processApi.launchExe

  if (typeof callback !== 'function') {
    throw new TypeError('launchTargetByNodeApi 的 callback 必须是函数')
  }

  const safeTarget = String(target || '').trim()
  const safeArgs = Array.isArray(args) ? args.map((item) => String(item)) : []

  if (!safeTarget) {
    throw new Error('启动目标不能为空')
  }

  if (safeArgs.length > 0) {
    return launchMethod(safeTarget, safeArgs, callback)
  }

  return launchMethod(safeTarget, callback)
}

export function launchElevatedByNodeApi(target, args = [], callback = () => {}) {
  const processApi = getVertexProcessNodeApi()
  if (typeof processApi.launchElevated !== 'function') {
    throw new Error('当前原生进程模块不支持定向提权启动')
  }
  if (typeof callback !== 'function') {
    throw new TypeError('launchElevatedByNodeApi 的 callback 必须是函数')
  }

  const safeTarget = String(target || '').trim()
  const safeArgs = Array.isArray(args) ? args.map((item) => String(item)) : []
  if (!safeTarget) {
    throw new Error('提权启动目标不能为空')
  }
  return processApi.launchElevated(safeTarget, safeArgs, callback)
}
