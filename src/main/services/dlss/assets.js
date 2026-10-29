import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonical, fail, hashFile, safeJoin } from './files.js'
import { digest, downloadVerified, readComponentArchive } from './downloads.js'

export function createAssetManager(root, catalog, { fetcher } = {}) {
  const entry = (id) => catalog.find((c) => c.id === id) || fail('unknown_component', '未知组件')
  const cachePath = (id) => path.join(root, id)
  async function verify(id) {
    for (const file of entry(id).files) {
      try {
        const dest = await safeJoin(cachePath(id), file.target)
        if ((await fs.stat(dest)).size !== file.size || (await hashFile(dest)) !== file.sha256)
          return false
      } catch {
        return false
      }
    }
    return true
  }
  async function install(component, read, signal) {
    await fs.mkdir(root, { recursive: true })
    const staging = await safeJoin(root, `${component.id}.${randomUUID()}.partial`)
    await fs.mkdir(staging)
    try {
      const stat = await fs.statfs(root)
      const bytes = component.files.reduce((sum, f) => sum + f.size, 0)
      if (stat.bavail * stat.bsize < bytes * 2 + 1048576) fail('disk_full', '组件缓存磁盘空间不足')
      for (const file of component.files) {
        signal?.throwIfAborted()
        const data = await read(file)
        if (data.length !== file.size || digest(data) !== file.sha256)
          fail(
            'asset_hash_mismatch',
            `${path.basename(file.target)} 与所选 ${component.version} 版本不符，可使用自动准备取得匹配版本`
          )
        const dest = await safeJoin(staging, file.target)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, data, { flag: 'wx' })
        if ((await hashFile(dest)) !== file.sha256)
          fail('asset_hash_mismatch', '组件写入后校验失败')
      }
      signal?.throwIfAborted()
      try {
        const previous = await safeJoin(root, component.id)
        await fs.access(previous)
        await fs.rename(previous, path.join(root, `${component.id}.preserved-${randomUUID()}`))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await fs.rename(staging, cachePath(component.id))
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
  async function prepare(ids, sourcePath, options = {}) {
    const real = await fs.realpath(sourcePath)
    const stat = await fs.stat(real)
    await canonical(real, stat.isDirectory())
    const candidates = [],
      archives = []
    async function collect(directory, depth = 0) {
      if (depth > 7 || candidates.length > 12000) return
      for (const e of await fs.readdir(directory, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue
        const f = path.join(directory, e.name)
        if (e.isDirectory()) await collect(f, depth + 1)
        else if (e.isFile()) candidates.push(f)
      }
    }
    if (stat.isDirectory()) await collect(real)
    else if (/\.(zip|exe)$/i.test(real)) {
      if (stat.size > 512 * 1024 * 1024) fail('component_too_large', '导入包超出允许大小')
      archives.push(
        readComponentArchive(await fs.readFile(real), /\.exe$/i.test(real) ? 'sfx' : 'zip')
      )
    } else candidates.push(real)
    const results = [],
      missing = []
    for (const id of ids) {
      const component = entry(id)
      if (await verify(id)) {
        results.push(id)
        continue
      }
      try {
        await install(
          component,
          async (file) => {
            let mismatched = false
            for (const f of candidates.filter(
              (f) => path.basename(f).toLowerCase() === path.basename(file.target).toLowerCase()
            )) {
              const info = await fs.stat(f)
              if (info.size !== file.size) {
                mismatched = true
                continue
              }
              const data = await fs.readFile(f)
              if (digest(data) === file.sha256) return data
              mismatched = true
            }
            for (const archive of archives)
              for (const [name, e] of archive) {
                if (path.posix.basename(name) !== path.basename(file.target).toLowerCase()) continue
                if (e.header.size !== file.size) {
                  mismatched = true
                  continue
                }
                const data = e.getData()
                if (digest(data) === file.sha256) return data
                mismatched = true
              }
            if (mismatched)
              fail(
                'asset_hash_mismatch',
                `${path.basename(file.target)} 版本与所选 ${component.version} 不符；已知社区修改版请选择对应运行库，或使用自动准备`
              )
            fail(
              'asset_missing',
              `未找到 ${path.basename(file.target)}。支持原始目录、普通解压目录和 ZIP 导入，也可自动准备所需组件`
            )
          },
          options.signal
        )
      } catch (error) {
        if (error.code !== 'asset_missing') throw error
        missing.push(id)
        continue
      }
      results.push(id)
    }
    if (!results.length && missing.length)
      fail(
        'asset_missing',
        '导入内容中未找到当前方案需要的完整组件，请选择对应发布包或使用自动准备'
      )
    return { prepared: results, missing }
  }
  async function download(ids, { signal, onProgress = () => {} } = {}) {
    const results = [],
      localOnly = []
    for (const id of ids) {
      signal?.throwIfAborted()
      const component = entry(id)
      if (await verify(id)) {
        onProgress({ component: id, phase: 'cached', source: 'cache' })
        results.push(id)
        continue
      }
      if (!component.downloads?.length) {
        localOnly.push(id)
        continue
      }
      const packages = []
      for (const [index, source] of component.downloads.entries()) {
        const data = await downloadVerified(source, path.join(root, 'archives'), {
          signal,
          fetcher,
          onProgress: (p) =>
            onProgress({
              ...p,
              component: id,
              fileIndex: index + 1,
              fileCount: component.downloads.length
            })
        })
        packages.push(source.format === 'file' ? data : readComponentArchive(data, source.format))
      }
      onProgress({ component: id, phase: 'extracting' })
      await install(
        component,
        async (file) => {
          const source = packages[file.download]
          if (Buffer.isBuffer(source)) return source
          const item = source?.get(file.downloadEntry.toLowerCase())
          if (!item || item.header.size !== file.size)
            fail('component_archive_layout', '发布包内容与已审核清单不符')
          return item.getData()
        },
        signal
      )
      results.push(id)
    }
    return { prepared: results, localOnly }
  }
  async function files(ids) {
    const result = []
    for (const id of ids) {
      if (!(await verify(id))) fail('assets_not_ready', `${entry(id).name} 尚未准备或校验失败`)
      for (const file of entry(id).files)
        result.push({ ...file, component: id, source: await safeJoin(cachePath(id), file.target) })
    }
    return result
  }
  return {
    prepare,
    download,
    files,
    verify,
    catalog: async () =>
      Promise.all(
        catalog.map(async (c) => ({
          id: c.id,
          name: c.name,
          version: c.version,
          upstream: c.upstream,
          distribution: c.distribution,
          requiredFiles: c.files.map((f) => path.basename(f.target)),
          downloadable: !!c.downloads?.length,
          ready: await verify(c.id)
        }))
      )
  }
}
