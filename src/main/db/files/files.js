import dbInstance from '../dbInstance.js'

export function insertFile(fileData) {
  const sql = `
    INSERT INTO files (module, type, version, external_id, file_path, md5, create_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  const params = [
    fileData.module,
    fileData.type,
    fileData.version,
    fileData.external_id,
    fileData.filePath,
    fileData.md5,
    fileData.create_time
  ]
  dbInstance.run(sql, params)
}

export function getFileRecordById(fileId) {
  return dbInstance.get('SELECT * FROM files WHERE id = ?', [fileId])
}

export function findFileRecord(file) {
  const { module, id, fileMd5 = '' } = file
  let sql = `select *
             from files
             where module = ?
               and external_id = ?
             order by create_time desc
             limit 1`

  if (fileMd5) {
    sql = `select *
           from files
             where module = ?
               and external_id = ?
               and md5 = ?
           order by create_time desc
           limit 1`
  }

  return dbInstance.get(sql, fileMd5 ? [module, id, fileMd5] : [module, id])
}

export function getAppFileRecords() {
  const sql = `select *
               from files
               where module = 1`
  return dbInstance.all(sql)
}

export function getAllFileRecordsDB() {
  const sql = `select *
               from files`
  return dbInstance.all(sql)
}

export function getFileRecordPathBatchDB(afterId = 0, limit = 200) {
  const sql = `select id, file_path
               from files
               where id > ?
               order by id asc
               limit ?`
  return dbInstance.all(sql, [afterId, limit])
}

export function getFileRecordBackupCleanupBatchDB(afterId = 0, limit = 200) {
  const sql = `select id, module, type, version, external_id, file_path, md5, create_time
               from files
               where id > ?
               order by id asc
               limit ?`
  return dbInstance.all(sql, [afterId, limit])
}

export function iterateFileRecordPathsDB() {
  const sql = `select id, file_path
               from files`
  return dbInstance.iterate(sql)
}

export function deleteFileRecordById(fileId) {
  return dbInstance.run('DELETE FROM files WHERE id = ?', [fileId])
}
