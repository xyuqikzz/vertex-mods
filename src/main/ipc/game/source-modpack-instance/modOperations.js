import dbInstance from '../../../db/dbInstance.js'
import { executeToggleModState, uninstallModById } from '../method.js'

// Thunderstore 的档案文件由其原生安装器管理，不能交给暂存部署引擎删除。
export async function mutateSourceModpackMod(event, localModId, action, dependencies = {}) {
  const readMod =
    dependencies.readMod ||
    ((id) =>
      dbInstance.get(
        `SELECT m.*, g.source_id AS community FROM mods m JOIN games g ON g.id = m.game_id WHERE m.id = ?`,
        [id]
      ))
  const mod = readMod(localModId)
  if (!mod) return { success: false, code: 'mod_not_found', message: '本地模组记录已不存在' }
  if (mod.source === 'thunderstore') {
    const native = dependencies.thunderstore || (await import('../thunderstore.js'))
    const storage = dependencies.storage || (await import('../../../services/profiles/thunderstoreStorage.js'))
    const payload = {
      community: mod.community,
      profileName: mod.profile_name,
      packageFullName: mod.source_mod_key,
      enabled: false
    }
    return await storage.runThunderstoreStorageOperation(() =>
      action === 'disable'
        ? native.thunderstoreSetModEnabled(payload)
        : native.thunderstoreUninstallPackage(payload)
    )
  }
  return action === 'disable'
    ? await (dependencies.disableMod || executeToggleModState)(
        event,
        { id: localModId, isActive: false },
        { update() {} }
      )
    : await (dependencies.uninstallMod || uninstallModById)(event, { id: localModId })
}
