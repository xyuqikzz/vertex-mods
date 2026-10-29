function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function includesAny(text = '', patternList = []) {
  return patternList.some((pattern) => pattern.test(text))
}

function getHttpStatusFromText(text = '') {
  const match = text.match(/\b(?:status|code)?\s*[:=]?\s*(4\d{2}|5\d{2})\b/i)
  return match ? Number(match[1]) : 0
}

function getHttpStatus(rawMessage = '', payload = {}) {
  const payloadStatus = Number(payload?.status || payload?.statusCode || payload?.httpStatus || 0)
  if (Number.isFinite(payloadStatus) && payloadStatus >= 400) {
    return payloadStatus
  }
  return getHttpStatusFromText(rawMessage)
}

function buildAttemptSuffix(payload = {}) {
  const attemptIndex = Number(payload?.attemptIndex || 0)
  const attemptCount = Number(payload?.attemptCount || 0)
  if (attemptCount > 1 && attemptIndex > 0) {
    return `（已尝试 ${Math.min(attemptIndex, attemptCount)}/${attemptCount} 个下载地址）`
  }
  return ''
}

function stripInstallFailurePrefix(message = '') {
  return toSafeText(message).replace(/^安装失败[:：,，\s]*/i, '')
}

function resolveStructuredErrorCode(context = {}) {
  return toSafeText(
    context?.code ||
      context?.errorCode ||
      context?.error_code ||
      context?.reasonCode ||
      context?.error?.code ||
      context?.failure?.code
  ).toLowerCase()
}

export function formatDownloadFailureMessage(rawMessage = '', payload = {}) {
  const message = toSafeText(rawMessage)
  const lowerText = message.toLowerCase()
  const status = getHttpStatus(message, payload)
  const attemptSuffix = buildAttemptSuffix(payload)

  if (!message) {
    return `下载失败，请检查网络后重试${attemptSuffix}`
  }

  if (/任务已取消|cancelled|canceled/i.test(message)) {
    return '任务已取消'
  }

  if (/下载地址为空|empty url|invalid url|url is empty/i.test(message)) {
    return `未获取到可用的下载地址，请稍后重试或改用云盘下载${attemptSuffix}`
  }

  if (
    includesAny(lowerText, [
      /timeout/,
      /timed out/,
      /etimedout/,
      /econnaborted/,
      /und_err_connect_timeout/,
      /下载超时/,
      /连接超时/
    ])
  ) {
    return `下载连接超时，请检查网络后重试，或改用云盘下载${attemptSuffix}`
  }

  if (
    includesAny(lowerText, [
      /econnreset/,
      /socket hang up/,
      /interrupted/,
      /network changed/,
      /网络连接中断/,
      /下载中断/,
      /连接被重置/
    ])
  ) {
    return `网络连接中断，下载没有完成，请检查网络后重试${attemptSuffix}`
  }

  if (
    includesAny(lowerText, [
      /enotfound/,
      /eai_again/,
      /err_name_not_resolved/,
      /network error/,
      /failed to fetch/,
      /网络错误/
    ])
  ) {
    return `网络连接异常，暂时无法下载，请检查网络或代理设置后重试${attemptSuffix}`
  }

  if (/enospc|no space|磁盘空间不足/i.test(message)) {
    return '磁盘空间不足，请清理下载目录或更换下载位置后重试'
  }

  if (/eacces|eperm|access is denied|permission denied|没有权限/i.test(message)) {
    return '没有权限写入下载目录，请更换下载位置或以管理员权限重试'
  }

  if (status === 401 || status === 403) {
    return `下载链接已失效或当前账号没有下载权限，请重新获取下载任务${attemptSuffix}`
  }

  if (status === 404) {
    return `下载文件不存在或链接已过期，请重新获取下载任务${attemptSuffix}`
  }

  if (status >= 500) {
    return `下载服务器暂时不可用，请稍后重试${attemptSuffix}`
  }

  if (/已尝试\s*\d+\/\d+\s*个下载地址/.test(message)) {
    return `下载失败，请检查网络后重试${attemptSuffix}`
  }

  return `下载失败，请检查网络或稍后重试${attemptSuffix}`
}

