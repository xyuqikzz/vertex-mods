import dbInstance from '../dbInstance.js'
import {
  buildAiTranslationCacheKey,
  LOCAL_AI_TRANSLATION_CACHE_MODEL_KEY
} from '../../../shared/translation/ai-translation-config.js'

const LOCAL_AI_TRANSLATION_CACHE_BASE_URL = 'local://offline'
let hasMigratedLocalCacheKey = false

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function toSafeText(value = '') {
  return String(value || '').trim()
}

function normalizeCacheKeyList(cacheKeys = []) {
  return [
    ...new Set(
      toSafeArray(cacheKeys)
        .map((item) => toSafeText(item))
        .filter(Boolean)
    )
  ]
}

function normalizeCacheRecord(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const cacheKey = toSafeText(source.cacheKey)
  const translatedText = String(source.translatedText || '')

  if (!cacheKey || !translatedText) {
    return null
  }

  return {
    cacheKey,
    source: toSafeText(source.source).toLowerCase(),
    scene: toSafeText(source.scene),
    itemKind: toSafeText(source.itemKind || source.kind) || 'text',
    providerType: toSafeText(source.providerType).toLowerCase(),
    baseURL: toSafeText(source.baseURL).toLowerCase(),
    model: toSafeText(source.model),
    targetLanguage: toSafeText(source.targetLanguage),
    promptHash: toSafeText(source.promptHash),
    textHash: toSafeText(source.textHash),
    sourceText: String(source.sourceText || ''),
    translatedText,
    sharedUploadedAt: toSafeText(source.sharedUploadedAt),
    updatedAt: toSafeText(source.updatedAt) || new Date().toISOString()
  }
}

function normalizeScopeRecord(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const cacheKey = toSafeText(source.cacheKey)

  if (!cacheKey) {
    return null
  }

  return {
    cacheKey,
    source: toSafeText(source.source).toLowerCase(),
    scene: toSafeText(source.scene),
    itemKind: toSafeText(source.itemKind || source.kind) || 'text',
    contextText: toSafeText(source.contextText || source.context),
    scopeType: toSafeText(source.scopeType),
    scopeKey: toSafeText(source.scopeKey).toLowerCase(),
    scopeLabel: toSafeText(source.scopeLabel),
    updatedAt: toSafeText(source.updatedAt) || new Date().toISOString()
  }
}

function normalizeCacheRow(row = {}) {
  return {
    id: Number(row?.id || 0),
    cacheKey: toSafeText(row?.cache_key),
    source: toSafeText(row?.source),
    scene: toSafeText(row?.scene),
    itemKind: toSafeText(row?.item_kind),
    providerType: toSafeText(row?.provider_type),
    baseURL: toSafeText(row?.base_url),
    model: toSafeText(row?.model),
    targetLanguage: toSafeText(row?.target_language),
    promptHash: toSafeText(row?.prompt_hash),
    textHash: toSafeText(row?.text_hash),
    sourceText: String(row?.source_text || ''),
    translatedText: String(row?.translated_text || ''),
    sharedUploadedAt: toSafeText(row?.shared_uploaded_at),
    createdAt: toSafeText(row?.created_at),
    updatedAt: toSafeText(row?.updated_at)
  }
}

function createPlaceholders(length = 0) {
  return new Array(Math.max(0, Number(length || 0))).fill('?').join(', ')
}

function createScopeWhereClause(filters = {}) {
  const clauses = []
  const params = []
  const source = toSafeText(filters?.source).toLowerCase()
  const scopeKey = toSafeText(filters?.scopeKey).toLowerCase()
  const keyword = toSafeText(filters?.keyword).toLowerCase()

  if (source) {
    clauses.push('c.source = ?')
    params.push(source)
  }

  if (scopeKey) {
    clauses.push(
      'EXISTS (SELECT 1 FROM ai_translation_cache_scope s2 WHERE s2.cache_key = c.cache_key AND s2.scope_key = ?)'
    )
    params.push(scopeKey)
  }

  if (keyword) {
    clauses.push(
      `(LOWER(c.source_text) LIKE ? OR LOWER(c.translated_text) LIKE ? OR EXISTS (SELECT 1 FROM ai_translation_cache_scope s3 WHERE s3.cache_key = c.cache_key AND (LOWER(s3.scope_label) LIKE ? OR LOWER(s3.context_text) LIKE ?)))`
    )
    const likeKeyword = `%${keyword}%`
    params.push(likeKeyword, likeKeyword, likeKeyword, likeKeyword)
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  }
}

