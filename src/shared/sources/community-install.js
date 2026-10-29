import { positivePlatformId } from './community-source.js'
import { normalizePublicGameKey } from '../games/game-rule-support.js'
import { sharedRuleIdentity } from '../installation/shared-install-rule.js'

export function communityIdentity(input = {}) {
  const source = String(input.source || '')
  if (!['gamebanana', 'steam-workshop'].includes(source)) throw new Error('不支持的社区来源')
  return {
    source,
    sourceGameId: positivePlatformId(input.sourceGameId || input.gameId),
    publicGameKey: normalizePublicGameKey(input.publicGameKey),
    gameName: String(input.gameName || '').slice(0, 200),
    cover: String(input.cover || '')
  }
}

export function attachCommunityInstall(task, context, detail, file, profileName = 'Default') {
  if (!context.document || context.state !== 'identified')
    throw new Error('请先获取安装规则并识别游戏目录')
  const { identity, document, sourceMeta, game } = context
  const fileId = String(file.id)
  const modId = String(detail.id)
  const profile = String(profileName || 'Default').trim()
  if (
    !profile ||
    profile.length > 32 ||
    /[<>:"/\\|?*]/.test(profile) ||
    [...profile].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('配置方案名称无效')
  const payload = {
    source: identity.source,
    sourceType: identity.source,
    sourcePlatform: identity.source,
    sourceAdapter: identity.source,
    sourceGameId: identity.sourceGameId,
    gameSourceId: identity.sourceGameId,
    sourceGameSlug: document.gameKey,
    sourceGameDomain: document.gameKey,
    publicGameKey: document.gameKey,
    appId: context.appId,
    appid: context.appId,
    gameName: identity.gameName,
    gameRoot: game.rootPath,
    clientInstallPath: '.',
    serverInstallPath: '',
    modId,
    fileId,
    id: fileId,
    modName: detail.name,
    name: file.name,
    version: file.version || detail.version || '',
    modVersion: file.version || detail.version || '',
    cover: detail.image || '',
    fileSize: file.size || 0,
    sourceModKey: task.items[0].item.sourceModKey,
    sourceMeta: { ...sourceMeta, profileName: profile },
    profileName: profile,
    targetProfileName: profile,
    installType: 0,
    taskType: 0,
    usageType: 1,
    typeId: 0,
    ruleSelection: 'public',
    sharedRuleDocument: sharedRuleIdentity(document),
    installRule: document.ruleJson,
    sourceInstallRule: document.ruleJson,
    metadata: {
      source: identity.source,
      sourceModId: modId,
      sourceFileId: fileId,
      sourcePageUrl: detail.url,
      profileName: profile
    }
  }
  return {
    ...task,
    gameRoot: game.rootPath,
    title: `${identity.source === 'steam-workshop' ? 'Steam' : 'Banana'} 安装：${detail.name}`,
    items: task.items.map((entry) => ({
      ...entry,
      item: { ...entry.item, downloadPurpose: 'install_source', showOpenInDownloadList: false },
      meta: { ...entry.meta, installPayload: payload }
    }))
  }
}
