import { createPackageProfile, hasAnyFile } from './genericAdapter.js'

export async function detectPackageProfile(snapshot = {}) {
  const hasPak = hasAnyFile(snapshot, ['*.pak', '**/*.pak'])
  const hasIoStore = hasAnyFile(snapshot, ['*.ucas', '**/*.ucas', '*.utoc', '**/*.utoc'])
  if (!hasPak && !hasIoStore) return null

  return createPackageProfile({
    type: 'unreal_pak',
    adapter: 'unrealPak',
    confidence: hasPak ? 82 : 70,
    signals: [
      hasPak ? { code: 'unreal_pak', message: '识别到 Unreal .pak 文件' } : null,
      hasIoStore ? { code: 'unreal_iostore', message: '识别到 Unreal IoStore 文件' } : null
    ].filter(Boolean),
    suggestedTarget: 'Content/Paks/~mods',
    provides: ['unreal_pak'],
    healthExpectations: {
      requiredFiles: [],
      requiredDirs: []
    }
  })
}
