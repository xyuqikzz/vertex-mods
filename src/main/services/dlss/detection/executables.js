import fs from 'node:fs'
import path from 'node:path'
import { readPeFile } from '../pe.js'

export const pathKey = (value) => path.resolve(value).toLowerCase()
export function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)
}
export function ownedPath(root, file) {
  try {
    return inside(fs.realpathSync(root), fs.realpathSync(file))
  } catch {
    return false
  }
}
const directory = (file) => {
  try {
    return fs.statSync(file).isDirectory()
  } catch {
    return false
  }
}

function unityProduct(root, data) {
  const file = path.join(data, 'app.info')
  try {
    if (!ownedPath(root, file) || fs.statSync(file).size > 4096) return ''
    const bytes = fs.readFileSync(file)
    const lines = bytes
      .toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/)
    return lines.length === 2 &&
      lines[1].length <= 256 &&
      !/[\\/]/.test(lines[1]) &&
      ![...lines[1]].some((char) => char.charCodeAt(0) < 32)
      ? lines[1]
      : ''
  } catch {
    return ''
  }
}

export function engineFor(root, exe) {
  const match = exe.path.match(/^(.*?)[\\/]Binaries[\\/]Win(?:32|64)[\\/]/i)
  if (
    match &&
    inside(root, match[1]) &&
    (/-Shipping\.exe$/i.test(exe.name) ||
      exe.launchers?.length ||
      directory(path.join(path.dirname(match[1]), 'Engine')))
  )
    return { kind: 'unreal', project: path.basename(match[1]), directory: match[1] }
  const data = path.join(
    path.dirname(exe.path),
    path.basename(exe.path, path.extname(exe.path)) + '_Data'
  )
  if (
    directory(data) &&
    ownedPath(root, data) &&
    (fs.existsSync(path.join(data, 'globalgamemanagers')) ||
      fs.existsSync(path.join(data, 'boot.config')))
  )
    return { kind: 'unity', directory: data, productName: unityProduct(root, data) }
  return null
}

// 角色依赖程序职责和结构；图形导入本身不能把内嵌浏览器或工具提升为游戏。
export const ENGINE_HELPER =
  /^(?:unitycrashhandler\d*|epicwebhelper|crashpad_handler|(?:unreal)?cefsubprocess(?:[-_].*)?|crashreportclient(?:[-_].*)?|zsync(?:make)?|pythonw?-config)\.exe$/i

function secondaryRole(exe) {
  const rel = exe.rel.replaceAll('\\', '/')
  if (
    ENGINE_HELPER.test(exe.name) ||
    /(?:^|\/)(?:plugins\/.*\/thirdparty|engine\/binaries\/thirdparty)(?:\/|$)/i.test(rel) ||
    /(?:^|\/)(?:tools?|utilities|utility|sdk|modding|\[(?:modding|utility|utilities|tools?)\][^/]*)(?:\/|$)/i.test(
      rel
    )
  )
    return 'helper'
  if (/(?:^|[-_])(?:dedicatedserver|server)(?:[-_.]|$)/i.test(exe.name)) return 'dedicated-server'
  if (/^(?:pythonw?|javaw?|node)\.exe$/i.test(exe.name)) return 'interpreter'
  // A title such as AimTrainer is not a tool just because of a substring.
  // Only owned engine layout can override this weak naming heuristic.
  if (
    !exe.engine &&
    !exe.bootstrapTarget &&
    /(?:cefsubprocess|webhelper|crashhandler|crashreport|crashpad|uninstall|redist|prereq|trainer(?:[-_].*)?\.exe$)/i.test(
      exe.name
    )
  )
    return 'helper'
  return null
}

