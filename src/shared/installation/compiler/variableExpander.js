import { createRuleCompileError, formatRulePath, hasOwn, isPlainObject } from './compilerUtils.js'

const RULE_VARIABLE_REFERENCE_REGEXP = /\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g

export function extractRuleVariableMap(ruleObject = {}) {
  if (isPlainObject(ruleObject.variables)) {
    return { ...ruleObject.variables }
  }

  if (isPlainObject(ruleObject.vars)) {
    return { ...ruleObject.vars }
  }

  return null
}

export function resolveRuleVariableMap(variableMap = {}) {
  const source = isPlainObject(variableMap) ? variableMap : {}
  const cache = new Map()
  const visiting = []

  const resolveVariableValue = (name, fieldPath = []) => {
    if (cache.has(name)) {
      return cache.get(name)
    }

    if (!hasOwn(source, name)) {
      throw createRuleCompileError(
        'rule_variable_undefined',
        `规则变量未定义: ${name}，位置: ${formatRulePath(fieldPath)}`,
        {
          variableName: name,
          fieldPath: formatRulePath(fieldPath)
        }
      )
    }

    if (visiting.includes(name)) {
      const cyclePath = [...visiting, name].join(' -> ')
      throw createRuleCompileError(
        'rule_variable_cycle',
        `规则变量存在循环引用: ${cyclePath}`,
        {
          variableName: name,
          cyclePath
        }
      )
    }

    const rawValue = source[name]
    // H10：variables 值支持字符串/数字/布尔，数字和布尔自动转为字符串；null 转为空串。
    // 对象/数组仍抛错（无法合理序列化为字符串）。
    let normalizedValue
    if (typeof rawValue === 'string') {
      normalizedValue = rawValue
    } else if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue)) {
        throw createRuleCompileError(
          'rule_variable_invalid_type',
          `规则变量必须是有限数字: ${name}，收到 ${rawValue}`,
          {
            variableName: name,
            fieldPath: formatRulePath(['variables', name]),
            valueType: 'number'
          }
        )
      }
      normalizedValue = String(rawValue)
    } else if (typeof rawValue === 'boolean') {
      normalizedValue = String(rawValue)
    } else if (rawValue === null) {
      normalizedValue = ''
    } else {
      throw createRuleCompileError(
        'rule_variable_invalid_type',
        `规则变量必须是字符串/数字/布尔: ${name}，收到 ${Array.isArray(rawValue) ? 'array' : typeof rawValue}`,
        {
          variableName: name,
          fieldPath: formatRulePath(['variables', name]),
          valueType: Array.isArray(rawValue) ? 'array' : typeof rawValue
        }
      )
    }

    visiting.push(name)
    const resolvedValue = normalizedValue.replace(
      RULE_VARIABLE_REFERENCE_REGEXP,
      (_match, referenceName) => resolveVariableValue(referenceName, ['variables', name])
    )
    visiting.pop()

    cache.set(name, resolvedValue)
    return resolvedValue
  }

  const result = {}
  for (const name of Object.keys(source)) {
    result[name] = resolveVariableValue(name)
  }

  return result
}

function expandRuleVariableText(text = '', variableMap = {}, fieldPath = []) {
  const rawText = String(text || '')
  if (!rawText.includes('${')) {
    return rawText
  }

  return rawText.replace(RULE_VARIABLE_REFERENCE_REGEXP, (_match, variableName) => {
    if (!hasOwn(variableMap, variableName)) {
      throw createRuleCompileError(
        'rule_variable_undefined',
        `规则变量未定义: ${variableName}，位置: ${formatRulePath(fieldPath)}`,
        {
          variableName,
          fieldPath: formatRulePath(fieldPath)
        }
      )
    }

    return String(variableMap[variableName] || '')
  })
}

function compileStringTree(node, variableMap = {}, fieldPath = []) {
  if (typeof node === 'string') {
    return expandRuleVariableText(node, variableMap, fieldPath)
  }

  if (Array.isArray(node)) {
    return node.map((item, index) => compileStringTree(item, variableMap, [...fieldPath, index]))
  }

  if (isPlainObject(node)) {
    const result = {}
    for (const [key, value] of Object.entries(node)) {
      result[key] = compileStringTree(value, variableMap, [...fieldPath, key])
    }
    return result
  }

  return node
}

