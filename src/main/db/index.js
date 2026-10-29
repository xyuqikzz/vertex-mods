import dbInstance from './dbInstance.js'
import { upDate } from './migrations/index.js'
import INIT_SQL from '../../../init.sql?raw'

function loadInitStatements() {
  const sqlContent = INIT_SQL.replace(/^\uFEFF/, '')

  return sqlContent
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`)
}

function initializeDatabase() {
  const statements = loadInitStatements()

  try {
    statements.forEach((sql) => {
      dbInstance.run(sql)
    })
    console.log('[数据库初始化] 表结构检查完成')
    upDate()
  } catch (error) {
    console.error('[数据库初始化错误]', error)
  }
}

// 执行初始化
initializeDatabase()
