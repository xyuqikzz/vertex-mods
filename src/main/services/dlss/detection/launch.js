import path from 'node:path'
import { steam } from '../swapper/library.js'
import { pathKey } from '../files.js'
import { launchForDetection } from '../detect-renderer.js'

export async function detectionLaunchPlan(
  { root, exePath, scan, platform },
  discoverSteam = steam
) {
  // Resolve ownership from the installed library, never from a caller-supplied AppID.
  const games = (await discoverSteam()).filter((game) => pathKey(game.dir) === pathKey(root))
  if (games.length) {
    const game = games.length === 1 ? games[0] : null
    const target =
      scan.launchEntries?.find((entry) => pathKey(entry.path) === pathKey(exePath))?.target ||
      exePath
    if (
      !game ||
      !/^[1-9]\d{0,9}$/.test(String(game.id)) ||
      !scan.selection?.path ||
      pathKey(target) !== pathKey(scan.selection.path)
    )
      return { method: 'manual', message: '请从 Steam 选择对应程序或模式启动游戏，检测会继续。' }
    return {
      method: 'steam',
      url: `steam://rungameid/${game.id}`,
      message: '正在通过 Steam 启动游戏，请选择平时使用的启动模式…'
    }
  }
  const knownPlatform = platform && !/^(?:manual|local|本地游戏)$/i.test(platform)
  if (knownPlatform || /(?:^|[\\/])steamapps[\\/]common[\\/]/i.test(path.resolve(root)))
    return { method: 'manual', message: '请从游戏平台按平时的方式启动游戏，检测会继续。' }
  return { method: 'direct', message: '正在按本地默认方式启动游戏…' }
}

export function createDetectionLauncher(
  context,
  { shell, discoverSteam = steam, direct = launchForDetection, onStarting = () => {} } = {}
) {
  return async (exePath) => {
    const plan = await detectionLaunchPlan({ ...context, exePath }, discoverSteam)
    context.signal?.throwIfAborted()
    onStarting(plan.message)
    if (plan.method === 'manual') return
    if (plan.method === 'steam') {
      if (!shell?.openExternal) throw new Error('Steam 启动入口不可用')
      // Never fall back to launching the renderer without the platform's options.
      await shell.openExternal(plan.url)
    } else await direct(exePath)
  }
}