export function formatInstallFailureMessage(rawMessage = '', context = {}) {
  const message = stripInstallFailurePrefix(rawMessage)
  const lowerText = message.toLowerCase()
  const errorCode = resolveStructuredErrorCode(context)

  if (errorCode === 'install_engine.lifecycle_recovery_required') {
    return message || '生命周期恢复准备或回滚未完成，请查看失败详情'
  }

  if (errorCode === 'source_staging_unreadable') {
    return '无法读取已安装模组的暂存源文件，请修复源文件保护状态后重试'
  }

  if (
    context?.gameProcessRunning === true ||
    errorCode === 'game_process_running' ||
    errorCode === 'target_game_process_running'
  ) {
    return '检测到游戏仍在运行，请关闭游戏和相关工具后重试'
  }

  if (errorCode === 'target_game_file_busy' || errorCode === 'game_file_busy') {
    return '游戏文件正在被占用，请关闭游戏和相关工具后重试'
  }

  if (!message) {
    return '安装失败，请查看失败详情后重试'
  }

  if (/无法找到安装路径|缺少游戏安装路径|游戏安装路径不存在|安装路径不存在/.test(message)) {
    return '未找到游戏安装路径，请先在游戏页重新选择安装目录'
  }

  if (/未找到服务器/.test(message)) {
    return '未找到服务器安装路径，请先完成服务器路径设置'
  }

  if (/服务器.*禁用.*安装|服务器已经禁用安装mod/i.test(message)) {
    return '当前服务器已禁用模组安装，请先修改服务器安装模式'
  }

  if (
    includesAny(lowerText, [
      /timeout/,
      /timed out/,
      /etimedout/,
      /超时/,
      /operation timeout/
    ])
  ) {
    return '安装操作超时，请检查游戏目录权限、磁盘状态和游戏进程后重试'
  }

  if (/an object could not be cloned|object could not be cloned|无法克隆/i.test(message)) {
    return '安装参数包含无法传递的数据，请重新发起安装'
  }

  if (/源文件不存在|enoent|no such file|文件不存在|已被移动/i.test(message)) {
    return '安装文件不存在或已被移动，请重新下载后再安装'
  }

  if (/cannot delete output file|文件正在被占用|被占用|占用|resource busy/i.test(message)) {
    return '游戏文件正在被占用，请关闭游戏和相关工具后重试'
  }

  if (/eacces|eperm|access is denied|permission denied|没有权限/i.test(message)) {
    return '没有权限访问安装所需文件，请检查暂存目录和游戏目录权限后重试'
  }

  if (/md5|校验|checksum|hash/i.test(message)) {
    return '文件校验未通过，请重新下载或重新选择正确文件'
  }

  if (/压缩包已加密|需要密码|wrong password|password/i.test(message)) {
    return '压缩包需要正确密码，请改用手动安装或重新获取文件'
  }

  if (/解压失败|extract|archive|压缩包/i.test(message)) {
    if (/没有权限|被占用|需要密码|已加密/.test(message)) {
      return message
    }
    return '压缩包解压失败，请确认文件完整后重试'
  }

  if (/下载结果缺少|安装参数|结构分析参数/.test(message)) {
    return '安装数据不完整，请重新创建安装任务'
  }

  if (/部署失败|安全部署重建失败|所有部署方式均失败|reconcile/i.test(message)) {
    return '文件部署失败，请查看失败详情并检查源文件和目标目录权限后重试'
  }

  if (/流量不足/.test(message)) {
    return '当前剩余流量不足，请改用云盘下载'
  }

  if (/已经创建安装任务|重复创建|重复添加/.test(message)) {
    return '已存在相同安装任务，请勿重复创建'
  }

  const fallback = toSafeText(context?.fallback)
  return fallback || '安装失败，请查看失败详情后重试'
}

export function buildDownloadFailureNotice(taskName = '', rawMessage = '', payload = {}) {
  const safeTaskName = toSafeText(taskName) || '下载任务'
  const reason = formatDownloadFailureMessage(rawMessage, payload)
  if (reason === '任务已取消') {
    return `任务【${safeTaskName}】已取消`
  }
  return `任务【${safeTaskName}】${reason}`
}

export function buildInstallFailureNotice(rawMessage = '', context = {}) {
  const reason = formatInstallFailureMessage(rawMessage, context)
  const modName = toSafeText(context?.modName || context?.name)
  const gameName = toSafeText(context?.gameName)
  const prefixList = []
  if (gameName) prefixList.push(gameName)
  if (modName) prefixList.push(modName)
  const prefix = prefixList.length ? `【${prefixList.join(' - ')}】` : ''

  return `${prefix}安装失败：${reason}`
}
