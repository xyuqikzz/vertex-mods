/**
 * itemMetadata.js — 安装项元数据解析（纯函数，无 DB 依赖）
 *
 * parseItemMetadata / parseItemDependencyRefs 只解析安装项已持有的 JSON 文本，
 * 不触达数据库。独立成模块后，排序 / 依赖评估等纯编排子模块可脱离 store/db 的
 * dbInstance（依赖 import.meta.env）单独导入与单测。
 */
import { parseJsonArray, parseJsonObject } from './contracts.js'

export function parseItemMetadata(item = {}) {
  return parseJsonObject(item.metadata_json, {})
}

export function parseItemDependencyRefs(item = {}) {
  const metadata = parseItemMetadata(item)
  return parseJsonArray(metadata.installPayload?.dependencies, [])
}
