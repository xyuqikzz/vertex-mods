import fs from 'node:fs'
import path from 'node:path'

// 不跟随受管根目录以内的 junction/symlink；每次实际变更前重新检查。
export function assertThunderstoreChild(root, target, { allowRoot = false } = {}) {
  const base = path.resolve(root)
  const resolved = path.resolve(target)
  const relative = path.relative(base, resolved)
  if ((!relative && !allowRoot) || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) || relative.includes(':')) throw new Error('模组文件超出安装目录')
  let current = resolved
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('模组路径包含目录联接或符号链接，操作已停止')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (path.relative(base, current) === '') break
    current = path.dirname(current)
  }
  return resolved
}
