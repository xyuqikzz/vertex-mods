// Versioned, JSON-only extensions. Kept independent of Node for editor/runtime parity.
export const INSTALL_RULE_ENGINE_VERSION = '3.1.0'
export const INSTALL_RULE_CAPABILITIES = Object.freeze({
  'templates.v1': 1,
  'facts.v1': 1,
  'units.v1': 1,
  'components.v1': 1,
  'fomod.xml5.v1': 1,
  'nested.zip.v1': 1,
  'config.fields.v1': 1,
  'mapping.exact.v1': 1
})

export const INSTALL_RULE_TARGET_BASES = Object.freeze({
  game: ['game', 'game_root', 'gameroot', 'game_relative'],
  download: ['download', 'download_root', 'downloadroot', 'download_relative'],
  local_appdata: ['local_appdata', 'localappdata', 'local_app_data', 'local_appdata_root', 'localappdata_root', 'user_local_appdata', 'userlocalappdata', '%localappdata%'],
  roaming_appdata: ['roaming_appdata', 'roamingappdata', 'roaming_app_data', 'roaming_appdata_root', 'roamingappdata_root', 'appdata', 'user_appdata', 'userappdata', '%appdata%']
})

export function resolveInstallRuleTargetBase(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return Object.entries(INSTALL_RULE_TARGET_BASES).find(([, aliases]) => aliases.includes(text))?.[0]
}

