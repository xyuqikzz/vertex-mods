/**
 * route/routePlanFactory.js — 单个 route 的计划对象工厂
 *
 * 把 route 定义 + 目标定位 + 已生成操作组装为 routePlan，健康期望统一委托
 * healthExpectations 模块（single / multi 共享单一来源）。
 */
import { isPlainObject, toPlainJson } from '../contracts.js'
import { collectRouteHealthExpectations } from '../healthExpectations.js'

export function createRoutePlan(
  route = {},
  routeId = '',
  ruleId = '',
  targetLocation = {},
  operations = []
) {
  return {
    routeId,
    ruleId,
    source: isPlainObject(route.source) ? toPlainJson(route.source, {}) : {},
    target: isPlainObject(route.target) ? toPlainJson(route.target, {}) : {},
    mapping: isPlainObject(route.mapping) ? toPlainJson(route.mapping, {}) : {},
    targetBaseType: targetLocation.targetBaseType,
    targetRoot: targetLocation.targetRoot,
    targetRelativePath: targetLocation.targetRelativePath,
    operations,
    healthExpectations: collectRouteHealthExpectations(route, operations)
  }
}
