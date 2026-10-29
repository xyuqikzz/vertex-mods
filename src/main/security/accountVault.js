import { randomUUID } from 'node:crypto'

// 客户端只保存当前登录账号的凭据，不再保存多账号。
// 加密结构仍为 version 1，accounts 恒为空数组，保证旧版本客户端读取时不报错。
export class AccountVault {
  constructor({ storage, encryption }) {
    this.storage = storage
    this.encryption = encryption
    this.state = null
    this.revision = randomUUID()
  }
  read() {
    if (this.state) return this.state
    const encrypted = this.storage.get('accountVault')
    if (!encrypted) return { version: 1, active: '', accounts: [], migrated: false }
    try {
      const state = JSON.parse(this.encryption.decryptString(Buffer.from(encrypted, 'base64')))
      if (state.version !== 1 || typeof state.active !== 'string' || !Array.isArray(state.accounts))
        throw new Error()
      this.state = state
      return state
    } catch {
      throw new Error('credential_decryption_failed')
    }
  }
  commit(state) {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('credential_encryption_unavailable')
    const text = JSON.stringify(state)
    const encrypted = this.encryption.encryptString(text).toString('base64')
    if (this.encryption.decryptString(Buffer.from(encrypted, 'base64')) !== text)
      throw new Error('credential_verification_failed')
    const previous = this.storage.get('accountVault')
    try {
      this.storage.set('accountVault', encrypted)
      const actual = this.encryption.decryptString(
        Buffer.from(this.storage.get('accountVault'), 'base64')
      )
      if (actual !== text) throw new Error()
    } catch {
      if (previous) this.storage.set('accountVault', previous)
      else this.storage.delete('accountVault')
      throw new Error('credential_write_failed')
    }
    this.state = state
    return this.snapshot()
  }
  migrate(input = {}) {
    const state = this.read()
    if (!state.migrated) {
      const active = String(
        input.token ||
          input.persisted?.token ||
          this.storage.get('dbData.user.token') ||
          this.storage.get('user.token') ||
          ''
      )
      this.commit({ version: 1, active, accounts: [], migrated: true })
    } else if (state.accounts.length || 'omittedId' in state) {
      // 旧版本保存的其他账号凭据不再使用。清理失败不影响启动，下次启动重试。
      try {
        this.commit({ version: 1, active: state.active, accounts: [], migrated: true })
      } catch {
        /* 保留原状态 */
      }
    }
    // Source cleanup happens only after durable encrypted storage was verified.
    this.storage.delete('dbData.user.token')
    this.storage.delete('user.token')
    this.storage.delete('user.savedAccounts')
    this.storage.delete('dbData.user.savedAccounts')
    return this.snapshot()
  }
  token() {
    return this.read().active
  }
  snapshot() {
    const state = this.read()
    return {
      token: state.active ? this.revision : '',
      isLogin: Boolean(state.active)
    }
  }
  login(token) {
    if (typeof token !== 'string' || !token || token.length > 32768)
      throw new Error('invalid_account_token')
    const snapshot = this.commit({ version: 1, active: token, accounts: [], migrated: true })
    this.revision = randomUUID()
    return { ...snapshot, token: this.revision }
  }
  logout() {
    return this.commit({ version: 1, active: '', accounts: [], migrated: true })
  }
}
