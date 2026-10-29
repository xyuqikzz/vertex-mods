/**
 * caseCompare.js — Unicode-aware 大小写不敏感比对 helper（H11）
 *
 * 替代 toLowerCase() 比对，使用 Intl.Collator('en', { sensitivity: 'base' }) 正确处理
 * Unicode 折叠（如土耳其 I/ı、德语 ß、希腊语 σ/ς）。
 *
 * Windows 路径通常不含特殊 Unicode 字符，实际风险低，但规则匹配可能涉及多语言
 * 文件名（如日文/土耳其文 mod），用 Intl.Collator 更稳健。
 */

const caseInsensitiveCollator = new Intl.Collator('en', { sensitivity: 'base' })

export function caseInsensitiveEquals(a = '', b = '') {
  return caseInsensitiveCollator.compare(String(a ?? ''), String(b ?? '')) === 0
}

export function caseInsensitiveStartsWith(str = '', prefix = '') {
  const safeStr = String(str ?? '')
  const safePrefix = String(prefix ?? '')
  if (safeStr.length < safePrefix.length) return false
  return caseInsensitiveCollator.compare(safeStr.slice(0, safePrefix.length), safePrefix) === 0
}

export function caseInsensitiveEndsWith(str = '', suffix = '') {
  const safeStr = String(str ?? '')
  const safeSuffix = String(suffix ?? '')
  if (safeStr.length < safeSuffix.length) return false
  return caseInsensitiveCollator.compare(
    safeStr.slice(safeStr.length - safeSuffix.length),
    safeSuffix
  ) === 0
}
