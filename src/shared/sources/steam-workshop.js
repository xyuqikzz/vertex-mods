import { positivePlatformId } from './community-source.js'

export function normalizeWorkshopTarget(input = {}) {
  return {
    steamAppId: positivePlatformId(input.steamAppId),
    publishedFileId: positivePlatformId(input.publishedFileId, 18446744073709551615n),
    loginMode: input.loginMode === 'qr' ? 'qr' : 'anonymous'
  }
}

export function normalizeWorkshopDetails(response, target) {
  const record = response?.response?.publishedfiledetails?.[0]
  if (!record || Number(record.result) !== 1)
    throw new Error('此Steam内容不可访问，可能已删除或设为私有')
  if (
    String(record.publishedfileid) !== target.publishedFileId ||
    String(record.consumer_app_id) !== target.steamAppId
  )
    throw new Error('模组与所选游戏不匹配，请从对应游戏卡片重新打开')
  if (Number(record.file_type) === 2)
    throw new Error('这是Steam合集，请打开其中的单个模组后下载')
  let downloadUrl = ''
  try {
    const url = new URL(record.file_url)
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      /(^|\.)(steamusercontent\.com|steamcontent\.com|steamstatic\.com)$/.test(url.hostname)
    ) {
      url.protocol = 'https:'
      downloadUrl = url.href
    }
  } catch {
    /* 新版 UGC 通过 Steam 协议下载，无 HTTP 地址。 */
  }
  return {
    ...target,
    title: String(record.title || `Workshop ${target.publishedFileId}`),
    size: Math.max(0, Number(record.file_size) || 0),
    version: String(record.time_updated || '0'),
    fileName: String(record.filename || `workshop-${target.publishedFileId}.bin`),
    downloadUrl
  }
}

export function buildWorkshopDownloadTask(detail) {
  const target = normalizeWorkshopTarget(detail)
  const fileName = detail.fileName.split(/[\\/]/).pop() || `workshop-${target.publishedFileId}.bin`
  return {
    source: 'steam-workshop',
    sourceAdapter: 'steam-workshop',
    sourceGameId: target.steamAppId,
    gameKey: `steam-workshop:${target.steamAppId}`,
    gameName: String(detail.gameName || target.steamAppId),
    title: `Steam下载：${detail.title}`,
    items: [
      {
        item: {
          task_name: detail.title,
          module: 'Mod',
          fileName,
          file_name: fileName,
          file_type: fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '',
          file_size: detail.size,
          sourcePlatform: 'steam-workshop',
          sourceType: 'steam-workshop',
          sourceGameId: target.steamAppId,
          sourceModId: target.publishedFileId,
          sourceFileId: target.publishedFileId,
          sourceModKey: `steam-workshop:${target.publishedFileId}`,
          version: detail.version,
          saveType: 2,
          downloadPurpose: 'download_only',
          showOpenInDownloadList: true,
          ...(detail.downloadUrl
            ? { download_url: detail.downloadUrl }
            : { workshopDownload: target })
        },
        meta: { displayName: detail.title, version: detail.version }
      }
    ]
  }
}

export function normalizeWorkshopCredentials(input = {}) {
  const username = String(input.username || '').trim()
  const password = String(input.password || '')
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(username))
    throw new Error('请输入 Steam 登录账号名（不是昵称或邮箱）')
  if (!/^[\x20-\x7e]{1,64}$/.test(password))
    throw new Error('请输入有效的 Steam 密码')
  return { username, password, guardMode: input.guardMode === 'mobile' ? 'mobile' : 'code' }
}

export function normalizeWorkshopGuardCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new Error('请输入 5 位 Steam Guard 验证码')
  return code
}

// 终端字符约为 1:2 宽高；上下半格按像素还原，避免字体间隙破坏二维码。
export function workshopQrMatrix(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n')
  if (lines.length < 12 || lines.length > 200 || lines.some(line => !/^[ █▀▄]*$/.test(line))) return []
  const width = Math.max(...lines.map(line => line.length))
  if (!width || width > 200) return []
  return lines.flatMap(line => [
    Array.from({ length: width }, (_, x) => ['█', '▀'].includes(line[x])),
    Array.from({ length: width }, (_, x) => ['█', '▄'].includes(line[x]))
  ])
}

export function buildDepotArguments(target, directory, login = null, options = {}) {
  const valid = options.authOnly ? { loginMode: 'qr' } : normalizeWorkshopTarget(target)
  return [
    ...(options.authOnly ? ['-vertex-auth-only'] : ['-app',
    valid.steamAppId,
    '-pubfile',
    valid.publishedFileId,
    '-dir',
    directory,
    '-validate',
    '-max-downloads',
    '8']),
    '-loginid',
    String(100000 + Math.floor(Math.random() * 100000000)),
    ...(options.remember && (login || valid.loginMode === 'qr') ? ['-remember-password'] : []),
    ...(login
      ? ['-username', login.username, ...(login.guardMode === 'mobile' ? [] : ['-no-mobile'])]
      : valid.loginMode === 'qr' ? ['-qr'] : [])
  ]
}

