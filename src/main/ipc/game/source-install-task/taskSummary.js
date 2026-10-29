import { buildPublicSourceInstallTaskRecord } from './taskSecurity.js'
import { parseJsonObject } from './contracts.js'

const JOB_FIELDS = [
  'id', 'job_id', 'agent_task_id', 'source', 'source_adapter', 'game_key', 'title',
  'state', 'progress', 'current_step', 'error_message', 'precheck_status', 'failure_stage',
  'health_status', 'warning_count', 'blocker_count', 'item_count', 'completed_item_count',
  'created_at', 'updated_at', 'completed_at'
]
const ITEM_FIELDS = [
  'item_id', 'job_id', 'source', 'game_key', 'source_mod_key', 'source_file_key',
  'title', 'item_type', 'state', 'progress', 'error_message', 'failure_stage', 'health_status'
]

function pick(record, fields) {
  return Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]))
}

export function buildSourceInstallTaskListRecord(record = {}) {
  const payload = parseJsonObject(record.payload_json || record.payload, {})
  return buildPublicSourceInstallTaskRecord({
    ...pick(record, JOB_FIELDS),
    payload: pick(payload, [
      'source', 'businessSource', 'gameName', 'game_name', 'sourceGameName', 'source_game_name'
    ])
  })
}

// 状态事件只携带消费者实际使用的摘要。执行记录及完整规则仍通过 detail 接口读取。
export function buildSourceInstallTaskUpdate(detail = {}) {
  const job = pick(detail.job || detail, JOB_FIELDS)
  return buildPublicSourceInstallTaskRecord({
    ...job,
    job,
    items: (detail.items || []).map((item) => pick(item, ITEM_FIELDS))
  })
}
