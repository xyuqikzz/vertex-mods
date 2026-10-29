import { nativeText } from '../../services/uiLanguage.js'
import AdmZip from 'adm-zip'
import { app, dialog } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import { createHash } from 'crypto'
import { pathToFileURL } from 'url'

const CUSTOM_PET_DIR_NAME = 'ai-mascot-pets'
const CUSTOM_PET_ID_PREFIX = 'custom:'
const PET_MANIFEST_FILE = 'pet.json'
const PET_SPRITESHEET_FILE = 'spritesheet.webp'
const SPRITESHEET_WIDTH = 1536
const SPRITESHEET_HEIGHT = 1872

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toZipPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
}

function isUnsafeZipRelativePath(value = '') {
  const text = toZipPath(value)
  if (!text) return true
  if (/^[a-zA-Z]:/.test(text)) return true
  if (path.posix.isAbsolute(text)) return true

  const normalized = path.posix.normalize(text)
  return normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')
}

function sanitizeDirectoryName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function createCustomPetDirectoryName(petId) {
  const safeId = sanitizeDirectoryName(petId) || 'pet'
  const hash = createHash('sha1')
    .update(String(petId || safeId))
    .digest('hex')
    .slice(0, 8)
  return `${safeId}-${hash}`
}

function getCustomPetRootPath() {
  return path.join(app.getPath('userData'), CUSTOM_PET_DIR_NAME)
}

function isInsideDirectory(targetPath, rootPath) {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function readWebpSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw new Error('spritesheet.webp 文件无效。')
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('spritesheet.webp 必须是 WebP 文件。')
  }

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + chunkSize > buffer.length) break

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return {
        width: readUInt24LE(buffer, dataOffset + 4) + 1,
        height: readUInt24LE(buffer, dataOffset + 7) + 1
      }
    }

    if (chunkType === 'VP8L' && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      }
    }

    if (
      chunkType === 'VP8 ' &&
      chunkSize >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      }
    }

    offset = dataOffset + chunkSize + (chunkSize % 2)
  }

  throw new Error('无法读取 spritesheet.webp 的尺寸。')
}

function assertSpritesheetSize(buffer) {
  const size = readWebpSize(buffer)
  if (size.width !== SPRITESHEET_WIDTH || size.height !== SPRITESHEET_HEIGHT) {
    throw new Error(
      `spritesheet.webp 尺寸必须是 ${SPRITESHEET_WIDTH}x${SPRITESHEET_HEIGHT}，当前是 ${size.width}x${size.height}。`
    )
  }
}

function findPackageEntry(zip, basename) {
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      entry,
      name: toZipPath(entry.entryName)
    }))
    .filter((item) => path.posix.basename(item.name).toLowerCase() === basename)
    .sort((left, right) => left.name.split('/').length - right.name.split('/').length)[0]
}

function findSpritesheetEntry(zip, manifestEntryName, spritesheetPath) {
  const manifestDir = path.posix.dirname(manifestEntryName)
  const baseDir = manifestDir === '.' ? '' : manifestDir
  const relativeSpritesheetPath = toZipPath(spritesheetPath || PET_SPRITESHEET_FILE)
  if (isUnsafeZipRelativePath(relativeSpritesheetPath)) {
    throw new Error('pet.json 中的 spritesheetPath 无效。')
  }

  const expectedName = path.posix.normalize(path.posix.join(baseDir, relativeSpritesheetPath))
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      entry,
      name: toZipPath(entry.entryName)
    }))

  return (
    entries.find((item) => item.name === expectedName) ||
    entries.find(
      (item) =>
        path.posix.dirname(item.name) === baseDir &&
        path.posix.basename(item.name).toLowerCase() === PET_SPRITESHEET_FILE
    )
  )
}

