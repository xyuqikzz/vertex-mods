import dbInstance from '../../../../db/dbInstance.js'
import { ensureSourceInstallTaskTables as ensureSourceInstallTaskTablesForDatabase } from '../taskSchema.js'
import { nowIso } from '../contracts.js'

export function run(sql, params = []) {
  return dbInstance.run(sql, params)
}

export function get(sql, params = []) {
  return dbInstance.get(sql, params)
}

export function all(sql, params = []) {
  return dbInstance.all(sql, params)
}

export function ensureSourceInstallTaskTables() {
  ensureSourceInstallTaskTablesForDatabase(dbInstance)
}

export function buildUpdateSql(tableName, keyColumn, keyValue, patch = {}) {
  const columns = []
  const params = []
  Object.entries(patch).forEach(([key, value]) => {
    columns.push(`${key} = ?`)
    params.push(value)
  })
  columns.push('updated_at = ?')
  params.push(nowIso())
  params.push(keyValue)
  return {
    sql: `UPDATE ${tableName} SET ${columns.join(', ')} WHERE ${keyColumn} = ?`,
    params
  }
}
