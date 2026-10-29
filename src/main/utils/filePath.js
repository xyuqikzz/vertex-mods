import fs from 'fs-extra'
import path from 'path'

export function getParentPath(inputPath) {
  try {
    // 解析路径，处理相对路径和规范化路径
    const resolvedPath = path.resolve(inputPath)

    // 检查路径是否存在
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('Path does not exist')
    }

    // 获取父目录
    const parentPath = path.dirname(resolvedPath)

    // 如果父目录与原路径相同（如根目录），则返回null
    return parentPath === resolvedPath ? null : parentPath
  } catch (error) {
    console.error('Error getting parent path:', error.message)
    return null
  }
}
