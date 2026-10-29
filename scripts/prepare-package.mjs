import prepareDlssPayload from './prepare-dlss-payload.mjs'
import { generateThirdPartyNotices } from './generate-third-party-notices.mjs'
import { createRequire } from 'node:module'
import { parseDependencyTreeOutput } from './lib/dependency-tree-json.mjs'

const require = createRequire(import.meta.url)

export default async function preparePackage(context) {
  if (process.platform === 'win32') {
    const { version } = require('app-builder-lib/package.json')
    if (version !== '26.18.1')
      throw new Error('更新 electron-builder 后需复核 Windows 依赖 JSON 兼容处理')
    const {
      NodeModulesCollector
    } = require('app-builder-lib/out/node-module-collector/nodeModulesCollector.js')
    NodeModulesCollector.prototype.parseDependenciesTree = parseDependencyTreeOutput
  }
  const result = await generateThirdPartyNotices({ root: context.packager.projectDir })
  console.log(`[licenses] included original notices for ${result.count} npm packages`)
  if (result.missing.length)
    console.warn(`[licenses] packages without bundled license text: ${result.missing.join(', ')}`)
  await prepareDlssPayload(context)
}