export function ensureAiTranslationCacheScopeTable() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS ai_translation_cache_scope
    (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key    TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT '',
      scene        TEXT NOT NULL DEFAULT '',
      item_kind    TEXT NOT NULL DEFAULT 'text',
      context_text TEXT NOT NULL DEFAULT '',
      scope_type   TEXT NOT NULL DEFAULT '',
      scope_key    TEXT NOT NULL DEFAULT '',
      scope_label  TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (cache_key, source, scene, item_kind, scope_type, scope_key)
    );
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_scope_lookup
    ON ai_translation_cache_scope (source, scope_key, scene, item_kind);
  `)
  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_scope_cache_key
    ON ai_translation_cache_scope (cache_key);
  `)
}

export function migrateLocalAiTranslationCacheToStableKey() {
  if (hasMigratedLocalCacheKey) {
    return 0
  }

  ensureAiTranslationCacheScopeTable()

  const legacyRows = dbInstance
    .all(
      `
        SELECT id,
               cache_key,
               source,
               scene,
               item_kind,
               provider_type,
               base_url,
               model,
               target_language,
               prompt_hash,
               text_hash,
               source_text,
               translated_text,
               shared_uploaded_at,
               created_at,
               updated_at
        FROM ai_translation_cache
        WHERE provider_type = 'local'
          AND model != ?
      `,
      [LOCAL_AI_TRANSLATION_CACHE_MODEL_KEY]
    )
    .map(normalizeCacheRow)

  if (!legacyRows.length) {
    hasMigratedLocalCacheKey = true
    return 0
  }

  let migratedCount = 0

  dbInstance.transaction(() => {
    legacyRows.forEach((row) => {
      const nextCacheKey = buildAiTranslationCacheKey({
        providerType: 'local',
        baseURL: LOCAL_AI_TRANSLATION_CACHE_BASE_URL,
        model: LOCAL_AI_TRANSLATION_CACHE_MODEL_KEY,
        targetLanguage: row.targetLanguage,
        source: row.source,
        scene: row.scene,
        kind: row.itemKind,
        promptHash: row.promptHash,
        textHash: row.textHash
      })

      if (!nextCacheKey || nextCacheKey === row.cacheKey) {
        return
      }

      const targetRow = dbInstance.get(
        `
          SELECT id, translated_text, updated_at, shared_uploaded_at
          FROM ai_translation_cache
          WHERE cache_key = ?
          LIMIT 1
        `,
        [nextCacheKey]
      )

      if (targetRow) {
        dbInstance.run(
          `
            UPDATE ai_translation_cache
            SET translated_text = CASE
                  WHEN translated_text = '' OR COALESCE(updated_at, '') < ? THEN ?
                  ELSE translated_text
                END,
                shared_uploaded_at = CASE
                  WHEN (shared_uploaded_at IS NULL OR shared_uploaded_at = '') AND ? != ''
                    THEN ?
                  ELSE shared_uploaded_at
                END,
                updated_at = CASE
                  WHEN COALESCE(updated_at, '') < ? THEN ?
                  ELSE updated_at
                END
            WHERE cache_key = ?
          `,
          [
            row.updatedAt,
            row.translatedText,
            row.sharedUploadedAt,
            row.sharedUploadedAt,
            row.updatedAt,
            row.updatedAt,
            nextCacheKey
          ]
        )
        dbInstance.run(`DELETE FROM ai_translation_cache_scope WHERE cache_key = ?`, [row.cacheKey])
        dbInstance.run(`DELETE FROM ai_translation_cache WHERE cache_key = ?`, [row.cacheKey])
      } else {
        dbInstance.run(
          `
            UPDATE ai_translation_cache
            SET cache_key = ?,
                provider_type = 'local',
                base_url = ?,
                model = ?
            WHERE cache_key = ?
          `,
          [
            nextCacheKey,
            LOCAL_AI_TRANSLATION_CACHE_BASE_URL,
            LOCAL_AI_TRANSLATION_CACHE_MODEL_KEY,
            row.cacheKey
          ]
        )
        dbInstance.run(
          `
            UPDATE ai_translation_cache_scope
            SET cache_key = ?
            WHERE cache_key = ?
          `,
          [nextCacheKey, row.cacheKey]
        )
      }

      migratedCount += 1
    })
  })

  hasMigratedLocalCacheKey = true
  return migratedCount
}

