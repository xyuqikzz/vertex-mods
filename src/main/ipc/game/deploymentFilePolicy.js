import path from 'node:path'

// 常见运行期配置必须与受 ACL 保护的暂存源隔离。
const MUTABLE_EXTENSIONS = new Set([
  '.ini',
  '.cfg',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
  '.xml',
  '.txt'
])

export function requiresIndependentDeployment(filePath = '') {
  return MUTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}
