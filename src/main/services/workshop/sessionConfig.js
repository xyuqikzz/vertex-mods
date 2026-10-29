// This is the bounded, single-account format shared with the bundled Vertex tool.
export function normalizeSteamSession(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !/^[a-zA-Z0-9_]{1,64}$/.test(value.username || '') ||
    typeof value.refreshToken !== 'string' ||
    !value.refreshToken ||
    value.refreshToken.length > 20000 ||
    typeof (value.guardData ?? '') !== 'string' ||
    (value.guardData || '').length > 4000
  )
    throw new Error('invalid_steam_session')
  return {
    username: value.username,
    refreshToken: value.refreshToken,
    guardData: value.guardData || ''
  }
}

export function encodeSteamToolSession(session) {
  const value = normalizeSteamSession(session)
  return JSON.stringify({
    Version: 1,
    LoginTokens: { [value.username]: value.refreshToken },
    GuardData: value.guardData ? { [value.username]: value.guardData } : {}
  })
}

export function decodeSteamToolSession(text) {
  if (typeof text !== 'string' || text.length > 32768) throw new Error('invalid_steam_session')
  const value = JSON.parse(text)
  const entries = Object.entries(value?.LoginTokens || {})
  if (value?.Version !== 1 || entries.length !== 1) throw new Error('invalid_steam_session')
  const [username, refreshToken] = entries[0]
  return normalizeSteamSession({
    username,
    refreshToken,
    guardData: value.GuardData?.[username] || ''
  })
}