function compileSelectedObjectFields(target = {}, fieldNameList = [], variableMap = {}, fieldPath = []) {
  if (!isPlainObject(target)) {
    return target
  }

  const result = { ...target }
  for (const fieldName of Array.isArray(fieldNameList) ? fieldNameList : []) {
    if (!hasOwn(result, fieldName)) {
      continue
    }
    result[fieldName] = compileStringTree(result[fieldName], variableMap, [...fieldPath, fieldName])
  }

  return result
}

function compileLifecycleStep(step = {}, variableMap = {}, fieldPath = []) {
  return compileSelectedObjectFields(
    step,
    [
      'path',
      'relative_path',
      'relativePath',
      'dir',
      'directory',
      'from',
      'source',
      'source_path',
      'sourcePath',
      'to',
      'target',
      'target_path',
      'targetPath',
      'backup',
      'backup_path',
      'backupPath',
      'text',
      'content',
      'value',
      'patch',
      'section',
      'key',
      'args',
      'arguments',
      'stdin',
      'input',
      'inputs'
    ],
    variableMap,
    fieldPath
  )
}

export function compileInstallRuleContainer(ruleObject = {}, variableMap = {}, fieldPath = []) {
  if (!isPlainObject(ruleObject)) {
    return ruleObject
  }

  const result = { ...ruleObject }

  if (isPlainObject(result.declarative)) {
    result.declarative = compileStringTree(result.declarative, variableMap, [...fieldPath, 'declarative'])
  }

  if (isPlainObject(result.match)) {
    result.match = compileStringTree(result.match, variableMap, [...fieldPath, 'match'])
  }

  if (isPlainObject(result.source)) {
    result.source = compileSelectedObjectFields(
      result.source,
      ['path', 'source_path', 'sourcePath', 'marker', 'marker_pattern', 'ensure_files', 'extension', 'pattern', 'patterns', 'file_pattern', 'filePattern', 'file_patterns', 'filePatterns'],
      variableMap,
      [...fieldPath, 'source']
    )
  }

  if (isPlainObject(result.target)) {
    result.target = compileSelectedObjectFields(
      result.target,
      [
        'path',
        'target_path',
        'targetPath',
        'show_inject_button',
        'showInjectButton',
        'inject_button',
        'injectButton',
        'launch_action',
        'launchAction',
        'launch_args',
        'launchArgs',
        'launch_target',
        'launchTarget',
        'launch_target_args',
        'launchTargetArgs',
        'launch_target_base',
        'launch_target_base_type',
        'launchTargetBase',
        'launchTargetBaseType',
        'inject_target',
        'injectTarget',
        'inject_target_args',
        'injectTargetArgs',
        'inject_target_base',
        'inject_target_base_type',
        'injectTargetBase',
        'injectTargetBaseType',
        'enable_target',
        'enableTarget',
        'enable_target_args',
        'enableTargetArgs',
        'enable_target_base',
        'enable_target_base_type',
        'enableTargetBase',
        'enableTargetBaseType',
        'enable_exe',
        'enableExe',
        'enable_exe_args',
        'enableExeArgs',
        'enable_exe_base',
        'enable_exe_base_type',
        'enableExeBase',
        'enableExeBaseType',
        'launch_exe',
        'launchExe',
        'launch_exe_args',
        'launchExeArgs',
        'launch_exe_base',
        'launch_exe_base_type',
        'launchExeBase',
        'launchExeBaseType',
        'inject_exe',
        'injectExe',
        'inject_exe_args',
        'injectExeArgs',
        'inject_exe_base',
        'inject_exe_base_type',
        'injectExeBase',
        'injectExeBaseType'
      ],
      variableMap,
      [...fieldPath, 'target']
    )
  }

  const healthExpectations = isPlainObject(result.health_expectations)
    ? result.health_expectations
    : isPlainObject(result.healthExpectations)
      ? result.healthExpectations
      : null
  if (healthExpectations) {
    const compiledHealthExpectations = compileStringTree(
      healthExpectations,
      variableMap,
      [
        ...fieldPath,
        isPlainObject(result.health_expectations) ? 'health_expectations' : 'healthExpectations'
      ]
    )
    result.health_expectations = compiledHealthExpectations
    if (isPlainObject(result.healthExpectations)) {
      result.healthExpectations = compiledHealthExpectations
    }
  }

  const lifecycleListMap = [
    ['post_install', 'postInstall'],
    ['on_enable', 'onEnable'],
    ['on_disable', 'onDisable'],
    ['on_uninstall', 'onUninstall']
  ]

  // routes 数组：对所有字符串值做变量展开
  const routesList = Array.isArray(result.routes) ? result.routes : null
  if (routesList) {
    result.routes = compileStringTree(routesList, variableMap, [...fieldPath, 'routes'])
  }

  for (const [primaryField, aliasField] of lifecycleListMap) {
    const lifecycleList = Array.isArray(result[primaryField])
      ? result[primaryField]
      : Array.isArray(result[aliasField])
        ? result[aliasField]
        : null
    if (!lifecycleList) {
      continue
    }

    const compiledLifecycleList = lifecycleList.map((item, index) =>
      compileLifecycleStep(item, variableMap, [...fieldPath, primaryField, index])
    )
    result[primaryField] = compiledLifecycleList
    if (Array.isArray(result[aliasField])) {
      result[aliasField] = compiledLifecycleList
    }
  }

  const installRuleList = Array.isArray(result.install_rules)
    ? result.install_rules
    : Array.isArray(result.installRules)
      ? result.installRules
      : null
  if (installRuleList) {
    const compiledInstallRuleList = installRuleList.map((item, index) =>
      compileInstallRuleContainer(item, variableMap, [...fieldPath, 'install_rules', index])
    )
    result.install_rules = compiledInstallRuleList
    if (Array.isArray(result.installRules)) {
      result.installRules = compiledInstallRuleList
    }
  }

  delete result.rules_v2
  delete result.rulesV2
  delete result.rules_v3
  delete result.rulesV3
  return result
}

