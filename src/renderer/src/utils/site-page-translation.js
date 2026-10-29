import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// 此函数在不可信网页中执行，只读写文字，不向网页暴露 Electron 或翻译 IPC。
function visibleTextRuntime(action, payload) {
  const key = '__vertexVisibleTextTranslationV1'
  let state = window[key]
  if (!state && action !== 'collect') return []
  if (!state) {
    state = { records: new Map(), nodes: new WeakMap(), nextId: 0, dirty: true, changedAt: 0 }
    const markDirty = () => {
      state.dirty = true
      state.changedAt = Date.now()
    }
    window.addEventListener('scroll', markDirty, true)
    window.addEventListener('resize', markDirty)
    // 动态广告/计数器可能持续更新，不能让这些变化一直推迟可见文字的处理。
    const observer = new MutationObserver(() => {
      state.dirty = true
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open']
    })
    state.dispose = () => {
      observer.disconnect()
      window.removeEventListener('scroll', markDirty, true)
      window.removeEventListener('resize', markDirty)
    }
    window[key] = state
  }
  const excluded =
    'script,style,noscript,code,pre,textarea,input,select,option,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[translate="no"],.notranslate,[hidden],[inert]'
  function visible(node) {
    const parent = node.parentElement
    if (!node.isConnected || !parent || parent.closest(excluded)) return false
    let left = 0,
      top = 0,
      right = innerWidth,
      bottom = innerHeight
    for (let el = parent; el; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
        return false
      if (el !== document.body && el !== document.documentElement) {
        const rect = el.getBoundingClientRect()
        if (style.overflowX !== 'visible') {
          left = Math.max(left, rect.left)
          right = Math.min(right, rect.right)
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, rect.top)
          bottom = Math.min(bottom, rect.bottom)
        }
      }
    }
    if (left >= right || top >= bottom) return false
    const range = document.createRange()
    range.selectNodeContents(node)
    return [...range.getClientRects()].some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > top &&
        rect.top < bottom &&
        rect.right > left &&
        rect.left < right
    )
  }
  if (action === 'restore') {
    state.dispose()
    for (const record of state.records.values()) {
      if (
        record.node.isConnected &&
        record.translated !== undefined &&
        record.node.nodeValue === record.translated
      )
        record.node.nodeValue = record.original
    }
    delete window[key]
    return []
  }
  if (action === 'resume') {
    for (const record of state.records.values()) record.pending = false
    state.dirty = true
    state.changedAt = 0
    return []
  }
  if (action === 'apply') {
    for (const item of payload || []) {
      const record = state.records.get(item.id)
      if (!record) continue
      record.pending = false
      if (
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.length > 8000 ||
        record.node.nodeValue !== record.original ||
        !visible(record.node)
      )
        continue
      const leading = record.original.match(/^\s*/)[0]
      const trailing = record.original.match(/\s*$/)[0]
      record.translated = leading + item.text.trim() + trailing
      record.node.nodeValue = record.translated
    }
    return []
  }
  if (!state.dirty || Date.now() - state.changedAt < 350) return []
  state.dirty = false
  for (const [id, record] of state.records) if (!record.node.isConnected) state.records.delete(id)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const items = []
  let characters = 0,
    node
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim()
    if (
      !text ||
      text.length > 4000 ||
      !/[a-zA-Z\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\uac00-\ud7af]/.test(text) ||
      /^(?:https?:\/\/|[\w./\\-]+\.(?:zip|7z|rar|pak|dll|exe)\b)/i.test(text)
    )
      continue
    let record = state.nodes.get(node)
    if (
      record?.pending ||
      (record?.translated !== undefined && node.nodeValue === record.translated)
    )
      continue
    if (!visible(node)) continue
    if (items.length >= 12 || (items.length && characters + text.length > 4800)) {
      state.dirty = true
      break
    }
    if (!record || node.nodeValue !== record.original) {
      if (record) state.records.delete(record.id)
      record = { id: String(++state.nextId), node, original: node.nodeValue }
      state.nodes.set(node, record)
      state.records.set(record.id, record)
    }
    record.pending = true
    items.push({ id: record.id, text })
    characters += text.length
  }
  return items
}

export function buildVisibleTextScript(action, payload = []) {
  return `(${visibleTextRuntime.toString()})(${JSON.stringify(action)},${JSON.stringify(payload)})`
}

export function createSitePageTranslator({
  getView,
  translate,
  onState = () => {},
  interval = 600
}) {
  let generation = 0,
    timer,
    enabled = false,
    suspended = false,
    busy = false,
    error = ''
  const cache = new Map()
  const report = () => onState({ enabled, busy, error })
  async function run(token) {
    const view = getView()
    if (!view || !enabled || suspended || token !== generation) return
    try {
      const raw = await view.executeJavaScript(buildVisibleTextScript('collect'))
      if (!enabled || token !== generation) return
      // 网页返回的数据仍是不可信输入；限制单次请求和字符串尺寸。
      const items = (Array.isArray(raw) ? raw : [])
        .slice(0, 12)
        .filter(
          (item) =>
            typeof item?.id === 'string' &&
            /^\d{1,12}$/.test(item.id) &&
            typeof item.text === 'string' &&
            item.text.trim() &&
            item.text.length <= 4000
        )
      if (items.length) {
        busy = true
        report()
        const missing = [
          ...new Map(
            items.filter((item) => !cache.has(item.text)).map((item) => [item.text, item])
          ).values()
        ]
        const result = missing.length ? await translate(missing) : new Map()
        if (!enabled || token !== generation) return
        for (const item of missing) {
          const text = result.get(item.id)
          if (typeof text === 'string' && text.trim() && text.length <= 8000) {
            cache.set(item.text, text)
            if (cache.size > 500) cache.delete(cache.keys().next().value)
          }
        }
        await view.executeJavaScript(
          buildVisibleTextScript(
            'apply',
            items.map((item) => ({ id: item.id, text: cache.get(item.text) }))
          )
        )
        if (items.some((item) => !cache.has(item.text)))
          throw new Error(uiText('ui.someTextCouldNotBeTranslatedTryAgainLater'))
      }
      if (token === generation) {
        busy = false
        report()
        timer = setTimeout(() => {
          void run(token)
        }, interval)
      }
    } catch (failure) {
      if (token !== generation) return
      busy = false
      error = String(failure?.message || '页面翻译失败，请稍后重试')
      report()
    }
  }
  return {
    suspend() {
      suspended = true
      ++generation
      clearTimeout(timer)
      busy = false
      report()
    },
    async resume() {
      if (!suspended) return
      suspended = false
      if (!enabled || error) return
      const token = ++generation
      const view = getView()
      if (!view) return
      try {
        await view.executeJavaScript(buildVisibleTextScript('resume'))
        if (token === generation) void run(token)
      } catch (failure) {
        if (token === generation) {
          error = String(failure?.message || '页面翻译恢复失败')
          report()
        }
      }
    },
    start() {
      clearTimeout(timer)
      enabled = true
      busy = false
      error = ''
      report()
      void run(++generation)
    },
    async stop() {
      ++generation
      clearTimeout(timer)
      enabled = false
      busy = false
      error = ''
      report()
      const view = getView()
      if (view) await view.executeJavaScript(buildVisibleTextScript('restore')).catch(() => {})
    }
  }
}
