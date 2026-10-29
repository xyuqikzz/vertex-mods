// 首页快捷启动卡片与轮播共用的游戏展示信息。
// 「本机扫描游戏」：Vertex 在本机识别到、但没有对应模组来源（Vertex / Ficsit / Thunderstore / Nexus / Mod.io 等）的游戏。
// 这类游戏只能启动和打开目录，不显示来源、模组数、管理模组和浏览模组。

export function hasQuickLaunchModSource(game = {}) {
  if (String(game?.currentSource || '').trim()) return true
  const sources = Array.isArray(game?.availableSources) ? game.availableSources : []
  return sources.some((source) => String(source || '').trim())
}

export function getQuickLaunchModCount(game = {}) {
  for (const candidate of [game?.modCount, game?.clientModCount]) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

// ready：可以启动；updating：更新中；disabled：不可用。
// 「已安装」不再单独显示：快捷启动里只有本机已安装、能找到启动方式的游戏。
export function getQuickLaunchGameStatus(game = {}) {
  if (game?.isUpdating || game?.updating) return 'updating'
  if (game?.disabled) return 'disabled'
  return 'ready'
}

// 与首页「打开游戏目录」使用同一套路径顺序：安装根目录优先，否则取启动程序所在目录。
export function getQuickLaunchGameDirectory(game = {}) {
  const rootPath = String(
    game?.client_root_path || game?.installPath || game?.gamePath || ''
  ).trim()
  if (rootPath) return rootPath

  const exePath = String(game?.client_exe_path || '').trim()
  if (!exePath || /^[a-z][a-z0-9+.-]*:\/\//i.test(exePath)) return ''

  const normalizedPath = exePath.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(
    normalizedPath.lastIndexOf('\\'),
    normalizedPath.lastIndexOf('/')
  )
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : normalizedPath
}
