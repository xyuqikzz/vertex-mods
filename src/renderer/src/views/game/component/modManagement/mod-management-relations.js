import { matchesModMetadataLabel } from './mod-metadata-label.js'
function toText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function toRelationList(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return []
  }

  const text = value.trim()
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [text]
  }
}

function normalizeIdentity(value) {
  return toText(value).toLowerCase()
}

function getDisplayInitial(value) {
  return toText(value).charAt(0).toUpperCase() || '?'
}

function parseThunderstoreDependency(value) {
  const text = toText(value)
  const match = text.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
  if (!match) {
    return { identity: text, version: '' }
  }
  return { identity: match[1], version: match[2] }
}

function getReadableIdentity(identity, source) {
  const text = toText(identity)
  if (source !== 'thunderstore') {
    return text
  }
  const separatorIndex = text.indexOf('-')
  return separatorIndex >= 0 ? text.slice(separatorIndex + 1) || text : text
}

function collectIdentityValues(value = {}) {
  if (!value || typeof value !== 'object') {
    return [value]
  }

  return [
    value.fullName,
    value.full_name,
    value.modReference,
    value.mod_reference,
    value.sourceModKey,
    value.source_mod_key,
    value.modId,
    value.mod_id,
    value.id,
    value.displayName,
    value.name,
    value.title
  ]
}

function buildAliasSet(value = {}, source = '') {
  const aliases = new Set()
  for (const entry of collectIdentityValues(value)) {
    const text = toText(entry)
    if (!text) continue
    aliases.add(normalizeIdentity(text))
    if (source === 'thunderstore') {
      const parsed = parseThunderstoreDependency(text)
      if (parsed.identity) {
        aliases.add(normalizeIdentity(parsed.identity))
      }
    }
  }
  return aliases
}

function getCardRaw(card = {}) {
  return card?.raw && typeof card.raw === 'object' ? card.raw : {}
}

function getCardVersion(card = {}) {
  const raw = getCardRaw(card)
  const directVersion = toText(
    raw.currentVersion || raw.current_version || raw.version || raw.modVersion || raw.mod_version
  )
  if (directVersion) {
    return directVersion
  }

  for (const group of Array.isArray(card?.metaGroups) ? card.metaGroups : []) {
    const row = (Array.isArray(group) ? group : []).find(
      (item) => matchesModMetadataLabel(item, ['版本']) && toText(item?.value) !== '--'
    )
    if (row) {
      return toText(row.value)
    }
  }
  return ''
}

function createRelationFromCard(card = {}) {
  return {
    key: toText(card?.key || card?.title),
    title: toText(card?.title, '--') || '--',
    version: getCardVersion(card),
    logoUrl: toText(card?.coverUrl),
    fallbackText: toText(card?.fallbackText) || getDisplayInitial(card?.title),
    installed: true,
    aliases: buildAliasSet(
      {
        ...getCardRaw(card),
        title: card?.title,
        key: card?.key
      },
      card?.source
    )
  }
}

function normalizeRelation(item, source = '') {
  if (item === null || item === undefined) {
    return null
  }

  if (typeof item === 'string' || typeof item === 'number') {
    const parsed =
      source === 'thunderstore'
        ? parseThunderstoreDependency(item)
        : { identity: toText(item), version: '' }
    if (!parsed.identity) {
      return null
    }
    return {
      key: normalizeIdentity(parsed.identity),
      title: getReadableIdentity(parsed.identity, source),
      version: parsed.version,
      logoUrl: '',
      fallbackText: getDisplayInitial(getReadableIdentity(parsed.identity, source)),
      installed: false,
      aliases: buildAliasSet(parsed.identity, source)
    }
  }

  if (typeof item !== 'object') {
    return null
  }

  const identity = toText(
    item.fullName ||
      item.full_name ||
      item.modReference ||
      item.mod_reference ||
      item.sourceModKey ||
      item.source_mod_key ||
      item.modId ||
      item.mod_id ||
      item.id
  )
  const title = toText(
    item.displayName || item.display_name || item.name || item.modName || item.mod_name
  )
  const fallbackTitle = getReadableIdentity(identity, source)
  const displayTitle = title || fallbackTitle
  if (!displayTitle && !identity) {
    return null
  }

  const aliases = buildAliasSet(item, source)
  if (identity) {
    aliases.add(normalizeIdentity(identity))
  }

  return {
    key: normalizeIdentity(identity || displayTitle),
    title: displayTitle || identity,
    version: toText(
      item.requiredVersion ||
        item.required_version ||
        item.condition ||
        item.version ||
        item.modVersion ||
        item.mod_version
    ),
    logoUrl: toText(
      item.logoUrl || item.logo_url || item.logo || item.iconUrl || item.icon || item.cover
    ),
    fallbackText: getDisplayInitial(displayTitle || identity),
    installed: false,
    aliases
  }
}

