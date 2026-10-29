/**
 * contracts.js — 安装引擎领域契约门面
 *
 * 对外保持原有全部具名导出零变更；实现已拆分为：
 * - contracts/util.js：无领域语义的纯工具
 * - contracts/model.js：领域模型工厂与常量（引擎领域模型唯一来源）
 */
export * from './contracts/util.js'
export * from './contracts/model.js'
