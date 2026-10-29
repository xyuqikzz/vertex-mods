import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
const DEFAULT_PROFILE_NAME = 'default'
const PROFILE_NAME_MAX_LENGTH = 32
const PROFILE_NAME_INVALID_PATTERN = /[\\/:*?"<>|]/
const GLOBAL_STORAGE_KEY = 'vertex_mod_source_profile_registry_v1'
const THUNDERSTORE_LEGACY_STORAGE_KEY = 'vertex_thunderstore_profile_registry_v1'

export const SOURCE_PROFILE_REGISTRY_UPDATED_EVENT = 'vertex:source-profile-registry-updated'

const PROFILE_REGISTRY_DISPATCH_DEBOUNCE_MS = 50
let profileRegistryDispatchTimer = null
const profileRegistryDispatchSources = new Set()
const profileRegistryDispatchIdentifiers = new Set()

function flushProfileRegistryDispatch() {
  profileRegistryDispatchTimer = null
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    profileRegistryDispatchSources.clear()
    profileRegistryDispatchIdentifiers.clear()
    return
  }
  const sources = Array.from(profileRegistryDispatchSources)
  const identifiers = Array.from(profileRegistryDispatchIdentifiers)
  profileRegistryDispatchSources.clear()
  profileRegistryDispatchIdentifiers.clear()
  try {
    window.dispatchEvent(
      new CustomEvent(SOURCE_PROFILE_REGISTRY_UPDATED_EVENT, {
        detail: { batched: true, sources, identifiers }
      })
    )
  } catch (error) {
    console.warn('[profile] 广播配置方案更新事件失败', error)
  }
}

function dispatchProfileRegistryUpdated(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const source = String(detail?.source || '').trim()
  const identifier = String(detail?.identifier || '').trim()
  if (source) profileRegistryDispatchSources.add(source)
  if (identifier) profileRegistryDispatchIdentifiers.add(identifier)
  if (profileRegistryDispatchTimer) return
  profileRegistryDispatchTimer = setTimeout(
    flushProfileRegistryDispatch,
    PROFILE_REGISTRY_DISPATCH_DEBOUNCE_MS
  )
}

export function normalizeSourceProfileName(value) {
  return String(value || '').trim()
}

export function normalizeSourceProfileKeySegment(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

export function sanitizeSourceProfileList(input, defaultProfileName = DEFAULT_PROFILE_NAME) {
  const source = Array.isArray(input) ? input : []
  const result = []
  const seen = new Set()

  const pushItem = (raw) => {
    const text = normalizeSourceProfileName(raw)
    if (!text) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(text)
  }

  pushItem(defaultProfileName || DEFAULT_PROFILE_NAME)
  for (const item of source) pushItem(item)
  return result
}

export function resolveSourceProfileNameInList(
  name,
  list,
  fallbackProfileName = DEFAULT_PROFILE_NAME
) {
  const fallback = normalizeSourceProfileName(fallbackProfileName) || DEFAULT_PROFILE_NAME
  const safeList = sanitizeSourceProfileList(list, fallback)
  const target = normalizeSourceProfileName(name)
  if (!target) return safeList[0] || fallback
  return (
    safeList.find((item) => item.toLowerCase() === target.toLowerCase()) || safeList[0] || fallback
  )
}

function normalizeProfileRecord(record = {}) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {}
  const requestedDefault =
    normalizeSourceProfileName(source.defaultProfile || source.defaultProfileName) ||
    DEFAULT_PROFILE_NAME
  const list = sanitizeSourceProfileList(source.list, requestedDefault)
  const defaultProfile = resolveSourceProfileNameInList(requestedDefault, list, requestedDefault)
  return {
    list,
    selected: resolveSourceProfileNameInList(source.selected, list, defaultProfile),
    defaultProfile
  }
}

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function writeStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data || {}))
  } catch (error) {
    console.error('[profile] 写入本地配置失败', error)
  }
}

function readGlobalStorage() {
  return readStorage(GLOBAL_STORAGE_KEY)
}

function writeGlobalStorage(data) {
  writeStorage(GLOBAL_STORAGE_KEY, data)
}

function normalizeSourceKey(sourceKey = '') {
  return String(sourceKey || '')
    .trim()
    .toLowerCase()
}

