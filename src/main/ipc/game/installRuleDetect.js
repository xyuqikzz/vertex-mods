import { detectGameRoot, detectGameRootFromDirectory } from './game-root-engine/index.js'

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function withLegacyIdentity(result = {}, payload = {}, options = {}) {
  return {
    ...result,
    domainName: toSafeText(payload?.domainName),
    ...(options.includeGameId === false
      ? {}
      : { nexusGameId: toSafeNumber(payload?.nexusGameId, 0) })
  }
}

export async function installDetectGameRootByRule(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const result = await detectGameRoot({ ruleJson: target.ruleJson })
  return withLegacyIdentity(result, target, {
    // 兼容旧返回：自动识别无候选时没有 nexusGameId 字段。
    includeGameId: result?.reason !== 'no_candidates'
  })
}

export async function installDetectGameRootByRuleFromDirectory(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const result = await detectGameRootFromDirectory({
    ruleJson: target.ruleJson,
    selectedDirectory: target.selectedDirectory
  })
  return withLegacyIdentity(result, target)
}