function validateDeclarationTarget(target, path) {
  if (!object(target)) bad(path, '必须指定 target 对象')
  for (const field of ['base', 'base_type', 'baseType', 'scope', 'scope_type', 'scopeType', 'user_scope', 'userScope']) {
    if (target[field] !== undefined && !resolveInstallRuleTargetBase(target[field])) bad(`${path}.${field}`, '不支持的安装目标基准')
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const bad = (path, message) => {
  const error = new Error(`${path}: ${message}`)
  error.code = 'install_engine.declaration_invalid'
  error.detail = { path }
  throw error
}
export function declarationFields(value, allowed, path) {
  if (!object(value)) bad(path, '必须为对象')
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) bad(`${path}.${key}`, '不支持的字段')
  }
}
export function declarationList(value, path, max = 128) {
  if (!Array.isArray(value) || value.length > max) bad(path, `必须为不超过 ${max} 项的数组`)
  return value
}
export function declarationId(value, path) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) {
    bad(path, '标识必须为 1–128 个字母、数字、点、下划线或连字符')
  }
  return value
}
export function validateFactPredicate(node, path = 'when', depth = 0) {
  if (depth > 16) bad(path, '条件嵌套超过 16 层')
  declarationFields(
    node,
    [
      'all',
      'any',
      'not',
      'fact',
      'equals',
      'one_of',
      'exists',
      'contains',
      'min',
      'max',
      'version'
    ],
    path
  )
  const operators = ['all', 'any', 'not', 'fact'].filter((key) => key in node)
  if (operators.length !== 1) bad(path, '每个条件必须且只能声明一个逻辑操作或 fact')
  if ('all' in node || 'any' in node) {
    const key = operators[0]
    if (Object.keys(node).length !== 1) bad(path, '逻辑条件不能混用比较字段')
    const children = declarationList(node[key], `${path}.${key}`, 64)
    if (!children.length) bad(path, '条件数组不能为空')
    children.forEach((item, i) => validateFactPredicate(item, `${path}.${key}[${i}]`, depth + 1))
  } else if ('not' in node) {
    if (Object.keys(node).length !== 1) bad(path, 'not 不能混用比较字段')
    validateFactPredicate(node.not, `${path}.not`, depth + 1)
  } else {
    declarationId(node.fact, `${path}.fact`)
    const comparisons = ['equals', 'one_of', 'exists', 'contains', 'version', 'min'].filter(
      (key) => key in node
    )
    if ('max' in node && !('min' in node)) comparisons.push('max')
    if (comparisons.length !== 1) bad(path, 'fact 必须有且只有一个比较操作（min/max 可组合）')
    if ('one_of' in node) declarationList(node.one_of, `${path}.one_of`, 64)
    if ('exists' in node && typeof node.exists !== 'boolean') bad(path, 'exists 必须为布尔值')
    for (const key of ['min', 'max'])
      if (key in node && !Number.isFinite(node[key])) bad(path, '数量边界必须为有限数字')
    if ('version' in node) {
      declarationFields(
        node.version,
        ['min', 'max', 'include_min', 'include_max'],
        `${path}.version`
      )
      if (!node.version.min && !node.version.max) bad(path, '版本条件必须指定 min/max')
      for (const key of ['min', 'max'])
        if (
          node.version[key] !== undefined &&
          !/^\d+(?:\.\d+){0,7}(?:-[a-zA-Z0-9.-]+)?$/.test(node.version[key])
        )
          bad(path, '版本必须为点分数字及可选预发布标识')
      for (const key of ['include_min', 'include_max'])
        if (node.version[key] !== undefined && typeof node.version[key] !== 'boolean')
          bad(path, '版本边界包含标志必须为布尔值')
    }
  }
}
export function validateDeclarativeRule(value, path = 'declarative') {
  declarationFields(
    value,
    ['facts', 'when', 'units', 'components', 'ignore', 'fomod', 'nested_archives', 'config'],
    path
  )
  if (value.config !== undefined) {
    for (const patch of declarationList(value.config, `${path}.config`, 32)) {
      declarationFields(patch, ['path', 'base', 'format', 'changes', 'component'], `${path}.config`)
      if (
        patch.base !== undefined &&
        !['game', 'local_appdata', 'roaming_appdata'].includes(patch.base)
      )
        bad(path, '配置 base 必须为 game/local_appdata/roaming_appdata')
      if (
        typeof patch.path !== 'string' ||
        !patch.path ||
        !['json', 'ini', 'lines'].includes(patch.format)
      )
        bad(path, '配置修改必须指定游戏相对路径和 json/ini/lines 格式')
      for (const change of declarationList(patch.changes, `${path}.config.changes`, 128)) {
        declarationFields(
          change,
          ['pointer', 'section', 'key', 'line', 'value', 'remove', 'present', 'expected'],
          `${path}.config.changes`
        )
        if (patch.format !== 'lines' && change.remove !== true && !Object.hasOwn(change, 'value'))
          bad(path, '配置修改必须提供 value 或 remove=true')
        if (patch.format === 'lines' && typeof change.line !== 'string')
          bad(path, 'lines 修改必须提供 line')
        if (
          patch.format === 'ini' &&
          change.value !== undefined &&
          !['string', 'number', 'boolean'].includes(typeof change.value)
        )
          bad(path, 'INI value 必须为标量')
        for (const key of ['remove', 'present'])
          if (change[key] !== undefined && typeof change[key] !== 'boolean')
            bad(path, `${key} 必须为布尔值`)
      }
    }
  }
  if (value.nested_archives !== undefined) {
    const spec = value.nested_archives
    declarationFields(
      spec,
      ['include', 'max_depth', 'max_entries', 'max_bytes'],
      `${path}.nested_archives`
    )
    if (
      !declarationList(spec.include, `${path}.nested_archives.include`, 32).length ||
      spec.include.some(
        (pattern) => typeof pattern !== 'string' || !pattern || pattern.length > 512
      )
    )
      bad(path, '嵌套包必须指定有限 include 模式')
    for (const [key, max] of [
      ['max_depth', 3],
      ['max_entries', 10000],
      ['max_bytes', 512 * 1024 * 1024]
    ]) {
      if (
        spec[key] !== undefined &&
        (!Number.isInteger(spec[key]) || spec[key] < 1 || spec[key] > max)
      )
        bad(path, `${key} 超出安全预算`)
    }
    if (value.fomod) bad(path, 'FOMOD 配置和数据应先位于同一包层级，不能同时隐式展开嵌套包')
  }
  if (value.fomod !== undefined) {
    declarationFields(
      value.fomod,
      ['config', 'target', 'file_state', 'active_plugins_fact', 'version_facts'],
      `${path}.fomod`
    )
    if (
      typeof value.fomod.config !== 'string' ||
      !value.fomod.config ||
      !object(value.fomod.target)
    )
      bad(path, 'FOMOD 必须指定 config glob 和 target')
    validateDeclarationTarget(value.fomod.target, `${path}.fomod.target`)
    if (
      value.fomod.file_state !== undefined &&
      !['deployed', 'plugin_list'].includes(value.fomod.file_state)
    )
      bad(path, 'file_state 必须为 deployed/plugin_list')
    if (value.fomod.version_facts !== undefined && !object(value.fomod.version_facts))
      bad(path, 'version_facts 必须为对象')
    if (value.units?.length || value.components?.length)
      bad(path, 'FOMOD 自带安装单元和组件，不能同时手写 units/components')
  }
  const facts = value.facts || {}
  if (!object(facts) || Object.keys(facts).length > 64) bad(`${path}.facts`, '最多支持 64 个事实')
  for (const [id, fact] of Object.entries(facts)) {
    declarationId(id, `${path}.facts.${id}`)
    declarationFields(
      fact,
      ['base', 'path', 'read', 'pointer', 'section', 'key', 'optional'],
      `${path}.facts.${id}`
    )
    if (!['game', 'package', 'context', 'local_appdata', 'roaming_appdata'].includes(fact.base))
      bad(path, 'fact.base 必须为 game/package/context/local_appdata/roaming_appdata')
    if (
      !['exists', 'file_exists', 'dir_exists', 'json', 'ini', 'text', 'pe_arch', 'value'].includes(
        fact.read
      )
    )
      bad(path, '不支持的事实读取方式')
    if (
      fact.base === 'context' &&
      (fact.read !== 'value' ||
        ![
          'platform',
          'arch',
          'source',
          'game_id',
          'domain',
          'endpoint',
          'profile',
          'store',
          'game_version',
          'runtime',
          'installed_capabilities'
        ].includes(fact.key))
    )
      bad(path, 'context.key 不是受支持的上下文事实')
    if (fact.base !== 'context' && (typeof fact.path !== 'string' || !fact.path))
      bad(path, '文件事实必须指定 path')
    if (fact.read === 'value' && fact.base !== 'context') bad(path, 'value 仅适用于 context')
    if (
      fact.pointer !== undefined &&
      (fact.read !== 'json' ||
        typeof fact.pointer !== 'string' ||
        (fact.pointer !== '' && !fact.pointer.startsWith('/')))
    )
      bad(path, 'pointer 仅用于 JSON，必须为 JSON Pointer 字符串')
    if (fact.read === 'ini' && (typeof fact.key !== 'string' || !fact.key))
      bad(path, 'INI 事实必须提供 key')
    if (fact.section !== undefined && (fact.read !== 'ini' || typeof fact.section !== 'string'))
      bad(path, 'section 仅用于 INI')
    if (fact.key !== undefined && !['ini', 'value'].includes(fact.read))
      bad(path, 'key 仅用于 INI/context')
    if (fact.optional !== undefined && typeof fact.optional !== 'boolean')
      bad(path, 'optional 必须为布尔值')
  }
  if (value.when) validateFactPredicate(value.when, `${path}.when`)
  const ids = new Set()
  for (const [i, unit] of declarationList(value.units || [], `${path}.units`).entries()) {
    const p = `${path}.units[${i}]`
    declarationFields(
      unit,
      [
        'id',
        'selector',
        'target',
        'preserve_container',
        'when',
        'component',
        'group',
        'facts',
        'identity_fact',
        'role',
        'dependencies',
        'provides',
        'ensure_files'
        , 'conflict_policy', 'health_expectations'
      ],
      p
    )
    if (unit.ensure_files !== undefined) {
      for (const file of declarationList(unit.ensure_files, `${p}.ensure_files`, 32)) {
        declarationFields(file, ['path', 'text'], `${p}.ensure_files`)
        if (
          typeof file.path !== 'string' ||
          !file.path ||
          typeof file.text !== 'string' ||
          new TextEncoder().encode(file.text).length > 65536
        )
          bad(p, 'ensure_files 必须指定 path/text，文本最多 64 KiB')
      }
    }
    if (unit.dependencies !== undefined) {
      for (const dependency of declarationList(unit.dependencies, `${p}.dependencies`, 64)) {
        declarationFields(
          dependency,
          ['id', 'kind', 'version_range', 'alternatives'],
          `${p}.dependencies`
        )
        if (typeof dependency.id !== 'string' || !dependency.id.includes(':'))
          bad(p, '单元依赖必须使用有命名空间的 id，例如 nexus:123 或 smapi:作者.模组')
        if (
          dependency.kind !== undefined &&
          !['required', 'optional', 'conflict'].includes(dependency.kind)
        )
          bad(p, '依赖 kind 无效')
        if (
          dependency.version_range !== undefined &&
          !/^(?:>=|<=|>|<|=|\^|~)?\s*v?\d+(?:\.\d+){0,3}(?:-[a-zA-Z0-9.-]+)?$/.test(
            dependency.version_range
          )
        )
          bad(p, 'version_range 必须为单个明确版本比较式')
        if (
          dependency.alternatives !== undefined &&
          declarationList(dependency.alternatives, `${p}.alternatives`, 16).some(
            (id) => typeof id !== 'string' || !id.includes(':')
          )
        )
          bad(p, '替代依赖必须使用有命名空间的 id')
      }
    }
    if (unit.provides !== undefined) {
      for (const provided of declarationList(unit.provides, `${p}.provides`, 32)) {
        declarationFields(provided, ['id', 'version_fact'], `${p}.provides`)
        if (typeof provided.id !== 'string' || !provided.id.includes(':'))
          bad(p, '提供能力必须使用有命名空间的 id')
        if (provided.version_fact && !Object.hasOwn(unit.facts || {}, provided.version_fact))
          bad(p, 'version_fact 必须引用本单元事实')
      }
    }
    declarationId(unit.id, `${p}.id`)
    if (ids.has(unit.id)) bad(p, '安装单元 ID 重复')
    ids.add(unit.id)
    declarationFields(
      unit.selector,
      [
        'anchor',
        'kind',
        'parent',
        'common_ancestor',
        'max_depth',
        'include',
        'exclude',
        'companions',
        'min',
        'max'
      ],
      `${p}.selector`
    )
    if (unit.selector.kind !== undefined && !['file', 'directory'].includes(unit.selector.kind))
      bad(p, 'selector.kind 必须为 file/directory')
    if (
      unit.selector.common_ancestor !== undefined &&
      typeof unit.selector.common_ancestor !== 'boolean'
    )
      bad(p, 'common_ancestor 必须为布尔值')
    if (
      unit.selector.max_depth !== undefined &&
      (!Number.isInteger(unit.selector.max_depth) ||
        unit.selector.max_depth < 0 ||
        unit.selector.max_depth > 80)
    )
      bad(p, 'max_depth 必须为 0–80')
    if (unit.facts !== undefined) {
      validateDeclarativeRule({ facts: unit.facts }, `${p}.facts`)
      if (Object.values(unit.facts).some((fact) => fact.base !== 'package'))
        bad(p, '单元事实必须使用 package 基准，相对于单元根目录')
    }
    if (unit.identity_fact !== undefined && !Object.hasOwn(unit.facts || {}, unit.identity_fact))
      bad(p, 'identity_fact 必须引用本单元事实')
    if (typeof unit.selector.anchor !== 'string' || !unit.selector.anchor)
      bad(p, 'selector.anchor 必填')
    for (const key of ['parent', 'min', 'max']) {
      if (
        unit.selector[key] !== undefined &&
        (!Number.isInteger(unit.selector[key]) ||
          unit.selector[key] < 0 ||
          unit.selector[key] > 128)
      )
        bad(p, `${key} 必须为 0–128 的整数`)
    }
    if ((unit.selector.min ?? 1) > (unit.selector.max ?? 128)) bad(p, 'min 不能大于 max')
    for (const key of ['include', 'exclude', 'companions']) {
      if (unit.selector[key] !== undefined) {
        for (const pattern of declarationList(unit.selector[key], `${p}.selector.${key}`, 64)) {
          if (typeof pattern !== 'string' || !pattern || pattern.length > 512)
            bad(p, '模式必须为非空字符串且不超过 512 字符')
        }
      }
    }
    validateDeclarationTarget(unit.target, `${p}.target`)
    if (unit.preserve_container !== undefined && typeof unit.preserve_container !== 'boolean')
      bad(p, 'preserve_container 必须为布尔值')
    if (unit.when) validateFactPredicate(unit.when, `${p}.when`)
    if (unit.component !== undefined) declarationId(unit.component, `${p}.component`)
  }
  const componentIds = new Set()
  const groupIds = new Set()
  for (const [i, group] of declarationList(
    value.components || [],
    `${path}.components`,
    32
  ).entries()) {
    const p = `${path}.components[${i}]`
    declarationFields(group, ['id', 'label', 'min', 'max', 'options'], p)
    declarationId(group.id, p)
    if (groupIds.has(group.id)) bad(p, '组件组 ID 重复')
    groupIds.add(group.id)
    const options = declarationList(group.options, `${p}.options`, 64)
    if (!options.length) bad(p, '组件组选项不能为空')
    for (const key of ['min', 'max']) {
      if (
        group[key] !== undefined &&
        (!Number.isInteger(group[key]) || group[key] < 0 || group[key] > options.length)
      )
        bad(p, `${key} 超出选项数量范围`)
    }
    if ((group.min ?? 0) > (group.max ?? options.length)) bad(p, 'min 不能大于 max')
    for (const option of options) {
      declarationFields(
        option,
        ['id', 'label', 'description', 'required', 'default', 'when'],
        `${p}.options`
      )
      declarationId(option.id, `${p}.options.id`)
      if (componentIds.has(option.id)) bad(p, '组件 ID 必须全局唯一')
      componentIds.add(option.id)
      for (const key of ['default', 'required']) {
        if (option[key] !== undefined && typeof option[key] !== 'boolean')
          bad(p, `${key} 必须为布尔值`)
      }
      if (option.when) validateFactPredicate(option.when, `${p}.${option.id}.when`)
    }
  }
  for (const unit of value.units || []) {
    if (unit.component && !componentIds.has(unit.component))
      bad(path, `单元 ${unit.id} 引用了未知组件`)
  }
  for (const patch of value.config || [])
    if (patch.component && !componentIds.has(patch.component) && !value.fomod)
      bad(path, '配置修改引用了未知组件')
  if (value.ignore !== undefined) {
    for (const item of declarationList(value.ignore, `${path}.ignore`, 64)) {
      declarationFields(item, ['pattern', 'reason'], `${path}.ignore`)
      if (
        typeof item.pattern !== 'string' ||
        !item.pattern ||
        typeof item.reason !== 'string' ||
        !item.reason.trim()
      )
        bad(path, '忽略文件必须提供 pattern 和 reason')
    }
  }
}

