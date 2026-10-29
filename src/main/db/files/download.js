import dbInstance from '../dbInstance.js'

export function getTrainerDownloadRecordsDB() {
  return dbInstance.all('SELECT * FROM download_records WHERE source_platform = ? OR module = ?', ['fling', '风灵月影'])
}

export function getAllDownloadRecordsDB() {
  const sql = `select *
               from download_records
               order by id desc`
  return dbInstance.all(sql)
}

export function getDownloadRecordFilePathBatchDB(afterId = 0, limit = 200) {
  const sql = `select id, file_path
               from download_records
               where id > ?
               order by id asc
               limit ?`
  return dbInstance.all(sql, [afterId, limit])
}

export function iterateDownloadRecordFilePathsDB() {
  const sql = `select id, file_path
               from download_records`
  return dbInstance.iterate(sql)
}

export function deleteDownloadRecordById(recordId) {
  return dbInstance.run('DELETE FROM download_records WHERE id = ?', [recordId])
}

export function deleteDownloadRecordsByFilePath(filePath) {
  return dbInstance.run('DELETE FROM download_records WHERE file_path = ?', [filePath])
}

export function updateDownloadRecordFilePathDB(previousFilePath, nextFilePath, fileType = '') {
  return dbInstance.run(
    'UPDATE download_records SET file_path = ?, file_type = COALESCE(NULLIF(?, ?), file_type) WHERE file_path = ?',
    [nextFilePath, fileType, '', previousFilePath]
  )
}

export function clearAllDownloadRecordsDB() {
  const sql = `delete
               from download_records`
  dbInstance.run(sql)
}
