// Resolve only known static tab titles. Game names and user-supplied titles stay untouched.
const titles = {
  '/app/home': ['首页', 'home'],
  '/app/game': ['模组中心', 'mods'],
  '/app/game-tools': ['游戏工具', 'gameTools'],
  '/app/system': ['系统工具', 'system'],
  '/app/game/repository': ['我的游戏', 'library'],
  '/app/user': ['个人中心', 'account'],
  '/app/settings': ['设置', 'settings'],
  '/app/game/install-tasks': ['任务中心', 'tasks']
}

export function translateMenuTitle(item, translate) {
  const path = String(item?.path || item?.fullPath || '').split(/[?#]/)[0]
  const title = titles[path]
  return title && item.content === title[0] ? translate(`nav.${title[1]}`) : item.content
}
