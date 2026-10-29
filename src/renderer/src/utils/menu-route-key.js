const MOD_MANAGEMENT_PATH_PREFIX = '/app/game/modManagement/'
const INSTALL_TASK_CENTER_PATH = '/app/game/install-tasks'
// 工具页用 ?tool=、设置页用 ?section= 记住当前模块，切换模块不应新开菜单页签。
const TOOL_PAGE_PATHS = new Set(['/app/game-tools', '/app/system', '/app/settings'])
// 安装配置页用 ?tab= 记住「选择配置 / 编辑规则」页签，切换页签不应新开菜单页签；其余参数（游戏名等）保留。
const INSTALL_CONFIG_PATH_PATTERN = /^\/app\/game\/(?:source\/[^/]+|nexus|modio)\/config\/[^/]+$/
const INSTALL_CONFIG_PAGE_QUERY_KEYS = new Set(['tab'])
// Thunderstore 配置编辑器一个社区一个页签：切换 Profile、从模组管理定位文件只改参数，不新开菜单页签。
const THUNDERSTORE_CONFIG_PATH_PATTERN = /^\/app\/game\/thunderstore\/config\/[^/]+$/
const THUNDERSTORE_CONFIG_QUERY_KEYS = new Set(['profile', 'package', 'file'])

export function normalizeMenuPath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.split('#')[0].split('?')[0] || ''
}

export function normalizeMenuFullPath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.split('#')[0] || ''
}

function stripQueryKeys(fullPath, keys) {
  const [path, query = ''] = fullPath.split('?')
  if (!query) return fullPath
  const kept = query
    .split('&')
    .filter((part) => part && !keys.has(decodeURIComponent(part.split('=')[0] || '')))
  return kept.length ? `${path}?${kept.join('&')}` : path
}

export function getMenuRouteKey(value) {
  const fullPath = normalizeMenuFullPath(value)
  if (!fullPath) return ''

  const path = normalizeMenuPath(fullPath)
  if (path.startsWith(MOD_MANAGEMENT_PATH_PREFIX)) {
    return path
  }

  if (path === INSTALL_TASK_CENTER_PATH || TOOL_PAGE_PATHS.has(path)) {
    return path
  }

  if (INSTALL_CONFIG_PATH_PATTERN.test(path)) {
    return stripQueryKeys(fullPath, INSTALL_CONFIG_PAGE_QUERY_KEYS)
  }

  if (THUNDERSTORE_CONFIG_PATH_PATTERN.test(path)) {
    return stripQueryKeys(fullPath, THUNDERSTORE_CONFIG_QUERY_KEYS)
  }

  return fullPath
}
