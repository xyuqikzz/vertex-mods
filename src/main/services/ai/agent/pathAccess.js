import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export function assertLocalAgentPath(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    /^[\\/]{2}/.test(value) ||
    (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':')))
  ) {
    throw Object.assign(new Error('仅允许本地绝对路径。'), { code: 'log_path_not_authorized' })
  }
}

export function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

export async function validateGameRoot(rootPath, exePath) {
  assertLocalAgentPath(rootPath)
  assertLocalAgentPath(exePath)
  const root = await fs.realpath(rootPath)
  const exe = await fs.realpath(exePath)
  if (!(await fs.stat(root)).isDirectory() || !(await fs.stat(exe)).isFile())
    throw new Error('请选择游戏目录及实际的游戏程序文件。')
  if (!isPathWithin(root, exe) || root === exe || path.extname(exe).toLowerCase() !== '.exe')
    throw new Error('游戏 EXE 必须位于绑定的游戏目录内。')
  if (await isProtectedRoot(root))
    throw new Error('不能将磁盘根目录、用户主目录或系统目录绑定为游戏目录。')
  return { root, exe }
}

export async function isProtectedRoot(root) {
  const targets = [
    path.parse(root).root,
    os.homedir(),
    process.env.WINDIR,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.APPDATA,
    process.env.LOCALAPPDATA
  ].filter(Boolean)
  for (const target of targets) {
    const real = await fs.realpath(target).catch(() => path.resolve(target))
    if (path.relative(real, root) === '') return true
    if ([process.env.WINDIR, process.env.SystemRoot].includes(target) && isPathWithin(real, root))
      return true
  }
  return false
}

export async function resolveAllowedLogPath(filePath, { roots = [], files = [] } = {}) {
  assertLocalAgentPath(filePath)
  const real = await fs.realpath(filePath)
  if (files.includes(real) || roots.some((root) => isPathWithin(root, real))) return real
  throw Object.assign(new Error('日志路径不在授权范围内，请通过文件选择器选择该文件。'), {
    code: 'log_path_not_authorized'
  })
}
