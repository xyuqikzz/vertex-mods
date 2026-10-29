function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function parseDateTime(value = '') {
  const date = new Date(toSafeText(value))
  return Number.isFinite(date.getTime()) ? date : null
}

export function getAgentPermissionGrantStatus(grant = {}, now = new Date()) {
  const revokedAt = toSafeText(grant.revokedAt || grant.revoked_at)
  if (revokedAt) {
    return {
      key: 'revoked',
      label: '已撤销',
      tone: 'muted'
    }
  }

  const expiresAt = parseDateTime(grant.expiresAt || grant.expires_at)
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    return {
      key: 'expired',
      label: '已过期',
      tone: 'warning'
    }
  }

  return {
    key: 'active',
    label: '有效',
    tone: 'success'
  }
}

export function formatAgentPermissionGrantScope(grant = {}) {
  const gameId = toSafeText(grant.gameId || grant.game_id, '*')
  const source = toSafeText(grant.source, '*')
  const gameText = gameId === '*' ? '全部游戏' : `游戏 ${gameId}`
  const sourceText = source === '*' ? '全部来源' : `来源 ${source}`
  return `${gameText} / ${sourceText}`
}

export function formatAgentPermissionGrantTime(value = '') {
  const date = parseDateTime(value)
  if (!date) return '未知'

  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function summarizeAgentPermissionGrant(grant = {}, now = new Date()) {
  return {
    id: toSafeText(grant.id),
    operationType: toSafeText(grant.operationType || grant.operation_type),
    toolName: toSafeText(grant.toolName || grant.tool_name),
    scopeText: formatAgentPermissionGrantScope(grant),
    status: getAgentPermissionGrantStatus(grant, now),
    expiresAtText: formatAgentPermissionGrantTime(grant.expiresAt || grant.expires_at),
    createdAtText: formatAgentPermissionGrantTime(grant.createdAt || grant.created_at)
  }
}
