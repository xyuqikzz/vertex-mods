import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { atomicWrite, fail, hashFile, safeJoin } from './files.js'

const exec = promisify(execFile)
export function createDirectLauncher({ root, source }) {
  const revision = createHash('sha256').update(source).digest('hex').slice(0, 20)
  let preparing
  async function compile() {
    await fs.mkdir(root, { recursive: true })
    const directory = await safeJoin(root, revision)
    await fs.mkdir(directory, { recursive: true })
    const file = await safeJoin(directory, 'launcher.exe')
    const marker = path.join(directory, 'build.json')
    try {
      const record = JSON.parse(await fs.readFile(marker, 'utf8'))
      if (record.revision === revision && record.sha256 === (await hashFile(file))) return file
    } catch {
      /* Build only our embedded source, never use an unverified helper. */
    }
    const compiler = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    )
    try {
      await fs.access(compiler)
    } catch {
      fail(
        'launcher_unavailable',
        '缺少 Windows .NET Framework 4 启动助手编译器，无法准备 DirectX 独立启动'
      )
    }
    const input = path.join(directory, 'launcher.cs')
    await atomicWrite(input, source)
    try {
      await exec(
        compiler,
        [
          '/nologo',
          '/platform:x64',
          '/optimize+',
          '/reference:System.Runtime.Serialization.dll',
          `/out:${file}`,
          input
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 262144 }
      )
    } catch {
      fail('launcher_build_failed', '无法准备图形启动助手，请检查 .NET Framework 与缓存目录权限')
    }
    await atomicWrite(marker, JSON.stringify({ revision, sha256: await hashFile(file) }))
    return file
  }
  async function launch(binding, env, directory, onPrepared = () => {}) {
    preparing ||= compile().catch((error) => {
      preparing = null
      throw error
    })
    const helper = await preparing
    const built = JSON.parse(
      await fs.readFile(path.join(path.dirname(helper), 'build.json'), 'utf8')
    )
    if ((await hashFile(helper)) !== built.sha256) {
      preparing = null
      fail('launcher_changed', '启动助手文件已变化，请重新准备后重试')
    }
    const dll = await safeJoin(directory, 'ReShade64.dll')
    return new Promise((resolve, reject) => {
      const child = spawn(helper, [], {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      })
      let output = '',
        settled = false,
        received = 0
      const timer = setTimeout(() => {
        child.kill()
        finish(new Error('图形启动助手超时'))
      }, 30000)
      function finish(error, result) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          child.stdin.end()
          reject(Object.assign(error, { code: error.code || 'isolated_load_failed' }))
        } else resolve(result)
      }
      child.stdout.on('data', (chunk) => {
        output += chunk
        received += chunk.length
        if (received > 65536) {
          child.kill()
          finish(new Error('启动助手输出异常'))
          return
        }
        let end
        while ((end = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, end)
          output = output.slice(end + 1)
          try {
            const result = JSON.parse(line)
            if (!result.ok || !Number.isInteger(result.pid) || result.pid <= 0)
              finish(
                new Error(
                  `独立加载失败（${result.stage || 'unknown'} / ${result.win32 || 0}），未启动普通游戏冒充成功`
                )
              )
            else if (result.stage === 'ready')
              Promise.resolve()
                .then(() => onPrepared(result.pid))
                .then(() => child.stdin.write('resume\n'))
                .catch((error) => finish(error))
            else if (result.stage === 'loaded')
              finish(null, { pid: result.pid, loaderVerified: true })
          } catch {
            finish(new Error('图形启动助手返回无效协议'))
          }
        }
      })
      child.on('error', () =>
        finish(Object.assign(new Error('图形启动助手无法启动'), { code: 'launcher_unavailable' }))
      )
      child.on('close', () => finish(new Error('图形启动助手未返回完整加载结果')))
      child.stdin.on('error', () => {})
      child.stdin.write(
        JSON.stringify({ exe: binding.exePath, cwd: binding.cwd, args: binding.args, dll }) + '\n'
      )
    })
  }
  return { launch }
}
