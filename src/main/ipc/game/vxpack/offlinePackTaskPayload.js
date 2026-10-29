function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toPlainJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function normalizeSource(value = '') {
  return toSafeText(value).toLowerCase()
}

export function buildOfflinePackInstallEntry(options = {}) {
  const item = toSafeObject(options.item)
  const sourceEntry = toPlainJson(options.sourceEntry, {})
  const fallbackEntry = toPlainJson(options.fallbackEntry, {})
  const entry = Object.keys(sourceEntry).length ? sourceEntry : fallbackEntry
  const filePath = toSafeText(options.filePath)
  const ruleSnapshot = toSafeObject(options.ruleSnapshot)
  const manifest = toSafeObject(options.manifest)
  const packagePath = toSafeText(options.packagePath)
  const packageSha256 = toSafeText(options.packageSha256)
  const targetProfileName = toSafeText(options.targetProfileName, 'default')
  const profilePlan = toPlainJson(options.profilePlan, {})

  // 离线安装包始终是客户端侧离线安装：显式补齐安装端点 / 用途字段。
  // 否则下游 installModsExecuteV2 读取到的 taskType=undefined 会被当作服务端安装
  // （int !== 0），而 Nexus 等规则来源不支持服务端安装，导致整单「依赖失败」。
  const previousInstallPayload = toSafeObject(entry.meta?.installPayload)
  const resolveNumberField = (value, fallback) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback
  const itemRole = toSafeText(item.role).toLowerCase()
  const isDefaultDependency = item.isDefaultDependency === true || itemRole === 'default_dependency'
  const resolvedTaskType = resolveNumberField(previousInstallPayload.taskType, 0)
  const resolvedInstallType = resolveNumberField(previousInstallPayload.installType, 0)
  const resolvedUsageType = resolveNumberField(previousInstallPayload.usageType, 1)
  const resolvedTypeId = resolveNumberField(
    previousInstallPayload.typeId,
    isDefaultDependency ? 1 : 0
  )
  // 展示元数据保真：封面与依赖关系来自 manifest 条目，缺失时回退已嵌入的安装载荷。
  const resolvedCover = toSafeText(item.cover) || toSafeText(previousInstallPayload.cover)
  const resolvedDependencies =
    Array.isArray(item.dependencies) && item.dependencies.length
      ? item.dependencies
      : Array.isArray(previousInstallPayload.dependencies)
        ? previousInstallPayload.dependencies
        : []
  // installModsExecuteV2 用 legacy 解构 `{ appid, modId, id }`（appid 实为 games.id、
  // id 实为 option/file_id），离线包导入时必须显式补齐这三个 key，否则：
  //   - appid undefined → staging 落到 `staging\\0\\`、`getGameDataByAppId` 退化为 sourceMeta 兜底；
  //   - modId / id undefined → `getModByData` 反查不到、profile 内同模组无法去重；
  //   - `mods.app_id / mod_id / option_id` 全部为空，模组管理后续按 sourceModKey 兜底显示。
  // 优先级：上游已显式写入 > 离线包条目自带 > sourceModKey 派生兜底。
  const resolvedAppId = (() => {
    // Exporter database ids do not identify the same game on another installation.
    const incoming = Number(options.gameId)
    if (Number.isFinite(incoming) && incoming > 0) return incoming
    const previous = Number(previousInstallPayload.appid ?? previousInstallPayload.app_id)
    if (Number.isFinite(previous) && previous > 0) return previous
    return undefined
  })()
  const sourceModKeyText = toSafeText(item.sourceModKey)
  const resolvedModId =
    toSafeText(previousInstallPayload.modId) ||
    toSafeText(item.sourceModId) ||
    sourceModKeyText
  const resolvedOptionId =
    toSafeText(previousInstallPayload.id) ||
    toSafeText(item.sourceFileId) ||
    (sourceModKeyText
      ? `${sourceModKeyText}:${toSafeText(item.version) || 'offline'}`
      : '')

  // artifactKey 加入 targetProfileName 与 packageSha256，防止同一 vxpack 跨 profile / 跨 job
  // 并发导入时 artifact 表 upsert 互相覆盖（审计 🟡#18）
  const targetProfileNameText = toSafeText(targetProfileName, 'default')
  const packageSha256Text = toSafeText(packageSha256)
  const baseArtifactKey = toSafeText(item.artifactKey || item.artifactId)
  const scopedArtifactKey = [baseArtifactKey, targetProfileNameText, packageSha256Text]
    .filter(Boolean)
    .join(':')

  entry.item = {
    ...(entry.item || {}),
    filePath,
    finalFilePath: filePath,
    download_url: '',
    sourcePlatform: item.sourcePlatform,
    sourceType: item.sourcePlatform,
    sourceModKey: item.sourceModKey,
    sourceModId: item.sourceModId,
    sourceFileId: item.sourceFileId,
    sha256: item.sha256 || entry.item?.sha256 || '',
    file_size: Number(item.sizeBytes ?? entry.item?.file_size ?? 0),
    artifactKey: scopedArtifactKey
  }
  entry.meta = {
    ...(entry.meta || {}),
    offlinePackId: manifest.id,
    offlinePackPath: packagePath,
    offlinePackPackageSha256: packageSha256,
    offlinePackCacheKey: packageSha256,
    offlinePackItemId: item.itemId,
    offlinePackArtifactId: item.artifactId,
    targetProfileName,
    profilePlan,
    installPayload: {
      ...(entry.meta?.installPayload || {}),
      taskType: resolvedTaskType,
      installType: resolvedInstallType,
      usageType: resolvedUsageType,
      typeId: resolvedTypeId,
      cover: resolvedCover,
      dependencies: resolvedDependencies,
      // legacy destructure 兼容：installModsExecuteV2 用 appid 当 game_id、
      // modId 与 id 写入 mods.mod_id / mods.option_id。
      appid: resolvedAppId,
      modId: resolvedModId,
      id: resolvedOptionId,
      fileSize: Number(item.sizeBytes ?? previousInstallPayload.fileSize ?? 0),
      // 离线包导入语义：「导入 = 入库 + 暂存」，文件不部署到游戏目录、is_active=0。
      // 用户在模组管理页点「启用」时再走 toggleModState 标准部署链路。
      deferActivation: true,
      sourceType: item.sourcePlatform,
      sourcePlatform: item.sourcePlatform,
      sourceModKey: item.sourceModKey,
      sourceModId: item.sourceModId,
      sourceFileId: item.sourceFileId,
      sourceGameId: item.sourceGameId,
      sourceGameSlug: item.sourceGameSlug,
      downloadUrl: '',
      profileName: targetProfileName,
      targetProfileName,
      installRule: ruleSnapshot,
      sourceInstallRule: ruleSnapshot,
      metadata: {
        ...(entry.meta?.installPayload?.metadata || {}),
        cover: resolvedCover || toSafeText(entry.meta?.installPayload?.metadata?.cover),
        offlineImport: true,
        offlinePackId: manifest.id,
        offlinePackPath: packagePath,
        offlinePackPackageSha256: packageSha256,
        offlinePackCacheKey: packageSha256,
        offlinePackArtifactId: item.artifactId
      }
    }
  }
  return entry
}

