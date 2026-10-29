/**
 * orchestrator/itemDependencyResolver.js — 安装项依赖关系评估（纯函数）
 *
 * 解析单个安装项的依赖引用（显式 + 默认依赖），结合同批 jobItems 状态判定
 * 是否阻断/等待，供编排核心在调度安装项前裁决。
 */
import { ITEM_STATE, TERMINAL_ITEM_STATES, toSafeText } from '../contracts.js'
import { parseItemDependencyRefs } from '../itemMetadata.js'

function buildItemKeyAliases(item = {}) {
  const aliases = new Set()
  const sourceModKey = toSafeText(item.source_mod_key)
  const dependencyKey = toSafeText(item.dependency_key)
  if (sourceModKey) {
    aliases.add(sourceModKey)
  }
  if (dependencyKey) {
    aliases.add(dependencyKey)
  }
  return aliases
}

function normalizeDependencyRef(ref = {}) {
  if (typeof ref === 'string') {
    return {
      keys: [toSafeText(ref)].filter(Boolean),
      required: true,
      title: toSafeText(ref)
    }
  }
  const safeRef = ref && typeof ref === 'object' ? ref : {}
  const source = toSafeText(safeRef.source || safeRef.sourceType || safeRef.sourcePlatform).toLowerCase()
  const modId = toSafeText(safeRef.modId || safeRef.sourceModId)
  const fileId = toSafeText(safeRef.fileId || safeRef.sourceFileId)
  const sourceModKey = toSafeText(safeRef.sourceModKey || safeRef.source_mod_key)
  const dependencyKey = toSafeText(safeRef.dependencyKey || safeRef.dependency_key)
  const keys = [
    sourceModKey,
    dependencyKey,
    source && modId && fileId ? `${source}:${modId}:${fileId}` : '',
    source && modId ? `${source}:${modId}` : '',
    modId && fileId ? `${modId}:${fileId}` : '',
    modId
  ].filter(Boolean)
  return {
    keys: [...new Set(keys)],
    required: safeRef.required !== false && safeRef.optional !== true,
    title: toSafeText(safeRef.name || safeRef.title || sourceModKey || dependencyKey || modId || '依赖项')
  }
}

function collectItemDependencyRefs(item = {}, jobItems = []) {
  const refs = parseItemDependencyRefs(item).map((entry) => normalizeDependencyRef(entry))
  const itemType = toSafeText(item.item_type || item.itemType, 'main')
  if (itemType === 'main' || itemType === 'dependency') {
    jobItems
      .filter((candidate) => candidate.item_id !== item.item_id)
      .filter((candidate) => candidate.item_type === 'default_dependency')
      .forEach((candidate) => {
        refs.push({
          keys: [...buildItemKeyAliases(candidate)],
          required: true,
          title: candidate.title || '默认依赖'
        })
      })
  }
  return refs.filter((entry) => entry.keys.length > 0)
}

export function evaluateItemDependencies(item = {}, jobItems = []) {
  const refs = collectItemDependencyRefs(item, jobItems)
  if (!refs.length) {
    return {
      blocked: false,
      waiting: false,
      failedDependencies: [],
      waitingDependencies: [],
      warningDependencies: []
    }
  }

  const itemMap = new Map()
  jobItems.forEach((candidate) => {
    buildItemKeyAliases(candidate).forEach((key) => {
      if (!itemMap.has(key)) {
        itemMap.set(key, [])
      }
      itemMap.get(key).push(candidate)
    })
  })

  const failedDependencies = []
  const waitingDependencies = []
  const warningDependencies = []
  refs.forEach((ref) => {
    const matchedItems = ref.keys.flatMap((key) => itemMap.get(key) || []).filter(Boolean)
    if (!matchedItems.length) {
      return
    }
    const uniqueMatchedItems = [...new Map(matchedItems.map((entry) => [entry.item_id, entry])).values()]
    const hasFailed = uniqueMatchedItems.some((entry) =>
      [ITEM_STATE.FAILED, ITEM_STATE.PRECHECK_BLOCKED, ITEM_STATE.CANCELLED].includes(entry.state)
    )
    const hasWaiting = uniqueMatchedItems.some((entry) => !TERMINAL_ITEM_STATES.has(entry.state))
    if (hasFailed && ref.required) {
      failedDependencies.push({
        title: ref.title,
        items: uniqueMatchedItems
      })
      return
    }
    if (hasFailed) {
      warningDependencies.push({
        title: ref.title,
        items: uniqueMatchedItems
      })
      return
    }
    if (hasWaiting && ref.required) {
      waitingDependencies.push({
        title: ref.title,
        items: uniqueMatchedItems
      })
    }
  })

  // 输出按 matched item 集合去重：默认依赖在「显式依赖列表」与「同任务默认依赖自动补齐」
  // 两条路径上可能被推入两个不同 ref，匹配到的却是同一个安装项；不去重会导致
  // 失败 / 等待提示出现「RE-UE4SS、RE-UE4SS」之类的重复，徒增噪音。
  return {
    blocked: failedDependencies.length > 0,
    waiting: waitingDependencies.length > 0,
    failedDependencies: dedupDependencyMatchesByItems(failedDependencies),
    waitingDependencies: dedupDependencyMatchesByItems(waitingDependencies),
    warningDependencies: dedupDependencyMatchesByItems(warningDependencies)
  }
}

function dedupDependencyMatchesByItems(list = []) {
  if (!Array.isArray(list) || list.length <= 1) return Array.isArray(list) ? list : []
  const seen = new Set()
  const result = []
  for (const entry of list) {
    const items = Array.isArray(entry?.items) ? entry.items : []
    const signature = items
      .map((candidate) => toSafeText(candidate?.item_id))
      .filter(Boolean)
      .sort()
      .join('|')
    if (!signature) {
      result.push(entry)
      continue
    }
    if (seen.has(signature)) continue
    seen.add(signature)
    result.push(entry)
  }
  return result
}
