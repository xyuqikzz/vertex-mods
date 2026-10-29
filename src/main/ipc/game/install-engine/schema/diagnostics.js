import { toSafeText } from '../contracts.js'

export function createDiagnostic(level, code, path, message, extra = {}) {
  return {
    level,
    code,
    path,
    ruleId: toSafeText(extra.ruleId),
    message,
    suggestion: toSafeText(extra.suggestion)
  }
}

export function pushDiagnostic(target, level, code, path, message, extra = {}) {
  const diagnostic = createDiagnostic(level, code, path, message, extra)
  target.push(diagnostic)
  return diagnostic
}
