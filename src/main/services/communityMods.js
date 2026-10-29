import { communityIdentity, attachCommunityInstall } from '../../shared/sources/community-install.js'
import { describeSharedRuleFailure, sameSharedRule } from '../../shared/installation/shared-install-rule.js'
import { buildGamebananaDownloadTask } from '../../shared/sources/gamebanana-catalog.js'
import { buildWorkshopDownloadTask } from '../../shared/sources/steam-workshop.js'

export function createCommunityModService(deps) {
  async function context(input, selectedDirectory = '') {
    const identity = communityIdentity(input)
    const localSourceMeta = {
      source: identity.source, sourceId: identity.sourceGameId,
      sourceSlug: identity.publicGameKey || '', name: identity.gameName, coverImage: identity.cover
    }
    const localRecord = await deps.findGame(localSourceMeta)
    const localGame = localRecord && deps.readLocalGame ? await deps.readLocalGame(localRecord) : null
    const localContext = localGame ? {
      game: localGame, sourceMeta: localSourceMeta,
      appId: Number(localRecord.app_id || localRecord.steamAppId || 0), canManage: true
    } : {}
    const query = {
      sourcePlatform: identity.source,
      sourceGameId: identity.sourceGameId,
      ...(identity.publicGameKey ? { gameKey: identity.publicGameKey } : {}),
      ...(identity.source === 'steam-workshop' ? { appId: Number(identity.sourceGameId) } : {})
    }
    let document
    try {
      document = await deps.fetchRule(query)
    } catch (error) {
      const failure = describeSharedRuleFailure(error)
      return {
        identity,
        ...localContext,
        state: ['NOT_CONFIGURED', 'UNPUBLISHED', 'WITHDRAWN'].includes(failure.state)
          ? 'no_rule'
          : 'rule_error',
        message: failure.message,
        ruleLabel: failure.label
      }
    }
    const steamAlias = document.aliases?.find(
      (alias) => alias.sourcePlatform === 'steam' && alias.aliasType === 'app_id'
    )
    const appId =
      identity.source === 'steam-workshop'
        ? Number(identity.sourceGameId)
        : Number(steamAlias?.aliasValue || 0)
    const sourceMeta = {
      source: identity.source,
      sourceId: identity.sourceGameId,
      sourceSlug: document.gameKey,
      appId: String(appId || ''),
      name: identity.gameName,
      coverImage: identity.cover
    }
    const existing =
      (await deps.findGame(sourceMeta)) || (appId ? await deps.findGame({ appId }) : null)
    let detected
    const directory = selectedDirectory || existing?.client_root_path
    if (directory)
      detected = await deps.detectDirectory({
        ruleJson: document.ruleJson,
        selectedDirectory: directory
      })
    if (!selectedDirectory && !detected?.success)
      detected = await deps.detect({ ruleJson: document.ruleJson })
    if (!detected?.success)
      return {
        identity,
        document,
        sourceMeta,
        appId,
        ...(localGame ? { game: localGame, canManage: true } : {}),
        state: 'unidentified',
        message: '规则已就绪，请识别或手动选择游戏目录'
      }
    const saved = await deps.saveGame({
      appId,
      sourceMeta,
      rootPath: detected.rootPath,
      exePath: detected.exePath
    })
    if (!saved?.success) throw new Error('保存游戏安装路径失败')
    return {
      identity,
      document,
      sourceMeta,
      appId,
      state: 'identified',
      canManage: true,
      game: { rootPath: detected.rootPath, exePath: detected.exePath }
    }
  }

  async function detail(input, options = {}) {
    const identity = communityIdentity(input)
    return deps.readDetail(identity, input.modId, options)
  }

  async function submit(event, input, options = {}) {
    const identity = communityIdentity(input)
    if (!['download', 'install'].includes(input.mode)) throw new Error('下载或安装操作无效')
    const mod = await deps.readDetail(identity, input.modId, options)
    const file = mod.files.find((file) => file.id === String(input.fileId || mod.id))
    if (!file || file.blocked) throw new Error('文件不可下载，请重新选择')
    let task =
      identity.source === 'steam-workshop'
        ? buildWorkshopDownloadTask({ ...mod.workshopDetail, gameName: identity.gameName })
        : buildGamebananaDownloadTask(mod, file.id)
    if (input.mode === 'install') {
      const current = await context(input)
      if (
        !current.document ||
        (input.sharedRuleDocument && !sameSharedRule(input.sharedRuleDocument, current.document))
      )
        throw new Error('安装规则已变化或不可用，请刷新页面后重试')
      task = attachCommunityInstall(task, current, mod, file, input.profileName)
    }
    if (options.signal?.aborted) throw new Error('请求已取消')
    return deps.createTask(event, task)
  }
  return { context, detail, submit }
}