function compileGameDetectCandidate(candidate = {}, variableMap = {}, fieldPath = []) {
  if (!isPlainObject(candidate)) {
    return candidate
  }

  const result = { ...candidate }

  if (isPlainObject(result.markers)) {
    result.markers = compileStringTree(result.markers, variableMap, [...fieldPath, 'markers'])
  }

  if (hasOwn(result, 'exe_globs')) {
    result.exe_globs = compileStringTree(result.exe_globs, variableMap, [...fieldPath, 'exe_globs'])
  }

  if (hasOwn(result, 'exeGlobs')) {
    result.exeGlobs = compileStringTree(result.exeGlobs, variableMap, [...fieldPath, 'exeGlobs'])
  }

  for (const fieldName of ['root_hints', 'rootHints', 'search_roots', 'searchRoots']) {
    if (hasOwn(result, fieldName)) {
      result[fieldName] = compileStringTree(result[fieldName], variableMap, [
        ...fieldPath,
        fieldName
      ])
    }
  }

  return result
}

export function compileGameDetectNode(gameDetect = {}, variableMap = {}, fieldPath = []) {
  if (!isPlainObject(gameDetect)) {
    return gameDetect
  }

  const result = { ...gameDetect }
  const candidateList = Array.isArray(result.candidates)
    ? result.candidates
    : Array.isArray(result.candidate_list)
      ? result.candidate_list
      : Array.isArray(result.candidateList)
        ? result.candidateList
        : null

  if (candidateList) {
    const compiledCandidates = candidateList.map((item, index) =>
      compileGameDetectCandidate(item, variableMap, [...fieldPath, 'candidates', index])
    )
    result.candidates = compiledCandidates
    if (Array.isArray(result.candidate_list)) {
      result.candidate_list = compiledCandidates
    }
    if (Array.isArray(result.candidateList)) {
      result.candidateList = compiledCandidates
    }
  }

  return result
}

function compileDefaultDependencyEntry(entry = {}, variableMap = {}, fieldPath = []) {
  if (!isPlainObject(entry)) {
    return entry
  }

  const result = { ...entry }
  if (isPlainObject(result.install)) {
    result.install = compileInstallRuleContainer(result.install, variableMap, [...fieldPath, 'install'])
  }

  return result
}

export function compileDefaultDependencyList(list = [], variableMap = {}, fieldPath = []) {
  return (Array.isArray(list) ? list : []).map((item, index) =>
    compileDefaultDependencyEntry(item, variableMap, [...fieldPath, index])
  )
}
