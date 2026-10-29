/**
 * lifecycle/contracts.js — 生命周期安全动作字段契约（H1/O7 共用）
 *
 * stepNormalizer / pathBaseResolver / lifecycleActions 三处共享字段契约，
 * 避免归一化阶段把 schema 承诺的 from/to/source/target/text/content/value/patch/
 * section/key/backup 等字段丢弃导致运行期拿不到值。
 */

// 每个安全动作可能用到的字段名全集，供 stepNormalizer 白名单保留。
// 不归一化字段名（仍由 lifecycleActions 多别名回退处理），只确保字段不被丢弃。
export const LIFECYCLE_PASSTHROUGH_FIELDS = Object.freeze([
  'from',
  'source',
  'source_path',
  'sourcePath',
  'to',
  'target',
  'target_path',
  'targetPath',
  'text',
  'content',
  'value',
  'patch',
  'section',
  'key',
  'backup',
  'backup_path',
  'backupPath',
  'overwrite',
  'encoding',
  'json_path',
  'jsonPath',
  'create_if_missing',
  'createIfMissing'
])

// 路径类字段：需模板展开 + 边界校验（isPathInside）。
export const LIFECYCLE_PATH_LIKE_FIELDS = Object.freeze([
  'from',
  'source',
  'source_path',
  'sourcePath',
  'to',
  'target',
  'target_path',
  'targetPath',
  'backup',
  'backup_path',
  'backupPath',
  'path'
])

// 文本类字段：仅模板展开，无边界校验。
export const LIFECYCLE_TEXT_LIKE_FIELDS = Object.freeze([
  'text',
  'content',
  'value',
  'patch',
  'section',
  'key',
  'json_path',
  'jsonPath'
])
