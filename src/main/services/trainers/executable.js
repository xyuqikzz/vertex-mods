import { trainerFailure } from '../../../shared/i18n/trainer-messages.js'
import fs from 'fs'
import path from 'path'

function resolveUniqueExecutablePath(filePath = '') {
  const preferredPath = `${filePath}.exe`
  if (!fs.existsSync(preferredPath)) return preferredPath

  let index = 2
  while (fs.existsSync(`${filePath} (${index}).exe`)) {
    index += 1
  }
  return `${filePath} (${index}).exe`
}

async function hasPortableExecutableSignature(filePath = '') {
  let fileHandle = null
  try {
    fileHandle = await fs.promises.open(filePath, 'r')
    const signature = Buffer.alloc(2)
    const { bytesRead } = await fileHandle.read(signature, 0, 2, 0)
    return bytesRead === 2 && signature[0] === 0x4d && signature[1] === 0x5a
  } finally {
    await fileHandle?.close()
  }
}

export async function ensureFlingTrainerExecutable(filePath = '') {
  const safeFilePath = String(filePath || '').trim()
  if (!safeFilePath || !fs.existsSync(safeFilePath)) {
    return { ...trainerFailure('file_not_found'), migrated: false }
  }

  const extension = path.extname(safeFilePath).toLowerCase()
  if (extension === '.exe') {
    return {
      success: true,
      migrated: false,
      filePath: safeFilePath,
      previousFilePath: safeFilePath
    }
  }

  if (extension) {
    return { ...trainerFailure('invalid_executable_extension'), migrated: false }
  }

  let hasExecutableSignature = false
  try {
    hasExecutableSignature = await hasPortableExecutableSignature(safeFilePath)
  } catch {
    return { ...trainerFailure('executable_file_unreadable'), migrated: false }
  }

  if (!hasExecutableSignature) {
    return { ...trainerFailure('invalid_executable_signature'), migrated: false }
  }

  const executablePath = resolveUniqueExecutablePath(safeFilePath)
  try {
    await fs.promises.rename(safeFilePath, executablePath)
  } catch {
    return { ...trainerFailure('executable_file_migration_failed'), migrated: false }
  }
  return {
    success: true,
    migrated: true,
    filePath: executablePath,
    previousFilePath: safeFilePath
  }
}
