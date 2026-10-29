/**
 * healthExpectations.js — 健康期望收敛模块（single / multi 规划共享单一来源）
 *
 * 收敛历史上分散在 planAssembler / multiRoutePlanner 的健康期望逻辑：
 * - buildHealthExpectations：从规则 + 包档案推导（single_target 与回退路径使用）
 * - collectRouteHealthExpectations：从单个 route + 其操作推导（multi_route 逐 route）
 * - mergeHealthExpectations：合并多个 routePlan 的健康期望（multi_route 汇总）
 *
 * 统一处理 requiredFiles/required_files 等 snake/camel 别名展开，避免别名漂移。
 */
import { isPlainObject, normalizeRelativeRulePath, toArrayValue } from './contracts.js'

export function buildHealthExpectations(rule = {}, packageProfile = {}, sourceSelection = {}) {
  const health = isPlainObject(rule.healthExpectations)
    ? rule.healthExpectations
    : isPlainObject(rule.health_expectations)
      ? rule.health_expectations
      : {}
  const profileHealth = isPlainObject(packageProfile.healthExpectations)
    ? packageProfile.healthExpectations
    : {}
  const profilePath = (value) => normalizeRelativeRulePath(
    sourceSelection.preserveSourceRootName ? `${sourceSelection.preserveSourceRootName}/${value}` : value
  )
  return {
    requiredFiles: [
      ...toArrayValue(profileHealth.requiredFiles || profileHealth.required_files).map(profilePath),
      ...toArrayValue(health.requiredFiles || health.required_files)
    ],
    requiredDirs: [
      ...toArrayValue(profileHealth.requiredDirs || profileHealth.required_dirs).map(profilePath),
      ...toArrayValue(health.requiredDirs || health.required_dirs)
    ],
    optionalFiles: [
      ...toArrayValue(profileHealth.optionalFiles || profileHealth.optional_files).map(profilePath),
      ...toArrayValue(health.optionalFiles || health.optional_files)
    ],
    recordRequired: health.recordRequired !== false
  }
}

export function collectRouteHealthExpectations(route = {}, operationList = []) {
  const operations = Array.isArray(operationList) ? operationList : []
  const health =
    operations.length > 0
      ? isPlainObject(route.healthExpectations)
        ? route.healthExpectations
        : isPlainObject(route.health_expectations)
          ? route.health_expectations
          : {}
      : {}
  const requiredFiles = [...toArrayValue(health.requiredFiles || health.required_files)]
  const requiredDirs = [...toArrayValue(health.requiredDirs || health.required_dirs)]

  for (const operation of operations) {
    const rp = normalizeRelativeRulePath(operation.relativePath)
    if (!rp) continue
    if (operation.kind === 'dir') {
      if (!requiredDirs.includes(rp)) requiredDirs.push(rp)
    } else if (operation.kind === 'file') {
      if (!requiredFiles.includes(rp)) requiredFiles.push(rp)
    }
  }

  return {
    requiredFiles,
    requiredDirs,
    optionalFiles: Array.isArray(health.optionalFiles)
      ? health.optionalFiles
      : Array.isArray(health.optional_files)
        ? health.optional_files
        : [],
    recordRequired: operations.length > 0 && health.recordRequired !== false
  }
}

export function mergeHealthExpectations(routePlans = []) {
  const requiredFiles = []
  const requiredDirs = []
  const optionalFiles = []
  for (const rp of Array.isArray(routePlans) ? routePlans : []) {
    const h = rp.healthExpectations || {}
    for (const f of h.requiredFiles || []) {
      if (!requiredFiles.includes(f)) requiredFiles.push(f)
    }
    for (const d of h.requiredDirs || []) {
      if (!requiredDirs.includes(d)) requiredDirs.push(d)
    }
    for (const o of h.optionalFiles || []) {
      if (!optionalFiles.includes(o)) optionalFiles.push(o)
    }
  }
  return { requiredFiles, requiredDirs, optionalFiles, recordRequired: true }
}
