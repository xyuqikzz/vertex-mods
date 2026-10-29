import fs from 'node:fs'
import path from 'node:path'

const key = value => path.resolve(value).replace(/\\/g, '/').toLowerCase()
const fail = code => { throw Object.assign(new Error(code), { code }) }

export function assertTrainerPathShape(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) ||
    [...value].some(character => character.charCodeAt(0) < 32) || /[<>"|?*]/.test(value) || value.slice(2).includes(':') ||
    value.split(/[\\/]/).some(part => part === '..' || /[. ]$/.test(part)) ||
    path.win32.resolve(value) === path.win32.parse(value).root) fail('invalid_trainer_path')
  return path.resolve(value)
}

export function isTrainerDownloadRecord(record) {
  try {
    const url = new URL(record.download_url)
    return ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'flingtrainer.com' || url.hostname.endsWith('.flingtrainer.com')) &&
      (record.source_platform === 'fling' || record.module === '风灵月影')
  } catch { return false }
}

export function assertTrainerFileAccess(value, records) {
  const filePath = assertTrainerPathShape(value)
  const record = records.find(item => isTrainerDownloadRecord(item) &&
    typeof item.file_path === 'string' && key(item.file_path) === key(filePath))
  if (!record) fail('untrusted_trainer_file')
  // 检查每级路径，防止已登记路径经符号链接或 junction 指向另一文件。
  const parsed = path.parse(filePath)
  let current = parsed.root
  for (const segment of filePath.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, segment)
    let stat
    try { stat = fs.lstatSync(current) } catch (error) {
      if (error.code === 'ENOENT') return { filePath, record, exists: false }
      throw error
    }
    if (stat.isSymbolicLink()) fail('linked_trainer_path')
    if (current === filePath && !stat.isFile()) fail('invalid_trainer_path')
  }
  return { filePath, record, exists: true }
}
