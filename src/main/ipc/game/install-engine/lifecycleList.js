/**
 * lifecycleList.js — 生命周期步骤列表收集（single / multi 规划共享单一来源）
 *
 * 统一 post_install / on_enable / on_disable / on_uninstall 及其 camelCase 别名的读取，
 * 取代历史上 planAssembler.normalizeLifecycleList 与 multiRoutePlanner.collectLifecycleList
 * 两处完全相同的实现。
 */
export function collectLifecycleList(rule = {}, primaryField = '', aliasField = '') {
  return Array.isArray(rule[primaryField])
    ? rule[primaryField]
    : Array.isArray(rule[aliasField])
      ? rule[aliasField]
      : []
}
