import path from 'node:path'
import { installedAppKey } from '../../shared/system/installed-app.js'

const win = path.win32
const key = (value) => String(value || '').toLowerCase()
const inside = (child, parent) => child === parent || child.startsWith(`${parent}\\`)
const hasControl = (text) => [...text].some((char) => char.charCodeAt(0) < 32)
const literalName = (value) => {
  const name = String(value || '').trim()
  if (name.length < 3 || hasControl(name) || /[<>:"/\\|?*]/.test(name) ||
      /[. ]$/.test(name) || name === '..') return ''
  return name
}

export function normalizeResidualPath(value = '') {
  const text = String(value || '').trim()
  if (!/^[a-z]:[\\/]/i.test(text) || hasControl(text) || /[<>|?*]/.test(text) ||
      text.slice(2).includes(':') || text.includes('"') ||
      text.split(/[\\/]/).some((part) => part === '..' || /[. ]$/.test(part))) return ''
  return win.normalize(text).replace(/\\+$/, '')
}

export function isSafeResidualPath(value, env = process.env) {
  const target = key(normalizeResidualPath(value))
  if (!target || /^[a-z]:$/.test(target)) return false
  if (/^[a-z]:\\users\\[^\\]+(?:\\(?:desktop|documents|downloads|pictures|music|videos|saved games|appdata)(?:\\(?:local|roaming|locallow))?)?$/i.test(target)) return false
  const root = win.parse(`${target}\\`).root
  const profile = env.USERPROFILE || ''
  const exactRoots = [
    `${root}Program Files`, `${root}Program Files (x86)`, `${root}ProgramData`,
    `${root}Users`, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData,
    profile, env.APPDATA, env.LOCALAPPDATA, env.PUBLIC, env.OneDrive,
    env.OneDriveConsumer, env.OneDriveCommercial,
    ...[env.APPDATA, env.LOCALAPPDATA, env.ProgramData].filter(Boolean)
      .flatMap((base) => ['Microsoft', 'Packages', 'Programs'].map((name) => win.join(base, name))),
    ...['AppData', 'AppData\\LocalLow', 'Desktop', 'Documents', 'Downloads',
      'Pictures', 'Music', 'Videos', 'Saved Games'].map((name) => profile && win.join(profile, name))
  ].filter(Boolean).map((entry) => key(normalizeResidualPath(entry)))
  if (exactRoots.some((entry) => entry && inside(entry, target))) return false
  const forbiddenTrees = [
    `${root}Windows`, `${root}Program Files\\Common Files`, `${root}Program Files\\WindowsApps`,
    `${root}Program Files (x86)\\Common Files`, `${root}$Recycle.Bin`,
    `${root}System Volume Information`, env.WINDIR, env.SystemRoot,
    env.CommonProgramFiles, env['CommonProgramFiles(x86)']
  ].filter(Boolean).map((entry) => key(normalizeResidualPath(entry)))
  if (forbiddenTrees.some((entry) => entry && (inside(target, entry) || inside(entry, target)))) return false
  return target.slice(win.parse(target).root.length).split('\\').filter(Boolean).length >= 2
}

function appNames(appInfo) {
  // Removing versions or brackets can turn one product into an entire product family.
  const raw = literalName(appInfo.displayName)
  const publisher = key(literalName(appInfo.publisher))
  return [...new Set([raw, raw.replace(/\s+/g, '')])]
    .filter((name) => name && key(name) !== publisher)
}

export function buildResidualCandidates(appInfo, installedApps = [], env = process.env) {
  const names = appNames(appInfo)
  const publisher = literalName(appInfo.publisher)
  const others = installedApps.filter((item) => installedAppKey(item) !== installedAppKey(appInfo))
  const otherNames = new Set(others.flatMap(appNames).map(key))
  const otherLocations = others.map((item) => key(normalizeResidualPath(item.installLocation))).filter(Boolean)
  const files = new Map()
  const addFile = (value, reason) => {
    const target = normalizeResidualPath(value)
    if (!isSafeResidualPath(target, env)) return
    if (publisher && key(win.basename(target)) === key(publisher)) return
    if (otherLocations.some((other) => inside(key(target), other) || inside(other, key(target)))) return
    files.set(key(target), { type: 'file', path: target, reason })
  }
  if (appInfo.installLocation) addFile(appInfo.installLocation, '应用登记的安装目录')
  const roots = [env.ProgramData || 'C:\\ProgramData', env.APPDATA, env.LOCALAPPDATA,
    env.USERPROFILE && win.join(env.USERPROFILE, 'AppData', 'LocalLow')].filter(Boolean)
  for (const name of names.filter((entry) => !otherNames.has(key(entry)))) {
    for (const root of roots) {
      addFile(win.join(root, name), '目录名与应用名称一致，请确认其中的数据')
      if (publisher) addFile(win.join(root, publisher, name), '发布商目录下与应用同名的目录')
    }
  }
  const registry = new Map()
  const addRegistry = (value, reason) => {
    const target = String(value || '').trim()
    if (!isSafeResidualRegistry(target, appInfo.registryPath)) return
    registry.set(key(target), { type: 'registry', path: target, reason })
  }
  addRegistry(appInfo.registryPath, '此应用的卸载登记项')
  for (const name of names.filter((entry) => !otherNames.has(key(entry)))) {
    for (const root of ['HKEY_CURRENT_USER\\Software', 'HKEY_LOCAL_MACHINE\\Software',
      'HKEY_LOCAL_MACHINE\\Software\\WOW6432Node']) {
      addRegistry(`${root}\\${name}`, '注册表项名称与应用名称一致')
      if (publisher) addRegistry(`${root}\\${publisher}\\${name}`, '发布商节点下与应用同名的注册表项')
    }
  }
  return [...files.values(), ...registry.values()]
}

export function isSafeResidualRegistry(value, appRegistryPath = '') {
  const text = String(value || '').trim()
  if (hasControl(text) || text.includes('/') || text.split('\\').some((part) => !part || part === '..')) return false
  const uninstall = /^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\Software\\(?:WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$/i
  if (uninstall.test(text)) return key(text) === key(appRegistryPath)
  if (!/^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\Software\\(?:WOW6432Node\\)?[^\\]+(?:\\[^\\]+)?$/i.test(text)) return false
  const suffix = text.replace(/^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\Software\\/i, '').replace(/^WOW6432Node\\/i, '')
  return !/^(?:Microsoft|Classes|Policies|WOW6432Node|RegisteredApplications)(?:\\|$)/i.test(suffix)
}
