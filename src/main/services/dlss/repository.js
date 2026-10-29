export function createDlssRepository(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS dlss_bindings (id TEXT PRIMARY KEY, instance_key TEXT NOT NULL UNIQUE, record TEXT NOT NULL)'
  )
  return {
    list: () =>
      db
        .prepare('SELECT record FROM dlss_bindings ORDER BY rowid DESC')
        .all()
        .map((row) => JSON.parse(row.record)),
    get: (id) => {
      const row = db.prepare('SELECT record FROM dlss_bindings WHERE id = ?').get(id)
      return row ? JSON.parse(row.record) : null
    },
    save(record) {
      db.prepare(
        'INSERT INTO dlss_bindings(id, instance_key, record) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET instance_key=excluded.instance_key, record=excluded.record'
      ).run(record.id, record.instanceKey, JSON.stringify(record))
      return record
    },
    remove: (id) => db.prepare('DELETE FROM dlss_bindings WHERE id = ?').run(id)
  }
}
