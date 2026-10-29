import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_COUNT = 10
const MAX_ITEM_COUNT = 300

function normalizeText(value = '') {
  return String(value ?? '').trim()
}

function normalizeKey(value = '') {
  return normalizeText(value).toLowerCase()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function getDetailPack(detail = {}) {
  const target = detail && typeof detail === 'object' ? detail : {}
  return target.modpack && typeof target.modpack === 'object' ? target.modpack : target
}

function normalizePage(pageData = {}) {
  const data = pageData && typeof pageData === 'object' ? pageData : {}
  const records = Array.isArray(data.records)
    ? data.records
    : Array.isArray(data.list)
      ? data.list
      : []
  return {
    records,
    total: toSafeNumber(data.total, records.length),
    current: toSafeNumber(data.current ?? data.page, 1),
    size: toSafeNumber(data.size ?? data.pageSize, DEFAULT_PAGE_SIZE)
  }
}

function getPackId(pack = {}) {
  return normalizeText(pack.id || pack.sourceModpackId || pack.source_modpack_id)
}

function getPackSourceType(pack = {}) {
  return normalizeKey(pack.sourceType || pack.source_type)
}

function getPackSourceGameId(pack = {}) {
  return normalizeKey(pack.sourceGameId || pack.source_game_id)
}

function getPackSourceGameSlug(pack = {}) {
  return normalizeKey(pack.sourceGameSlug || pack.source_game_slug)
}

function getPackShareCode(pack = {}) {
  return normalizeText(pack.shareCode || pack.share_code || pack.code)
}

function hasSameGameIdentity(pack = {}, snapshot = {}) {
  const targetGameId = getPackSourceGameId(pack)
  const sourceGameId = getPackSourceGameId(snapshot)
  const targetGameSlug = getPackSourceGameSlug(pack)
  const sourceGameSlug = getPackSourceGameSlug(snapshot)

  if (targetGameId && sourceGameId && targetGameId === sourceGameId) return true
  if (targetGameSlug && sourceGameSlug && targetGameSlug === sourceGameSlug) return true
  return false
}

function isCompatibleTarget(pack = {}, snapshot = {}) {
  const sourceType = getPackSourceType(snapshot)
  const targetSourceType = getPackSourceType(pack)
  if (!sourceType || !targetSourceType) return false
  if (targetSourceType !== 'mixed' && targetSourceType !== sourceType) return false
  return hasSameGameIdentity(pack, snapshot)
}

function getItemPlatform(item = {}) {
  return normalizeKey(item.sourcePlatform || item.source_platform)
}

function getItemIdentity(item = {}) {
  const platform = getItemPlatform(item)
  const sourceModId = normalizeKey(item.sourceModId || item.source_mod_id)
  const sourceModKey = normalizeKey(item.sourceModKey || item.source_mod_key)
  const identity = sourceModId || sourceModKey
  return platform && identity ? `${platform}|${identity}` : ''
}

function mergeMetadata(previousValue, nextValue) {
  const previous = previousValue && typeof previousValue === 'object' ? previousValue : {}
  const next = nextValue && typeof nextValue === 'object' ? nextValue : {}
  return {
    ...previous,
    ...next
  }
}

function preferNextText(nextValue, previousValue) {
  const next = normalizeText(nextValue)
  return next || normalizeText(previousValue)
}

function mergeItem(previousItem = {}, nextItem = {}, sortIndex = 0) {
  const previous = previousItem && typeof previousItem === 'object' ? previousItem : {}
  const next = nextItem && typeof nextItem === 'object' ? nextItem : {}
  const previousMetadata =
    previous.metadata && typeof previous.metadata === 'object' ? previous.metadata : {}
  const nextMetadata = next.metadata && typeof next.metadata === 'object' ? next.metadata : {}
  const nextDependencies = Array.isArray(next.dependencies)
    ? next.dependencies
    : Array.isArray(nextMetadata.dependencies)
      ? nextMetadata.dependencies
      : null

  return {
    ...previous,
    ...next,
    sourcePlatform: preferNextText(
      next.sourcePlatform || next.source_platform,
      previous.sourcePlatform
    ),
    sourceModId: preferNextText(next.sourceModId || next.source_mod_id, previous.sourceModId),
    sourceFileId: preferNextText(next.sourceFileId || next.source_file_id, previous.sourceFileId),
    sourceModKey: preferNextText(next.sourceModKey || next.source_mod_key, previous.sourceModKey),
    name: preferNextText(next.name, previous.name),
    version: preferNextText(next.version, previous.version),
    cover: preferNextText(
      next.cover || next.icon || nextMetadata.cover || nextMetadata.icon,
      previous.cover || previous.icon || previousMetadata.cover || previousMetadata.icon
    ),
    description: preferNextText(
      next.description || next.summary || nextMetadata.description || nextMetadata.summary,
      previous.description ||
        previous.summary ||
        previousMetadata.description ||
        previousMetadata.summary
    ),
    downloadUrl: preferNextText(
      next.downloadUrl ||
        next.download_url ||
        nextMetadata.downloadUrl ||
        nextMetadata.download_url,
      previous.downloadUrl ||
        previous.download_url ||
        previousMetadata.downloadUrl ||
        previousMetadata.download_url
    ),
    dependencies: nextDependencies ?? previous.dependencies ?? [],
    metadata: mergeMetadata(previousMetadata, nextMetadata),
    sortIndex
  }
}

function getItemReleaseFileId(item = {}) {
  return normalizeKey(item.sourceFileId || item.source_file_id)
}

function getItemReleaseVersion(item = {}) {
  return normalizeKey(item.version)
}

function getItemSourceModKey(item = {}) {
  return normalizeKey(item.sourceModKey || item.source_mod_key)
}

function hasItemChanged(previousItem = {}, nextItem = {}) {
  const previousFileId = getItemReleaseFileId(previousItem)
  const nextFileId = getItemReleaseFileId(nextItem)
  if (previousFileId && nextFileId) return previousFileId !== nextFileId

  const previousVersion = getItemReleaseVersion(previousItem)
  const nextVersion = getItemReleaseVersion(nextItem)
  if (previousVersion && nextVersion) return previousVersion !== nextVersion

  const previousSourceModKey = getItemSourceModKey(previousItem)
  const nextSourceModKey = getItemSourceModKey(nextItem)
  if (previousSourceModKey && nextSourceModKey) {
    return previousSourceModKey !== nextSourceModKey
  }

  return false
}

function buildAppendUpdateDiff(existingItems = [], snapshotItems = []) {
  const mergedItems = (Array.isArray(existingItems) ? existingItems : []).map((item, index) => ({
    ...item,
    sortIndex: index
  }))
  const existingIndexByIdentity = new Map()
  const changeByIdentity = new Map()

  mergedItems.forEach((item, index) => {
    const identity = getItemIdentity(item)
    if (identity && !existingIndexByIdentity.has(identity)) {
      existingIndexByIdentity.set(identity, index)
    }
  })

  for (const rawItem of Array.isArray(snapshotItems) ? snapshotItems : []) {
    const identity = getItemIdentity(rawItem)
    if (!identity) continue
    const existingIndex = existingIndexByIdentity.get(identity)

    if (existingIndex === undefined) {
      const addedItem = mergeItem({}, rawItem, mergedItems.length)
      mergedItems.push(addedItem)
      existingIndexByIdentity.set(identity, mergedItems.length - 1)
      changeByIdentity.set(identity, {
        changeType: 'added',
        item: addedItem,
        previousItem: null
      })
      continue
    }

    const previousItem = mergedItems[existingIndex]
    const nextItem = mergeItem(previousItem, rawItem, existingIndex)
    mergedItems[existingIndex] = nextItem
    if (hasItemChanged(previousItem, nextItem)) {
      changeByIdentity.set(identity, {
        changeType: 'updated',
        item: nextItem,
        previousItem
      })
    }
  }

  const entries = mergedItems.map((item) => {
    const identity = getItemIdentity(item)
    return (
      changeByIdentity.get(identity) || {
        changeType: 'retained',
        item,
        previousItem: null
      }
    )
  })
  const added = entries.filter((entry) => entry.changeType === 'added')
  const updated = entries.filter((entry) => entry.changeType === 'updated')
  const retained = entries.filter((entry) => entry.changeType === 'retained')

  return {
    entries,
    mergedItems,
    added,
    updated,
    retained,
    addedCount: added.length,
    updatedCount: updated.length,
    retainedCount: retained.length,
    changedCount: added.length + updated.length,
    hasChanges: added.length + updated.length > 0,
    itemLimit: MAX_ITEM_COUNT,
    exceedsItemLimit: mergedItems.length > MAX_ITEM_COUNT
  }
}

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`source-modpack update coordinator missing dependency: ${name}`)
  }
  return value
}