export function buildOfflinePackSourceTaskPayload(payload = {}, game = {}, manifest = {}, entries = []) {
  const source = normalizeSource(
    payload.source || entries[0]?.item?.sourcePlatform || game.sourceType
  )
  const profileName = toSafeText(
    payload.targetProfileName ||
      payload.target_profile_name ||
      manifest.profile?.targetProfileName ||
      manifest.profile?.name,
    'default'
  )
  return {
    source,
    sourceAdapter: source,
    sourcePlatform: source,
    gameKey: game.gameKey,
    gameRoot: toSafeText(game.gameRoot || game.clientRootPath),
    title: `离线安装包：${manifest.name || game.displayName || '未命名包'} · ${source || 'mixed'}`,
    sourceMeta: {
      offlineImport: true,
      displaySource: 'offline-pack',
      displaySourceLabel: '离线安装包',
      offlinePackId: manifest.id,
      offlinePackPath: payload.packagePath || '',
      offlinePackPackageSha256: payload.packageSha256 || payload.package_sha256 || '',
      offlinePackCacheKey: payload.packageSha256 || payload.package_sha256 || '',
      targetProfileName: profileName,
      profilePlan: toPlainJson(payload.profilePlan, {})
    },
    options: {
      autoStart: payload.autoStart !== false,
      conflictPolicy: toSafeText(payload.conflictPolicy || payload.conflict_policy, 'backup'),
      profileName,
      targetProfileName: profileName
    },
    profileName,
    targetProfileName: profileName,
    items: entries
  }
}