function readLegacyThunderstoreStorage() {
  return readStorage(THUNDERSTORE_LEGACY_STORAGE_KEY)
}

function writeLegacyThunderstoreRecord(identifier, record = {}) {
  const key = normalizeSourceProfileKeySegment(identifier)
  if (!key) return
  const storage = readLegacyThunderstoreStorage()
  storage[key] = normalizeProfileRecord(record)
  writeStorage(THUNDERSTORE_LEGACY_STORAGE_KEY, storage)
}

function removeLegacyThunderstoreRecordProfile(identifier, profileName = '') {
  const key = normalizeSourceProfileKeySegment(identifier)
  const target = normalizeSourceProfileName(profileName)
  if (!key || !target) return
  const storage = readLegacyThunderstoreStorage()
  const current = normalizeProfileRecord(storage[key])
  if (target.toLowerCase() === current.defaultProfile.toLowerCase()) return
  const list = sanitizeSourceProfileList(
    current.list.filter((item) => item.toLowerCase() !== target.toLowerCase()),
    current.defaultProfile
  )
  storage[key] = {
    list,
    selected: resolveSourceProfileNameInList(current.selected, list, current.defaultProfile),
    defaultProfile: current.defaultProfile
  }
  writeStorage(THUNDERSTORE_LEGACY_STORAGE_KEY, storage)
}

export function migrateLegacyThunderstoreProfiles() {
  const legacyData = readLegacyThunderstoreStorage()
  if (!legacyData || !Object.keys(legacyData).length) return

  const root = readGlobalStorage()
  const bucket =
    root.thunderstore && typeof root.thunderstore === 'object' && !Array.isArray(root.thunderstore)
      ? root.thunderstore
      : {}

  for (const [identifier, record] of Object.entries(legacyData)) {
    const key = normalizeSourceProfileKeySegment(identifier)
    if (!key || !record || typeof record !== 'object' || Array.isArray(record)) continue
    if (bucket[key]) continue
    bucket[key] = normalizeProfileRecord(record)
  }

  root.thunderstore = bucket
  writeGlobalStorage(root)
}

export function getSourceProfileRegistryKey(sourceKey, identifier) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  return source && key ? `${source}:${key}` : ''
}

export function readSourceProfiles(sourceKey, identifier) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  if (!source || !key) return normalizeProfileRecord()

  if (source === 'thunderstore') migrateLegacyThunderstoreProfiles()

  const root = readGlobalStorage()
  const bucket =
    root[source] && typeof root[source] === 'object' && !Array.isArray(root[source])
      ? root[source]
      : {}
  return normalizeProfileRecord(bucket[key])
}

export function resolveSelectedSourceProfileName(
  sourceKey,
  identifier,
  fallbackProfileName = DEFAULT_PROFILE_NAME
) {
  const fallback = normalizeSourceProfileName(fallbackProfileName) || DEFAULT_PROFILE_NAME
  const record = readSourceProfiles(sourceKey, identifier)
  return (
    normalizeSourceProfileName(record?.selected) ||
    normalizeSourceProfileName(record?.defaultProfile) ||
    fallback
  )
}

export function writeSourceProfiles(
  sourceKey,
  identifier,
  profiles,
  activeProfileName,
  options = {}
) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  if (!source || !key) return null

  const root = readGlobalStorage()
  const bucket =
    root[source] && typeof root[source] === 'object' && !Array.isArray(root[source])
      ? root[source]
      : {}
  const current = normalizeProfileRecord(bucket[key])
  const requestedDefault =
    normalizeSourceProfileName(options?.defaultProfileName || options?.defaultProfile) ||
    current.defaultProfile
  const list = sanitizeSourceProfileList(profiles, requestedDefault)
  const defaultProfile = resolveSourceProfileNameInList(requestedDefault, list, requestedDefault)
  const selected = resolveSourceProfileNameInList(activeProfileName, list, defaultProfile)
  const record = { list, selected, defaultProfile }

  bucket[key] = record
  root[source] = bucket
  writeGlobalStorage(root)

  if (source === 'thunderstore') writeLegacyThunderstoreRecord(key, record)
  dispatchProfileRegistryUpdated({ source, identifier: key, list, selected, defaultProfile })
  return record
}

