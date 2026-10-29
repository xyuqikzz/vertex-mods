import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import initPath from '../initPath.js'

// 从环境变量获取应用名称
const { VITE_APP_NAME } = import.meta.env

/**
 * SQLite 数据库操作类
 * 提供数据库连接、查询、事务管理等操作
 */
class SQLiteDB {
  // ==================== 类属性 ====================
  dbPath = path.join(initPath, `${VITE_APP_NAME}.db`)
  db = null
  statementCache = new Map() // SQL 语句缓存

  // ==================== 构造函数 ====================
  /**
   * 初始化数据库连接
   * @param {string} [dbName] 数据库文件名（可选）
   * @param {boolean} [verbose=true] 是否打印调试日志
   */
  constructor(dbName, verbose = false) {
    // 处理数据库文件名
    if (dbName) {
      this.dbPath = path.join(initPath, dbName)
    }

    // 确保目录存在
    this._ensureDirExists()

    // 连接数据库
    this.db = new Database(this.dbPath, {
      verbose: verbose ? console.log : null
    })

    // 启用 WAL 模式提高并发性能
    this.db.pragma('journal_mode = WAL')
  }

  // ==================== 私有方法 ====================
  /**
   * 确保数据库目录存在
   */
  _ensureDirExists() {
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * 包装错误信息
   * @param {Error} error 原始错误
   * @param {string} sql SQL 语句
   * @param {Array} params 查询参数
   * @returns {Object} 包装后的错误对象
   */
  _wrapError(error, sql, params = []) {
    // 内层 run/get/事务已包装并打印过的错误直接透传，避免嵌套事务重复打印 "SQL Error: SQL Error: ..."
    if (error && !(error instanceof Error) && typeof error.sql === 'string') {
      return error
    }

    console.error(`SQL Error: ${error.message}`, {
      sql,
      params: params.length > 0 ? params : undefined
    })

    return {
      message: `SQL Error: ${error.message}`,
      sql,
      params,
      stack: error.stack
    }
  }

  /**
   * 准备 SQL 语句（使用缓存）
   * @param {string} sql SQL 语句
   * @returns {Statement} 准备好的语句
   */
  _prepare(sql) {
    if (!this.statementCache.has(sql)) {
      this.statementCache.set(sql, this.db.prepare(sql))
    }
    return this.statementCache.get(sql)
  }

  // ==================== 公共方法 ====================
  /**
   * 执行 SQL 语句（无返回值）
   * @param {string} sql SQL 语句
   * @param {Array} [params=[]] 参数
   * @returns {Object} { changes, lastInsertRowid }
   */
  run(sql, params = []) {
    try {
      const stmt = this._prepare(sql)
      const result = stmt.run(...params)
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      }
    } catch (error) {
      throw this._wrapError(error, sql, params)
    }
  }

  /**
   * 批量执行 SQL 语句
   * @param {Array} operations 操作数组 [{sql, params}]
   */
  batch(operations) {
    try {
      const results = []
      for (const op of operations) {
        const stmt = this._prepare(op.sql)
        results.push(stmt.run(...(op.params || [])))
      }
      return results
    } catch (error) {
      throw this._wrapError(error, 'BATCH OPERATION')
    }
  }

  /**
   * 查询单条记录
   * @param {string} sql SQL 语句
   * @param {Array} [params=[]] 参数
   * @returns {Object|null} 记录对象或 null
   */
  get(sql, params = []) {
    try {
      const stmt = this._prepare(sql)
      return stmt.get(...params) || null
    } catch (error) {
      throw this._wrapError(error, sql, params)
    }
  }

  /**
   * 查询多条记录
   * @param {string} sql SQL 语句
   * @param {Array} [params=[]] 参数
   * @returns {Array} 记录数组
   */
  all(sql, params = []) {
    try {
      const stmt = this._prepare(sql)
      return stmt.all(...params)
    } catch (error) {
      throw this._wrapError(error, sql, params)
    }
  }

  /**
   * 迭代查询结果，避免一次性加载全部记录
   * @param {string} sql SQL 语句
   * @param {Array} [params=[]] 参数
   * @returns {IterableIterator<Object>}
   */
  iterate(sql, params = []) {
    try {
      const stmt = this._prepare(sql)
      return stmt.iterate(...params)
    } catch (error) {
      throw this._wrapError(error, sql, params)
    }
  }

  /**
   * 执行事务
   * @param {Function} operations 包含数据库操作的函数
   */
  transaction(operations) {
    try {
      // 使用内置事务API提高性能
      return this.db.transaction(() => {
        operations()
      })()
    } catch (error) {
      throw this._wrapError(error, 'TRANSACTION')
    }
  }

  /**
   * 清理已缓存的 SQL 语句
   */
  clearStatementCache() {
    this.statementCache.clear()
  }

  /**
   * 检查表是否存在
   * @param {string} tableName 表名
   * @returns {boolean} 表是否存在
   */
  tableExists(tableName) {
    const sql = `
      SELECT count(*) AS count
      FROM sqlite_master
      WHERE type='table' AND name = ?
    `
    const result = this.get(sql, [tableName])
    return result && result.count > 0
  }

  /**
   * 备份数据库
   * @param {string} backupPath 备份路径
   */
  backup(backupPath) {
    try {
      const backupDb = new Database(backupPath)
      this.db.backup(backupDb, {
        progress: ({ totalPages, remainingPages }) => {
          const percent = (((totalPages - remainingPages) / totalPages) * 100).toFixed(2)
          console.log(`Backup progress: ${percent}%`)
        }
      })
      backupDb.close()
      console.log(`Database backed up to: ${backupPath}`)
    } catch (error) {
      throw this._wrapError(error, 'BACKUP')
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close()
      this.db = null
      console.log('Database connection closed')
    }
  }
}

// 导出单例实例
const dbInstance = new SQLiteDB()
export default dbInstance
