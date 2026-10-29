import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

// 从锁文件和实际安装包取原文，不按 SPDX 名称猜测作者、版权或许可内容。
export async function generateThirdPartyNotices({ root = projectRoot, check = false } = {}) {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const packages = new Map()
  const missing = []
  const upstreamSources = JSON.parse(
    await fs
      .readFile(path.join(root, 'resources/licenses/npm-upstream-sources.json'), 'utf8')
      .catch(() => '{}')
  )
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative.startsWith('node_modules/')) continue
    const directory = path.join(root, relative)
    let pkg
    try {
      pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT' && entry.optional) continue
      throw error
    }
    if (pkg.version !== entry.version) throw new Error(`依赖未按锁文件安装：${pkg.name}`)
    const identity = `${pkg.name}@${pkg.version}`
    if (packages.has(identity)) continue
    const documents = []
    for (const name of (await fs.readdir(directory)).sort()) {
      if (!/^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(name)) continue
      const file = path.join(directory, name)
      if (!(await fs.stat(file)).isFile()) continue
      documents.push({ name, text: (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n') })
    }
    if (!documents.length) {
      for (const name of (await fs.readdir(directory)).filter((name) =>
        /^readme([.-]|$)/i.test(name)
      )) {
        const readme = await fs.readFile(path.join(directory, name), 'utf8')
        const start = readme.search(/^(?:#+\s*)?(?:License|Copyright)(?:\s|\(|#|$)/im)
        const text = start < 0 ? '' : readme.slice(start)
        if (
          /Permission is hereby granted|Redistribution and use in source|Permission to use, copy, modify/i.test(
            text
          )
        ) {
          documents.push({ name: `${name} (license section)`, text: text.replace(/\r\n/g, '\n') })
        }
      }
    }
    const upstream = upstreamSources[identity]
    if (!documents.length && upstream) {
      if (!/^npm-upstream\/[a-zA-Z0-9._-]+\.txt$/.test(upstream.file))
        throw new Error(`无效许可文件路径：${identity}`)
      const text = await fs.readFile(path.join(root, 'resources/licenses', upstream.file), 'utf8')
      if (createHash('sha256').update(text).digest('hex') !== upstream.sha256)
        throw new Error(`上游许可校验失败：${identity}`)
      documents.push({ name: upstream.url, text })
    }
    if (!documents.length) missing.push(identity)
    packages.set(identity, {
      name: pkg.name,
      version: pkg.version,
      license:
        typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || entry.license || '',
      repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '',
      documents
    })
  }
  const records = [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en')
  )
  const header = [
    'Vertex — npm third-party licenses and notices',
    'Generated from package-lock.json and installed package license files.',
    'Includes application dependencies and development/build tools for this build platform.',
    'Original copyright and license text below governs each component; retain these notices when distributing Vertex under GPL-3.0-only.',
    ''
  ].join('\n')
  const text =
    header +
    records
      .map((pkg) =>
        [
          '='.repeat(72),
          `${pkg.name}@${pkg.version}`,
          `License: ${pkg.license}`,
          `Repository: ${pkg.repository}`,
          '',
          ...pkg.documents.flatMap((doc) => [`--- ${doc.name} ---`, doc.text, '']),
          ...(!pkg.documents.length
            ? ['No license text included in this npm package; consult the upstream project.', '']
            : [])
        ].join('\n')
      )
      .join('\n')
  const inventory = records.map(({ documents, ...pkg }) => ({
    ...pkg,
    licenseFiles: documents.map((doc) => doc.name)
  }))
  const outputs = {
    'npm-third-party-notices.txt': text + '\n',
    'npm-license-inventory.json': JSON.stringify(inventory, null, 2) + '\n'
  }
  const destination = path.join(root, 'resources/licenses')
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(destination, name)
    if (check) {
      if ((await fs.readFile(file, 'utf8')) !== content)
        throw new Error(`第三方许可资料需要重新生成：${name}`)
    } else {
      await fs.mkdir(destination, { recursive: true })
      await fs.writeFile(file, content)
    }
  }
  return { count: records.length, missing }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateThirdPartyNotices({ check: process.argv.includes('--check') })
  console.log(JSON.stringify(result, null, 2))
}
