import { sanitizeErrorMessage } from './installEngineError.js'

export class StructuredLogger {
  constructor() {
    this.logs = []
  }

  /**
   * 脱敏上下文中的敏感路径
   */
  sanitizeContext(context) {
    if (!context || typeof context !== 'object') return context
    try {
      const jsonStr = JSON.stringify(context)
      const sanitized = sanitizeErrorMessage(jsonStr)
      return JSON.parse(sanitized)
    } catch {
      return context
    }
  }

  log(level, phase, message, extra = {}) {
    const { ruleId, context, checks } = extra
    
    // 对 checks 里的物理路径也进行脱敏
    let sanitizedChecks = null
    if (checks) {
      try {
        sanitizedChecks = JSON.parse(sanitizeErrorMessage(JSON.stringify(checks)))
      } catch {
        sanitizedChecks = checks
      }
    }

    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      phase,
      ruleId: ruleId || '',
      message: sanitizeErrorMessage(message),
      context: this.sanitizeContext(context || {}),
      checks: sanitizedChecks || []
    })
  }

  info(phase, message, extra = {}) {
    this.log('info', phase, message, extra)
  }

  warn(phase, message, extra = {}) {
    this.log('warn', phase, message, extra)
  }

  error(phase, message, extra = {}) {
    this.log('error', phase, message, extra)
  }

  getLogs() {
    return this.logs
  }
}
