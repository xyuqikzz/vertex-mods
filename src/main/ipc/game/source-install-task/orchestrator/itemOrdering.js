/**
 * orchestrator/itemOrdering.js — 安装项排序（纯函数）
 *
 * 排序优先级：item_type（default_dependency < dependency < main）→ sortIndex → id。
 */
import { toSafeText } from '../contracts.js'
import { parseItemMetadata } from '../itemMetadata.js'

function getItemSortIndex(item = {}) {
  const metadata = parseItemMetadata(item)
  return Number(metadata.sortIndex ?? metadata.meta?.sortIndex ?? 0)
}

function getItemTypePriority(item = {}) {
  const itemType = toSafeText(item.item_type || item.itemType || item.type, 'main')
  if (itemType === 'default_dependency') {
    return 0
  }
  if (itemType === 'dependency') {
    return 1
  }
  return 2
}

export function sortItems(items = []) {
  return [...items].sort((left, right) => {
    const typeGap = getItemTypePriority(left) - getItemTypePriority(right)
    if (typeGap !== 0) {
      return typeGap
    }
    const sortGap = getItemSortIndex(left) - getItemSortIndex(right)
    if (sortGap !== 0) {
      return sortGap
    }
    return Number(left.id || 0) - Number(right.id || 0)
  })
}
