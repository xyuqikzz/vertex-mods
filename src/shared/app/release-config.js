import config from './release-config.json' with { type: 'json' }

export function validateReleaseConfig(value = {}) {
  const channel = String(value.channel || 'community').trim()
  if (!['community', 'official', 'custom'].includes(channel))
    throw new Error('invalid_release_channel')
  const updateFeed = String(value.updateFeed || '').trim()
  const downloadPage = String(value.downloadPage || '').trim()
  for (const address of [updateFeed, downloadPage].filter(Boolean)) {
    const url = new URL(address)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      /[\\\s]/.test(address)
    )
      throw new Error('invalid_release_url')
  }
  if (updateFeed && (new URL(updateFeed).search || !updateFeed.endsWith('/')))
    throw new Error('invalid_update_feed')
  if (channel === 'community' && updateFeed) throw new Error('community_update_feed_disabled')
  return Object.freeze({
    channel,
    updateFeed,
    downloadPage,
    updatesEnabled: channel !== 'community' && Boolean(updateFeed)
  })
}

export const releaseConfig = validateReleaseConfig(config)
