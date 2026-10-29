import { createPackageProfile, hasAnyDir, hasAnyFile } from './genericAdapter.js'

export async function detectPackageProfile(snapshot = {}) {
  const hasModsDir = hasAnyDir(snapshot, ['Mods', 'MelonLoader/Mods', '**/MelonLoader/Mods'])
  const hasMelonFile = hasAnyFile(snapshot, [
    'MelonLoader/*.dll',
    'MelonLoader/**/*.dll',
    '**/MelonLoader/**/*.dll'
  ])
  // Mods 是许多框架的数据目录，version.dll / doorstop 也不是 MelonLoader 专属。
  if (!hasMelonFile) return null

  return createPackageProfile({
    type: 'melonloader',
    adapter: 'melonLoader',
    confidence: hasModsDir ? 88 : 72,
    signals: [
      hasModsDir ? { code: 'melonloader_mods', message: '识别到 MelonLoader Mods 目录' } : null,
      hasMelonFile ? { code: 'melonloader_file', message: '识别到 MelonLoader 引导文件' } : null
    ].filter(Boolean),
    suggestedTarget: '.',
    provides: ['melonloader'],
    healthExpectations: {
      requiredDirs: hasModsDir ? ['Mods'] : [],
      requiredFiles: []
    }
  })
}
