import { createPackageProfile, hasAnyDir, hasAnyFile } from './genericAdapter.js'

export async function detectPackageProfile(snapshot = {}) {
  const hasPluginDir = hasAnyDir(snapshot, ['BepInEx/plugins', '**/BepInEx/plugins'])
  const hasPatcherDir = hasAnyDir(snapshot, ['BepInEx/patchers', '**/BepInEx/patchers'])
  const hasBepInExFile = hasAnyFile(snapshot, ['BepInEx/*.dll', '**/BepInEx/*.dll'])
  if (!hasPluginDir && !hasPatcherDir && !hasBepInExFile) return null

  return createPackageProfile({
    type: 'bepinex',
    adapter: 'bepInEx',
    confidence: hasPluginDir || hasPatcherDir ? 92 : 78,
    signals: [
      hasPluginDir ? { code: 'bepinex_plugins', message: '识别到 BepInEx 插件目录' } : null,
      hasPatcherDir ? { code: 'bepinex_patchers', message: '识别到 BepInEx patchers 目录' } : null,
      hasBepInExFile ? { code: 'bepinex_file', message: '识别到 BepInEx 文件' } : null
    ].filter(Boolean),
    suggestedTarget: '.',
    provides: ['bepinex'],
    healthExpectations: {
      requiredDirs: hasPluginDir ? ['BepInEx/plugins'] : ['BepInEx'],
      requiredFiles: []
    }
  })
}
