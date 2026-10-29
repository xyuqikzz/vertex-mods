import path from 'node:path'
import crypto from 'node:crypto'
import { parseBoundedXml } from './boundedXml.js'
import { isRouteSourcePathMatched } from './pathMapper.js'
import {
  readDeclarativeFacts,
  evaluateFactPredicate,
  captureDeclarativeContext
} from './declarativeFacts.js'
import { normalizeSafeRelativePath } from './pathSafety.js'
import { resolveRouteTargetLocation } from './targetResolver.js'
import { InstallEngineError } from './installEngineError.js'

const fail = (message) => {
  throw new InstallEngineError('install_engine.fomod_invalid', message)
}
const child = (node, name) => node?.children.find((entry) => entry.name === name)
const children = (node, name) => node?.children.filter((entry) => entry.name === name) || []
const attributes = {
  config: ['xmlns:xsi', 'xsi:noNamespaceSchemaLocation'],
  moduleName: ['position', 'colour'],
  moduleImage: ['path', 'showImage', 'showFade', 'height'],
  moduleDependencies: ['operator'],
  dependencies: ['operator'],
  visible: ['operator'],
  fileDependency: ['file', 'state'],
  flagDependency: ['flag', 'value'],
  gameDependency: ['version'],
  fommDependency: ['version'],
  foseDependency: ['version'],
  skseDependency: ['version'],
  nvseDependency: ['version'],
  f4seDependency: ['version'],
  requiredInstallFiles: [],
  file: ['source', 'destination', 'alwaysInstall', 'installIfUsable', 'priority'],
  folder: ['source', 'destination', 'alwaysInstall', 'installIfUsable', 'priority'],
  installSteps: ['order'],
  installStep: ['name'],
  optionalFileGroups: ['order'],
  group: ['name', 'type'],
  plugins: ['order'],
  plugin: ['name'],
  description: [],
  image: ['path'],
  files: [],
  typeDescriptor: [],
  type: ['name'],
  dependencyType: [],
  defaultType: ['name'],
  patterns: [],
  pattern: [],
  conditionFlags: [],
  flag: ['name'],
  conditionalFileInstalls: []
}
const dependencyTags = [
  'dependencies',
  'fileDependency',
  'flagDependency',
  'gameDependency',
  'fommDependency',
  'foseDependency',
  'skseDependency',
  'nvseDependency',
  'f4seDependency'
]
const structure = {
  config: [
    'moduleName',
    'moduleImage',
    'moduleDependencies',
    'requiredInstallFiles',
    'installSteps',
    'conditionalFileInstalls'
  ],
  moduleDependencies: dependencyTags,
  dependencies: dependencyTags,
  visible: dependencyTags,
  requiredInstallFiles: ['file', 'folder'],
  files: ['file', 'folder'],
  installSteps: ['installStep'],
  installStep: ['visible', 'optionalFileGroups'],
  optionalFileGroups: ['group'],
  group: ['plugins'],
  plugins: ['plugin'],
  plugin: ['description', 'image', 'files', 'typeDescriptor', 'conditionFlags'],
  typeDescriptor: ['type', 'dependencyType'],
  dependencyType: ['defaultType', 'patterns'],
  patterns: ['pattern'],
  pattern: ['dependencies', 'type', 'files'],
  conditionFlags: ['flag'],
  conditionalFileInstalls: ['patterns']
}
const bool = (value) => {
  if (value === undefined || value === 'false' || value === '0') return false
  if (value === 'true' || value === '1') return true
  fail('FOMOD 布尔属性无效')
}
function validateTree(node, patternKind = '') {
  if (!Object.hasOwn(attributes, node.name)) fail(`不支持 FOMOD 节点 ${node.name}`)
  for (const key of Object.keys(node.attributes))
    if (!attributes[node.name].includes(key)) fail(`不支持 FOMOD 属性 ${node.name}.${key}`)
  const repeated = new Set([
    'dependencies',
    'visible',
    'moduleDependencies',
    'files',
    'requiredInstallFiles',
    'installSteps',
    'optionalFileGroups',
    'plugins',
    'patterns',
    'conditionFlags'
  ])
  if (
    !repeated.has(node.name) &&
    new Set(node.children.map((entry) => entry.name)).size !== node.children.length
  )
    fail(`FOMOD ${node.name} 包含重复单例节点`)
  const requiredChildren =
    {
      config: ['moduleName'],
      plugin: ['typeDescriptor'],
      group: ['plugins'],
      installStep: ['optionalFileGroups'],
      dependencyType: ['defaultType', 'patterns'],
      conditionalFileInstalls: ['patterns'],
      pattern: ['dependencies']
    }[node.name] || []
  if (requiredChildren.some((name) => !child(node, name))) fail(`FOMOD ${node.name} 缺少必要子节点`)
  if (node.name === 'typeDescriptor' && node.children.length !== 1)
    fail('FOMOD typeDescriptor 必须且只能指定一种类型描述')
  if (node.name === 'pattern' && !!child(node, 'files') === !!child(node, 'type'))
    fail('FOMOD pattern 必须指定文件或类型')
  if (node.name === 'pattern' && patternKind && !child(node, patternKind))
    fail('FOMOD 模式类型与父级声明不一致')
  if (['group', 'plugin', 'installStep', 'flag'].includes(node.name) && !node.attributes.name)
    fail(`FOMOD ${node.name} 缺少 name`)
  if (['file', 'folder'].includes(node.name) && !node.attributes.source)
    fail('FOMOD 文件源不能为空')
  if (
    node.name === 'fileDependency' &&
    (!node.attributes.file || !['Active', 'Inactive', 'Missing'].includes(node.attributes.state))
  )
    fail('FOMOD 文件依赖无效')
  if (
    node.name === 'flagDependency' &&
    (!node.attributes.flag || node.attributes.value === undefined)
  )
    fail('FOMOD 标记依赖无效')
  for (const key of ['alwaysInstall', 'installIfUsable'])
    if (node.attributes[key] !== undefined) bool(node.attributes[key])
  if (!['moduleName', 'description', 'flag'].includes(node.name) && node.text.trim())
    fail(`FOMOD ${node.name} 含有不支持的文本`)
  for (const entry of node.children) {
    if (!(structure[node.name] || []).includes(entry.name))
      fail(`FOMOD ${node.name} 下不能包含 ${entry.name}`)
    validateTree(
      entry,
      node.name === 'dependencyType'
        ? 'type'
        : node.name === 'conditionalFileInstalls'
          ? 'files'
          : patternKind
    )
  }
  for (const key of ['source', 'file', 'path']) {
    if (node.attributes[key] !== undefined && node.attributes[key] !== '')
      normalizeSafeRelativePath(node.attributes[key].replace(/\\/g, '/'))
  }
  if (node.attributes.destination)
    normalizeSafeRelativePath(node.attributes.destination.replace(/\\/g, '/'))
}
function ordered(node, name) {
  const items = children(node, name)
  const order = node?.attributes.order || 'Ascending'
  if (!['Explicit', 'Ascending', 'Descending'].includes(order)) fail('FOMOD order 无效')
  if (order === 'Explicit') return items
  return [...items].sort(
    (a, b) =>
      (a.attributes.name || '').localeCompare(b.attributes.name || '', 'en') *
      (order === 'Descending' ? -1 : 1)
  )
}
function versionAtLeast(actual, expected) {
  if (!/^\d+(?:\.\d+){0,7}$/.test(String(actual)) || !/^\d+(?:\.\d+){0,7}$/.test(expected))
    fail('FOMOD 版本事实必须为明确的数字点分版本')
  const a = String(actual).split('.').map(Number)
  const b = expected.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return true
}

