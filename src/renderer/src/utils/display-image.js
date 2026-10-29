const MANAGED_IMAGE = /\/client\/media\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/i
const SIZES = [320, 640, 1280]

// 只调整自有、无签名的图片地址；外站、动画、原图查看与下载地址保持原样。
export function displayImageUrl(source, pixels = 640) {
  if (!source) return ''
  if (!/^(https?:\/\/|\/(?!\/))/i.test(source)) return source
  try {
    const url = new URL(source, 'https://vertex.invalid')
    if (!['https:', 'http:'].includes(url.protocol) || !MANAGED_IMAGE.test(url.pathname)) return source
    if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'size')) return source
    const size = SIZES.find(value => value >= (Number(pixels) || 640)) || 1280
    url.searchParams.set('size', String(size))
    return source.startsWith('/') && !source.startsWith('//') ? `${url.pathname}${url.search}` : url.href
  } catch {
    return source
  }
}
