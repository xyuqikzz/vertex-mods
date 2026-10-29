function parse(value, fallback) {
  try {
    for (let i = 0; i < 2 && typeof value === 'string'; i++) value = JSON.parse(value)
    return value ?? fallback
  } catch {
    return fallback
  }
}

function list(value) {
  const parsed = parse(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '--' ? value.trim() : ''
}

// 与本地路径 IPC 的边界一致：不将相对路径、URL 或占位文字交给系统外壳。
function localPath(value) {
  const path = text(value)
  return /^[a-z]:[\\/]/i.test(path) &&
    ![...path].some((char) => char.charCodeAt(0) < 32) &&
    !path.slice(2).includes(':') &&
    !path.split(/[\\/]/).includes('..') &&
    !/^[a-z]:[\\/]*$/i.test(path)
    ? path
    : ''
}

function unique(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = value.replace(/\\/g, '/').toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getManagedModRecordId(record = {}) {
  const id = Number(record.rowId || record.recordId || record.id)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

export function getManagedModSourceUrl(record = {}, source = '') {
  const metadata = parse(record.metadata_json || record.metadata, {})
  const id = text(String(record.mod_id || record.modId || metadata.sourceModId || ''))
  const reference = text(record.modReference)
  const fallback =
    source === 'steam-workshop' && /^\d+$/.test(id)
      ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
      : source === 'gamebanana' && /^\d+$/.test(id)
        ? `https://gamebanana.com/mods/${id}`
        : source === 'ficsit' && reference
          ? `https://ficsit.app/mod/${encodeURIComponent(reference)}`
          : ''
  try {
    const url = new URL(
      record.sourcePageUrl ||
        record.sourceUrl ||
        metadata.sourcePageUrl ||
        metadata.sourceUrl ||
        fallback
    )
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : ''
  } catch {
    return ''
  }
}

export function getModFileInfo(record = {}) {
  const raw = { ...(record.raw || {}), ...record }
  const metadata = parse(raw.metadata_json || raw.metadata, {})
  const enabled =
    Number(
      raw.is_active ?? raw.isActive ?? raw.installState ?? raw.install_state ?? raw.enabled ?? 1
    ) === 1
  const roots = [
    raw.installRoot,
    raw.targetPath,
    raw.target_path,
    metadata.installRoot,
    metadata.targetPath
  ]
    .map(localPath)
    .filter(Boolean)
  const stored = [
    raw.source_root_path,
    raw.sourceRootPath,
    raw.stagingPath,
    raw.staging_path,
    metadata.stagingPath,
    raw.sourcePath,
    raw.library_root_path
  ]
    .map(localPath)
    .filter(Boolean)
  const entries = []
  const paths = []
  function walk(nodes) {
    for (const node of nodes) {
      if (!node) continue
      if (typeof node === 'string') {
        entries.push(node)
        paths.push(localPath(node))
        continue
      }
      const entryPath = text(node.path || node.absolutePath || node.targetPath || node.originalPath)
      paths.push(localPath(entryPath))
      const children = list(node.sub || node.children)
      if (children.length) walk(children)
      else if (node.type !== 0 && node.type !== 'folder' && node.type !== 'directory') {
        entries.push(text(node.relativePath) || entryPath)
      }
    }
  }
  const fileList = [raw.files, raw.files_json, raw.fileList, raw.filePaths]
    .map(list)
    .find((items) => items.length)
  walk(fileList || list(raw.install_paths_json || raw.installPaths))
  // 旧安装记录只保存目录树；即使有独立文件清单，也保留树中的定位信息。
  if (!paths.some(Boolean) && fileList) {
    const first = list(raw.install_paths_json || raw.installPaths)[0]
    paths.push(localPath(typeof first === 'string' ? first : first?.path))
  }
  const boundPaths = list(metadata.items).map((item) =>
    localPath(item?.state === 'disabled' ? item.disabledPath : item?.originalPath)
  )
  const deployed = [...roots, ...paths, localPath(raw.primaryInstallPath)]
  const locationPaths = unique(
    [...boundPaths, ...(enabled ? [...deployed, ...stored] : [...stored, ...deployed])].filter(
      Boolean
    )
  )
  const root = (roots[0] || stored[0] || '').replace(/\\/g, '/').replace(/\/$/, '')
  const files = unique(
    entries.map((entry) => {
      const value = text(entry).replace(/\\/g, '/')
      return root && value.toLowerCase().startsWith(`${root.toLowerCase()}/`)
        ? value.slice(root.length + 1)
        : value
    })
  )
  return { files, locationPaths, primaryInstallPath: locationPaths[0] || '' }
}

export function withModDirectoryAction(card, actions = []) {
  if (!card || card.installModel === 'local-library') return actions
  const location = getModFileInfo(card.raw)
  const available = getManagedModRecordId(card.raw) && location.locationPaths.length
  return [
    {
      key: 'open-install-root',
      label: '打开目录',
      disabled: Boolean(card.disabled || !available),
      title: available ? location.primaryInstallPath : '此安装记录没有可定位的本地路径'
    },
    ...actions.filter(
      (action) => !['open-install-root', 'location', 'open-location'].includes(action.key)
    )
  ]
}
