import { STANDARD_ERROR_CODE } from './constants.js'

export class StandardInstallError extends Error {
  constructor(message, options = {}) {
    super(String(message || '标准安装任务失败'))
    this.name = 'StandardInstallError'
    this.code = String(options.code || STANDARD_ERROR_CODE.INSTALL_FAILED)
    this.recoverable = options.recoverable !== false
    this.details = options.details && typeof options.details === 'object' ? options.details : {}
    this.cause = options.cause
  }
}

export function createStandardError(code, message, options = {}) {
  return new StandardInstallError(message, {
    ...options,
    code
  })
}

export function normalizeStandardError(error, fallbackCode = STANDARD_ERROR_CODE.INSTALL_FAILED) {
  if (error instanceof StandardInstallError) {
    return error
  }

  const message = String(error?.message || error || '标准安装任务失败')
  return new StandardInstallError(message, {
    code: String(error?.code || fallbackCode),
    recoverable: error?.recoverable !== false,
    details: error?.details,
    cause: error
  })
}

export function toPublicErrorPayload(error) {
  const normalized = normalizeStandardError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    recoverable: normalized.recoverable,
    details: normalized.details
  }
}
