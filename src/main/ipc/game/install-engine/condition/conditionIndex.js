/**
 * condition/conditionIndex.js — 快照条件索引
 *
 * 把目录快照预处理为 O(1) 命名/扩展名查找索引，并按快照对象弱引用缓存，
 * 供条件分派器与各条件族模块复用（避免重复构建）。
 */
import path from 'path'
import { isPlainObject, normalizeRelativeRulePath } from '../contracts.js'
import { getEntryName } from './conditionUtils.js'

export const EMPTY_SNAPSHOT = Object.freeze({
  directEntries: [],
  directDirs: [],
  directFiles: [],
  allDirs: [],
  allFiles: [],
  recursiveLoaded: true
})

const SNAPSHOT_CONDITION_INDEX_CACHE = new WeakMap()

export function createConditionIndex(snapshot = EMPTY_SNAPSHOT) {
  const directEntries = Array.isArray(snapshot.directEntries) ? snapshot.directEntries : []
  const directDirs = Array.isArray(snapshot.directDirs) ? snapshot.directDirs : []
  const directFiles = Array.isArray(snapshot.directFiles) ? snapshot.directFiles : []
  const allDirs = Array.isArray(snapshot.allDirs) ? snapshot.allDirs : []
  const allFiles = Array.isArray(snapshot.allFiles) ? snapshot.allFiles : []
  const allFilePaths = allFiles.map((item) => normalizeRelativeRulePath(item.relativePath || ''))
  const allDirPaths = allDirs.map((item) => normalizeRelativeRulePath(item.relativePath || ''))

  let extensionMap = null
  const getFilesByExtension = (ext) => {
    if (!extensionMap) {
      extensionMap = new Map()
      for (const file of allFiles) {
        let extName = file.ext || ''
        if (!extName && file.relativePath) {
          const rawExt = path.extname(file.relativePath)
          extName = rawExt.startsWith('.') ? rawExt.slice(1) : rawExt
        }
        const cleanExt = String(extName).toLowerCase()
        if (cleanExt) {
          if (!extensionMap.has(cleanExt)) {
            extensionMap.set(cleanExt, [])
          }
          extensionMap.get(cleanExt).push(file)
        }
      }
    }
    return extensionMap.get(String(ext).toLowerCase()) || []
  }

  return {
    directEntries,
    directDirs,
    directFiles,
    allDirs,
    allFiles,
    allFilePaths,
    allDirPaths,
    directDirNames: new Set(directDirs.map(getEntryName)),
    directFileNames: new Set(directFiles.map(getEntryName)),
    directEntryNames: new Set(directEntries.map(getEntryName)),
    allFileNames: new Set(allFiles.map(getEntryName)),
    allDirNames: new Set(allDirs.map(getEntryName)),
    getFilesByExtension
  }
}

export function getConditionIndex(snapshot = EMPTY_SNAPSHOT) {
  const source = isPlainObject(snapshot) ? snapshot : EMPTY_SNAPSHOT
  if (SNAPSHOT_CONDITION_INDEX_CACHE.has(source)) {
    return SNAPSHOT_CONDITION_INDEX_CACHE.get(source)
  }

  const index = createConditionIndex(source)
  SNAPSHOT_CONDITION_INDEX_CACHE.set(source, index)
  return index
}
