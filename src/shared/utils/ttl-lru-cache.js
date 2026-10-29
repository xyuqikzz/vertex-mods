export class TtlLruCache {
  constructor(options = {}) {
    this.max = Math.max(1, Number(options.max || 100))
    this.ttl = Math.max(1, Number(options.ttl || 5 * 60 * 1000))
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.cache = new Map()
  }

  get size() {
    this.pruneExpired()
    return this.cache.size
  }

  has(key) {
    return this.get(key) !== undefined
  }

  get(key) {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key)
      return undefined
    }
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key, value) {
    this.cache.delete(key)
    this.cache.set(key, {
      value,
      expiresAt: this.now() + this.ttl
    })
    this.pruneExpired()
    while (this.cache.size > this.max) {
      this.cache.delete(this.cache.keys().next().value)
    }
    return this
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
  }

  pruneExpired() {
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key)
      }
    }
  }
}
