// 来源图标与封面字段归一化。
import { toSafeText } from './values.js'

function pickImageText(...values) {
  for (const value of values) {
    const text = resolveImageText(value)
    if (text) return text
  }
  return ''
}

function normalizeImageScalarText(value = '') {
  const text = toSafeText(value)
  return text && text !== '[object Object]' ? text : ''
}

function resolveImageText(value = '') {
  if (!value) {
    return ''
  }

  if (typeof value !== 'object') {
    return normalizeImageScalarText(value)
  }

  return pickImageText(
    value.url,
    value.src,
    value.href,
    value.original,
    value.thumb_1280x720,
    value.thumb_640x360,
    value.thumb_320x180,
    value.thumb_640x320,
    value.thumb_320x160,
    value.thumb_100x100,
    value.thumb_50x50,
    value.image,
    value.icon,
    value.cover,
    value.pictureUrl,
    value.picture_url
  )
}

function resolveSourceLogoUrl(source = {}) {
  const versions = Array.isArray(source?.versions) ? source.versions : []
  const mediaImages = Array.isArray(source?.media?.images) ? source.media.images : []
  return pickImageText(
    source?.pictureUrl,
    source?.picture_url,
    source?.logoUrl,
    source?.logo_url,
    source?.iconUrl,
    source?.icon_url,
    source?.coverUrl,
    source?.cover_url,
    source?.thumbnailUrl,
    source?.thumbnail_url,
    source?.imageUrl,
    source?.image_url,
    source?.logo,
    source?.icon,
    source?.cover,
    source?.coverImage,
    source?.cover_image,
    source?.thumbnail,
    source?.image,
    source?.avatar,
    source?.header,
    mediaImages[0],
    source?.latestVersion?.icon,
    source?.latestVersion?.logo,
    source?.latest_version?.icon,
    source?.latest_version?.logo,
    source?.latest?.icon,
    source?.latest?.logo,
    versions[0]?.icon,
    versions[0]?.logo,
    source?.modfile?.logo,
    source?.modfile?.image,
    source?.modFile?.logo,
    source?.modFile?.image,
    source?.file?.logo,
    source?.file?.image
  )
}

export function buildLogoFields(source = {}) {
  const logoUrl = resolveSourceLogoUrl(source)
  return logoUrl
    ? {
        logo: logoUrl,
        icon: logoUrl,
        cover: logoUrl,
        pictureUrl: logoUrl
      }
    : {}
}

export function hasSourceLogo(source = {}) {
  return !!resolveSourceLogoUrl(source)
}