export async function prepareFomodRule(rule, snapshot, context, resolveComponents) {
  const spec = rule.declarative.fomod
  const files = (snapshot.allFiles || []).filter((entry) => !/^__vertex_/i.test(entry.relativePath))
  const directories = (snapshot.allDirs || []).filter(
    (entry) => !/^__vertex_/i.test(entry.relativePath)
  )
  const nonEmpty = new Set(
    [...files, ...directories].map((entry) => path.posix.dirname(entry.relativePath).toLowerCase())
  )
  const emptyDirectories = directories.filter(
    (entry) => !nonEmpty.has(entry.relativePath.toLowerCase())
  )
  const configs = files.filter((file) => isRouteSourcePathMatched(file.relativePath, [spec.config]))
  if (configs.length !== 1) fail(`FOMOD 配置必须唯一，当前找到 ${configs.length} 个`)
  const configPath = configs[0].relativePath
  if (!/\/fomod\/ModuleConfig\.xml$/i.test(`/${configPath}`))
    fail('FOMOD 配置必须位于 fomod/ModuleConfig.xml')
  const root = path.posix.dirname(path.posix.dirname(configPath))
  const packagePrefix = root === '.' ? '' : root
  const definitions = { ...(rule.declarative.facts || {}) }
  if (Object.keys(definitions).some((id) => id.startsWith('fomod_')))
    fail('fomod_ 为内部事实标识前缀')
  definitions.fomod_config = { base: 'package', path: configPath, read: 'fomod_xml' }
  const initial = await readDeclarativeFacts(definitions, context)
  if (!evaluateFactPredicate(rule.declarative.when, initial.values)) return { matched: false }
  const tree = parseBoundedXml(initial.values.fomod_config.value)
  if (tree.name !== 'config') fail('FOMOD 根节点必须为 config')
  if (
    tree.attributes['xsi:noNamespaceSchemaLocation'] &&
    !/5[._]0\.xsd$/i.test(tree.attributes['xsi:noNamespaceSchemaLocation'])
  )
    fail('仅支持声明式 FOMOD XML 5.0')
  validateTree(tree)
  const target = await resolveRouteTargetLocation({ target: spec.target }, context)
  const dependencyIds = new Map()
  const gather = (node) => {
    if (node.name === 'fileDependency') {
      if (target.targetBaseType !== 'game') fail('FOMOD 文件依赖当前要求 game 目标边界')
      if (!spec.file_state) fail('存在文件依赖时，规则必须明确 file_state 语义')
      const relative = normalizeSafeRelativePath(
        [target.targetRelativePath === '.' ? '' : target.targetRelativePath, node.attributes.file]
          .filter(Boolean)
          .join('/')
      )
      const id = `fomod_file_${dependencyIds.size}`
      dependencyIds.set(node, id)
      definitions[id] = { base: 'game', path: relative, read: 'file_exists' }
    }
    node.children.forEach(gather)
  }
  gather(tree)
  if (Object.keys(definitions).length > 256) fail('FOMOD 文件依赖超过预算')
  const facts = await readDeclarativeFacts(definitions, context)
  const flags = Object.create(null)
  const dependency = (node) => {
    if (!node) return true
    if (['dependencies', 'moduleDependencies', 'visible'].includes(node.name)) {
      const results = node.children.map(dependency)
      const op = node.attributes.operator || 'And'
      if (!['And', 'Or'].includes(op)) fail('FOMOD 依赖逻辑操作无效')
      return op === 'And' ? results.every(Boolean) : results.some(Boolean)
    }
    if (node.name === 'flagDependency')
      return (
        Object.hasOwn(flags, node.attributes.flag) &&
        flags[node.attributes.flag] === node.attributes.value
      )
    if (node.name === 'fileDependency') {
      const exists = facts.values[dependencyIds.get(node)].value
      let active = exists
      if (spec.file_state === 'plugin_list') {
        const list = facts.values[spec.active_plugins_fact]
        if (!list?.known || typeof list.value !== 'string') fail('FOMOD 缺少已启用插件列表事实')
        active =
          exists &&
          list.value
            .split(/\r?\n/)
            .some(
              (line) =>
                line.trim().replace(/^\*/, '').toLowerCase() === node.attributes.file.toLowerCase()
            )
      }
      const state = !exists ? 'Missing' : active ? 'Active' : 'Inactive'
      if (!['Missing', 'Active', 'Inactive'].includes(node.attributes.state))
        fail('FOMOD 文件依赖状态无效')
      return state === node.attributes.state
    }
    const versionId = spec.version_facts?.[node.name]
    const version = facts.values[versionId]
    if (!version?.known) fail(`FOMOD 缺少 ${node.name} 的版本事实映射`)
    return versionAtLeast(version.value, node.attributes.version)
  }
  if (!dependency(child(tree, 'moduleDependencies'))) fail('FOMOD 必要依赖未满足')
  const binding = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        rule,
        evidence: facts.evidence,
        files: files.map((file) => [file.relativePath, file.size]),
        gameRoot: path.resolve(context.gameRoot)
      })
    )
    .digest('hex')
  const groups = []
  const plugins = []
  const submitted = context.data?.installChoices
  for (const [si, step] of ordered(child(tree, 'installSteps'), 'installStep').entries()) {
    const visible = dependency(child(step, 'visible'))
    const stepFlags = []
    for (const [gi, group] of ordered(child(step, 'optionalFileGroups'), 'group').entries()) {
      const entries = ordered(child(group, 'plugins'), 'plugin')
      const bounds = {
        SelectAny: [0, entries.length],
        SelectAll: [entries.length, entries.length],
        SelectExactlyOne: [1, 1],
        SelectAtMostOne: [0, 1],
        SelectAtLeastOne: [1, entries.length]
      }[group.attributes.type]
      if (!bounds || !entries.length) fail('FOMOD 组件组类型无效或为空')
      const options = entries.map((plugin, pi) => {
        const descriptor = child(plugin, 'typeDescriptor')
        let type = child(descriptor, 'type')?.attributes.name
        const dynamic = child(descriptor, 'dependencyType')
        if (dynamic) {
          type = child(dynamic, 'defaultType')?.attributes.name
          for (const pattern of children(child(dynamic, 'patterns'), 'pattern')) {
            if (dependency(child(pattern, 'dependencies'))) {
              type = child(pattern, 'type')?.attributes.name
              break
            }
          }
        }
        if (!['Required', 'Optional', 'Recommended', 'NotUsable', 'CouldBeUsable'].includes(type))
          fail('FOMOD 插件类型缺失或无效')
        const id = `fomod-${si}-${gi}-${pi}`
        const available = visible && !['NotUsable', 'CouldBeUsable'].includes(type)
        const required = visible && (type === 'Required' || group.attributes.type === 'SelectAll')
        const selected =
          available &&
          (required || (submitted ? submitted.selected?.includes(id) : type === 'Recommended'))
        if (selected) stepFlags.push(...children(child(plugin, 'conditionFlags'), 'flag'))
        plugins.push({ id, node: plugin, type, visible, available })
        return {
          id,
          label: plugin.attributes.name || id,
          description: child(plugin, 'description')?.text.trim() || '',
          required,
          default: type === 'Recommended',
          when: { fact: `${id}-available`, equals: true }
        }
      })
      groups.push({
        id: `fomod-${si}-${gi}`,
        label: `${step.attributes.name || ''} · ${group.attributes.name || ''}`,
        min: visible ? bounds[0] : 0,
        max: visible ? bounds[1] : 0,
        options
      })
    }
    for (const flag of stepFlags) flags[flag.attributes.name] = flag.text.trim()
  }
  if (groups.length > 32 || plugins.length > 128) fail('FOMOD 组件数量超过预算')
  const componentFacts = Object.fromEntries(
    plugins.map((plugin) => [`${plugin.id}-available`, { known: true, value: plugin.available }])
  )
  const selected = resolveComponents(groups, componentFacts, submitted, binding)
  const mappings = []
  const ignored = new Map()
  const addFiles = (node, enabled, usable = true) => {
    for (const item of node?.children || []) {
      const source = normalizeSafeRelativePath(
        [packagePrefix, item.attributes.source].filter(Boolean).join('/')
      )
      const isFolder = item.name === 'folder'
      const candidates = (isFolder ? [...files, ...emptyDirectories] : files).filter((file) =>
        isFolder
          ? file.relativePath.toLowerCase() === source.toLowerCase() ||
            file.relativePath.toLowerCase().startsWith(`${source.toLowerCase()}/`)
          : file.relativePath.toLowerCase() === source.toLowerCase()
      )
      const install =
        enabled ||
        bool(item.attributes.alwaysInstall) ||
        (usable && bool(item.attributes.installIfUsable))
      if (install && !candidates.length) fail(`FOMOD 引用的源文件不存在：${item.attributes.source}`)
      let destination = item.attributes.destination ?? item.attributes.source
      destination = destination.replace(/\\/g, '/').replace(/\/+$/, '')
      const priority = Number(item.attributes.priority || 0)
      if (!Number.isSafeInteger(priority)) fail('FOMOD 文件优先级无效')
      for (const file of candidates) {
        if (!install) {
          ignored.set(file.relativePath, '未选择的 FOMOD 组件或未满足的条件')
          continue
        }
        const suffix = isFolder ? file.relativePath.slice(source.length + 1) : ''
        if (file.type === 'dir' && !suffix && !destination) {
          ignored.set(file.relativePath, '空源根目录由安装目标目录承载')
          continue
        }
        const fileDestination = /[/\\]$/.test(item.attributes.destination || '')
          ? `${destination}/${path.posix.basename(source)}`
          : destination || path.posix.basename(source)
        const dest = normalizeSafeRelativePath(
          isFolder ? [destination, suffix].filter(Boolean).join('/') : fileDestination
        )
        mappings.push({ source: file.relativePath, destination: dest, priority, kind: file.type })
        if (mappings.length > 50000) fail('FOMOD 文件映射超过预算')
      }
    }
  }
  addFiles(child(tree, 'requiredInstallFiles'), true)
  for (const plugin of plugins)
    addFiles(child(plugin.node, 'files'), selected.includes(plugin.id), plugin.available)
  for (const pattern of children(
    child(child(tree, 'conditionalFileInstalls'), 'patterns'),
    'pattern'
  ))
    addFiles(child(pattern, 'files'), dependency(child(pattern, 'dependencies')))
  const destinations = new Map()
  for (const mapping of mappings) {
    const key = mapping.destination.toLowerCase()
    const previous = destinations.get(key)
    if (
      previous &&
      previous.source !== mapping.source &&
      previous.priority === mapping.priority &&
      !(previous.kind === 'dir' && mapping.kind === 'dir')
    )
      fail(`FOMOD 同优先级文件冲突：${mapping.destination}`)
    if (!previous || previous.priority < mapping.priority) destinations.set(key, mapping)
  }
  const winningSources = new Set([...destinations.values()].map((item) => item.source))
  for (const mapping of mappings)
    if (!winningSources.has(mapping.source))
      ignored.set(mapping.source, '由更高优先级 FOMOD 文件替代')
  ;[...files, ...emptyDirectories]
    .filter((file) =>
      file.relativePath
        .toLowerCase()
        .startsWith(`${packagePrefix ? packagePrefix + '/' : ''}fomod/`.toLowerCase())
    )
    .forEach((file) => ignored.set(file.relativePath, 'FOMOD 安装描述和展示资源'))
  for (const source of winningSources) ignored.delete(source)
  for (const item of rule.declarative.ignore || []) {
    for (const file of [...files, ...directories])
      if (
        !winningSources.has(file.relativePath) &&
        isRouteSourcePathMatched(file.relativePath, [item.pattern])
      )
        ignored.set(file.relativePath, item.reason)
  }
  const routes = [...destinations.values()].map((mapping, i) => ({
    id: `fomod-file-${i}`,
    source: { paths: [mapping.source] },
    target: spec.target,
    mapping: { replace_prefix: { from: mapping.source, to: mapping.destination } }
  }))
  if (!routes.length) fail('FOMOD 当前选择没有可安装文件')
  return {
    matched: true,
    rule: { ...rule, routes },
    ignored: [...ignored].map(([sourceRelativePath, reason]) => ({ sourceRelativePath, reason })),
    replay: {
      version: 1,
      binding,
      selected,
      facts: facts.evidence,
      context: captureDeclarativeContext(context),
      config: (rule.declarative.config || []).filter(
        (patch) => !patch.component || selected.includes(patch.component)
      ),
      fomod: { configPath, format: '5.0' }
    }
  }
}