// Windows 控制台可能输出 GBK；按完整行判断编码，避免分块截断 UTF-8 字符。
export function createDepotStreamDecoder(emit) {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  const legacy = new TextDecoder('gbk')
  let pending = new Uint8Array()
  function line(bytes) {
    let text
    try { text = utf8.decode(bytes) }
    catch { text = legacy.decode(bytes) }
    emit(text + '\n')
  }
  return {
    push(chunk) {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
      const combined = new Uint8Array(pending.length + bytes.length)
      combined.set(pending); combined.set(bytes, pending.length)
      let start = 0
      for (let i = 0; i < combined.length; i++) {
        if (combined[i] !== 10 && combined[i] !== 13) continue
        if (i > start) line(combined.subarray(start, i))
        start = i + 1
      }
      pending = combined.slice(start).slice(-32768)
      // Console.Write 的凭据提示没有换行，不能等到进程退出才交给解析器。
      const prompt = new TextDecoder().decode(pending)
      if (depotPromptKind(prompt)) {
        emit(prompt + '\n')
        pending = new Uint8Array()
      }
    },
    finish() {
      if (pending.length) line(pending)
      pending = new Uint8Array()
    }
  }
}

// 不向日志或数据库写入 CLI 原文：其中可能包含账号名、授权二维码或签名地址。
function depotPromptKind(value) {
  if (/Enter account password for "[^"\r\n]*":\s*$/.test(value)) return 'password'
  if (/Please enter your (?:2-factor|2 factor) auth code from your authenticator app:\s*$/.test(value)) return 'device'
  if (/Please enter (?:the auth code sent to the email at [^\r\n]*|the authentication code sent to your email address):\s*$/.test(value)) return 'email'
  return ''
}

export function createDepotOutputParser({ progress = () => {}, qr = () => {}, prompt = () => {}, auth = () => {}, verified = () => {}, session = () => {} } = {}) {
  let buffer = '',
    qrLines = [],
    qrTimer,
    failure = '',
    failureCode = '',
    peak = 0,
    incorrectCode = false
  function line(value) {
    if (value.startsWith('VERTEX_SESSION:')) { session(value.slice('VERTEX_SESSION:'.length)); return }
    if (value.trim() === 'VERTEX_AUTHENTICATED') verified()
    const kind = depotPromptKind(value)
    if (kind) {
      prompt(kind, incorrectCode)
      incorrectCode = false
      return
    }
    if (/previous 2-factor auth code.*incorrect/i.test(value)) incorrectCode = true
    if (/Use the Steam Mobile App to confirm your sign in/.test(value)) auth('mobile')
    if (
      (/^[ █▀▄]+$/.test(value) && value.includes('█')) ||
      (qrLines.length && /^[ █▀▄]*$/.test(value))
    ) {
      qrLines.push(value)
      clearTimeout(qrTimer)
      qrTimer = setTimeout(() => {
        if (qrLines.length >= 12) qr(qrLines.join('\n'))
        qrLines = []
      }, 100)
      return
    }
    if (/QR code has changed|Use the Steam Mobile App to sign in/.test(value)) {
      qrLines = []
      return
    }
    if (/Logged on|Got session token|Using Steam3 suggested CellID:|Got \d+ licenses for account!/.test(value)) {
      clearTimeout(qrTimer)
      qrLines = []
      qr('')
      auth('authenticated')
    }
    if (/Logged on|Got session token|Connecting to Steam3/.test(value))
      progress(peak, '正在连接 Steam')
    const match = value.match(/(?:^|\s)(\d+(?:\.\d+)?)%/)
    if (match) {
      peak = Math.max(peak, Math.min(99, Number(match[1])))
      progress(peak, '正在下载Steam文件')
    }
    if (/Access token was rejected/i.test(value)) {
      failureCode = 'workshop_session_expired'
      failure = '保存的 Steam 登录状态已失效，请重新授权。'
    } else if (/Failed to authenticate with Steam:|Unable to login to Steam3:.*(?:InvalidPassword|AccountLogonDenied|TwoFactorCodeMismatch|RateLimitExceeded)/i.test(value)) {
      failureCode = 'workshop_login_failed'
      failure = /InvalidPassword/i.test(value)
        ? 'Steam 账号或密码不正确，请重新输入。'
        : /RateLimitExceeded|LimitExceeded/i.test(value)
          ? 'Steam 登录请求过于频繁，请稍后再试。'
          : 'Steam 登录未完成，请检查账号、密码和验证方式后重试。'
    } else if (
      /App\s+\d+.*is not available from this account|access.?denied|no subscription|not have.*(?:license|access)|Failed to get depot key|InsufficientPrivilege/i.test(
        value
      )
    ) {
      failureCode = 'workshop_auth_required'
      failure = 'Steam 未授权此内容，需要账号访问权限，请使用拥有该游戏的 Steam 账号登录或扫码授权。'
    } else if (/failed to (?:connect|download|get manifest)|timeout|timed out/i.test(value)) {
      if (!failure) {
        failureCode = 'workshop_network_failed'
        failure = 'Steam 下载失败，请检查网络后在任务中心重试。'
      }
    }
  }
  return {
    push(text) {
      buffer += text
      const lines = buffer.split(/\r?\n|\r/)
      buffer = lines.pop().slice(-32768)
      lines.forEach(line)
    },
    finish() {
      if (buffer) line(buffer)
      clearTimeout(qrTimer)
      return failure
    },
    getFailureCode() {
      return failureCode
    }
  }
}
