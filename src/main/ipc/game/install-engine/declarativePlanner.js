import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { isRouteSourcePathMatched } from './pathMapper.js'
import {
  readDeclarativeFacts,
  evaluateFactPredicate,
  captureDeclarativeContext
} from './declarativeFacts.js'
import { InstallEngineError } from './installEngineError.js'
import { toArrayValue } from './contracts.js'
import { validateDeclarativeRule } from '../../../../shared/installation/install-rule-declarations.js'
import { prepareFomodRule } from './fomodPlanner.js'
import { expandNestedArchives } from './nestedArchivePlanner.js'
import { createPlanningPathChecker, normalizeSafeRelativePath } from './pathSafety.js'

const fail = (message, detail = {}) => {
  throw new InstallEngineError('install_engine.declaration_invalid', message, detail)
}
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const internal = (entry) =>
  /^__(?:vertex_install_plan_v3|vertex_install_rule|vertex_nexus_rule)__(?:\/|$)/i.test(
    entry.relativePath
  )
const under = (file, root) => !root || file.toLowerCase().startsWith(`${root.toLowerCase()}/`)

export function resolveComponents(groups, facts, submitted, binding) {
  const resolved = groups.map((group) => ({
    ...group,
    min: group.min ?? 0,
    max: group.max ?? group.options.length,
    options: group.options.map((option) => ({
      ...option,
      available: evaluateFactPredicate(option.when, facts)
    }))
  }))
  const ids = new Set(resolved.flatMap((group) => group.options.map((option) => option.id)))
  if (
    submitted !== undefined &&
    (!Array.isArray(submitted?.selected) ||
      new Set(submitted.selected).size !== submitted.selected.length)
  )
    fail('组件选择包含重复或无效选项')
  if (submitted?.binding === binding && submitted.selected.some((id) => !ids.has(id)))
    fail('组件选择包含未知选项')
  const stale = submitted && submitted.binding !== binding
  const selected = new Set(
    submitted?.selected.filter((id) => ids.has(id)) ||
      resolved.flatMap((group) =>
        group.options
          .filter((option) => option.available && (option.required || option.default))
          .map((option) => option.id)
      )
  )
  let needsInput =
    !submitted &&
    resolved.some((group) => group.options.some((option) => option.available && !option.required))
  for (const group of resolved) {
    for (const option of group.options) {
      if (option.required && option.available) selected.add(option.id)
      if (selected.has(option.id) && !option.available) {
        selected.delete(option.id)
        needsInput = true
      }
    }
    const count = group.options.filter((option) => selected.has(option.id)).length
    if (count < group.min || count > group.max) needsInput = true
  }
  if (needsInput || stale) {
    throw new InstallEngineError(
      stale ? 'install_engine.preview_stale' : 'install_engine.selection_required',
      stale ? '规则、包结构或环境已变化，请重新确认有效组件' : '此安装包需要选择组件',
      {
        selectionRequest: { binding, groups: resolved, selected: [...selected] }
      }
    )
  }
  return [...selected].sort()
}

function substituteUnit(value, bindings) {
  if (typeof value === 'string')
    return value.replace(/\{\{unit\.(name|root|anchor|identity)\}\}/g, (_, key) => {
      if (bindings[key] === undefined) fail(`缺少单元变量 ${key}`)
      return String(bindings[key])
    })
  if (Array.isArray(value)) return value.map((item) => substituteUnit(item, bindings))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteUnit(item, bindings)])
    )
  return value
}

