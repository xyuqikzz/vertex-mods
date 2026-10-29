import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createAssetManager } from './assets.js'
import { hashFile, safeJoin } from './files.js'
import { scanSource } from './swapper/scan.js'
import { componentCatalog, packageFiles } from './component-catalog.js'
import { consumerVersions, consumerPath } from '../../../shared/dlss-swapper/consumer-versions.js'
import { downloadVerified } from './downloads.js'
import { componentProgress } from './progress.js'

// Assemble reviewed components independently. Only the byte-locked legacy NR
// runtime still needs extraction from Swapper when no verified cache exists.
// Existing flat caches are import sources only; new files have their own cache.
export function createSwapperPayload({ root, bundledDirectory, fetcher, sevenZip }) {
  const directory = bundledDirectory || path.join(root, 'payload-components')
  const assets = createAssetManager(path.join(root, 'components'), componentCatalog, { fetcher })
  let preparing
  async function verify(at = directory) {
    for (const file of packageFiles) {
      try {
        const target = await safeJoin(at, file.path)
        if ((await fs.stat(target)).size !== file.size || (await hashFile(target)) !== file.sha256)
          return false
      } catch {
        return false
      }
    }
    return true
  }
  function source() {
    return {
      source: scanSource(directory),
      reshadeSetup: path.join(directory, 'ReShade_Setup_6.8.0_Addon.exe'),
      consumers: Object.fromEntries(
        consumerVersions.map((c) => [c.version, path.join(directory, consumerPath(c.version))])
      ),
      components: componentCatalog.map((c) => ({
        id: c.id,
        version: c.version,
        sources: c.downloads.map((d) => ({ url: d.url, sha256: d.sha256 })),
        files: c.files.map((f) => ({ path: f.target, sha256: f.sha256, size: f.size }))
      }))
    }
  }
  async function prepare(log = () => {}) {
    const report = componentProgress(log, { name: '基础组件' })
    report({ phase: 'checking' })
    if (await verify()) {
      report({ phase: 'cached', source: bundledDirectory ? 'bundled' : 'cache' })
      return source()
    }
    if (bundledDirectory)
      throw Object.assign(new Error('安装包中的组件缺失或校验失败，请修复 Vertex 安装包。'), {
        code: 'component_bundle_invalid'
      })
    for (const component of componentCatalog) {
      const progress = componentProgress(log, { name: component.name, version: component.version })
      if (await assets.verify(component.id)) {
        progress({ phase: 'cached', source: 'cache' })
        continue
      }
      for (const previous of [directory, path.join(root, 'payload')]) {
        try {
          await assets.prepare([component.id], previous)
        } catch (error) {
          if (!['ENOENT', 'asset_missing', 'asset_hash_mismatch'].includes(error.code)) throw error
        }
        if (await assets.verify(component.id)) break
      }
      if (component.id === 'nr-legacy' && !(await assets.verify(component.id))) {
        // This tested runtime is not byte-identical to any reviewed RHI build.
        // Keep its provenance explicit until an equivalent independent source is verified.
        const archiveRoot = path.join(root, 'archives')
        await downloadVerified(component.downloads[0], archiveRoot, {
          fetcher,
          onProgress: progress
        })
        if (!sevenZip) throw new Error('缺少兼容运行库解包工具')
        const temporary = path.join(root, 'runtime-' + randomUUID())
        await fs.mkdir(temporary, { recursive: true })
        try {
          progress({ phase: 'extracting' })
          const run = promisify(execFile)
          await run(
            sevenZip,
            [
              'x',
              path.join(archiveRoot, component.downloads[0].sha256),
              '-o' + temporary,
              '$PLUGINSDIR/app-64.7z',
              '-y'
            ],
            { windowsHide: true, timeout: 120000 }
          )
          await run(
            sevenZip,
            [
              'x',
              path.join(temporary, '$PLUGINSDIR/app-64.7z'),
              '-o' + temporary,
              ...component.files.map((file) => 'resources/payload/' + file.downloadEntry),
              '-y'
            ],
            { windowsHide: true, timeout: 120000 }
          )
          await assets.prepare([component.id], temporary)
        } finally {
          await fs.rm(temporary, { recursive: true, force: true })
        }
      }
      await assets.download([component.id], {
        onProgress: progress
      })
    }
    const stage = path.join(root, 'assembly-' + randomUUID())
    await fs.mkdir(stage, { recursive: true })
    try {
      for (const file of await assets.files(componentCatalog.map((c) => c.id))) {
        const target = await safeJoin(stage, file.target)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(file.source, target)
      }
      if (!(await verify(stage))) throw new Error('组件组合校验失败')
      // Preserve an incomplete cache, never delete unknown files while migrating.
      try {
        await fs.rename(directory, directory + '.preserved-' + randomUUID())
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await fs.rename(stage, directory)
    } finally {
      await fs.rm(stage, { recursive: true, force: true })
    }
    report({ phase: 'ready' })
    return source()
  }
  return {
    directory,
    dlssVersion: '310.9.1.0',
    verify,
    source,
    version: 'components-2.2.9',
    packageFiles,
    ensure(log) {
      preparing ||= prepare(log).finally(() => {
        preparing = null
      })
      return preparing
    }
  }
}
