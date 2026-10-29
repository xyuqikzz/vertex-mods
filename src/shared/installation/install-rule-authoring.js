import {
  expandInstallRuleTemplates,
  INSTALL_RULE_CAPABILITIES
} from './install-rule-declarations.js'

function safeRelative(value) {
  const text = String(value || '')
    .trim()
    .replace(/\\/g, '/')
  if (
    !text ||
    text.startsWith('/') ||
    /[<>:"|?*]/u.test(text) ||
    [...text].some((char) => char.charCodeAt(0) < 32) ||
    text
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
  )
    throw new Error('映射必须使用安全的相对文件路径，不能包含通配符')
  return text
}

export function buildManualMappingRule(rows, id = 'manual-mapping') {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
    throw new Error('手动映射需要 1–1000 个文件')
  const targets = new Set()
  const mappings = rows.map((row) => {
    const source = safeRelative(row.source)
    const target = safeRelative(row.target)
    if (targets.has(target.toLowerCase())) throw new Error(`多个文件映射到同一目标：${target}`)
    targets.add(target.toLowerCase())
    return { source, target }
  })
  return {
    id,
    priority: 1000,
    match: { all_file_patterns: [...new Set(mappings.map((row) => row.source))] },
    declarative: { ignore: [] },
    routes: mappings.map((row, index) => ({
      id: `${id}-${index + 1}`,
      source: { paths: [row.source] },
      target: { base: 'game', path: '.' },
      mapping: { replace_prefix: { from: row.source, to: row.target } }
    }))
  }
}

export function getDeclarationDiagnostic(document) {
  try {
    expandInstallRuleTemplates(document)
    return null
  } catch (error) {
    return { path: error.detail?.path || '', message: error.message }
  }
}

// Completion descriptions share the capability catalogue used by the compiler.
export const INSTALL_RULE_COMPLETIONS = Object.freeze(
  [
    ['requires', '客户端能力门禁：capabilities 数组与 schema 版本'],
    ['templates', '版本固定的 JSON 模板定义'],
    ['use_templates', '指定模板 id、version 和 parameters'],
    ['declarative', '通用事实、单元、组件、FOMOD、配置和受限嵌套包'],
    ['facts', '受限内容事实；game/package/context'],
    ['units', '以文件锚点绑定目录的安装单元'],
    ['components', '组件组及 min/max 选择约束'],
    ['fomod', '声明式 XML 5.0：config 和 target 必填'],
    ['nested_archives', '显式 ZIP include，深度/大小/条目预算'],
    ['config', 'JSON/INI/文本列表的有归属字段修改'],
    ['selector', 'anchor、parent、include、exclude、companions、min/max'],
    ['ignore', '显式忽略 pattern 和必须提供的 reason'],
    ['paths', '精确源文件路径集合；用于手动映射'],
    ...Object.keys(INSTALL_RULE_CAPABILITIES).map((name) => [name, '当前客户端支持的声明式能力'])
  ].map(([label, detail]) => ({ label, detail, type: 'property' }))
)
