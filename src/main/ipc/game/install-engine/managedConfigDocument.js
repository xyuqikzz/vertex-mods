import { InstallEngineError } from './installEngineError.js'
import { isDeepStrictEqual } from 'node:util'

const fail = (message) => {
  throw new InstallEngineError('install_engine.config_conflict', message)
}
const clone = (value) => JSON.parse(JSON.stringify(value))
export const sameConfigValue = (a, b) => isDeepStrictEqual(a, b)

export function configFieldKey(format, change) {
  for (const key of ['pointer', 'section', 'key']) if (typeof change[key] === 'string' && change[key].length > 2048) fail('配置字段路径超过 2048 字符预算')
  if (format === 'json') {
    if (
      typeof change.pointer !== 'string' ||
      !change.pointer.startsWith('/') ||
      /~(?![01])/g.test(change.pointer)
    )
      fail('JSON 配置必须指定字段 Pointer，不能覆盖整个文档')
    const parts = change.pointer
      .slice(1)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    if (parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)))
      fail('JSON 配置包含不安全字段')
    return JSON.stringify(parts)
  }
  if (format === 'ini') {
    if (
      typeof change.key !== 'string' ||
      !change.key ||
      /[\r\n=[\]]/.test(change.key) ||
      /[\r\n[\]]/.test(change.section || '')
    )
      fail('INI section/key 无效')
    return JSON.stringify([change.section || '', change.key])
  }
  if (format === 'lines') {
    if (typeof change.line !== 'string' || !change.line || /[\r\n]/.test(change.line) || Buffer.byteLength(change.line) > 65536)
      fail('启用列表必须指定非空单行文本')
    return JSON.stringify(change.line)
  }
  fail('配置格式必须为 json/ini/lines')
}

export function createConfigDocument(format, rawText = '') {
  const bom = rawText.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = rawText.replace(/^\uFEFF/, '')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (format === 'json') {
    const data = text.trim() ? JSON.parse(text) : {}
    if (!data || Array.isArray(data) || typeof data !== 'object') fail('JSON 配置根必须为对象')
    const locate = (key, create = false) => {
      const parts = JSON.parse(key)
      let node = data
      for (const part of parts.slice(0, -1)) {
        if (!Object.hasOwn(node, part)) {
          if (!create) return null
          node[part] = {}
        }
        node = node[part]
        if (!node || Array.isArray(node) || typeof node !== 'object')
          fail('JSON 配置父路径不是对象；数组必须作为完整字段显式修改')
      }
      return { node, part: parts.at(-1), parts }
    }
    return {
      missingParents(key) {
        const parts = JSON.parse(key),
          missing = []
        let node = data
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node || !Object.hasOwn(node, parts[i]))
            missing.push(JSON.stringify(parts.slice(0, i + 1)))
          node = node && typeof node === 'object' ? node[parts[i]] : undefined
        }
        return missing
      },
      prune(keys = []) {
        for (const key of [...keys].reverse()) {
          const found = locate(key)
          const value = found?.node[found.part]
          if (
            value &&
            !Array.isArray(value) &&
            typeof value === 'object' &&
            Object.keys(value).length === 0
          )
            delete found.node[found.part]
        }
      },
      get(key) {
        const found = locate(key)
        return found && Object.hasOwn(found.node, found.part)
          ? { exists: true, value: clone(found.node[found.part]) }
          : { exists: false }
      },
      set(key, value) {
        const found = locate(key, value.exists)
        if (!found) return
        if (value.exists) found.node[found.part] = clone(value.value)
        else delete found.node[found.part]
      },
      serialize: () => bom + JSON.stringify(data, null, text.match(/\n([\t ]+)\S/)?.[1] || 2) + eol,
      empty: () => Object.keys(data).length === 0
    }
  }
  const lines = text ? text.split(/\r?\n/) : []
  const locateIni = (key) => {
    const [wantedSection, wantedKey] = JSON.parse(key)
    let section = ''
    let found = -1
    let insert = lines.length
    let sectionExists = wantedSection === ''
    for (let i = 0; i < lines.length; i++) {
      const header = lines[i].match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/)
      if (header) {
        if (section === wantedSection) insert = i
        section = header[1].trim()
        if (section === wantedSection) {
          sectionExists = true
          insert = i + 1
        }
      } else if (section === wantedSection) {
        const entry = lines[i].match(/^\s*([^;#=]+?)\s*=\s*(.*?)\s*$/)
        if (entry && entry[1] === wantedKey) {
          if (found !== -1) fail('INI 存在重复键，不能安全合并')
          found = i
        }
        insert = i + 1
      }
    }
    return { found, insert, sectionExists, wantedSection, wantedKey }
  }
  return {
    missingParents(key) {
      if (format !== 'ini') return []
      const location = locateIni(key)
      return !location.sectionExists ? [location.wantedSection] : []
    },
    prune(sections = []) {
      if (format !== 'ini') return
      for (const section of sections) {
        const start = lines.findIndex((line) => line.trim() === `[${section}]`)
        if (start < 0) continue
        let end = start + 1
        while (end < lines.length && !/^\s*\[/.test(lines[end])) end++
        if (lines.slice(start + 1, end).every((line) => !line.trim()))
          lines.splice(start, end - start)
      }
    },
    get(key) {
      if (format === 'lines') {
        const indexes = lines.flatMap((line, index) => (line === JSON.parse(key) ? [index] : []))
        return { exists: true, value: indexes.length > 0, count: indexes.length }
      }
      const { found } = locateIni(key)
      return found < 0
        ? { exists: false }
        : { exists: true, value: lines[found].match(/^[^=]*=\s*(.*?)\s*$/)[1] }
    },
    set(key, value) {
      if (format === 'lines') {
        const line = JSON.parse(key)
        const desired =
          value.value === true
            ? (value.count ?? Math.max(1, lines.filter((entry) => entry === line).length))
            : 0
        let count = lines.filter((entry) => entry === line).length
        for (let i = lines.length - 1; i >= 0 && count > desired; i--)
          if (lines[i] === line) {
            lines.splice(i, 1)
            count--
          }
        while (count++ < desired)
          lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, line)
        return
      }
      const location = locateIni(key)
      if (!value.exists) {
        if (location.found >= 0) lines.splice(location.found, 1)
        return
      }
      if (/[\r\n]/.test(String(value.value))) fail('INI value 不能包含换行')
      const entry = `${location.wantedKey}=${String(value.value)}`
      if (location.found >= 0)
        lines[location.found] = lines[location.found].replace(
          /=.*/,
          () => `=${String(value.value)}`
        )
      else if (location.sectionExists) lines.splice(location.insert, 0, entry)
      else lines.push(`[${location.wantedSection}]`, entry)
    },
    serialize: () => bom + lines.join(eol),
    empty: () => lines.every((line) => !line.trim())
  }
}
