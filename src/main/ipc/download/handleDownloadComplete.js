import { getRetiredDownloadFailure } from '../../../shared/sources/retired-source-policy.js'
import { openPath } from '../tool.js'
import { setImageAsWallpaper } from '../system/medhod.js'
import { installApp } from '../update/medhod.js'
import { formatInstallFailureMessage } from '../../../shared/installation/install-flow-message.js'

const funList = {
  setImageAsWallpaper,
  installApp
}

function handleFollowupError(eventRef, method = '', data = {}, error = null) {
  const rawMessage = String(error?.message || error || '后续操作执行失败').trim()
  const userMessage = formatInstallFailureMessage(rawMessage, {
    fallback: '下载完成，但后续操作失败，请稍后重试'
  })
  console.error('下载完成后执行后续操作失败', {
    method,
    rawMessage,
    error
  })

  if (method === 'installMods' && eventRef?.reply) {
    eventRef.reply('modInstall-failed', {
      ...(data && typeof data === 'object' ? data : {}),
      rawErrorMsg: rawMessage,
      errorMsg: userMessage
    })
    return
  }

  eventRef?.reply?.('node-notify', {
    type: 'warning',
    message: userMessage,
    rawMessage
  })
}

function runFollowupProcess(eventRef, method = '', args = [], data = {}) {
  const handler = funList[method]
  if (typeof handler !== 'function') {
    handleFollowupError(eventRef, method, data, new Error('未找到后续处理函数'))
    return
  }

  try {
    const result = handler(...args)
    if (result && typeof result.then === 'function') {
      result.catch((error) => handleFollowupError(eventRef, method, data, error))
    }
  } catch (error) {
    handleFollowupError(eventRef, method, data, error)
  }
}

export function startProcess(item) {
  const retiredFailure = getRetiredDownloadFailure(item)
  if (retiredFailure) {
    handleFollowupError(item.eventRef, item.fun?.method, item.fun?.data, retiredFailure.message)
    return retiredFailure
  }
  const { fun, finalFilePath, eventRef } = item
  const { type, method = '', data } = fun

  if (!type) {
    console.log('[提示]： 无需额外执行函数')
    return
  }

  if (type === 1) {
    openPath(eventRef, finalFilePath).then(() => {})
  }

  if (type === 2) {
    runFollowupProcess(eventRef, method, [eventRef, finalFilePath], data)
  }

  if (type === 3) {
    runFollowupProcess(eventRef, method, [eventRef, finalFilePath, data], data)
  }
}