function hasSharedAlias(left = new Set(), right = new Set()) {
  for (const value of left) {
    if (right.has(value)) {
      return true
    }
  }
  return false
}

function findMatchingCard(relation, cards = [], excludedKey = '') {
  if (!relation) return null
  return (
    cards.find((card) => {
      if (!card || toText(card.key) === excludedKey) return false
      return hasSharedAlias(relation.aliases, createRelationFromCard(card).aliases)
    }) || null
  )
}

function mergeRelationWithCard(relation, card) {
  if (!card) {
    return relation
  }
  const cardRelation = createRelationFromCard(card)
  return {
    ...relation,
    ...cardRelation,
    version: cardRelation.version || relation.version,
    aliases: new Set([...relation.aliases, ...cardRelation.aliases])
  }
}

function getRawRelations(raw = {}, key = 'dependencies') {
  const aliases =
    key === 'dependents'
      ? ['dependents', 'dependentList', 'dependent_list']
      : ['dependencies', 'dependencyList', 'dependency_list', 'dependencies_json']
  for (const field of aliases) {
    const list = toRelationList(raw?.[field])
    if (list.length) {
      return list
    }
  }
  return []
}

function appendUniqueRelation(target, relation) {
  if (!relation) return
  const duplicate = target.some((item) => hasSharedAlias(item.aliases, relation.aliases))
  if (!duplicate) {
    target.push(relation)
  }
}

function finalizeRelations(list = []) {
  return list.map((relation) => {
    const item = { ...relation }
    delete item.aliases
    return item
  })
}

// 列表行只需要知道「依赖是否缺失」：所有卡片的别名只建一次，避免每行重复扫描整个列表。
export function buildMissingDependencyIndex(cards = []) {
  const safeCards = Array.isArray(cards) ? cards.filter(Boolean) : []
  const installed = new Set()
  for (const card of safeCards) {
    for (const alias of createRelationFromCard(card).aliases) installed.add(alias)
  }
  const index = new Map()
  for (const card of safeCards) {
    if (card.relationsKnown === false) continue
    const source = toText(card.source)
    const missing = []
    for (const item of getRawRelations(getCardRaw(card), 'dependencies')) {
      const relation = normalizeRelation(item, source)
      if (relation && ![...relation.aliases].some((alias) => installed.has(alias))) {
        missing.push({ title: relation.title, version: relation.version })
      }
    }
    if (missing.length) index.set(toText(card.key || card.title), missing)
  }
  return index
}

export function buildModManagementRelations(selectedCard = null, cards = []) {
  if (!selectedCard) {
    return { dependencies: [], dependents: [] }
  }

  const safeCards = Array.isArray(cards) ? cards : []
  const selectedKey = toText(selectedCard.key)
  const source = toText(selectedCard.source)
  const raw = getCardRaw(selectedCard)
  const dependencies = []
  const dependents = []

  for (const item of getRawRelations(raw, 'dependencies')) {
    const relation = normalizeRelation(item, source)
    appendUniqueRelation(
      dependencies,
      mergeRelationWithCard(relation, findMatchingCard(relation, safeCards, selectedKey))
    )
  }

  for (const item of getRawRelations(raw, 'dependents')) {
    const relation = normalizeRelation(item, source)
    appendUniqueRelation(
      dependents,
      mergeRelationWithCard(relation, findMatchingCard(relation, safeCards, selectedKey))
    )
  }

  const selectedAliases = createRelationFromCard(selectedCard).aliases
  for (const candidate of safeCards) {
    if (!candidate || toText(candidate.key) === selectedKey) continue
    const candidateSource = toText(candidate.source || source)
    const candidateDependsOnSelected = getRawRelations(getCardRaw(candidate), 'dependencies').some(
      (item) => {
        const relation = normalizeRelation(item, candidateSource)
        return relation ? hasSharedAlias(relation.aliases, selectedAliases) : false
      }
    )
    if (candidateDependsOnSelected) {
      appendUniqueRelation(dependents, createRelationFromCard(candidate))
    }
  }

  return {
    dependencies: finalizeRelations(dependencies),
    dependents: finalizeRelations(dependents)
  }
}
