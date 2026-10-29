// Adapted to Vertex ES modules from DLSS5-Swapper v2.2.7 (MIT).
// Copyright (c) 2026 Rakan Alkhaldi. See resources/licenses/DLSS5-Swapper-LICENSE.txt.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
// History is an append-only audit log, not a view of the current backup.
// Backups change on reinstall/restore; the audit survives both and library resets.

const key = (dir) => path.resolve(dir).toLowerCase()
const count = (value) =>
  Array.isArray(value) ? value.length : Number.isSafeInteger(value) && value >= 0 ? value : 0
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const fingerprint = (row) => `${key(row.dir)}|${row.manifestDate}|${row.action}`

function operation(dir, manifest = {}, action = 'install', name) {
  return {
    id: crypto.randomUUID(),
    name: name || path.basename(dir),
    dir: path.resolve(dir),
    date: new Date().toISOString(),
    manifestDate: validDate(manifest.date) ? manifest.date : null,
    action,
    undone: action === 'restore',
    route: manifest.route || null,
    exe: manifest.game?.exe || null,
    api: manifest.game?.api || null,
    replaced: count(manifest.replaced),
    added: count(manifest.added)
  }
}

function fromManifests(folders) {
  const rows = []
  for (const { dir, name } of folders) {
    const root = path.join(dir, '_DLSS5_Backup')
    // Never import an in-flight/rolled-back switch as an installation.
    if (fs.existsSync(path.join(root, 'pending-switch.json'))) continue
    let files
    try {
      files = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      const match = /^manifest\.json(\.done(?:-(\d+))?)?$/.exec(file.name)
      if (!match || !file.isFile()) continue
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, file.name), 'utf8'))
        if (
          manifest?.version !== 1 ||
          !validDate(manifest.date) ||
          !Array.isArray(manifest.replaced) ||
          !Array.isArray(manifest.added)
        )
          continue
        const row = operation(dir, manifest, match[1] ? 'restore' : 'install', name)
        // Older backups only contain a snapshot, not every historic click.
        row.imported = true
        row.date = match[2] ? new Date(Number(match[2])).toISOString() : manifest.date
        row.id = 'backup:' + crypto.createHash('sha256').update(fingerprint(row)).digest('hex')
        rows.push(row)
      } catch {
        /* Ignore one corrupt backup, never discard the rest. */
      }
    }
  }
  return rows
}

class HistoryStore {
  constructor(file) {
    this.file = file
    this.pending = new Map()
  }

  saved() {
    let content
    try {
      content = fs.readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const rows = new Map()
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (
          typeof row.id === 'string' &&
          typeof row.dir === 'string' &&
          path.isAbsolute(row.dir) &&
          validDate(row.date) &&
          ['install', 'restore', 'recovery'].includes(row.action)
        )
          rows.set(row.id, row)
      } catch {
        /* A truncated final write must not lose older operations. */
      }
    }
    return [...rows.values()]
  }

  append(rows) {
    if (!rows.length) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const fd = fs.openSync(this.file, 'a')
    try {
      // Leading newline also separates a previously interrupted partial record.
      fs.writeFileSync(fd, '\n' + rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  record(dir, manifest, action, name) {
    const row = operation(dir, manifest, action, name)
    this.pending.set(row.id, row)
    this.append([row])
    this.pending.delete(row.id)
    return row
  }

  list(folders = [], onWarning = () => {}) {
    let saved = []
    try {
      saved = this.saved()
    } catch (error) {
      onWarning(error)
    }
    const ids = new Set(saved.map((row) => row.id))
    for (const id of ids) this.pending.delete(id)
    const rows = [...saved, ...[...this.pending.values()].filter((row) => !ids.has(row.id))]
    const seen = new Set(rows.map(fingerprint))
    for (const row of fromManifests(folders)) {
      if (!seen.has(fingerprint(row))) {
        rows.push(row)
        seen.add(fingerprint(row))
      }
    }
    const unsaved = rows.filter((row) => !ids.has(row.id))
    try {
      this.append(unsaved)
      for (const row of unsaved) this.pending.delete(row.id)
    } catch (error) {
      for (const row of unsaved) this.pending.set(row.id, row)
      onWarning(error)
    }
    return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  }
}

export { HistoryStore, fromManifests, operation }
