import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'

const ARIA2_PLATFORM_DIR = 'win32'
const ARIA2_BINARY_NAME = 'aria2c.exe'

function uniquePathList(pathList = []) {
  const seen = new Set()
  return pathList
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

export function getAria2PlatformDir() {
  if (process.arch !== 'x64') {
    throw new Error('aria2 下载引擎当前仅支持 Windows x64')
  }
  return ARIA2_PLATFORM_DIR
}

export function getAria2BinaryName() {
  return ARIA2_BINARY_NAME
}

function getAria2ResourceRootCandidates() {
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, 'resources')]
  }

  return uniquePathList([
    path.join(process.cwd(), 'resources'),
    app.getAppPath ? path.join(app.getAppPath(), 'resources') : '',
    path.join(__dirname, '..', '..', '..', '..', 'resources'),
    path.join(__dirname, '..', '..', '..', 'resources'),
    path.join(__dirname, '..', '..', 'resources')
  ])
}

export function getAria2ExecutableCandidates() {
  const platformDir = getAria2PlatformDir()
  const binaryName = getAria2BinaryName()
  return getAria2ResourceRootCandidates().map((rootPath) =>
    path.join(rootPath, 'aria2', platformDir, binaryName)
  )
}

export function getAria2ExecutablePath() {
  const candidates = getAria2ExecutableCandidates()
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

export function assertAria2Executable() {
  const exePath = getAria2ExecutablePath()
  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error(`未找到 aria2 下载引擎：${exePath}`)
  }

  try {
    execFileSync(exePath, ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true
    })
  } catch (error) {
    throw new Error(`aria2 下载引擎不可执行：${exePath}。${error?.message || error}`)
  }

  return exePath
}