export function getAiTranslationCacheBatch(cacheKeys = []) {
  migrateLocalAiTranslationCacheToStableKey()
  const normalizedKeys = normalizeCacheKeyList(cacheKeys)

  if (!normalizedKeys.length) {
    return []
  }

  const placeholders = createPlaceholders(normalizedKeys.length)
  const sql = `
    SELECT id,
           cache_key,
           source,
           scene,
           item_kind,
           provider_type,
           base_url,
           model,
           target_language,
           prompt_hash,
           text_hash,
           source_text,
           translated_text,
           shared_uploaded_at,
           created_at,
           updated_at
    FROM ai_translation_cache
    WHERE cache_key IN (${placeholders})
  `

  return dbInstance.all(sql, normalizedKeys).map(normalizeCacheRow)
}

export function upsertAiTranslationCacheBatch(records = []) {
  migrateLocalAiTranslationCacheToStableKey()
  const normalizedRecords = toSafeArray(records).map(normalizeCacheRecord).filter(Boolean)

  if (!normalizedRecords.length) {
    return 0
  }

  dbInstance.transaction(() => {
    normalizedRecords.forEach((record) => {
      dbInstance.run(
        `
          INSERT INTO ai_translation_cache
            (
              cache_key,
              source,
              scene,
              item_kind,
              provider_type,
              base_url,
              model,
              target_language,
              prompt_hash,
              text_hash,
              source_text,
              translated_text,
              shared_uploaded_at,
              updated_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            source = excluded.source,
            scene = excluded.scene,
            item_kind = excluded.item_kind,
            provider_type = excluded.provider_type,
            base_url = excluded.base_url,
            model = excluded.model,
            target_language = excluded.target_language,
            prompt_hash = excluded.prompt_hash,
            text_hash = excluded.text_hash,
            source_text = excluded.source_text,
            translated_text = excluded.translated_text,
            shared_uploaded_at = CASE
              WHEN excluded.shared_uploaded_at IS NOT NULL AND excluded.shared_uploaded_at != ''
                THEN excluded.shared_uploaded_at
              WHEN ai_translation_cache.translated_text = excluded.translated_text
                THEN ai_translation_cache.shared_uploaded_at
              ELSE NULL
            END,
            updated_at = excluded.updated_at
        `,
        [
          record.cacheKey,
          record.source,
          record.scene,
          record.itemKind,
          record.providerType,
          record.baseURL,
          record.model,
          record.targetLanguage,
          record.promptHash,
          record.textHash,
          record.sourceText,
          record.translatedText,
          record.sharedUploadedAt || null,
          record.updatedAt
        ]
      )
    })
  })

  return normalizedRecords.length
}

export function upsertAiTranslationCacheScopeBatch(records = []) {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const normalizedRecords = toSafeArray(records).map(normalizeScopeRecord).filter(Boolean)

  if (!normalizedRecords.length) {
    return 0
  }

  dbInstance.transaction(() => {
    normalizedRecords.forEach((record) => {
      dbInstance.run(
        `
          INSERT INTO ai_translation_cache_scope
            (
              cache_key,
              source,
              scene,
              item_kind,
              context_text,
              scope_type,
              scope_key,
              scope_label,
              updated_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cache_key, source, scene, item_kind, scope_type, scope_key) DO UPDATE SET
            context_text = excluded.context_text,
            scope_label = excluded.scope_label,
            updated_at = excluded.updated_at
        `,
        [
          record.cacheKey,
          record.source,
          record.scene,
          record.itemKind,
          record.contextText,
          record.scopeType,
          record.scopeKey,
          record.scopeLabel,
          record.updatedAt
        ]
      )
    })
  })

  return normalizedRecords.length
}

