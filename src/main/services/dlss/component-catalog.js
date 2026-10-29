import updates from './component-updates.json' with { type: 'json' }
import catalog from './catalog.json' with { type: 'json' }
import legacy from './swapper/payload.json' with { type: 'json' }
import { consumerVersions, consumerPath } from '../../../shared/dlss-swapper/consumer-versions.js'

const oldFile = (target) => {
  const f = legacy.files.find((f) => f.path === target)
  if (!f) throw new Error('Missing component lock: ' + target)
  return { target, size: f.size, sha256: f.sha256 }
}
const oldComponent = (id) => catalog.find((c) => c.id === id)
const reshade = oldComponent('reshade')
const feeder = oldComponent('feeder')
const shaderCommit = 'ee30868391d4ad103db60489820102d8fd40e3c1'
// Use pinned source archives for the includes/license too: raw.githubusercontent
// can be unreachable even when GitHub releases and codeload work. File hashes
// stay identical; this changes transport, not the tested component combination.
const feederDownloads = [
  { ...updates['feeder-1.17.0'], files: undefined, format: 'zip' },
  feeder.downloads[1],
  {
    url: `https://codeload.github.com/crosire/reshade-shaders/zip/${shaderCommit}`,
    sha256: '9b13d9fec19ea973b0e06e28610c11f5ec0cbdf88eced9b304fcde1f29d6f409',
    size: 57115,
    format: 'zip'
  },
  {
    url: 'https://codeload.github.com/jlrouzies-fr/DLSS5-Feeder/zip/refs/tags/v0.7.0',
    sha256: 'b1f7077e98b20d7e58e28146d96b1336159cab212f63f82066ffeceef9823814',
    size: 423792,
    format: 'zip'
  }
]
const feederFile = (f) => ({
  ...f,
  target: 'feeder/' + f.target,
  ...(f.download === 2 || f.download === 3
    ? {
        download: 2,
        downloadEntry: `reshade-shaders-${shaderCommit}/Shaders/${f.download === 2 ? 'ReShade.fxh' : 'ReShadeUI.fxh'}`
      }
    : f.download === 4
      ? { download: 3, downloadEntry: 'DLSS5-Feeder-0.7.0/LICENSE' }
      : {})
})
function releaseComponent(id, name, version, tag, prefix, filter = () => true) {
  const entry = updates[tag]
  return {
    id,
    name,
    version,
    downloads: [{ url: entry.url, sha256: entry.sha256, size: entry.size, format: 'zip' }],
    files: entry.files.filter(filter).map((f) => ({
      target: prefix + f.name,
      size: f.size,
      sha256: f.sha256,
      download: 0,
      downloadEntry: f.name
    }))
  }
}

// Only reviewed artifacts are offered. No GitHub /latest lookup during install.
// Reuse legacy hashes for byte-identical assets. The NR runtime is an explicit
// exception until an independent source for these exact bytes is verified.
export const componentCatalog = [
  {
    id: 'reshade',
    name: reshade.name,
    version: reshade.version,
    downloads: [...reshade.downloads, { ...reshade.downloads[0], format: 'file' }],
    files: [
      { ...oldFile('ReShade_Setup_6.8.0_Addon.exe'), download: 1 },
      ...['ReShade32.dll', 'ReShade32.json', 'ReShade64.dll', 'ReShade64.json'].map((name) => ({
        ...oldFile('reshade-vulkan/' + name),
        download: 0,
        downloadEntry: name
      }))
    ]
  },
  releaseComponent('sr', 'DLSS 超分辨率运行库', '310.9.1.0', 'dlss-310.9.1', 'streamline/'),
  {
    id: 'nr-legacy',
    name: 'DLSS NR 已验证兼容构建',
    version: '310.8.0-swapper-streamline',
    downloads: [{ url: legacy.url, sha256: legacy.sha256, size: legacy.size, format: 'swapper' }],
    files: [
      {
        ...oldFile('streamline/nvngx_dlssnr.dll'),
        download: 0,
        downloadEntry: 'streamline/nvngx_dlssnr.dll'
      },
      ...legacy.files
        .filter((f) => /^streamline\/(?:sl\.[a-z_]+\.dll|.*\.license\.txt)$/i.test(f.path))
        .map((f) => ({ ...oldFile(f.path), download: 0, downloadEntry: f.path }))
    ]
  },
  {
    id: 'feeder',
    name: feeder.name,
    version: '1.17.0',
    downloads: feederDownloads,
    files: [
      ...feeder.files.filter((f) => f.download !== 0).map(feederFile),
      ...updates['feeder-1.17.0'].files.map((f) => ({
        target: 'feeder/' + f.name.replace('host64/dlss5-feed-host64.exe', 'dlss5-feed-host64.exe'),
        size: f.size,
        sha256: f.sha256,
        download: 0,
        downloadEntry: f.name
      }))
    ]
  },
  ...consumerVersions.map((c) => ({
    id: 'renodx-' + c.version,
    name: 'RenoDX DLSS5',
    version: c.version,
    downloads: [{ url: c.url, sha256: c.archiveSha256, size: c.archiveSize, format: 'zip' }],
    files: [
      consumerPath(c.version),
      ...(c.version === '6.5.3'
        ? ['renodx-dlss5.addon64', 'feeder/host64/renodx-dlss5.addon64']
        : [])
    ].map((target) => ({
      target,
      size: c.size,
      sha256: c.sha256,
      download: 0,
      downloadEntry: 'renodx-dlss5.addon64'
    }))
  })),
  releaseComponent(
    'renodx-sf',
    'RenoDX DLSS Tool',
    '26.0927.2125',
    'renodx-dlss-SF-26.0927.2125',
    'feeder/host64/'
  )
]
export const packageFiles = componentCatalog.flatMap((c) =>
  c.files.map((f) => ({ ...f, path: f.target, component: c.id, version: c.version }))
)
