import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createPlanningPathChecker, normalizeSafeRelativePath } from './pathSafety.js'
import { InstallEngineError } from './installEngineError.js'
import { resolveTargetBoundaryRoot } from './targetResolver.js'

const MAX_READ_BYTES = 256 * 1024
const MAX_FOMOD_BYTES = 1024 * 1024
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message) => {
  throw new InstallEngineError('install_engine.fact_unknown', message)
}

export function captureDeclarativeContext(context) {
  return {
    sourceGameId: context.sourceGameId,
    domainName: context.domainName,
    installedCapabilities: context.installedCapabilities,
    data: Object.fromEntries(
      ['sourceGameId', 'endpointType', 'profileName', 'gameStore', 'gameVersion', 'gameRuntime']
        .filter((key) => context.data?.[key] !== undefined)
        .map((key) => [key, context.data[key]])
    )
  }
}

export async function readDeclarativeFacts(definitions = {}, context = {}) {
  const budget = context.factReadBudget || { reads: 0, bytes: 0, startedAt: Date.now() }
  context.factReadBudget = budget
  const values = Object.create(null)
  const evidence = []
  const within = createPlanningPathChecker()
  // A fresh cache for every preview/execution check; file contents never persist across requests.
  const files = new Map()
  for (const [id, spec] of Object.entries(definitions)) {
    if (++budget.reads > 1024 || Date.now() - budget.startedAt > 30000) fail('内容事实超过 1024 次读取或 30 秒规划预算')
    if (spec.base === 'context') {
      const value = {
        platform: process.platform,
        arch: process.arch,
        source: context.source,
        game_id: context.sourceGameId || context.data?.sourceGameId,
        domain: context.domainName,
        endpoint: context.data?.endpointType,
        profile: context.data?.profileName,
        store: context.data?.gameStore,
        game_version: context.data?.gameVersion,
        runtime: context.data?.gameRuntime,
        installed_capabilities: context.installedCapabilities
      }[spec.key]
      if ((value === undefined || value === '') && !spec.optional) fail(`事实 ${id} 缺少上下文`)
      values[id] = { known: value !== undefined && value !== '', value }
      evidence.push({ id, spec, fingerprint: digest(JSON.stringify(value ?? null)) })
      continue
    }
    const root = ['local_appdata', 'roaming_appdata'].includes(spec.base)
      ? (await resolveTargetBoundaryRoot(spec.base, context.gameRoot)).targetBoundaryRoot
      : spec.base === 'game'
        ? context.gameRoot
        : context.stagingPath
    if (!root) fail(`事实 ${id} 缺少目录上下文`)
    const relative = normalizeSafeRelativePath(spec.path)
    const fullPath = path.resolve(root, ...relative.split('/'))
    if (!(await within(root, fullPath))) fail(`事实 ${id} 读取路径越界`)
    let file = files.get(fullPath)
    if (!file) {
      let stat
      try {
        stat = await fs.stat(fullPath)
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      }
      file = { stat, buffer: null }
      files.set(fullPath, file)
    }
    if (['exists', 'file_exists', 'dir_exists'].includes(spec.read)) {
      values[id] = {
        known: true,
        value:
          spec.read === 'file_exists'
            ? !!file.stat?.isFile()
            : spec.read === 'dir_exists'
              ? !!file.stat?.isDirectory()
              : !!file.stat
      }
      evidence.push({
        id,
        spec,
        fingerprint: digest(file.stat ? (file.stat.isDirectory() ? 'dir' : 'file') : 'missing')
      })
      continue
    }
    if (!file.stat) {
      if (!spec.optional) fail(`事实 ${id} 所需文件不存在`)
      values[id] = { known: false }
      evidence.push({ id, spec, fingerprint: 'missing' })
      continue
    }
    if (!file.stat.isFile()) fail(`事实 ${id} 必须读取普通文件`)
    let buffer
    if (spec.read === 'pe_arch') {
      const handle = await fs.open(fullPath, 'r')
      try {
        const header = Buffer.alloc(64)
        if (
          (await handle.read(header, 0, 64, 0)).bytesRead !== 64 ||
          header.toString('ascii', 0, 2) !== 'MZ'
        )
          fail(`事实 ${id} 不是有效 PE 文件`)
        const offset = header.readUInt32LE(0x3c)
        if (offset < 64 || offset > 16 * 1024 * 1024 || offset + 6 > file.stat.size)
          fail(`事实 ${id} PE 头无效`)
        const machine = Buffer.alloc(6)
        if (
          (await handle.read(machine, 0, 6, offset)).bytesRead !== 6 ||
          machine.readUInt32LE(0) !== 0x4550
        )
          fail(`事实 ${id} PE 签名无效`)
        const arch = { 332: 'x86', 34404: 'x64', 43620: 'arm64' }[machine.readUInt16LE(4)]
        if (!arch) fail(`事实 ${id} PE 架构不受支持`)
        values[id] = { known: true, value: arch }
        buffer = Buffer.concat([header, machine])
      } finally {
        await handle.close()
      }
    } else {
      const maxReadBytes = spec.read === 'fomod_xml' ? MAX_FOMOD_BYTES : MAX_READ_BYTES
      if (file.stat.size > maxReadBytes) fail(`事实 ${id} 文件超过 ${maxReadBytes / 1024} KiB 内容读取预算`)
      if (!file.buffer) {
        // Read with a fixed capacity even if the file grows after stat.
        const handle = await fs.open(fullPath, 'r')
        try {
          const bounded = Buffer.alloc(maxReadBytes + 1)
          const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0)
          if (bytesRead > maxReadBytes) fail(`事实 ${id} 文件超过读取预算`)
          file.buffer = bounded.subarray(0, bytesRead)
          budget.bytes += bytesRead
          if (budget.bytes > 32 * 1024 * 1024) fail('内容事实超过 32 MiB 总读取预算')
        } finally {
          await handle.close()
        }
      }
      buffer = file.buffer
      let encoding = 'utf-8'
      if (spec.read === 'fomod_xml') {
        if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le'
        else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be'
      }
      const text = new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
      let value = text
      if (spec.read === 'json') {
        value = JSON.parse(text)
        const pointer = spec.pointer ?? ''
        if (pointer !== '' && !pointer.startsWith('/')) fail(`事实 ${id} 必须使用 JSON Pointer`)
        for (const part of pointer === '' ? [] : pointer.slice(1).split('/')) {
          const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
          value =
            value !== null && typeof value === 'object' && Object.hasOwn(value, key)
              ? value[key]
              : undefined
        }
      } else if (spec.read === 'ini') {
        let section = ''
        value = undefined
        for (const line of text.split(/\r?\n/)) {
          const header = line.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/)
          if (header) {
            section = header[1].trim()
            continue
          }
          const entry = line.match(/^\s*([^;#=]+?)\s*=\s*(.*?)\s*$/)
          if (entry && section === (spec.section || '') && entry[1] === spec.key) {
            if (value !== undefined) fail(`事实 ${id} INI 键重复，无法确定值`)
            value = entry[2]
          }
        }
      } else if (!['text', 'fomod_xml'].includes(spec.read)) fail(`事实 ${id} 读取方式无效`)
      if (value === undefined && !spec.optional) fail(`事实 ${id} 所需字段不存在`)
      values[id] = { known: value !== undefined, value }
    }
    evidence.push({ id, spec, fingerprint: digest(buffer) })
  }
  return { values, evidence }
}

export function evaluateFactPredicate(node, facts) {
  if (!node) return true
  // Evaluate all branches: an unknown fact must not disappear behind short-circuiting.
  if (node.all) return node.all.map((x) => evaluateFactPredicate(x, facts)).every(Boolean)
  if (node.any) return node.any.map((x) => evaluateFactPredicate(x, facts)).some(Boolean)
  if (node.not) return !evaluateFactPredicate(node.not, facts)
  const fact = Object.hasOwn(facts, node.fact) ? facts[node.fact] : null
  if (!fact) fail(`条件引用了未声明的事实 ${node.fact}`)
  if ('exists' in node) return fact.known === node.exists
  if (!fact.known) fail(`事实 ${node.fact} 无法确定，不能执行比较或取反`)
  if ('equals' in node) return isDeepStrictEqual(fact.value, node.equals)
  if (node.one_of) return node.one_of.some((value) => isDeepStrictEqual(value, fact.value))
  if ('contains' in node) {
    if (typeof fact.value === 'string' && typeof node.contains === 'string')
      return fact.value.includes(node.contains)
    if (Array.isArray(fact.value))
      return fact.value.some((value) => isDeepStrictEqual(value, node.contains))
    fail(`事实 ${node.fact} 不是字符串或数组，不能执行 contains`)
  }
  if ('min' in node || 'max' in node) {
    if (typeof fact.value !== 'number' || !Number.isFinite(fact.value))
      fail(`事实 ${node.fact} 不是有限数字`)
    return (
      (node.min === undefined || fact.value >= node.min) &&
      (node.max === undefined || fact.value <= node.max)
    )
  }
  if (node.version) {
    const compare = (left, right) => {
      if (!/^\d+(?:\.\d+){0,7}(?:-[a-zA-Z0-9.-]+)?$/.test(String(left)))
        fail(`事实 ${node.fact} 不是可比较版本`)
      const [a, ap] = String(left).split(/-(.*)/s),
        [b, bp] = right.split(/-(.*)/s)
      const av = a.split('.').map(Number),
        bv = b.split('.').map(Number)
      for (let i = 0; i < Math.max(av.length, bv.length); i++)
        if ((av[i] || 0) !== (bv[i] || 0)) return (av[i] || 0) > (bv[i] || 0) ? 1 : -1
      if (!ap || !bp) return ap === bp ? 0 : ap ? -1 : 1
      const ax = ap.split('.'),
        bx = bp.split('.')
      for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
        if (ax[i] === bx[i]) continue
        if (ax[i] === undefined || bx[i] === undefined) return ax[i] === undefined ? -1 : 1
        const an = /^\d+$/.test(ax[i]),
          bn = /^\d+$/.test(bx[i])
        if (an && bn) return Number(ax[i]) > Number(bx[i]) ? 1 : -1
        if (an !== bn) return an ? -1 : 1
        return ax[i] > bx[i] ? 1 : -1
      }
      return 0
    }
    const min = node.version.min === undefined ? 1 : compare(fact.value, node.version.min)
    const max = node.version.max === undefined ? -1 : compare(fact.value, node.version.max)
    return (
      (node.version.include_min === false ? min > 0 : min >= 0) &&
      (node.version.include_max === false ? max < 0 : max <= 0)
    )
  }
  fail('无法识别事实条件')
}

export async function assertDeclarativeEvidenceCurrent(plan, context) {
  const previous = plan?.replayContext?.declarative?.facts || []
  if (!previous.length) return
  const definitions = Object.fromEntries(previous.map((item) => [item.id, item.spec]))
  const stored = plan.replayContext.declarative.context || {}
  const current = await readDeclarativeFacts(definitions, {
    ...stored,
    ...context,
    data: { ...stored.data, ...context.data }
  })
  if (JSON.stringify(current.evidence) !== JSON.stringify(previous)) {
    throw new InstallEngineError(
      'install_engine.preview_stale',
      '安装环境或包内容已变化，请重新预览并确认组件'
    )
  }
}
