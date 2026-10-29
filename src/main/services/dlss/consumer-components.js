import fs from 'node:fs/promises'
import path from 'node:path'
import { hashFile } from './files.js'
import journal from './swapper/file-journal.js'
import {
  consumerVersions,
  resolveConsumer
} from '../../../shared/dlss-swapper/consumer-versions.js'

export async function inspectConsumer(gameRoot, target) {
  if (!target) return null
  const dir =
    target.bitness === 32
      ? path.join(path.dirname(target.path), 'host64')
      : path.dirname(target.path)
  const rel = path.relative(gameRoot, path.join(dir, 'renodx-dlss5.addon64'))
  const file = journal.safePath(gameRoot, rel)
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return { known: false, rel }
    const sha256 = await hashFile(file)
    const known = consumerVersions.find((c) => c.size === stat.size && c.sha256 === sha256)
    return { known: !!known, rel, sha256, size: stat.size, version: known?.version || null }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function planConsumer(gameRoot, target, route, preference) {
  const consumer = await inspectConsumer(gameRoot, target)
  return { consumer, plan: resolveConsumer({ ...target, consumer }, route, preference) }
}