export function ensureSourceProfile(sourceKey, identifier, profileName, options = {}) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  const name = normalizeSourceProfileName(profileName)
  if (!source || !key || !name) return null

  const current = readSourceProfiles(source, key)
  const list = sanitizeSourceProfileList([...current.list, name], current.defaultProfile)
  const selected = options?.select === false ? current.selected : name
  return writeSourceProfiles(source, key, list, selected, {
    defaultProfileName: current.defaultProfile
  })
}

export function renameSourceProfile(sourceKey, identifier, profileName, nextProfileName) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  const currentName = normalizeSourceProfileName(profileName)
  const nextName = normalizeSourceProfileName(nextProfileName)
  if (!source || !key || !currentName || !nextName) return null

  const current = readSourceProfiles(source, key)
  const resolvedCurrent = current.list.find(
    (item) => item.toLowerCase() === currentName.toLowerCase()
  )
  if (!resolvedCurrent) return { ok: false, reason: uiText('ui.profileDoesNotExist') }
  const validation = validateSourceProfileName(nextName, current.list, {
    excludeProfileName: resolvedCurrent
  })
  if (!validation.ok) return validation

  const list = current.list.map((item) =>
    item.toLowerCase() === resolvedCurrent.toLowerCase() ? validation.name : item
  )
  const selected =
    current.selected.toLowerCase() === resolvedCurrent.toLowerCase()
      ? validation.name
      : current.selected
  const defaultProfile =
    current.defaultProfile.toLowerCase() === resolvedCurrent.toLowerCase()
      ? validation.name
      : current.defaultProfile
  const record = writeSourceProfiles(source, key, list, selected, {
    defaultProfileName: defaultProfile
  })
  return record
    ? {
        ok: true,
        previousName: resolvedCurrent,
        name: validation.name,
        isDefault: defaultProfile.toLowerCase() === validation.name.toLowerCase(),
        ...record
      }
    : null
}

export function removeSourceProfile(sourceKey, identifier, profileName) {
  const source = normalizeSourceKey(sourceKey)
  const key = normalizeSourceProfileKeySegment(identifier)
  const target = normalizeSourceProfileName(profileName)
  if (!source || !key || !target) return null

  const current = readSourceProfiles(source, key)
  if (target.toLowerCase() === current.defaultProfile.toLowerCase()) return null
  const list = sanitizeSourceProfileList(
    current.list.filter((item) => item.toLowerCase() !== target.toLowerCase()),
    current.defaultProfile
  )
  const selected = resolveSourceProfileNameInList(current.selected, list, current.defaultProfile)
  const record = writeSourceProfiles(source, key, list, selected, {
    defaultProfileName: current.defaultProfile
  })

  if (source === 'thunderstore') removeLegacyThunderstoreRecordProfile(key, target)
  return record
}

export function validateSourceProfileName(rawName, profiles = [], options = {}) {
  const name = normalizeSourceProfileName(rawName)
  if (!name) return { ok: false, reason: uiText('ui.enterAConfigurationName') }
  if (name.length > PROFILE_NAME_MAX_LENGTH) {
    return { ok: false, reason: uiText('ui.profileNamesCannotExceedValueCharacters', { value1: (PROFILE_NAME_MAX_LENGTH) }) }
  }
  if (PROFILE_NAME_INVALID_PATTERN.test(name)) {
    return { ok: false, reason: uiText('ui.profileNamesCannotContain') }
  }
  const excluded = normalizeSourceProfileName(options?.excludeProfileName).toLowerCase()
  const existed = (Array.isArray(profiles) ? profiles : []).some((item) => {
    const current = normalizeSourceProfileName(item)
    return (
      current && current.toLowerCase() !== excluded && current.toLowerCase() === name.toLowerCase()
    )
  })
  if (existed) return { ok: false, reason: uiText('ui.thisProfileNameAlreadyExistsChooseAnotherName') }
  return { ok: true, name }
}

export const SOURCE_PROFILE_REGISTRY_CONSTANTS = Object.freeze({
  DEFAULT_PROFILE_NAME,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_INVALID_PATTERN,
  GLOBAL_STORAGE_KEY,
  THUNDERSTORE_LEGACY_STORAGE_KEY
})
