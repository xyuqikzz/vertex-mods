import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { extractZip as extract } from '../../utils/extractZip.js'
import toolManifest from './toolManifest.js'
import { decodeSteamToolSession, encodeSteamToolSession } from './sessionConfig.js'
import {
  normalizeWorkshopTarget,
  buildDepotArguments,
  createDepotOutputParser,
  createDepotStreamDecoder,
  normalizeWorkshopCredentials,
  normalizeWorkshopGuardCode
} from '../../../shared/sources/steam-workshop.js'

const ARCHIVE_SHA = toolManifest.archiveSha256
const EXE_SHA = toolManifest.executableSha256
const preparing = new Map()
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function workshopDownloadError(message, code = 'workshop_download_failed') {
  return Object.assign(new Error(message), { code, stage: 'download_failed' })
}

async function clearSessionDirectory(sessionRoot, parent) {
  if (path.dirname(path.resolve(sessionRoot)) !== parent || !path.basename(sessionRoot).startsWith('workshop-session-'))
    throw workshopDownloadError('Steam 临时会话清理范围无效', 'workshop_tool_failed')
  try {
    await fs.rm(sessionRoot, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    throw workshopDownloadError('Steam 临时登录数据清理失败，请关闭客户端后重试', 'workshop_tool_failed')
  }
}

async function toolArchive() {
  const bundled = [
    process.resourcesPath &&
      path.join(process.resourcesPath, 'resources', 'workshop', 'DepotDownloader-windows-x64.zip'),
    path.resolve('resources/workshop/DepotDownloader-windows-x64.zip')
  ].filter(Boolean)
  for (const file of bundled) {
    const bytes = await fs.readFile(file).catch(() => null)
    if (bytes && sha256(bytes) === ARCHIVE_SHA) return bytes
  }
  throw new Error('内置 Steam 下载内核缺失或校验失败，请修复客户端安装')
}

export async function ensureDepotDownloader(cacheRoot) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('当前Steam下载内核支持 Windows x64')
  const root = path.resolve(cacheRoot, `depotdownloader-${toolManifest.version}`)
  if (preparing.has(root)) return preparing.get(root)
  const prepare = (async () => {
    const executable = path.join(root, 'DepotDownloader.exe')
    const existing = await fs.readFile(executable).catch(() => null)
    if (existing && sha256(existing) === EXE_SHA) return executable
    await fs.mkdir(root, { recursive: true })
    const temporary = await fs.mkdtemp(path.join(root, 'prepare-'))
    try {
      const archiveBytes = await toolArchive()
      if (sha256(archiveBytes) !== ARCHIVE_SHA) throw new Error('Steam下载内核校验失败')
      const archive = path.join(temporary, 'tool.zip')
      await fs.writeFile(archive, archiveBytes)
      await extract(archive, { dir: temporary })
      const bytes = await fs.readFile(path.join(temporary, 'DepotDownloader.exe'))
      if (sha256(bytes) !== EXE_SHA) throw new Error('Steam下载内核校验失败')
      await fs.copyFile(path.join(temporary, 'DepotDownloader.exe'), executable)
      await fs.copyFile(path.join(temporary, 'LICENSE'), path.join(root, 'LICENSE'))
      return executable
    } catch (error) {
      throw new Error(
        error.message.includes('校验')
          ? error.message
          : '下载内核准备失败，请检查 GitHub 网络连接后重试'
      )
    } finally {
      const relative = path.relative(root, temporary)
      if (relative.startsWith('prepare-') && !path.isAbsolute(relative) && !relative.includes('..'))
        await fs.rm(temporary, { recursive: true, force: true })
    }
  })()
  preparing.set(root, prepare)
  try {
    return await prepare
  } finally {
    preparing.delete(root)
  }
}

export async function runWorkshopDownload(options, dependencies = {}) {
  const lease = dependencies.account?.acquire(options.signal, options.authOnly === true)
  try {
    return await runWorkshopSession({ ...options, signal: lease?.signal || options.signal }, { ...dependencies, lease })
  } finally {
    lease?.close()
  }
}

