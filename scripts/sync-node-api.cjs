const fs = require('fs')
const path = require('path')

// 兼容原生仓库的扁平和按领域分目录产物，版本能力仍须与客户端匹配。
const projectRoot = path.resolve(__dirname, '..')
const nativeProjectRoot = process.env.VERTEX_NODE_API_ROOT
  ? path.resolve(process.env.VERTEX_NODE_API_ROOT)
  : path.resolve(projectRoot, '..', 'vertex-node-api')
const sourceRoot = path.join(nativeProjectRoot, 'dist')
const targetRoot = path.join(projectRoot, 'resources', 'node')
const runtimeFile = (name, domain) => [path.join(sourceRoot, name), path.join(sourceRoot, domain, name)].find(file => fs.existsSync(file)) || path.join(sourceRoot, name)

// required=true 缺失即报错；可选产物缺失只告警跳过，便于部分构建/增量同步。
const copyPlan = [
  { source: runtimeFile('file_api_v3.node', 'file'), target: path.join(targetRoot, 'file_api_v3.node'), required: true },
  { source: runtimeFile('file_api.node', 'file'), target: path.join(targetRoot, 'file_api.node'), required: true },
  { source: runtimeFile('file_api_v2.node', 'file'), target: path.join(targetRoot, 'file_api_v2.node'), required: false, skipIfBusy: true },
  { source: runtimeFile('7z.exe', 'file'), target: path.join(targetRoot, '7z.exe'), required: true },
  { source: runtimeFile('7z.dll', 'file'), target: path.join(targetRoot, '7z.dll'), required: true },
  { source: runtimeFile('process_api.node', 'process'), target: path.join(targetRoot, 'process_api.node'), required: false },
  { source: runtimeFile('system_api.node', 'system'), target: path.join(targetRoot, 'system_api_v2.node'), required: false }
]

function copyRuntimeFile(item) {
  if (!fs.existsSync(item.source)) {
    if (item.required) {
      throw new Error(
        `未找到 Node-API 构建产物：${item.source}（请先在 n-api 执行 npm run build）`
      )
    }
    console.warn(`跳过缺失的可选 Node-API 资源：${item.source}`)
    return
  }
  fs.mkdirSync(path.dirname(item.target), { recursive: true })
  try {
    fs.copyFileSync(item.source, item.target)
    console.log(`已同步 Node-API 资源：${item.target}`)
  } catch (error) {
    if (item.skipIfBusy && ['EBUSY', 'EPERM', 'EACCES'].includes(String(error?.code || ''))) {
      console.warn(`跳过正在被旧客户端占用的兼容 Node-API 资源：${item.target}`)
      return
    }
    throw error
  }
}

if (!fs.existsSync(sourceRoot)) {
  throw new Error(
    `未找到 n-api 构建输出目录：${sourceRoot}（请先在 n-api 执行 npm run build 再 npm run sync:napi）`
  )
}

// 复制前统一检查，避免缺少高版本产物时只覆盖部分运行时。
for (const item of copyPlan.filter(item => item.required)) {
  if (!fs.existsSync(item.source)) throw new Error(`原生版本不匹配或未构建：缺少 ${path.basename(item.source)}。客户端现有运行时未修改，请使用匹配源码或设置 VERTEX_NODE_API_ROOT。`)
}
if (process.argv.includes('--check')) {
  console.log('原生产物路径检查通过，未复制或替换文件')
} else {
  copyPlan.forEach(copyRuntimeFile)
}
