import path from 'node:path'
import fs from 'node:fs'

export function validateLegacyUninstallManifest(payload, game = {}, endpointType = 0) {
  let entries
  try {
    entries = typeof payload === 'string' ? JSON.parse(payload) : payload
  } catch {
    return false
  }
  const rootValue =
    Number(endpointType) === 1
      ? game.server_root_path || (game.server_exe_path && path.dirname(game.server_exe_path))
      : game.client_root_path || (game.client_exe_path && path.dirname(game.client_exe_path))
  if (
    !rootValue ||
    !path.isAbsolute(rootValue) ||
    path.parse(rootValue).root === path.resolve(rootValue)
  )
    return false
  if (!fs.existsSync(rootValue)) return false
  const realRoot = fs.realpathSync(rootValue)
  const inside = (value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return false
    const relative = path.relative(path.resolve(rootValue), path.resolve(value))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
    let existing = path.resolve(value)
    while (!fs.existsSync(existing) && existing !== path.dirname(existing))
      existing = path.dirname(existing)
    const realRelative = path.relative(realRoot, fs.realpathSync(existing))
    return !realRelative.startsWith('..') && !path.isAbsolute(realRelative)
  }
  const safeFile = (value) => inside(value) && (!fs.existsSync(value) || fs.statSync(value).isFile())
  let fileCount = 0
  const visit = (nodes) =>
    Array.isArray(nodes) &&
    nodes.every((node) => {
      if (typeof node === 'string') {
        fileCount += 1
        return safeFile(node)
      }
      if (!node || !inside(node.path) || ![0, 1].includes(Number(node.type))) return false
      if (Number(node.type) === 1) {
        fileCount += 1
        return safeFile(node.path)
      }
      return visit(node.sub || [])
    })
  return visit(entries) && fileCount > 0
}

export function collectLegacyManifestFiles(payload) {
  let entries
  try {
    entries = typeof payload === 'string' ? JSON.parse(payload) : payload
  } catch {
    return []
  }
  const files = []
  const visit = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (typeof node === 'string') files.push(path.resolve(node).toLowerCase())
      else if (Number(node?.type) === 1 && node.path)
        files.push(path.resolve(node.path).toLowerCase())
      else visit(node?.sub)
    }
  }
  visit(entries)
  return files
}