async function runWorkshopSession(options, dependencies) {
  const { signal, onProgress = () => {}, onQr = () => {}, auth } = options
  const authOnly = options.authOnly === true
  const lease = dependencies.lease
  const target = authOnly ? { loginMode: 'qr' } : normalizeWorkshopTarget(options.target)
  const abort = () => {
    if (signal?.aborted) throw signal.reason || new Error('下载已取消')
  }
  abort()
  onProgress(0, '正在准备Steam下载内核')
  const preparation = (dependencies.ensureTool || ensureDepotDownloader)(options.cacheRoot)
  const executable = await new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason || new Error('下载已取消'))
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    Promise.resolve(preparation)
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', cancel))
  }).catch((error) => {
    if (signal?.aborted) throw signal.reason || error
    throw workshopDownloadError(error.message || 'Steam 下载内核准备失败', 'workshop_tool_failed')
  })
  abort()
  const folderName = `${target.publishedFileId}-${String(options.jobId).replace(/[^a-zA-Z0-9_-]/g, '')}`
  const destination = authOnly ? '' : path.resolve(
    options.downloadRoot,
    'Mod',
    'steam-workshop',
    target.steamAppId,
    folderName
  )
  if (destination) await fs.mkdir(destination, { recursive: true })
  // 会话经私有管道传递；临时目录只容纳下载内核运行数据，不保存令牌。
  const sessionParent = path.resolve(options.cacheRoot)
  await fs.mkdir(sessionParent, { recursive: true })
  const sessionRoot = await fs.mkdtemp(path.join(sessionParent, 'workshop-session-'))
  let failureText = ''
  let verified = false, identified = false, usingSaved = Boolean(lease?.session)
  let authenticatedSession = null
  async function attempt(downloadTarget, login = null) {
    abort()
    verified = false
    authenticatedSession = login?.saved ? lease.session : null
    identified = Boolean(login || downloadTarget.loginMode === 'qr')
    const attemptController = new AbortController()
    let child, nextLogin, inputError, inputPending = false, password = login?.password || ''
    const stopForInputError = () => {
      if (attemptController.signal.aborted || signal?.aborted) return
      inputError = workshopDownloadError('Steam 授权已结束，请在任务中心重试', 'workshop_login_failed')
      child?.kill()
    }
    const parser = createDepotOutputParser({
      session(text) {
        try { authenticatedSession = decodeSteamToolSession(text) }
        catch { authenticatedSession = null }
      },
      verified() { verified = true },
      progress: onProgress,
      qr(qrText) {
        onQr(qrText)
        if (qrText) auth?.update({ phase: 'qr', qrText })
      },
      auth(phase) {
        if (phase === 'authenticated') {
          attemptController.abort()
          auth?.clear()
        } else auth?.update({ phase: 'mobile', qrText: '', message: '请在 Steam 手机应用中确认此次登录。' })
      },
      prompt(kind, incorrect) {
        if (attemptController.signal.aborted || signal?.aborted) return
        if (kind === 'password') {
          if (login?.saved) {
            inputError = workshopDownloadError('保存的 Steam 登录状态已失效，请重新授权。', 'workshop_session_expired')
            child?.kill()
            return
          }
          if (!password || !child?.stdin?.writable) { stopForInputError(); return }
          child.stdin.write(password + '\n')
          password = ''
          return
        }
        if (!auth || inputPending || attemptController.signal.aborted) return
        inputPending = true
        auth.request({
          phase: 'guard', kind, qrText: '',
          message: incorrect ? '验证码不正确或已过期，请重新输入。' : ''
        }, attemptController.signal).then(value => {
          if (attemptController.signal.aborted || signal?.aborted || !child?.stdin?.writable) return
          inputPending = false
          child.stdin.write(normalizeWorkshopGuardCode(value.code) + '\n')
        }).catch(stopForInputError)
      }
    })
    try {
      return await new Promise((resolve, reject) => {
        child = (dependencies.spawn || spawn)(
          executable,
          buildDepotArguments(downloadTarget, destination, login, { authOnly, remember: Boolean(lease) }),
          {
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, VERTEX_WORKSHOP_SESSION_PIPE: '1' },
            cwd: sessionRoot
          }
        )
        let timer, timeoutError, cleaned = false
        const resetTimeout = () => {
          if (cleaned) return
          clearTimeout(timer)
          timer = setTimeout(
            () => {
              timeoutError = workshopDownloadError(
                'Steam 下载长时间无响应，请检查网络后重试', 'workshop_network_failed'
              )
              child.kill()
            },
            10 * 60 * 1000
          )
        }
        const cancel = () => child.kill()
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        resetTimeout()
        child.stdin?.on('error', stopForInputError)
        child.stdin?.write((login?.saved ? encodeSteamToolSession(lease.session) : '{"Version":1}') + '\n')
        if (login) {
          auth?.update({ phase: 'connecting', qrText: '', message: '正在登录 Steam…' })
        } else if (downloadTarget.loginMode === 'qr' && auth) {
          auth.request({ phase: 'qr', qrText: '' }, attemptController.signal).then(value => {
            if (attemptController.signal.aborted || signal?.aborted) return
            nextLogin = value.loginMode === 'qr' ? value : normalizeWorkshopCredentials(value)
            child.kill()
          }).catch(stopForInputError)
        }
        const decoders = []
        for (const stream of [child.stdout, child.stderr]) {
          const decoder = createDepotStreamDecoder(text => parser.push(text))
          decoders.push(decoder)
          stream.on('data', (bytes) => {
            resetTimeout()
            decoder.push(bytes)
          })
        }
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          attemptController.abort()
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          for (const decoder of decoders) decoder.finish()
          child.stdin?.removeListener('error', stopForInputError)
        }
        child.once('error', () => {
          cleanup()
          parser.finish()
          reject(workshopDownloadError('Steam下载内核无法启动', 'workshop_tool_failed'))
        })
        child.once('close', (code) => {
          cleanup()
          const failure = parser.finish()
          failureText = failure
          if (signal?.aborted) reject(signal.reason || new Error('下载已取消'))
          else if (timeoutError) reject(timeoutError)
          else if (inputError) reject(inputError)
          else if (nextLogin) resolve(nextLogin)
          else if (code !== 0)
            reject(
              workshopDownloadError(
                failure || 'Steam 下载未完成，请检查网络与内容访问权限后重试',
                parser.getFailureCode() || 'workshop_download_failed'
              )
            )
          else resolve(null)
        })
      })
    } finally {
      password = ''
      if (login) login.password = ''
      attemptController.abort()
      auth?.clear()
      onQr('')
    }
  }
  try {
    let login
    try {
      login = await attempt(target, lease?.session ? { username: lease.session.username, saved: true } : null)
    } catch (error) {
      // 网络故障不丢弃已保存的账号；只有明确的令牌拒绝才标记过期。
      if (error.code === 'workshop_session_expired') lease?.invalidate()
      if (!['workshop_auth_required', 'workshop_session_expired'].includes(error.code) || (target.loginMode === 'qr' && !usingSaved) ||
        (!auth && typeof options.onQr !== 'function') || signal?.aborted) throw error
      usingSaved = false
      onProgress(0, '此内容需要 Steam 账号，等待登录授权')
      try {
        login = await attempt({ ...target, loginMode: 'qr' })
      } catch (authorizationError) {
        if (authorizationError.code === 'workshop_auth_required') {
          throw workshopDownloadError('授权的 Steam 账号仍无此内容的访问权限，请确认该账号拥有此游戏。', 'workshop_auth_required')
        }
        throw authorizationError
      }
    }
    while (login) {
      abort()
      usingSaved = false
      try {
        login = await attempt(login.loginMode === 'qr' ? { ...target, loginMode: 'qr' } : target,
          login.loginMode === 'qr' ? null : login)
      } catch (error) {
        if (error.code !== 'workshop_login_failed' || !auth || signal?.aborted) throw error
        // 仅等待用户主动重试，不自动重复发送错误密码。
        const response = await auth.request({
          phase: 'credentials', qrText: '', message: error.message
        }, signal)
        login = response.loginMode === 'qr' ? response : normalizeWorkshopCredentials(response)
      }
    }
    abort()
    if (authOnly && !verified) throw workshopDownloadError('Steam 未确认登录成功，请重新授权。', 'workshop_login_failed')
    if (lease && verified && identified) {
      try {
        lease.save(authenticatedSession, usingSaved ? lease.remembered : auth?.remember === true)
      } catch {
        throw workshopDownloadError('Steam 已授权，但登录状态保存失败，请检查系统凭据存储后重试。', 'workshop_storage_failed')
      }
    }
    if (authOnly) return { authenticated: true }
    const entries = await fs.readdir(destination, { withFileTypes: true })
    if (!entries.some((entry) => entry.name !== '.DepotDownloader'))
      throw workshopDownloadError(failureText || 'Steam 未返回可下载文件，请确认内容访问权限')
    onProgress(100, '下载完成')
    return destination
  } finally {
    authenticatedSession = null
    auth?.clear()
    // 只移除本次创建且仍处于工具缓存目录内的临时会话。
    await clearSessionDirectory(sessionRoot, sessionParent)
  }
}