export async function prepareDeclarativeRule(rule, snapshot, context) {
  const declaration = rule.declarative
  if (!declaration) return { rule, matched: true }
  validateDeclarativeRule(declaration)
  if (declaration.fomod) return prepareFomodRule(rule, snapshot, context, resolveComponents)
  const nested = await expandNestedArchives(snapshot, context, declaration.nested_archives)
  snapshot = nested.snapshot
  const files = (snapshot.allFiles || [])
    .filter((entry) => !internal(entry))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'))
  const directories = (snapshot.allDirs || []).filter((entry) => !internal(entry))
  const nonEmpty = new Set(
    [...files, ...directories].map((entry) => path.posix.dirname(entry.relativePath).toLowerCase())
  )
  const emptyDirectories = directories.filter(
    (entry) => !nonEmpty.has(entry.relativePath.toLowerCase())
  )
  if (files.length > 50000) fail('声明式规划超过 50000 个文件的预算')
  const facts = await readDeclarativeFacts(declaration.facts, context)
  if (!evaluateFactPredicate(declaration.when, facts.values)) return { matched: false }
  const binding = hash({
    rule,
    facts: facts.evidence,
    files: files.map((file) => [file.relativePath, file.size]),
    gameRoot: path.resolve(context.gameRoot),
    source: context.source
  })
  const selected = resolveComponents(
    declaration.components || [],
    facts.values,
    context.data?.installChoices,
    binding
  )
  const routes = [...(rule.routes || [])]
  const ignored = new Map(nested.ignored.map((item) => [item.sourceRelativePath, item.reason]))
  const units = []
  const dependencies = [
    ...toArrayValue(rule.dependencies || rule.default_dependencies || rule.defaultDependencies)
  ]
  const providedCapabilities = []
  const generatedEntries = []
  const claimed = new Set()
  let comparisons = 0
  const matches = (value, patterns) => {
    comparisons += patterns.length
    if (comparisons > 2000000) fail('声明式选择器超过 200 万次匹配预算')
    return isRouteSourcePathMatched(value, patterns)
  }
  for (const unit of declaration.units || []) {
    const unitEnabled =
      (!unit.component || selected.includes(unit.component)) &&
      (unit.facts ? true : evaluateFactPredicate(unit.when, facts.values))
    const selector = unit.selector
    const sourceEntries =
      selector.kind === 'directory'
        ? (snapshot.allDirs || []).filter((entry) => !internal(entry))
        : files
    const anchors = sourceEntries.filter(
      (file) =>
        file.relativePath.split('/').length - 1 <= (selector.max_depth ?? 80) &&
        matches(file.relativePath, [selector.anchor])
    )
    const roots = new Map()
    for (const anchor of anchors) {
      const parts = anchor.relativePath
        .split('/')
        .slice(0, selector.kind === 'directory' ? undefined : -1)
      const parents = selector.parent ?? 0
      if (parts.length < parents) fail(`单元 ${unit.id} 锚点层级不足`)
      const root = parts.slice(0, parts.length - parents).join('/')
      if (!roots.has(root.toLowerCase()))
        roots.set(root.toLowerCase(), { root, anchor: anchor.relativePath })
    }
    if (selector.common_ancestor && roots.size) {
      const values = [...roots.values()]
      const common = values[0].root.split('/').filter(Boolean)
      for (const value of values.slice(1)) {
        const parts = value.root.split('/')
        while (
          common.length &&
          !common.every((part, i) => part.toLowerCase() === parts[i]?.toLowerCase())
        )
          common.pop()
      }
      roots.clear()
      roots.set(common.join('/').toLowerCase(), {
        root: common.join('/'),
        anchor: values[0].anchor
      })
    }
    if (roots.size > 128) fail(`单元 ${unit.id} 目录候选超过 128 个`)
    let matchedUnits = 0
    for (const { root, anchor } of roots.values()) {
      const candidates = [...files, ...emptyDirectories].filter((file) =>
        under(file.relativePath, root)
      )
      const relative = (file) =>
        root ? file.relativePath.slice(root.length + 1) : file.relativePath
      let unitFacts = { values: {}, evidence: [] }
      if (unitEnabled && unit.facts) {
        const actualAnchor = sourceEntries.find((entry) => entry.relativePath === anchor)
        const tailCount = anchor.split('/').length - (root ? root.split('/').length : 0)
        let actualRoot = actualAnchor.fullPath
        for (let i = 0; i < tailCount; i++) actualRoot = path.dirname(actualRoot)
        const definitions = Object.fromEntries(
          Object.entries(unit.facts).map(([id, spec]) => {
            if (
              /^(?:[/\\]|[a-zA-Z]:)/.test(spec.path) ||
              spec.path.replace(/\\/g, '/').split('/').includes('..')
            )
              fail('单元事实不能越出单元目录')
            return [
              id,
              {
                ...spec,
                path: path
                  .relative(context.stagingPath, path.join(actualRoot, spec.path))
                  .replace(/\\/g, '/')
              }
            ]
          })
        )
        unitFacts = await readDeclarativeFacts(definitions, context)
        for (const entry of unitFacts.evidence)
          facts.evidence.push({ ...entry, id: `${unit.id}.${hash(root).slice(0, 12)}.${entry.id}` })
      }
      const active =
        unitEnabled && evaluateFactPredicate(unit.when, { ...facts.values, ...unitFacts.values })
      if (active) matchedUnits++
      if (active) {
        for (const companion of selector.companions || []) {
          if (
            !candidates.some((file) => file.type !== 'dir' && matches(relative(file), [companion]))
          )
            fail(`单元 ${unit.id} 缺少同目录配套文件 ${companion}`)
        }
      }
      const entries = candidates.filter(
        (file) =>
          matches(relative(file), selector.include || ['**']) &&
          !matches(relative(file), selector.exclude || [])
      )
      for (const file of candidates)
        if (matches(relative(file), selector.exclude || []))
          ignored.set(file.relativePath, `被单元 ${unit.id} 的 exclude 显式排除`)
      if (!active) {
        entries.forEach((file) =>
          ignored.set(
            file.relativePath,
            unit.component ? `未选择组件 ${unit.component}` : `单元 ${unit.id} 的环境条件未满足`
          )
        )
        continue
      }
      if (!entries.length) fail(`单元 ${unit.id} 没有可安装文件`)
      const generatedFiles = []
      const generatedKeys = new Set()
      for (const file of unit.ensure_files || []) {
        const relativePath = normalizeSafeRelativePath(file.path)
        if (generatedKeys.has(relativePath.toLowerCase())) fail('ensure_files 包含重复生成路径')
        generatedKeys.add(relativePath.toLowerCase())
        if (
          /[<>:"|?*]/.test(relativePath) ||
          relativePath.split('/').some((part) => /[. ]$/.test(part))
        )
          fail('生成文件名称不安全')
        const virtualPath = root ? `${root}/${relativePath}` : relativePath
        if (
          directories.some(
            (entry) => entry.relativePath.toLowerCase() === virtualPath.toLowerCase()
          )
        )
          fail('生成文件路径已存在同名目录')
        const existing = files.find(
          (entry) => entry.relativePath.toLowerCase() === virtualPath.toLowerCase()
        )
        if (existing) {
          if (!entries.includes(existing)) entries.push(existing)
          continue
        }
        const privateRoot = path.join(
          context.stagingPath,
          '__vertex_install_plan_v3__',
          `generated-${crypto.randomUUID()}`
        )
        if (!(await createPlanningPathChecker()(context.stagingPath, privateRoot)))
          fail('生成文件的私有目录越界')
        await fs.mkdir(privateRoot, { recursive: true })
        const fullPath = path.join(privateRoot, relativePath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, file.text, { encoding: 'utf8', flag: 'wx' })
        const entry = {
          relativePath: virtualPath,
          fullPath,
          name: path.basename(fullPath),
          type: 'file',
          size: Buffer.byteLength(file.text),
          generated: true
        }
        entries.push(entry)
        generatedEntries.push(entry)
        generatedFiles.push(relativePath)
      }
      const name = path.posix.basename(root) || context.packageFolderName || 'package'
      const identity = unit.identity_fact ? unitFacts.values[unit.identity_fact] : null
      if (
        unit.identity_fact &&
        (!identity?.known ||
          !['string', 'number'].includes(typeof identity.value) ||
          !String(identity.value))
      )
        fail(`单元 ${unit.id} 的稳定身份无法确定`)
      const id = `${unit.id}:${identity ? identity.value : name}`
      if (units.some((entry) => entry.id.toLowerCase() === id.toLowerCase()))
        fail(`单元 ${unit.id} 的稳定身份重复`)
      const target = substituteUnit(unit.target, {
        name,
        root,
        anchor,
        identity: identity?.value ?? name
      })
      const bindings = { name, root, anchor, identity: identity?.value ?? name }
      const unitDependencies = substituteUnit(unit.dependencies || [], bindings)
      dependencies.push(...unitDependencies)
      for (const provided of unit.provides || []) {
        const version = provided.version_fact ? unitFacts.values[provided.version_fact] : null
        if (
          provided.version_fact &&
          (!version?.known || !['string', 'number'].includes(typeof version.value))
        )
          fail(`单元 ${unit.id} 的能力版本无法确定`)
        providedCapabilities.push({
          id: substituteUnit(provided.id, bindings),
          version: version ? String(version.value) : ''
        })
      }
      if (unit.preserve_container)
        target.path = [target.path === '.' ? '' : target.path, name].filter(Boolean).join('/')
      const paths = entries.map((file) => file.relativePath)
      if (paths.some((file) => claimed.has(file.toLowerCase())))
        fail(`单元 ${unit.id} 与其他单元重复认领文件`)
      paths.forEach((file) => claimed.add(file.toLowerCase()))
      routes.push({
        id,
        source: { paths },
        target,
        conflict_policy: unit.conflict_policy,
        health_expectations: unit.health_expectations,
        mapping: { strip_prefix: root },
        ...(unit.group ? { group: unit.group } : {})
      })
      units.push({
        id,
        root,
        anchor,
        role: unit.role || '',
        component: unit.component || '',
        fileCount: entries.filter((entry) => entry.type !== 'dir').length,
        target,
        dependencies: unitDependencies,
        generatedFiles
      })
      if (routes.length > 256) fail('展开后的安装路由超过 256 条')
    }
    if (unitEnabled && (matchedUnits < (selector.min ?? 1) || matchedUnits > (selector.max ?? 128)))
      fail(`单元 ${unit.id} 匹配数量 ${matchedUnits} 不符合基数约束`)
  }
  for (const ignoredRule of declaration.ignore || []) {
    ;[...files, ...directories]
      .filter((file) => matches(file.relativePath, [ignoredRule.pattern]))
      .forEach((file) => ignored.set(file.relativePath, ignoredRule.reason))
  }
  for (const file of files)
    if (claimed.has(file.relativePath.toLowerCase())) ignored.delete(file.relativePath)
  if (!routes.length) fail('当前组件选择没有生成安装路由')
  return {
    rule: { ...rule, routes, dependencies },
    providedCapabilities,
    snapshot: { ...snapshot, allFiles: [...snapshot.allFiles, ...generatedEntries] },
    matched: true,
    ignored: [...ignored].map(([sourceRelativePath, reason]) => ({ sourceRelativePath, reason })),
    replay: {
      version: 1,
      binding,
      selected,
      units,
      facts: facts.evidence,
      context: captureDeclarativeContext(context),
      providedCapabilities,
      dependencyCapabilities: dependencies.length ? context.installedCapabilities || {} : undefined,
      nestedArchives: nested.archives,
      config: (declaration.config || []).filter(
        (patch) => !patch.component || selected.includes(patch.component)
      )
    }
  }
}
