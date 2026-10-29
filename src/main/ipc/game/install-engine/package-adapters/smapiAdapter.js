import fs from 'fs-extra'
import { createPackageProfile, normalizeSnapshotEntries } from './genericAdapter.js'

async function hasSmapiManifest(snapshot = {}) {
  const entries = normalizeSnapshotEntries(snapshot).allFiles.filter((item) =>
    item.lowerPath.endsWith('manifest.json')
  )
  for (const entry of entries.slice(0, 12)) {
    const filePath = entry.fullPath || entry.path
    if (!filePath) continue
    const json = await fs.readJson(filePath).catch(() => null)
    if (json?.UniqueID || json?.EntryDll || json?.MinimumApiVersion) {
      return true
    }
  }
  return false
}

export async function detectPackageProfile(snapshot = {}) {
  const matched = await hasSmapiManifest(snapshot)
  if (!matched) return null

  return createPackageProfile({
    type: 'smapi',
    adapter: 'smapi',
    confidence: 90,
    signals: [{ code: 'smapi_manifest', message: '识别到 SMAPI manifest.json' }],
    suggestedTarget: 'Mods',
    provides: ['smapi_mod'],
    healthExpectations: {
      requiredFiles: ['manifest.json'],
      requiredDirs: []
    }
  })
}
