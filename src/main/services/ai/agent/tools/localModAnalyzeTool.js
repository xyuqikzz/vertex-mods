import crypto from 'node:crypto'
import path from 'node:path'

const MAX_PATHS = 20
const MAX_ITEMS = 20
const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i
const PRIVATE_PATH_KEY_PATTERN = /(^|_)(path|paths|filePath|folderPath|sourcePath|targetPath|gameRoot|rootPath|gamePath)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)
}

function truncateText(value = '', maxLength = 500) {
  const text = toSafeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function redactText(value = '', maxLength = 500) {
  return truncateText(value, maxLength)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function normalizePathItem(item) {
  const rawPath = typeof item === 'string' ? item : item?.path
  const safePath = toSafeText(rawPath)
  if (!safePath) return null
  const basename = path.basename(safePath)
  return {
    path: safePath,
    pathHash: hashText(path.resolve(safePath).toLowerCase()),
    pathBasename: basename,
    extension: path.extname(basename).toLowerCase(),
    pathConfigured: true
  }
}

function normalizeRequestedPaths(args = {}) {
  const sourceItems = Array.isArray(args.paths)
    ? args.paths
    : Array.isArray(args.items)
      ? args.items
      : []
  return sourceItems.map((item) => normalizePathItem(item)).filter(Boolean).slice(0, MAX_PATHS)
}

function sanitizePrivateValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    const safeText = toSafeText(value)
    if (!safeText) {
      return false
    }
    return {
      configured: true,
      basename: path.basename(safeText),
      pathHash: hashText(path.resolve(safeText).toLowerCase())
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePrivateValue(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
      continue
    }
    const sanitized = sanitizePrivateValue(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}

function normalizeRiskReasons(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      code: toSafeText(item.code),
      message: redactText(item.message),
      pathConfigured: Boolean(toSafeText(item.path))
    }))
    .filter((item) => item.code || item.message)
    .slice(0, 10)
}

function normalizeDuplicateState(value = {}) {
  return {
    duplicated: value?.duplicated === true,
    batchDuplicate: value?.batchDuplicate === true,
    assetDuplicate: Boolean(value?.assetDuplicate),
    bindingDuplicate: Boolean(value?.bindingDuplicate)
  }
}

function normalizeAnalysisItem(item = {}, requestItem = {}, index = 0) {
  const displayName = toSafeText(item.displayName || item.name || item.fileName || requestItem.pathBasename)
  const sourceType = toSafeText(item.sourceType)
  const sourceSignals = Array.isArray(item.signals) ? item.signals : []
  return {
    index,
    success: item.success !== false,
    code: toSafeText(item.code),
    message: redactText(item.message),
    displayName: redactText(displayName, 200),
    fileName: path.basename(toSafeText(item.fileName || requestItem.pathBasename)),
    pathConfigured: Boolean(toSafeText(item.path) || requestItem.pathConfigured),
    pathBasename: path.basename(toSafeText(item.path) || requestItem.pathBasename),
    pathHash: requestItem.pathHash || hashText(toSafeText(item.path)),
    extension: toSafeText(item.extension || requestItem.extension),
    sourceType,
    recommendedMode: toSafeText(item.recommendedMode),
    riskLevel: toSafeText(item.riskLevel, item.success === false ? 'blocked' : 'safe'),
    riskReasons: normalizeRiskReasons(item.riskReasons),
    duplicateState: normalizeDuplicateState(item.duplicateState),
    sizeBytes: toSafeNumber(item.sizeBytes),
    fileCount: toSafeNumber(item.fileCount),
    directoryCount: toSafeNumber(item.directoryCount),
    signals: sourceSignals.slice(0, 20),
    fingerprint: toSafeText(item.fingerprint),
    summary: sanitizePrivateValue(item.summary || {}),
    metadata: sanitizePrivateValue(item.metadata || {})
  }
}

function createNextActions(items = []) {
  const actions = []
  if (items.some((item) => item.riskLevel === 'blocked')) {
    actions.push({
      type: 'select_safe_source_path',
      label: '重新选择安全来源路径',
      message: '存在被阻止的高风险路径，请改选具体 Mod 文件、压缩包或子目录。'
    })
  }
  if (items.some((item) => item.duplicateState.duplicated)) {
    actions.push({
      type: 'review_duplicate_local_mod',
      label: '检查重复项',
      message: '存在同批重复或已接管记录，继续操作前应确认是否重复导入。'
    })
  }
  if (items.some((item) => item.success && item.recommendedMode === 'library_install_task')) {
    actions.push({
      type: 'create_local_install_task',
      label: '生成本地安装任务',
      message: '压缩包类来源建议走安装任务中心流程；本工具只做分析，不会提交任务。'
    })
  }
  if (items.some((item) => item.success && item.recommendedMode === 'bind_existing')) {
    actions.push({
      type: 'bind_existing_local_mod',
      label: '接管已有本地模组',
      message: '文件夹或单文件来源可在用户确认后接管；本工具只输出分析结果。'
    })
  }
  if (!actions.length) {
    actions.push({
      type: 'inspect_result',
      label: '查看分析结果',
      message: '未发现明确下一步动作，请根据结构信号和风险提示决定。'
    })
  }
  return actions.slice(0, 6)
}

async function resolveAnalyzer(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.analyzeLocalModSources === 'function') {
    return dependencyOverrides.analyzeLocalModSources
  }
  const module = await import('../../../../ipc/game/local-mod-manager/analyzer.js')
  return module.analyzeLocalModSources
}

export async function analyzeLocalModTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  void ctx
  const requestItems = normalizeRequestedPaths(args)
  if (!requestItems.length) {
    return {
      success: false,
      errorCode: 'missing_local_mod_paths',
      message: '缺少本地 Mod 路径，请传入用户已选择或明确提供的 paths。'
    }
  }

  const analyzer = await resolveAnalyzer(dependencyOverrides)
  const analyzerResult = await analyzer({
    ...args,
    paths: requestItems.map((item) => item.path)
  })
  if (analyzerResult?.success === false) {
    return {
      success: false,
      errorCode: analyzerResult.code || analyzerResult.errorCode || 'local_mod_analyze_failed',
      message: analyzerResult.message || '本地 Mod 分析失败。'
    }
  }

  const data = analyzerResult?.data || analyzerResult || {}
  const rawItems = Array.isArray(data.items) ? data.items : []
  const items = rawItems
    .slice(0, MAX_ITEMS)
    .map((item, index) => normalizeAnalysisItem(item, requestItems[index] || {}, index))
  const successCount = toSafeNumber(data.successCount, items.filter((item) => item.success).length)
  const failedCount = toSafeNumber(data.failedCount, items.filter((item) => !item.success).length)

  return toPlainJson(
    {
      success: true,
      scope: 'local_mod_analysis',
      summary: {
        total: rawItems.length,
        returned: items.length,
        successCount,
        failedCount,
        truncated: rawItems.length > items.length,
        riskLevel: items.some((item) => item.riskLevel === 'blocked')
          ? 'blocked'
          : items.some(
                (item) => item.riskLevel === 'warning' || item.duplicateState.duplicated
              )
            ? 'warning'
            : 'safe'
      },
      items,
      nextActions: createNextActions(items),
      message: `已分析 ${rawItems.length} 个本地 Mod 来源。`
    },
    {}
  )
}
