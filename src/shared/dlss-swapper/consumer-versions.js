// Release identity is independent of PE FileVersion (4.60 and 4.70 share it).
export const consumerVersions = [
  {
    version: '6.5.3',
    size: 878080,
    sha256: '342341f669f1d64e0c70c8593a07a2fab5075e073dfae97c331c9a6776260a0a',
    url: 'https://github.com/RankFTW/rhi-repo/releases/download/renodx-dlss5-6.5.3/renodx-dlss5_6.5.3.zip',
    archiveSha256: '553b1619b9e5ddfbcb4ebc7f2f3bffff9256a48a25b988f4817f5c63f4caa1de',
    archiveSize: 370292
  },
  {
    version: '4.60',
    size: 1703424,
    sha256: '245c06137ad13b1ca03afaad5100c1e8f0dce8c11fe50a9272ea562f33cea601',
    url: 'https://github.com/RankFTW/rhi-repo/releases/download/renodx-dlss5-4.60/renodx-dlss5_4.60.zip',
    archiveSha256: 'ad30994ba898f3eed5a4c7953927db9759c680a71bc9d9855cac93e9ccc1e3c6',
    archiveSize: 622241
  },
  {
    version: '4.70',
    size: 1732608,
    sha256: 'd5adf82eb44b065f4c590ac91fe824bab07afea0eb9f994bde936710c8593952',
    url: 'https://github.com/RankFTW/rhi-repo/releases/download/renodx-dlss5-4.70/renodx-dlss5_4.70.zip',
    archiveSha256: 'd6e356d01b429af6288f488a4926c44f1d779a7d4586ee8c79d04d3a09a536e6',
    archiveSize: 632174
  }
]
export const consumerVersion = (version) =>
  consumerVersions.find((item) => item.version === version)
export const validConsumerChoice = (value) => value === 'auto' || !!consumerVersion(value)
export const consumerPath = (version) => `consumers/renodx-dlss5/${version}/renodx-dlss5.addon64`

export function resolveConsumer(target, route, preference = 'auto') {
  if (!validConsumerChoice(preference))
    throw Object.assign(new Error('插件版本选项无效'), { code: 'consumer_version_invalid' })
  if (!['feeder', 'native'].includes(route)) return null
  const gl = route === 'feeder' && target?.api === 'opengl'
  const current = target?.consumer
  let version, reason
  if (preference !== 'auto') {
    version = preference
    reason = 'manual'
  } else {
    version = gl ? '4.60' : '6.5.3'
    reason = gl ? 'opengl-compatibility' : 'default'
  }
  const entry = consumerVersion(version)
  return {
    id: 'renodx-dlss5',
    version,
    sha256: entry.sha256,
    size: entry.size,
    sourceUrl: entry.url,
    selection: preference,
    reason,
    warning: gl && version === '4.70' ? 'opengl-workset-pool' : null,
    blocked: preference === 'auto' && current && !current.known ? 'consumer_unknown' : null
  }
}
