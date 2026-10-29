/**
 * unrealGroupValidator.js — Unreal IoStore 文件组完整性检测模块
 *
 * 专门判定 Unreal 引擎包中的文件组（例如搭配 require_siblings 规则的 .pak, .ucas, .utoc）
 * 是否缺少配套文件，并对覆盖账本中不完整的部分予以标记。
 */

import path from 'path'
import { isPlainObject, toSafeText, normalizeRelativeRulePath } from './contracts.js'
import { updateLedgerEntry, COVERAGE_LEDGER_STATUS } from './coverageLedger.js'

/**
 * 提取文件组分组键名（忽略后缀和大小写）
 * @param {string} relativePath - 快照条目的相对路径
 * @returns {string} 排除后缀后的标准化键名
 */
export function createGroupKey(relativePath = '') {
  const normalizedPath = normalizeRelativeRulePath(relativePath)
  const dirName = path.posix.dirname(normalizedPath)
  const ext = path.posix.extname(normalizedPath).toLowerCase()
  const baseName = path.posix.basename(normalizedPath, ext)
  return `${dirName === '.' ? '' : `${dirName}/`}${baseName}`.toLowerCase()
}

/**
 * 检查当前路由选中的 Unreal 文件条目，若缺少配套文件，则标记其覆盖账本为 GROUP_INCOMPLETE 并返回拦截名单
 * @param {object} route - 路由配置
 * @param {Array<object>} selectedFiles - 当前选中的文件快照条目列表
 * @param {Map<string, object>} ledgerIndex - 覆盖账本索引映射表
 * @returns {Set<string>} 需要阻断安装的不完整文件路径集合（Lowercase 形式）
 */
export function markIncompleteUnrealGroups(route = {}, selectedFiles = [], ledgerIndex = new Map()) {
  const group = isPlainObject(route.group) ? route.group : {}
  const groupType = toSafeText(group.type || group.kind).toLowerCase()
  const requireSiblings = group.require_siblings === true || group.requireSiblings === true
  if (!['unreal_pak', 'unreal_iostore'].includes(groupType) || !requireSiblings) {
    return new Set()
  }

  const groupMap = new Map()
  for (const entry of selectedFiles) {
    const ext = path.posix.extname(entry.relativePath).toLowerCase()
    if (!['.pak', '.ucas', '.utoc'].includes(ext)) continue
    const key = createGroupKey(entry.relativePath)
    if (!groupMap.has(key)) groupMap.set(key, new Map())
    groupMap.get(key).set(ext, entry)
  }

  const blocked = new Set()
  for (const extMap of groupMap.values()) {
    const missing = ['.pak', '.ucas', '.utoc'].filter((ext) => !extMap.has(ext))
    if (!missing.length) continue
    for (const entry of extMap.values()) {
      blocked.add(entry.relativePath.toLowerCase())
      updateLedgerEntry(ledgerIndex, entry.relativePath, {
        status: COVERAGE_LEDGER_STATUS.GROUP_INCOMPLETE,
        reason: `Unreal IoStore 文件组缺少配套文件：${missing.join(', ')}`
      })
    }
  }
  return blocked
}
