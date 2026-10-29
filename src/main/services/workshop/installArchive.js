import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export async function prepareWorkshopInstallArchive(directory, { signal, executable } = {}) {
  const root = path.resolve(directory)
  const check = async (folder) => {
    if (signal?.aborted) throw new Error('安装任务已取消')
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.name === '.DepotDownloader') continue
      const file = path.join(folder, entry.name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw new Error('Steam 下载内容包含符号链接，无法安全安装')
      if (stat.isDirectory()) await check(file)
    }
  }
  await check(root)
  // Steam 返回目录；转换为标准压缩包后复用原有预检、部署、记录和回滚流程。
  const archive = `${root}-${randomUUID()}.zip`
  const tool =
    executable ||
    (app.isPackaged
      ? path.join(process.resourcesPath, 'resources/node/7z.exe')
      : path.resolve(__dirname, '../../resources/node/7z.exe'))
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        tool,
        ['a', '-tzip', '-mx=0', '-y', '-sse', archive, '.', '-xr!.DepotDownloader'],
        {
          cwd: root,
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        }
      )
      const cancel = () => child.kill()
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      child.once('error', () => {
        signal?.removeEventListener('abort', cancel)
        reject(new Error('无法准备 Steam 安装包'))
      })
      child.once('close', (code) => {
        signal?.removeEventListener('abort', cancel)
        if (signal?.aborted) reject(new Error('安装任务已取消'))
        else if (code !== 0) reject(new Error('Steam 安装包准备失败'))
        else resolve()
      })
    })
    return archive
  } catch (error) {
    await fs.rm(archive, { force: true })
    throw error
  }
}
