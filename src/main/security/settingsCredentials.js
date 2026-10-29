import { createHash, randomUUID } from 'node:crypto'

const VAULT_KEY = 'apiCredentialVault'
const REF_KEY = '$vertexCredential'
const SCOPES = new Set(['nexusApi', 'modioApi', 'aiTranslation', 'aiAgent'])
const SECRET_KEYS = /^(apiKey|aiApiKey|apikey|key|apiKeys|keys)$/i
const clone = (value) => (value === undefined ? undefined : structuredClone(value))

function setPath(target, path, value, remove = false) {
  const parts = path.split('.')
  if (parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)))
    throw new Error('invalid_config_path')
  const last = parts.pop()
  let parent = target
  for (const part of parts) parent = parent[part] ??= {}
  if (remove) delete parent[last]
  else parent[last] = clone(value)
}

// 普通配置只保存引用；凭据表与配置通过同一次文件写入提交，避免迁移中断后丢失密钥。
export function createSettingsCredentialStore(raw, encryption) {
  let cachedCipher, cachedSecrets
  function decode(cipher) {
    if (!cipher) return {}
    if (cipher === cachedCipher) return cachedSecrets
    if (!encryption.isEncryptionAvailable()) throw new Error('credential_encryption_unavailable')
    try {
      const value = JSON.parse(encryption.decryptString(Buffer.from(cipher, 'base64')))
      if (
        !value ||
        value.version !== 1 ||
        !value.secrets ||
        typeof value.secrets !== 'object' ||
        Array.isArray(value.secrets)
      )
        throw new Error()
      cachedCipher = cipher
      cachedSecrets = value.secrets
      return cachedSecrets
    } catch {
      throw new Error('credential_decryption_failed')
    }
  }
  function hydrate(value, secrets = () => decode(raw.get(VAULT_KEY))) {
    if (!value || typeof value !== 'object') return value
    if (Object.hasOwn(value, REF_KEY)) {
      const secret = secrets()[value[REF_KEY]]
      if (typeof secret !== 'string') throw new Error('credential_reference_missing')
      return secret
    }
    if (Array.isArray(value)) return value.map((item) => hydrate(item, secrets))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, hydrate(item, secrets)])
    )
  }
  function protect(settings) {
    const secrets = {}
    function visit(value, scope = '', sensitive = false) {
      if (typeof value === 'string' && value && sensitive) {
        const id = randomUUID()
        secrets[id] = value
        return { [REF_KEY]: id }
      }
      if (!value || typeof value !== 'object') return value
      if (Object.hasOwn(value, REF_KEY)) throw new Error('invalid_credential_reference')
      if (Array.isArray(value)) return value.map((item) => visit(item, scope, sensitive))
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          visit(
            item,
            scope || key,
            sensitive || (SCOPES.has(scope) && SECRET_KEYS.test(key)) || key === 'vamhubAuthCookie'
          )
        ])
      )
    }
    return { settings: visit(settings), secrets }
  }
  function commit(snapshot) {
    const previous = raw.store
    const { settings, secrets } = protect(snapshot.systemConfig?.settings || {})
    const text = JSON.stringify({ version: 1, secrets })
    let cipher
    if (Object.keys(secrets).length) {
      if (!encryption.isEncryptionAvailable()) throw new Error('credential_encryption_unavailable')
      cipher = encryption.encryptString(text).toString('base64')
      if (encryption.decryptString(Buffer.from(cipher, 'base64')) !== text)
        throw new Error('credential_verification_failed')
    }
    snapshot.systemConfig = { ...snapshot.systemConfig, settings }
    if (cipher) snapshot[VAULT_KEY] = cipher
    else delete snapshot[VAULT_KEY]
    try {
      raw.store = snapshot
      const actual = raw.store
      if (
        JSON.stringify(actual.systemConfig?.settings) !== JSON.stringify(settings) ||
        actual[VAULT_KEY] !== cipher
      )
        throw new Error()
      if (cipher && encryption.decryptString(Buffer.from(actual[VAULT_KEY], 'base64')) !== text)
        throw new Error()
    } catch {
      raw.store = previous
      throw new Error('credential_write_failed')
    }
    cachedCipher = cipher
    cachedSecrets = secrets
  }
  const touchesSettings = (key) =>
    key === 'systemConfig' ||
    key === 'systemConfig.settings' ||
    key.startsWith('systemConfig.settings.')
  const get = (key, fallback) => hydrate(raw.get(key, fallback))
  const set = (key, value) => {
    if (typeof key !== 'string') throw new Error('invalid_config_path')
    if (!touchesSettings(key)) return raw.set(key, value)
    const snapshot = raw.store
    if (snapshot.systemConfig?.settings)
      snapshot.systemConfig.settings = hydrate(snapshot.systemConfig.settings)
    setPath(snapshot, key, value)
    commit(snapshot)
  }
  const remove = (key) => {
    if (!touchesSettings(key)) return raw.delete(key)
    const snapshot = raw.store
    if (snapshot.systemConfig?.settings)
      snapshot.systemConfig.settings = hydrate(snapshot.systemConfig.settings)
    setPath(snapshot, key, undefined, true)
    commit(snapshot)
  }
  function archiveLegacySettings(value) {
    if (!encryption.isEncryptionAvailable()) throw new Error('credential_encryption_unavailable')
    const key = 'legacySettingsCredentialVault'
    const previous = raw.get(key)
    let archives = {}
    try {
      if (previous) archives = JSON.parse(encryption.decryptString(Buffer.from(previous, 'base64')))
      if (!archives || typeof archives !== 'object' || Array.isArray(archives)) throw new Error()
    } catch {
      throw new Error('credential_decryption_failed')
    }
    const plain = JSON.stringify(value)
    const id = createHash('sha256').update(plain).digest('hex')
    if (Object.hasOwn(archives, id)) return
    archives[id] = value
    const text = JSON.stringify(archives)
    const cipher = encryption.encryptString(text).toString('base64')
    if (encryption.decryptString(Buffer.from(cipher, 'base64')) !== text)
      throw new Error('credential_verification_failed')
    try {
      raw.set(key, cipher)
      if (encryption.decryptString(Buffer.from(raw.get(key), 'base64')) !== text) throw new Error()
    } catch {
      if (previous) raw.set(key, previous)
      else raw.delete(key)
      throw new Error('credential_write_failed')
    }
  }
  return new Proxy(raw, {
    get(target, key) {
      if (key === 'get') return get
      if (key === 'set') return set
      if (key === 'delete') return remove
      if (key === 'secureSettings')
        return () => set('systemConfig.settings', get('systemConfig.settings') || {})
      if (key === 'archiveLegacySettings') return archiveLegacySettings
      if (key === 'store') return hydrate(target.store)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) {
      if (key === 'store') {
        commit(clone(value))
        return true
      }
      return Reflect.set(target, key, value, target)
    }
  })
}
