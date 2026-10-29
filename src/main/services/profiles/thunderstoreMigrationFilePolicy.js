import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'fs-extra'

function isRegenerableEcosystemCache(filePath = '') {
  const resolvedPath = path.resolve(String(filePath || ''))
  return (
    path.basename(resolvedPath).toLowerCase() === 'ecosystem-cache.json' &&
    path.basename(path.dirname(resolvedPath)).toLowerCase() === 'ecosystem'
  )
}

async function hashFile(filePath = '') {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function areFilesIdentical(leftPath, rightPath) {
  const [leftStat, rightStat] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)])
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false
  const [leftHash, rightHash] = await Promise.all([hashFile(leftPath), hashFile(rightPath)])
  return leftHash === rightHash
}

export async function inspectThunderstoreMigrationTarget(sourcePath, targetPath) {
  if (!(await fs.pathExists(targetPath))) {
    return { conflict: false, reuseExisting: false, reason: 'target_missing' }
  }
  if (await areFilesIdentical(sourcePath, targetPath)) {
    return { conflict: false, reuseExisting: true, reason: 'identical' }
  }
  if (isRegenerableEcosystemCache(sourcePath) && isRegenerableEcosystemCache(targetPath)) {
    return {
      conflict: false,
      reuseExisting: true,
      reason: 'regenerable_cache_target_kept'
    }
  }
  return { conflict: true, reuseExisting: false, reason: 'different_content' }
}
