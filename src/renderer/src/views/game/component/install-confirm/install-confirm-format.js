// 安装确认弹窗的展示格式：只改变显示，不改变安装数据。

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 1024 进制；B 取整，其余保留 1 位小数并去掉末尾 .0。无效值返回空字符串。 */
export function formatInstallSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), SIZE_UNITS.length - 1)
  const value = size / 1024 ** index
  const text = index === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${SIZE_UNITS[index]}`
}

function toDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value)
  const text = String(value || '').trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return toDate(Number(text))
  return new Date(text)
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 列表里只显示 YYYY-MM-DD（本地时区）；无法解析时原样返回。 */
export function formatInstallDate(value) {
  const date = toDate(value)
  if (!date || Number.isNaN(date.getTime())) return String(value || '').trim()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 悬停时显示的完整本地时间。 */
export function formatInstallDateTime(value) {
  const date = toDate(value)
  if (!date || Number.isNaN(date.getTime())) return String(value || '').trim()
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 下载次数用千分位，不缩写成「万」，方便比较。 */
export function formatInstallCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count < 0) return ''
  return Math.round(count).toLocaleString('en-US')
}
