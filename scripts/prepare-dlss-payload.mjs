import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import release from '../src/main/services/dlss/swapper/payload.json' with { type: 'json' }
import { packageFiles } from '../src/main/services/dlss/component-catalog.js'
import { createSwapperPayload } from '../src/main/services/dlss/swapper-payload.js'
import { hashFile, safeJoin } from '../src/main/services/dlss/files.js'

// Runs for both directory and installer builds, including direct builder calls.
// Only the pinned payload and its notices ship, never the portable upstream app.
export default async function prepareDlssPayload(context) {
  const projectRoot =
    context?.packager?.projectDir || path.resolve(fileURLToPath(new URL('..', import.meta.url)))
  const root = path.join(projectRoot, 'artifacts/dlss-package')
  const payload = createSwapperPayload({
    root,
    sevenZip: path.join(projectRoot, 'resources/node/7z.exe')
  })
  if (!(await payload.verify()) && process.env.VERTEX_DLSS_SWAPPER_ARCHIVE) {
    const archive = path.resolve(process.env.VERTEX_DLSS_SWAPPER_ARCHIVE)
    if (
      (await fs.stat(archive)).size !== release.size ||
      (await hashFile(archive)) !== release.sha256
    )
      throw new Error('VERTEX_DLSS_SWAPPER_ARCHIVE 与锁定的 DLSS5 组件包不符')
    await fs.mkdir(path.join(root, 'archives'), { recursive: true })
    const target = path.join(root, 'archives', release.sha256)
    if (archive !== target) await fs.copyFile(archive, target)
  }
  let lastProgress
  await payload.ensure((item) => {
    if (item.code === 'componentProgress') {
      const p = item.params
      const key = `${p.name} ${p.version} ${p.phase} ${p.total ? Math.floor((p.received / p.total) * 10) * 10 + '%' : ''}`
      if (key !== lastProgress) console.log(`[DLSS5 build] ${key}`)
      lastProgress = key
      return
    }
    console.log(`[DLSS5 build] ${item.code}`)
  })
  if (!(await payload.verify())) throw new Error('DLSS5 组件校验失败，已阻止生成不完整安装包')
  console.log(`[DLSS5 build] verified ${packageFiles.length} independently locked component files`)
}

export async function afterPack(context) {
  const root = path.join(context.packager.projectDir, 'artifacts/dlss-package')
  const directory = path.join(root, 'payload-components')
  const destination = path.join(context.appOutDir, 'resources/dlss/payload')
  // extraResources transforms/signs .exe files, which would invalidate the
  // pinned upstream hashes. Copy these data assets after that transformation;
  // Vertex itself still follows the normal executable signing pipeline.
  for (const entry of packageFiles) {
    const from = await safeJoin(directory, entry.path)
    const to = await safeJoin(destination, entry.path)
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
  }
  const bundled = createSwapperPayload({ root, bundledDirectory: destination })
  if (!(await bundled.verify())) throw new Error('目录包中的 DLSS5 组件不完整，已中止打包')
  console.log(`[DLSS5 build] bundled and verified ${packageFiles.length} unchanged files`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareDlssPayload()