function parsePetPackage(zipPath) {
  const zip = new AdmZip(zipPath)
  const manifestItem = findPackageEntry(zip, PET_MANIFEST_FILE)
  if (!manifestItem) {
    throw new Error('压缩包内缺少 pet.json。')
  }

  let manifest = null
  try {
    manifest = JSON.parse(zip.readAsText(manifestItem.entry))
  } catch {
    throw new Error('pet.json 不是有效 JSON。')
  }

  const petId = toSafeText(manifest?.id)
  if (!petId) {
    throw new Error('pet.json 缺少 id。')
  }

  const spritesheetItem = findSpritesheetEntry(
    zip,
    manifestItem.name,
    manifest?.spritesheetPath || PET_SPRITESHEET_FILE
  )
  if (!spritesheetItem) {
    throw new Error('压缩包内缺少 spritesheet.webp。')
  }

  const spritesheetBuffer = zip.readFile(spritesheetItem.entry)
  assertSpritesheetSize(spritesheetBuffer)

  return {
    manifest: {
      ...manifest,
      id: petId,
      displayName: toSafeText(manifest.displayName, petId),
      description: toSafeText(manifest.description),
      spritesheetPath: PET_SPRITESHEET_FILE
    },
    spritesheetBuffer
  }
}

async function readCustomPetDirectory(rootPath, directoryName) {
  if (!/^[a-z0-9_-]+$/.test(directoryName)) return null

  const petDir = path.join(rootPath, directoryName)
  const manifestPath = path.join(petDir, PET_MANIFEST_FILE)
  const spritesheetPath = path.join(petDir, PET_SPRITESHEET_FILE)
  if (!(await fs.pathExists(manifestPath)) || !(await fs.pathExists(spritesheetPath))) {
    return null
  }

  try {
    const [manifest, spritesheetBuffer, spritesheetStat] = await Promise.all([
      fs.readJson(manifestPath),
      fs.readFile(spritesheetPath),
      fs.stat(spritesheetPath)
    ])
    assertSpritesheetSize(spritesheetBuffer)

    const originalId = toSafeText(manifest?.id, directoryName)
    return {
      id: `${CUSTOM_PET_ID_PREFIX}${directoryName}`,
      originalId,
      displayName: toSafeText(manifest?.displayName, originalId),
      description: toSafeText(manifest?.description),
      spritesheetPath: PET_SPRITESHEET_FILE,
      spritesheetUrl: `${pathToFileURL(spritesheetPath).href}?mtime=${Math.round(spritesheetStat.mtimeMs)}`,
      source: 'custom'
    }
  } catch (error) {
    console.warn('读取自定义桌宠失败:', petDir, error)
    return null
  }
}

export async function listCustomAiMascotPets() {
  const rootPath = getCustomPetRootPath()
  await fs.ensureDir(rootPath)

  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const pets = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readCustomPetDirectory(rootPath, entry.name))
  )

  return pets.filter(Boolean)
}

export async function importAiMascotPetZip() {
  const result = await dialog.showOpenDialog({
    title: nativeText('selectPetArchive'),
    properties: ['openFile'],
    filters: [
      {
        name: 'Codex Pet 压缩包',
        extensions: ['zip']
      }
    ]
  })

  if (result.canceled || !result.filePaths?.[0]) {
    return {
      canceled: true
    }
  }

  const packagePath = result.filePaths[0]
  const { manifest, spritesheetBuffer } = parsePetPackage(packagePath)
  const rootPath = getCustomPetRootPath()
  const directoryName = createCustomPetDirectoryName(manifest.id)
  const targetDir = path.join(rootPath, directoryName)
  if (!isInsideDirectory(targetDir, rootPath)) {
    throw new Error('桌宠保存路径无效。')
  }

  await fs.ensureDir(rootPath)
  await fs.remove(targetDir)
  await fs.ensureDir(targetDir)
  await Promise.all([
    fs.writeJson(path.join(targetDir, PET_MANIFEST_FILE), manifest, { spaces: 2 }),
    fs.writeFile(path.join(targetDir, PET_SPRITESHEET_FILE), spritesheetBuffer)
  ])

  const pets = await listCustomAiMascotPets()
  const pet = pets.find((item) => item.id === `${CUSTOM_PET_ID_PREFIX}${directoryName}`) || null

  return {
    canceled: false,
    pet,
    pets
  }
}