function assertSnapshot(snapshot = {}) {
  const sourceType = getPackSourceType(snapshot)
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  if (!sourceType) throw new Error(uiText('ui.theCurrentProfileHasNoSourceTypeCannotUpdateThe'))
  if (!getPackSourceGameId(snapshot) && !getPackSourceGameSlug(snapshot)) {
    throw new Error(uiText('ui.theCurrentProfileHasNoGameIdentifierCannotMatchExisting'))
  }
  if (!items.length) throw new Error(uiText('ui.theCurrentProfileHasNoModsToAddToA'))
}

export function createSourceModpackUpdateCoordinator(options = {}) {
  const listOwnedPage = assertFunction(options.listOwnedPage, 'listOwnedPage')
  const getDetail = assertFunction(options.getDetail, 'getDetail')
  const update = assertFunction(options.update, 'update')
  const normalizeDraft = assertFunction(options.normalizeDraft, 'normalizeDraft')
  const buildUpdatePayload = assertFunction(options.buildUpdatePayload, 'buildUpdatePayload')

  async function listTargets(snapshot = {}) {
    assertSnapshot(snapshot)
    const records = []
    const seenIds = new Set()
    const sourceGameId = normalizeText(snapshot.sourceGameId || snapshot.source_game_id)

    for (let page = 1; page <= MAX_PAGE_COUNT; page++) {
      const response = await listOwnedPage({
        page,
        size: DEFAULT_PAGE_SIZE,
        ...(sourceGameId ? { sourceGameId } : {})
      })
      const normalizedPage = normalizePage(response)
      for (const record of normalizedPage.records) {
        const id = getPackId(record)
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        records.push(record)
      }

      if (
        normalizedPage.records.length < Math.max(1, normalizedPage.size) ||
        records.length >= normalizedPage.total
      ) {
        break
      }
    }

    return records
      .filter((record) => isCompatibleTarget(record, snapshot))
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.updated_at || left.createdAt || 0) || 0
        const rightTime =
          Date.parse(right.updatedAt || right.updated_at || right.createdAt || 0) || 0
        return rightTime - leftTime
      })
  }

  async function inspect({ targetId, snapshot } = {}) {
    assertSnapshot(snapshot)
    const normalizedTargetId = normalizeText(targetId)
    if (!normalizedTargetId) throw new Error(uiText('ui.chooseAnExistingShareToUpdate'))

    const detail = await getDetail(normalizedTargetId)
    const pack = getDetailPack(detail)
    if (!getPackId(pack)) throw new Error(uiText('ui.theLoadedShareHasNoValidID'))
    if (!isCompatibleTarget(pack, snapshot)) {
      throw new Error(uiText('ui.theSelectedShareDoesNotMatchTheCurrentSourceOr'))
    }

    const draft = normalizeDraft(detail)
    const diff = buildAppendUpdateDiff(draft.items, snapshot.items)
    return toPlainJson(
      {
        targetId: getPackId(pack),
        shareCode: getPackShareCode(pack),
        detail,
        pack,
        snapshot,
        draft: {
          ...draft,
          items: diff.mergedItems
        },
        diff
      },
      null
    )
  }

  async function apply({ inspection, version } = {}) {
    const target = inspection && typeof inspection === 'object' ? inspection : null
    if (!target?.detail || !target?.draft || !target?.diff) {
      throw new Error(uiText('ui.theUpdatePreviewExpiredPreviewAgain'))
    }
    if (!target.diff.hasChanges) {
      throw new Error(uiText('ui.theCurrentProfileHasNoNewOrUpdatedContentFor'))
    }
    if (target.diff.exceedsItemLimit) {
      throw new Error(uiText('ui.theUpdateExceedsTheLimitOfValueModsPerShare', { value1: (target.diff.itemLimit || MAX_ITEM_COUNT) }))
    }

    const nextVersion = normalizeText(
      version || target.draft.version || target.pack?.version || '1.0.0'
    )
    if (!nextVersion) throw new Error(uiText('ui.enterAModpackVersion'))
    const payload = buildUpdatePayload(target.detail, {
      ...target.draft,
      version: nextVersion,
      items: target.diff.mergedItems
    })
    const result = await update(target.targetId, payload)
    const resultPack = getDetailPack(result)

    return {
      result,
      targetId: target.targetId,
      shareCode: getPackShareCode(resultPack) || target.shareCode,
      version: nextVersion,
      revision: toSafeNumber(
        resultPack.currentRevision ?? resultPack.current_revision,
        toSafeNumber(target.pack?.currentRevision ?? target.pack?.current_revision, 0)
      ),
      diff: target.diff
    }
  }

  return Object.freeze({
    listTargets,
    inspect,
    apply
  })
}