export async function identifyExecutables(root, candidates) {
  for (const exe of candidates) {
    let facts
    try {
      facts = await readPeFile(exe.path, { dynamic: false })
    } catch {
      /* 受保护文件保留清单证据。 */
    }
    exe.architecture = facts?.valid
      ? facts.architecture
      : exe.encrypted
        ? exe.bitness === 64
          ? 'x64'
          : 'x86'
        : 'unknown'
    exe.fingerprint = facts?.valid ? { size: facts.size, modifiedAt: facts.modifiedAt } : null
    exe.bootstrapTarget = facts?.bootstrapTarget || ''
    if ((!facts?.valid && !exe.encrypted) || facts?.isDll || !ownedPath(root, exe.path)) {
      exe.engine = null
      exe.role = 'helper'
      exe.roleReasons = ['invalid-executable-target']
      continue
    }
    exe.engine = engineFor(root, exe)
    exe.role = secondaryRole(exe) || (exe.bootstrapTarget ? 'launcher' : exe.roleHint || 'unknown')
    exe.roleReasons =
      exe.role === 'unknown' ? [] : [exe.bootstrapTarget ? 'bootstrap-resource' : 'program-role']
  }
  const launchEntries = []
  for (const exe of candidates.filter((e) => e.role === 'launcher' && e.bootstrapTarget)) {
    const rel = exe.bootstrapTarget
    if (
      path.win32.isAbsolute(rel) ||
      rel.includes(':') ||
      [...rel].some((char) => char.charCodeAt(0) < 32)
    )
      continue
    const targetPath = path.resolve(path.dirname(exe.path), ...rel.split(/[\\/]/))
    if (!ownedPath(root, targetPath)) continue
    const target = candidates.find((e) => pathKey(e.path) === pathKey(targetPath))
    if (
      !target ||
      ['helper', 'dedicated-server', 'launcher', 'interpreter'].includes(target.role) ||
      target.architecture !== exe.architecture
    )
      continue
    target.launchers = [...(target.launchers || []), exe.path]
    target.role = 'renderer'
    target.roleReasons = ['bootstrap-target']
    launchEntries.push({ path: exe.path, target: target.path, source: 'bootstrap-resource' })
  }
  for (const exe of candidates) {
    if (['helper', 'dedicated-server', 'launcher', 'interpreter'].includes(exe.role)) continue
    exe.engine ||= engineFor(root, exe)
    if (
      exe.engine ||
      exe.api ||
      exe.apiCandidates?.length ||
      exe.declared ||
      exe.emulator ||
      exe.role === 'engine-entry'
    ) {
      exe.role = 'renderer'
      exe.roleReasons.push(
        exe.engine ? 'engine-layout' : exe.declared ? 'platform-manifest' : 'graphics-evidence'
      )
    }
  }
  return { launchEntries }
}

const identityKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
const stem = (exe) => path.basename(exe.path, path.extname(exe.path))
const isRenderer = (exe) => ['renderer', 'engine-entry'].includes(exe.role)

// These are recommendation rules, never filters for the manual picker. File
// size, API version and identical Unity host bytes do not identify the main game.
export function selectExecutable(candidates, { root } = {}) {
  const compatible = candidates.filter((e) => ['x64', 'x86'].includes(e.architecture))
  const linked = compatible.filter((e) => e.launchers?.length)
  const renderers = compatible.filter(isRenderer)
  const pool = linked.length ? linked : renderers.length ? renderers : compatible
  let chosen = pool.length === 1 && isRenderer(pool[0]) ? pool[0] : null
  let reason = chosen ? 'single-renderer' : null
  if (!chosen && pool.length > 1 && root) {
    const name = path.basename(root)
    const titles = new Set(
      [
        name,
        name.replace(
          /(?:^|[\s_()[\]-])(?:r|v|ver|version|rev|build)\s*\d+(?:\.\d+)*(?=$|[\s_()[\]-])/gi,
          ' '
        )
      ]
        .map(identityKey)
        .filter((key) => key.length >= 3)
    )
    const matches = pool.filter(
      (exe) =>
        isRenderer(exe) &&
        exe.engine &&
        [stem(exe), exe.engine.productName, exe.engine.project].some((value) =>
          titles.has(identityKey(value))
        )
    )
    // A base name is not enough to choose between explicit API/architecture
    // alternatives; those remain a user choice even when one matches the folder.
    const alternativeKey = (exe) =>
      identityKey(
        stem(exe).replace(
          /(?:[-_ ]?)(?:dx(?:9|10|11|12)|d3d(?:9|10|11|12)|vulkan|opengl|x86|x64|win32|win64)$/i,
          ''
        )
      )
    if (
      matches.length === 1 &&
      !pool.some((exe) => exe !== matches[0] && alternativeKey(exe) === alternativeKey(matches[0]))
    ) {
      chosen = matches[0]
      reason = 'engine-directory-identity'
    }
  }
  if (!chosen && pool.length > 1) {
    // Prefer the flat-screen entry only when every other renderer is its VR
    // sibling in the same directory. Do not guess across unrelated programs.
    const bases = pool.filter(
      (base) =>
        isRenderer(base) &&
        base.engine &&
        pool.every(
          (exe) =>
            exe === base ||
            (exe.engine?.kind === base.engine.kind &&
              exe.architecture === base.architecture &&
              pathKey(path.dirname(exe.path)) === pathKey(path.dirname(base.path)) &&
              /(?:[-_ ]?vr)$/i.test(stem(exe)) &&
              identityKey(stem(exe).replace(/(?:[-_ ]?vr)$/i, '')) === identityKey(stem(base)))
        )
    )
    if (bases.length === 1) {
      chosen = bases[0]
      reason = 'base-vr-entry'
    }
  }
  return {
    state: chosen ? 'recommended' : pool.length ? 'needs-choice' : 'unavailable',
    path: chosen?.path || null,
    reason
  }
}
