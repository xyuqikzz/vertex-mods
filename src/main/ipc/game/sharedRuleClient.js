import { normalizePublicGameKey } from '../../../shared/games/game-rule-support.js'
import { expandInstallRuleTemplates } from '../../../shared/installation/install-rule-declarations.js'
import { createPayloadHash, buildLegacySourceHashRequest, pickInspectToken } from './standard/payloadValidator.js'
import {
  SHARED_RULE_SOURCES,
  verifySharedRuleDocument,
  sharedRuleError,
  sharedRuleIdentity,
  sameSharedRule
} from '../../../shared/installation/shared-install-rule.js'

const inspected = new Map()
const PRIVATE_SELECTIONS = new Set(['local_override', 'player_profile', 'local', 'player'])
const RULE_FIELDS = [
  'installRule',
  'sourceInstallRule',
  'nexusInstallRule',
  'modioInstallRule',
  'ficsitInstallRule',
  'vamhubInstallRule'
]

export function usesPublicRule(source, data = {}) {
  return SHARED_RULE_SOURCES.has(source) && !PRIVATE_SELECTIONS.has(data.ruleSelection)
}

export function buildSharedRuleQuery(source, data = {}) {
  const meta = data.sourceMeta || {}
  const document = data.sharedRuleDocument || {}
  return {
    sourcePlatform: source,
    gameKey: normalizePublicGameKey(document.gameKey || data.publicGameKey || data.gameKey) || undefined,
    canonicalGameKey: document.canonicalGameKey || data.canonicalGameKey || undefined,
    sourceGameId: String(
      source === 'nexus'
        ? data.sourceNexusGameId || data.nexusGameId || data.sourceGameId || data.gameSourceId || ''
        : source === 'modio'
          ? data.modioGameId || data.sourceGameId || data.gameSourceId || ''
          : data.sourceGameId || data.gameSourceId || ''
    ),
    nexusGameId:
      source === 'nexus' ? data.sourceNexusGameId || data.nexusGameId || undefined : undefined,
    domainName:
      data.sourceGameDomain ||
      data.gameDomainName ||
      data.sourceGameSlug ||
      data.gameSourceSlug ||
      meta.sourceSlug ||
      undefined,
    appId: data.appId || data.steamAppId || undefined
  }
}

export async function fetchSharedRule(query, requestOverride) {
  const request = requestOverride || (await import('../../utils/require.js')).requestBackendApi
  const response = await request({
    method: 'GET',
    url: '/install-config/shared/match',
    params: query
  })
  const envelope = response?.data
  if (envelope?.code !== 200) {
    throw sharedRuleError('REQUEST_FAILED', envelope?.message || '无法确认公共规则发布状态')
  }
  return verifySharedRuleDocument(envelope.data)
}

export async function prepareSharedRuleInspection(source, request, dependencies = {}) {
  const data = request.data || {}
  if (!usesPublicRule(source, data)) return { request, document: null }
  const document = await (dependencies.fetchSharedRule || fetchSharedRule)(
    buildSharedRuleQuery(source, data)
  )
  if (data.sharedRuleDocument && !sameSharedRule(data.sharedRuleDocument, document)) {
    throw sharedRuleError('REVISION_CHANGED', '所选公共规则已变化，请刷新并重新生成安装计划')
  }
  const prepared = JSON.parse(JSON.stringify(request))
  expandInstallRuleTemplates(document.ruleJson)
  prepared.data = { ...(prepared.data || {}), sharedRuleDocument: sharedRuleIdentity(document) }
  for (const field of RULE_FIELDS) prepared.data[field] = document.ruleJson
  return { request: prepared, document: sharedRuleIdentity(document) }
}

export function rememberSharedInspection(token, source, original, prepared, document) {
  if (!document) return
  if (!token) throw sharedRuleError('TOKEN_MISSING', '公共规则预检未生成安装凭证')
  const now = Date.now()
  for (const [key, value] of inspected) if (value.expiresAt <= now) inspected.delete(key)
  if (inspected.size >= 500) inspected.delete(inspected.keys().next().value)
  inspected.set(token, {
    source,
    originalHash: createPayloadHash(buildLegacySourceHashRequest(original)),
    request: JSON.parse(JSON.stringify(prepared)),
    document,
    expiresAt: now + 30 * 60 * 1000
  })
}

export async function verifySharedRuleBeforeInstall(source, request, dependencies = {}) {
  const data = request.data || {}
  if (!usesPublicRule(source, data)) return request
  const token = pickInspectToken(request)
  const pinned = inspected.get(token)
  if (!pinned || pinned.source !== source || pinned.expiresAt <= Date.now()) {
    throw sharedRuleError('REINSPECT_REQUIRED', '公共规则安装凭证已失效，请重新预检')
  }
  if (pinned.originalHash !== createPayloadHash(buildLegacySourceHashRequest(request))) {
    throw sharedRuleError('PAYLOAD_CHANGED', '安装参数已变化，请重新预检')
  }
  const current = await (dependencies.fetchSharedRule || fetchSharedRule)({
    sourcePlatform: source,
    canonicalGameKey: pinned.document.canonicalGameKey
  })
  if (!sameSharedRule(current, pinned.document)) {
    inspected.delete(token)
    throw sharedRuleError('REVISION_CHANGED', '公共规则已经更新，请重新生成安装计划')
  }
  return {
    ...pinned.request,
    inspectToken: token,
    data: { ...pinned.request.data, standardInspectToken: token }
  }
}