export function getAiTranslationDataManagerOverview(filters = {}) {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const sourceRows = dbInstance.all(
    `
      SELECT source, COUNT(*) AS count
      FROM ai_translation_cache
      GROUP BY source
      ORDER BY count DESC, source ASC
    `
  )
  const source = toSafeText(filters?.source).toLowerCase()
  const scopeRows = source
    ? dbInstance.all(
        `
          SELECT scope_key, scope_label, scope_type, COUNT(DISTINCT cache_key) AS count
          FROM ai_translation_cache_scope
          WHERE source = ?
          GROUP BY scope_key, scope_label, scope_type
          ORDER BY count DESC, scope_label ASC, scope_key ASC
        `,
        [source]
      )
    : []
  const totalRow = dbInstance.get(`SELECT COUNT(*) AS count FROM ai_translation_cache`)

  return {
    totalCount: Number(totalRow?.count || 0),
    sourceOptions: sourceRows.map((row) => ({
      key: toSafeText(row?.source),
      label: toSafeText(row?.source) || '未分类平台',
      count: Number(row?.count || 0)
    })),
    scopeOptions: scopeRows
      .map((row) => ({
        key: toSafeText(row?.scope_key),
        label: toSafeText(row?.scope_label) || '未标记',
        type: toSafeText(row?.scope_type),
        count: Number(row?.count || 0)
      }))
      .filter((item) => item.key)
  }
}

