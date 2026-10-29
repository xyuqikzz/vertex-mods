import { createPackageProfile, hasAnyDir, hasAnyFile } from './genericAdapter.js'

export async function detectPackageProfile(snapshot = {}) {
  const hasUe4ssDir = hasAnyDir(snapshot, ['UE4SS', '**/UE4SS', 'Mods', '**/Mods'])
  const hasCore = hasAnyFile(snapshot, ['UE4SS.dll', '**/UE4SS.dll'])
  const hasUe4ssFile = hasAnyFile(snapshot, [
    'UE4SS-settings.ini',
    '**/UE4SS-settings.ini'
  ])
  if (!hasUe4ssFile && !hasCore) return null

  // 仅当 UE4SS-settings.ini 位于根目录时才加入健康检查，
  // 避免文件实际在子目录（如 ue4ss/UE4SS-settings.ini）时路径解析错误。
  const hasRootSettingsIni = hasAnyFile(snapshot, ['UE4SS-settings.ini'])

  return createPackageProfile({
    type: 'ue4ss',
    adapter: 'ue4ss',
    confidence: hasCore ? 92 : 68,
    signals: [
      hasUe4ssDir ? { code: 'ue4ss_dir', message: '识别到 UE4SS 目录结构' } : null,
      hasUe4ssFile ? { code: 'ue4ss_file', message: '识别到 UE4SS 配置文件' } : null,
      hasCore ? { code: 'ue4ss_core', message: '识别到 UE4SS 核心 DLL' } : null
    ].filter(Boolean),
    suggestedTarget: '.',
    provides: hasCore ? ['ue4ss'] : [],
    healthExpectations: {
      requiredFiles: hasRootSettingsIni ? ['UE4SS-settings.ini'] : [],
      requiredDirs: []
    }
  })
}
