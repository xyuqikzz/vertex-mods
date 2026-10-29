import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { CAN_UPLOAD_AVATAR, UPLOAD_AVATAR } from '@renderer/api/modules/user.js'

export function validateNickname(value) {
  const length = String(value || '').trim().length
  return length < 2 || length > 10 ? '昵称须为 2–10 个字符。' : ''
}

export function validatePassword(password, repeat) {
  if (
    password.length < 8 ||
    password.length > 16 ||
    !/[a-zA-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return '密码须为 8–16 个字符，同时包含字母和数字。'
  }
  return password !== repeat ? '两次输入的密码不一致。' : ''
}

export function validateAvatar(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    return '请选择 PNG、JPG 或 WebP 图片。'
  if (!file.size || file.size > 512 * 1024) return '头像大小须在 1 B 至 512 KB 之间。'
  return ''
}

// 图片编码为 JSON，通过既有账号网络通道交给 Java，避免 Blob / FormData 跨 IPC 丢失。
export async function submitAvatar(file, signal) {
  signal.throwIfAborted()
  const error = validateAvatar(file)
  if (error) throw new Error(error)
  const config = { signal }
  if (!(await CAN_UPLOAD_AVATAR(config))) throw new Error(uiText('ui.youCanChangeYourAvatarOnceEvery30DaysTry'))
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  const result = await UPLOAD_AVATAR({ contentType: file.type, base64: btoa(binary) }, config)
  signal.throwIfAborted()
  if (!result?.avatar || result.status !== 'active')
    throw new Error(uiText('ui.theAvatarUploadResponseWasIncompleteRefreshYourAccountDetails'))
  return result
}