export function listAiTranslationDataRecords(filters = {}) {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const page = Math.max(1, Number(filters?.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(filters?.pageSize || 20)))
  const offset = (page - 1) * pageSize
  const { whereSql, params } = createScopeWhereClause(filters)
  const countRow = dbInstance.get(
    `
      SELECT COUNT(*) AS count
      FROM ai_translation_cache c
      ${whereSql}
    `,
    params
  )
  const rows = dbInstance.all(
    `
      SELECT c.id,
             c.cache_key,
             c.source,
             c.scene,
             c.item_kind,
             c.provider_type,
             c.model,
             c.target_language,
             c.source_text,
             c.translated_text,
             c.created_at,
             c.updated_at,
             GROUP_CONCAT(DISTINCT NULLIF(s.scope_label, '')) AS scope_labels,
             GROUP_CONCAT(DISTINCT NULLIF(s.scope_key, '')) AS scope_keys,
             GROUP_CONCAT(DISTINCT NULLIF(s.scope_type, '')) AS scope_types,
             GROUP_CONCAT(DISTINCT NULLIF(s.context_text, '')) AS context_texts
      FROM ai_translation_cache c
      LEFT JOIN ai_translation_cache_scope s
        ON s.cache_key = c.cache_key
      ${whereSql}
      GROUP BY c.cache_key
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, pageSize, offset]
  )

  return {
    total: Number(countRow?.count || 0),
    page,
    pageSize,
    items: rows.map((row) => ({
      id: Number(row?.id || 0),
      cacheKey: toSafeText(row?.cache_key),
      source: toSafeText(row?.source),
      scene: toSafeText(row?.scene),
      itemKind: toSafeText(row?.item_kind),
      providerType: toSafeText(row?.provider_type),
      model: toSafeText(row?.model),
      targetLanguage: toSafeText(row?.target_language),
      sourceText: String(row?.source_text || ''),
      translatedText: String(row?.translated_text || ''),
      scopeLabels: toSafeText(row?.scope_labels)
        ? toSafeText(row?.scope_labels).split(',').filter(Boolean)
        : [],
      scopeKeys: toSafeText(row?.scope_keys)
        ? toSafeText(row?.scope_keys).split(',').filter(Boolean)
        : [],
      scopeTypes: toSafeText(row?.scope_types)
        ? toSafeText(row?.scope_types).split(',').filter(Boolean)
        : [],
      contextTexts: toSafeText(row?.context_texts)
        ? toSafeText(row?.context_texts).split(',').filter(Boolean)
        : [],
      createdAt: toSafeText(row?.created_at),
      updatedAt: toSafeText(row?.updated_at)
    }))
  }
}

export function deleteAllAiTranslationData() {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  let deletedCacheCount = 0

  dbInstance.transaction(() => {
    deletedCacheCount = Number(dbInstance.run(`DELETE FROM ai_translation_cache`)?.changes || 0)
    dbInstance.run(`DELETE FROM ai_translation_cache_scope`)
  })

  return {
    deletedCacheCount
  }
}

export function deleteAiTranslationDataBySource(source = '') {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const safeSource = toSafeText(source).toLowerCase()
  if (!safeSource) {
    return {
      deletedCacheCount: 0
    }
  }

  let deletedCacheCount = 0

  dbInstance.transaction(() => {
    dbInstance.run(`DELETE FROM ai_translation_cache_scope WHERE source = ?`, [safeSource])
    deletedCacheCount = Number(
      dbInstance.run(`DELETE FROM ai_translation_cache WHERE source = ?`, [safeSource])?.changes ||
        0
    )
  })

  return {
    deletedCacheCount
  }
}

export function deleteAiTranslationDataByScope(source = '', scopeKey = '') {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const safeSource = toSafeText(source).toLowerCase()
  const safeScopeKey = toSafeText(scopeKey).toLowerCase()
  if (!safeSource || !safeScopeKey) {
    return {
      deletedCacheCount: 0,
      deletedScopeCount: 0
    }
  }

  const targetRows = dbInstance.all(
    `
      SELECT DISTINCT cache_key
      FROM ai_translation_cache_scope
      WHERE source = ?
        AND scope_key = ?
    `,
    [safeSource, safeScopeKey]
  )
  const targetCacheKeys = normalizeCacheKeyList(targetRows.map((row) => row?.cache_key))

  if (!targetCacheKeys.length) {
    return {
      deletedCacheCount: 0,
      deletedScopeCount: 0
    }
  }

  let deletedScopeCount = 0
  let deletedCacheCount = 0

  dbInstance.transaction(() => {
    deletedScopeCount = Number(
      dbInstance.run(
        `
          DELETE FROM ai_translation_cache_scope
          WHERE source = ?
            AND scope_key = ?
        `,
        [safeSource, safeScopeKey]
      )?.changes || 0
    )

    const placeholders = createPlaceholders(targetCacheKeys.length)
    const removableRows = dbInstance.all(
      `
        SELECT cache_key
        FROM ai_translation_cache
        WHERE cache_key IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1
            FROM ai_translation_cache_scope scope
            WHERE scope.cache_key = ai_translation_cache.cache_key
          )
      `,
      targetCacheKeys
    )
    const removableKeys = normalizeCacheKeyList(removableRows.map((row) => row?.cache_key))

    if (removableKeys.length) {
      const removablePlaceholders = createPlaceholders(removableKeys.length)
      deletedCacheCount = Number(
        dbInstance.run(
          `DELETE FROM ai_translation_cache WHERE cache_key IN (${removablePlaceholders})`,
          removableKeys
        )?.changes || 0
      )
    }
  })

  return {
    deletedCacheCount,
    deletedScopeCount
  }
}

export function deleteAiTranslationDataByCacheKey(cacheKey = '') {
  migrateLocalAiTranslationCacheToStableKey()
  ensureAiTranslationCacheScopeTable()
  const safeCacheKey = toSafeText(cacheKey)
  if (!safeCacheKey) {
    return {
      deletedCacheCount: 0
    }
  }

  let deletedCacheCount = 0

  dbInstance.transaction(() => {
    dbInstance.run(`DELETE FROM ai_translation_cache_scope WHERE cache_key = ?`, [safeCacheKey])
    deletedCacheCount = Number(
      dbInstance.run(`DELETE FROM ai_translation_cache WHERE cache_key = ?`, [safeCacheKey])
        ?.changes || 0
    )
  })

  return {
    deletedCacheCount
  }
}