export function expandInstallRuleTemplates(raw) {
  const result = JSON.parse(JSON.stringify(raw))
  if (!object(result)) bad('install_rule', '规则必须为对象')
  if (result.requires !== undefined) {
    declarationFields(result.requires, ['capabilities', 'schema'], 'requires')
    if (
      result.requires.schema !== undefined &&
      (!Number.isInteger(result.requires.schema) ||
        result.requires.schema < 1 ||
        result.requires.schema > 5)
    )
      bad('requires.schema', '不支持的规则版本')
    for (const capability of declarationList(
      result.requires.capabilities || [],
      'requires.capabilities',
      32
    )) {
      if (!Object.hasOwn(INSTALL_RULE_CAPABILITIES, capability))
        bad('requires.capabilities', `客户端不支持能力 ${String(capability)}`)
    }
  }
  if (Number(result.schema_version ?? result.schemaVersion ?? 4) > 5)
    bad('schema_version', '此客户端不支持未来版本规则')
  const templates = result.templates || {}
  if (!object(templates) || Object.keys(templates).length > 64)
    bad('templates', '模板必须为对象，最多 64 个')
  const expanded = []
  const templateVersions = [
    ...(Array.isArray(result.template_versions) ? result.template_versions : [])
  ]
  for (const [i, use] of declarationList(
    result.use_templates || [],
    'use_templates',
    64
  ).entries()) {
    const p = `use_templates[${i}]`
    declarationFields(use, ['id', 'version', 'parameters'], p)
    declarationId(use.id, p)
    const template = templates[use.id]
    declarationFields(template, ['version', 'parameters', 'rules'], `templates.${use.id}`)
    if (
      !Number.isInteger(template.version) ||
      template.version < 1 ||
      use.version !== template.version
    )
      bad(p, '模板版本必须明确指定并精确匹配')
    const defaults = template.parameters || {}
    const provided = use.parameters || {}
    if (!object(defaults) || !object(provided)) bad(p, '模板参数必须为对象')
    for (const key of Object.keys(provided))
      if (!Object.hasOwn(defaults, key)) bad(p, `未知参数 ${key}`)
    const parameters = { ...defaults, ...provided }
    templateVersions.push({ id: use.id, version: use.version, parameters })
    const substitute = (node, depth = 0) => {
      if (depth > 32) bad(p, '模板嵌套过深')
      if (typeof node === 'string')
        return node.replace(/\{\{param:([a-zA-Z0-9_.-]+)\}\}/g, (_, key) => {
          const value = parameters[key]
          if (
            !Object.hasOwn(parameters, key) ||
            !['string', 'number', 'boolean'].includes(typeof value)
          )
            bad(p, `参数 ${key} 缺失或不是标量`)
          return String(value)
        })
      if (Array.isArray(node)) return node.map((item) => substitute(item, depth + 1))
      if (object(node))
        return Object.fromEntries(
          Object.entries(node).map(([key, value]) => [key, substitute(value, depth + 1)])
        )
      return node
    }
    expanded.push(...substitute(declarationList(template.rules, `${p}.rules`)))
  }
  if (expanded.length)
    result.install_rules = [...(result.install_rules || result.installRules || []), ...expanded]
  if (expanded.length) {
    const ids = result.install_rules.map((rule) => rule.id).filter(Boolean)
    if (new Set(ids).size !== ids.length)
      bad('use_templates', '模板展开后的规则 ID 重复，请用参数提供不同 ID')
  }
  if (templateVersions.length) result.template_versions = templateVersions
  delete result.templates
  delete result.use_templates
  for (const [i, rule] of (result.install_rules || result.installRules || []).entries()) {
    if (rule?.declarative !== undefined)
      validateDeclarativeRule(rule.declarative, `install_rules[${i}].declarative`)
  }
  return result
}
