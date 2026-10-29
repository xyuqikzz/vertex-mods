import fs from 'fs-extra'
import { createPackageProfile, hasAnyFile, normalizeSnapshotEntries } from './genericAdapter.js'

async function readThunderstoreManifest(snapshot = {}) {
  const entries = normalizeSnapshotEntries(snapshot).allFiles.filter((item) =>
    item.lowerPath.endsWith('manifest.json')
  )
  for (const entry of entries.slice(0, 12)) {
    const filePath = entry.fullPath || entry.path
    if (!filePath) continue
    const json = await fs.readJson(filePath).catch(() => null)
    if (json?.name && (json?.version_number || Array.isArray(json?.dependencies))) {
      return json
    }
  }
  return null
}

export async function detectPackageProfile(snapshot = {}) {
  const hasToml = hasAnyFile(snapshot, ['thunderstore.toml', '**/thunderstore.toml'])
  const manifest = await readThunderstoreManifest(snapshot)
  if (!hasToml && !manifest) return null

  return createPackageProfile({
    type: 'thunderstore',
    adapter: 'thunderstoreManifest',
    confidence: hasToml ? 94 : 84,
    signals: [
      hasToml ? { code: 'thunderstore_toml', message: '识别到 thunderstore.toml' } : null,
      manifest ? { code: 'thunderstore_manifest', message: '识别到 Thunderstore manifest' } : null
    ].filter(Boolean),
    suggestedTarget: '.',
    dependencies: Array.isArray(manifest?.dependencies)
      ? manifest.dependencies.map((item) => ({ name: item, kind: 'required' }))
      : [],
    provides: ['thunderstore_package'],
    healthExpectations: {
      requiredFiles: hasToml ? ['thunderstore.toml'] : ['manifest.json'],
      requiredDirs: []
    }
  })
}
