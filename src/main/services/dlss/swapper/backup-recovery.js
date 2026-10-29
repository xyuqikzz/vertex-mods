// Recovery of retired install records, adapted from DLSS5-Swapper v2.2.9 (MIT).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { safePath } from './file-journal.js'

function hash(file, stat, hashes) {
  const key = `${file}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`
  if (hashes.has(key)) return hashes.get(key)
  const digest = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(256 * 1024)
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)))
      digest.update(buffer.subarray(0, count))
  } finally {
    fs.closeSync(fd)
  }
  const value = digest.digest('hex')
  if (hashes.size >= 512) hashes.clear()
  hashes.set(key, value)
  return value
}
function validate(gameDir, manifest) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.added) ||
    !Array.isArray(manifest.replaced) ||
    !manifest.game?.exe ||
    (manifest.backupPrefix && !/^originals\/[a-f0-9-]+$/.test(manifest.backupPrefix))
  )
    throw Object.assign(new Error('errBackupInvalid'), { code: 'errBackupInvalid' })
  safePath(gameDir, manifest.game.exe)
  for (const rel of [
    ...manifest.added,
    ...(manifest.addedDirs || []),
    ...manifest.replaced.map((f) => f.rel)
  ])
    safePath(gameDir, rel)
  return manifest
}
const backup = (gameDir, manifest, rel) =>
  safePath(gameDir, path.join('_DLSS5_Backup', manifest.backupPrefix || '', rel))

export function assertHistoricalRestoreSafe(gameDir, manifest) {
  validate(gameDir, manifest)
  const hashes = new Map()
  const exeDir = path.dirname(manifest.game.exe)
  const paths = new Set([
    ...manifest.added, ...manifest.replaced.map((item) => item.rel),
    ...(manifest.reshade?.filesAdded || []).map((name) => path.join(exeDir, name)),
    ...(manifest.reshade?.installedByUs && manifest.reshade.file
      ? [path.join(exeDir, manifest.reshade.file)] : [])
  ])
  const conflicts = []
  for (const rel of paths) {
    const file = safePath(gameDir, rel)
    if (!fs.existsSync(file)) continue
    const stat = fs.statSync(file)
    if (stat.isDirectory() && !manifest.added.includes(rel) &&
        !manifest.replaced.some((item) => item.rel === rel)) continue
    const expected = manifest.deploymentHashes?.[rel]
    if (!stat.isFile() || !/^[a-f0-9]{64}$/i.test(expected || '') ||
        hash(file, stat, hashes) !== expected.toLowerCase()) conflicts.push(rel)
  }
  if (conflicts.length) throw Object.assign(new Error(
    `历史恢复存在已修改或无法核验的文件，未修改游戏目录：${conflicts.slice(0, 8).join('、')}`
  ), { code: 'errBackendRecovery', conflicts })
}
function stillInstalled(gameDir, manifest, hashes) {
  // Validate the whole record before using any part of it, including records
  // copied from another game folder. Never follow an escaping junction.
  validate(gameDir, manifest)
  for (const rel of manifest.added) {
    const file = safePath(gameDir, rel)
    if (!fs.existsSync(file)) continue
    const stat = fs.statSync(file)
    if (!stat.isFile()) continue
    // A different mod may reuse the filename after a successful restore.
    if (manifest.deploymentHashes) {
      if (
        manifest.deploymentHashes[rel] &&
        hash(file, stat, hashes) === manifest.deploymentHashes[rel]
      )
        return true
    } else return true
  }
  for (const item of manifest.replaced) {
    const target = safePath(gameDir, item.rel),
      original = backup(gameDir, manifest, item.rel)
    if (!fs.existsSync(target) || !fs.existsSync(original)) continue
    const a = fs.statSync(target),
      b = fs.statSync(original)
    if (!a.isFile() || !b.isFile()) continue
    if (
      manifest.deploymentHashes &&
      hash(target, a, hashes) !== manifest.deploymentHashes[item.rel]
    )
      continue
    if (a.size !== b.size || hash(target, a, hashes) !== hash(original, b, hashes)) return true
  }
  return false
}
export function recoverableManifest(gameDir) {
  // Windows copies can preserve timestamps. Cache only within one synchronous
  // inspection; a later install/restore must re-read the actual bytes.
  const hashes = new Map()
  const root = safePath(gameDir, '_DLSS5_Backup')
  if (!fs.existsSync(root)) return null
  const records = fs
    .readdirSync(root)
    .filter((name) => /^manifest\.json\.done(?:-|$)/.test(name))
    .map((name) => ({ path: safePath(gameDir, path.join('_DLSS5_Backup', name)), name }))
    .map((entry) => ({ ...entry, at: fs.statSync(entry.path).mtimeMs }))
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))
  for (const entry of records) {
    try {
      if (fs.statSync(entry.path).size > 4 * 1024 * 1024) continue
      const manifest = JSON.parse(fs.readFileSync(entry.path, 'utf8'))
      if (stillInstalled(gameDir, manifest, hashes)) return { ...entry, manifest, recovered: true }
    } catch {
      /* Malformed/escaping retired records cannot authorize recovery. */
    }
  }
  return null
}
export function restoreRecord(gameDir) {
  const file = safePath(gameDir, '_DLSS5_Backup/manifest.json')
  if (fs.existsSync(file))
    return {
      path: file,
      manifest: validate(gameDir, JSON.parse(fs.readFileSync(file, 'utf8'))),
      recovered: false
    }
  return recoverableManifest(gameDir)
}
