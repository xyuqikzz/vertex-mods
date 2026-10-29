const release = require('./src/shared/app/release-config.json')
const feed = String(release.updateFeed || '').trim()
if (!['community', 'official', 'custom'].includes(release.channel))
  throw new Error('invalid_release_channel')
if (feed) {
  const url = new URL(feed)
  if (
    release.channel === 'community' ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !feed.endsWith('/') ||
    /[\\\s]/.test(feed)
  )
    throw new Error('invalid_update_feed')
}
module.exports = {
  extends: './electron-builder.yml',
  // 打包时写入 app-update.yml（包含缓存目录）；实际发布仍由 CI 控制。
  publish: release.channel === 'community'
    ? [{ provider: 'github', owner: 'xyuqikzz', repo: 'vertex-mods', private: false }]
    : feed ? [{ provider: 'generic', url: feed }] : null
}
