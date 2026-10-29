import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createPlanningPathChecker, normalizeSafeRelativePath, isPathInside } from './pathSafety.js'
import { createConfigDocument, configFieldKey, sameConfigValue } from './managedConfigDocument.js'
import { InstallEngineError } from './installEngineError.js'
import { resolveTargetBoundaryRoot } from './targetResolver.js'

const MAX_BYTES = 1024 * 1024
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message) => {
  throw new InstallEngineError('install_engine.config_conflict', message)
}
function configPath(value) {
  const relative = normalizeSafeRelativePath(value)
  if (/[<>:"|?*]/.test(relative) || relative.split('/').some((part) => /[. ]$/.test(part)))
    fail('配置文件路径包含不安全名称')
  return relative
}
let queue = Promise.resolve()
async function serialized(action) {
  const current = queue.then(action)
  queue = current.catch(() => {})
  return current
}
async function readText(file, maxBytes = MAX_BYTES) {
  let handle
  try {
    handle = await fs.open(file, 'r')
    if (!(await handle.stat()).isFile()) fail('配置不是普通文件')
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxBytes) fail('配置或恢复日志超过安全读取预算')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close()
  }
}
async function atomicWrite(file, content, root) {
  if (Buffer.byteLength(content) > 16 * MAX_BYTES) fail('配置恢复日志超过 16 MiB 写入预算')
  const within = createPlanningPathChecker()
  if (!(await within(root, file))) fail('配置或日志路径真实边界已变化')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.vertex-${crypto.randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (!(await createPlanningPathChecker()(root, file))) fail('配置写入前边界已变化')
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}
async function writeTarget(file, text, root) {
  if (text === null) {
    if (!(await createPlanningPathChecker()(root, file))) fail('配置删除路径越界')
    await fs.unlink(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  } else await atomicWrite(file, text, root)
}
async function loadJournal(file, journalRoot, target, boundary, { readOnly = false, allowAncestorBoundary = false } = {}) {
  if (!(await createPlanningPathChecker()(journalRoot, file))) fail('配置恢复日志路径越界')
  const raw = await readText(file, 16 * MAX_BYTES)
  const journal = raw
    ? JSON.parse(raw)
    : { version: 1, target, boundary, fields: [], createdFile: false }
  if (
    journal.version !== 1 ||
    journal.target !== target ||
    (journal.boundary !== boundary && !(readOnly && allowAncestorBoundary &&
      typeof journal.boundary === 'string' && path.isAbsolute(journal.boundary) &&
      isPathInside(journal.boundary, boundary))) ||
    !Array.isArray(journal.fields)
  )
    fail('配置恢复日志与目标不一致')
  const validateFields = (fields) => {
    if (!Array.isArray(fields) || fields.length > 4096) fail('配置恢复日志字段数量无效')
    for (const field of fields) {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(field.owner || '') || typeof field.key !== 'string') fail('配置恢复日志归属无效')
      const key = JSON.parse(field.key)
      let descriptor
      if (journal.format === 'json') {
        if (!Array.isArray(key) || !key.length || key.some((part) => typeof part !== 'string')) fail('配置恢复日志 JSON 字段无效')
        descriptor = { pointer: '/' + key.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/') }
      } else if (journal.format === 'ini') {
        if (!Array.isArray(key) || key.length !== 2) fail('配置恢复日志 INI 字段无效')
        descriptor = { section: key[0], key: key[1] }
      } else descriptor = { line: key }
      if (configFieldKey(journal.format, descriptor) !== field.key) fail('配置恢复日志字段不规范')
      if (field.createdParents !== undefined) {
        if (!Array.isArray(field.createdParents) || field.createdParents.length > 80) fail('配置恢复日志父路径无效')
        for (const parent of field.createdParents) {
          if (journal.format === 'json') {
            const parts = JSON.parse(parent)
            if (!Array.isArray(parts) || parts.length >= key.length || !parts.every((part, index) => part === key[index])) fail('配置恢复日志父路径不属于受管理字段')
          } else if (journal.format !== 'ini' || parent !== key[0]) fail('配置恢复日志父路径不属于受管理字段')
        }
      }
      for (const value of [field.before, field.after]) if (!value || typeof value.exists !== 'boolean' || (value.exists && !Object.hasOwn(value, 'value'))) fail('配置恢复日志缺少字段值')
    }
  }
  validateFields(journal.fields)
  journal.transactions ||= []
  if (!Array.isArray(journal.transactions) || journal.transactions.length > 128) fail('配置事务日志数量无效')
  for (const transaction of journal.transactions) {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(transaction.id || '') ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(transaction.owner || '') ||
        typeof transaction.gameRoot !== 'string' || !path.isAbsolute(transaction.gameRoot) ||
        !['game', 'local_appdata', 'roaming_appdata'].includes(transaction.baseType)) fail('配置事务日志身份无效')
    validateFields(transaction.beforeFields)
    validateFields(transaction.afterFields)
    if ([...transaction.beforeFields, ...transaction.afterFields].some((field) => field.owner !== transaction.owner)) fail('配置事务日志归属不一致')
  }
  if (journal.pending) {
    validateFields(journal.pending.beforeFields)
    validateFields(journal.pending.afterFields)
    if (!(await createPlanningPathChecker()(boundary, target))) fail('配置恢复目标真实路径越界')
    const current = await readText(target)
    const fingerprint = hash(JSON.stringify(current))
    if (fingerprint === journal.pending.afterHash) journal.fields = journal.pending.afterFields
    else if (fingerprint === journal.pending.beforeHash)
      journal.fields = journal.pending.beforeFields
    else fail('检测到未完成配置事务且文件已被修改，保留文件和恢复日志')
    journal.createdFile =
      fingerprint === journal.pending.afterHash
        ? journal.pending.afterCreatedFile
        : journal.pending.beforeCreatedFile
    delete journal.pending
    if (!readOnly) await atomicWrite(file, JSON.stringify(journal), journalRoot)
  }
  return journal
}
function overlap(left, right, format) {
  if (left === right) return true
  if (format !== 'json') return false
  const a = JSON.parse(left),
    b = JSON.parse(right)
  return a.every((part, i) => part === b[i]) || b.every((part, i) => part === a[i])
}

function revertOwnedFields(document, owned, { allowAlreadyReverted = false } = {}) {
  const restore = []
  for (const field of owned) {
    const current = document.get(field.key)
    if (sameConfigValue(current, field.after)) restore.push(field)
    else if (!allowAlreadyReverted || !sameConfigValue(current, field.before))
      fail('用户或其他程序已修改受管理配置字段，已保留现场并停止覆盖')
  }
  for (const field of restore) {
    document.set(field.key, field.before)
    document.prune(field.createdParents || [])
  }
}

// Whole-file deployment must not invalidate another mod's field ownership.
export async function assertManagedConfigDeploymentAllowed({ journalRoot, target, boundary }) {
  const file = path.join(journalRoot, `${hash(target.toLowerCase())}.json`)
  const journal = await loadJournal(file, journalRoot, target, boundary, { readOnly: true, allowAncestorBoundary: true })
  if (journal.fields.length || journal.transactions.length) {
    throw new InstallEngineError(
      'install_engine.config_conflict',
      '该配置文件仍有模组管理的字段，请先禁用相关模组再替换或移除配置文件',
      { target, owners: [...new Set(journal.fields.map((field) => field.owner))] }
    )
  }
}

function assertReleasedFieldsCurrent(journal, document, owner, format) {
  for (const transaction of journal.transactions.filter((entry) => entry.owner === owner)) {
    for (const field of transaction.beforeFields) {
      if (journal.fields.some((current) => current.owner === owner && overlap(current.key, field.key, format))) continue
      if (journal.fields.some((current) => overlap(current.key, field.key, format)) ||
          !sameConfigValue(document.get(field.key), field.before)) {
        fail('配置撤销后受管理字段发生变化，保留文件和未完成事务')
      }
    }
  }
}

async function finalizeConfigTransactions(entries, ids) {
  const seen = new Set()
  for (const entry of entries) {
    const file = path.join(entry.journalRoot, `${hash(entry.target.toLowerCase())}.json`)
    if (seen.has(file)) continue
    seen.add(file)
    const journal = await loadJournal(file, entry.journalRoot, entry.target, entry.boundary)
    journal.transactions = journal.transactions.filter((transaction) => !ids.has(transaction.id))
    await atomicWrite(file, JSON.stringify(journal), entry.journalRoot)
  }
}

async function changeFile(
  {
    journalRoot,
    owner,
    boundary,
    target,
    format,
    changes = [],
    active,
    baseType = 'game',
    gameRoot,
    transactionId = '',
    recoveryTransactions = []
  },
  undo = null
) {
  if (!(await createPlanningPathChecker()(boundary, target))) fail('配置目标路径越界')
  const journalFile = path.join(journalRoot, `${hash(target.toLowerCase())}.json`)
  const journal = await loadJournal(journalFile, journalRoot, target, boundary)
  if (journal.format && journal.format !== format) fail('同一配置文件不能使用不同格式编辑')
  journal.format = format
  const text = await readText(target)
  const document = createConfigDocument(format, text || '')
  if (transactionId && journal.transactions.some((entry) => entry.owner === owner && entry.id !== transactionId && !recoveryTransactions.includes(entry.id)))
    fail('该模组存在未完成配置事务，请先恢复')
  if (recoveryTransactions.length) assertReleasedFieldsCurrent(journal, document, owner, format)
  const beforeFields = structuredClone(journal.fields)
  const beforeCreatedFile = journal.createdFile
  const owned = journal.fields.filter((field) => field.owner === owner)
  const other = journal.fields.filter((field) => field.owner !== owner)
  const desired = undo
    ? undo
    : active
      ? changes.map((change) => ({
          key: configFieldKey(format, change),
          after:
            format === 'lines'
              ? { exists: true, value: change.present !== false }
              : change.remove
                ? { exists: false }
                : { exists: true, value: change.value },
          expected: change.expected
        }))
      : []
  if (!owned.length && !desired.length) return null
  for (const desiredField of desired) {
    if (other.some((field) => overlap(field.key, desiredField.key, format)))
      fail('配置字段已由其他模组管理，请先解决组件冲突')
    if (desired.filter((field) => overlap(field.key, desiredField.key, format)).length !== 1)
      fail('同一规则存在重叠配置字段')
  }
  // Revert only this owner's fields, preserving every unrelated value in the current document.
  revertOwnedFields(document, owned, { allowAlreadyReverted: !active && !undo })
  const next = []
  for (const desiredField of desired) {
    const before = document.get(desiredField.key)
    const createdParents = document.missingParents(desiredField.key)
    if (
      desiredField.expected !== undefined &&
      (!before.exists || !sameConfigValue(before.value, desiredField.expected))
    )
      fail('配置前置值不符合规则要求')
    document.set(desiredField.key, desiredField.after)
    next.push({
      owner,
      gameRoot,
      baseType,
      key: desiredField.key,
      before: desiredField.before || before,
      after: document.get(desiredField.key),
      createdParents: desiredField.createdParents || createdParents
    })
  }
  const afterFields = [...other, ...next]
  const afterCreatedFile = (journal.createdFile || text === null) && afterFields.length > 0
  const afterText =
    (journal.createdFile || text === null) && afterFields.length === 0 && document.empty()
      ? null
      : document.serialize()
  if (afterText !== null && Buffer.byteLength(afterText) > MAX_BYTES) fail('合并后的配置超过 1 MiB 写入预算')
  const beforeTransactions = structuredClone(journal.transactions)
  if (transactionId) {
    journal.transactions.push({ id: transactionId, owner, gameRoot, baseType, beforeFields: owned, afterFields: next })
  }
  // A pending record precedes the atomic target rename, making interruption detectable and recoverable.
  journal.pending = {
    beforeHash: hash(JSON.stringify(text)),
    afterHash: hash(JSON.stringify(afterText)),
    beforeFields,
    afterFields,
    beforeCreatedFile,
    afterCreatedFile
  }
  await atomicWrite(journalFile, JSON.stringify(journal), journalRoot)
  try {
    if ((await readText(target)) !== text) fail('写入前配置发生并发修改，已停止覆盖')
    await writeTarget(target, afterText, boundary)
    journal.fields = afterFields
    journal.createdFile = afterCreatedFile
    delete journal.pending
    await atomicWrite(journalFile, JSON.stringify(journal), journalRoot)
  } catch (error) {
    try {
      const actual = await readText(target)
      if (actual !== text && actual !== afterText) fail('配置在恢复前被修改')
      if (actual === afterText) await writeTarget(target, text, boundary)
      journal.fields = beforeFields
      journal.createdFile = beforeCreatedFile
      journal.transactions = beforeTransactions
      delete journal.pending
      await atomicWrite(journalFile, JSON.stringify(journal), journalRoot)
    } catch {
      error.needRecovery = true
    }
    throw error
  }
  return { journalRoot, owner, boundary, target, format, gameRoot, baseType, previous: owned }
}

export async function transitionManagedConfigs({
  journalRoot,
  owner,
  gameRoot,
  patches = [],
  previousPatches = [],
  active = true,
  recoveryTransactions = []
}) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(owner || '')) fail('配置归属 ID 无效')
  const done = []
  const transactionId = crypto.randomUUID()
  const rollback = async () =>
    serialized(async () => {
      const failures = []
      for (const entry of [...done].reverse()) {
        try {
          await changeFile(entry, entry.previous)
        } catch (error) {
          failures.push(error.message)
        }
      }
      if (failures.length)
        throw new InstallEngineError(
          'install_engine.config_recovery_required',
          '配置事务恢复未完成，请保留恢复日志',
          { failures }
        )
      await finalizeConfigTransactions(done, new Set([transactionId]))
      done.length = 0
    })
  try {
    await serialized(async () => {
      const requested = new Map()
      for (const patch of [...previousPatches, ...patches]) {
        const relative = configPath(patch.path)
        const baseType = patch.base || 'game'
        const { targetBoundaryRoot: boundary } = await resolveTargetBoundaryRoot(baseType, gameRoot)
        const target = path.resolve(boundary, ...relative.split('/'))
        const current = patches.filter(
          (item) =>
            (item.base || 'game') === baseType &&
            item.path.replace(/\\/g, '/').toLowerCase() === relative.toLowerCase()
        )
        if (current.length > 1) fail('同一配置文件必须合并成一组 changes')
        requested.set(target.toLowerCase(), {
          journalRoot,
          owner,
          boundary,
          gameRoot: path.resolve(gameRoot),
          baseType,
          target,
          format: patch.format,
          changes: current[0]?.changes || [],
          active: active && current.length > 0,
          transactionId,
          recoveryTransactions
        })
      }
      for (const request of requested.values()) {
        const entry = await changeFile(request)
        if (entry) done.push(entry)
      }
    })
  } catch (error) {
    try {
      await rollback()
    } catch (recoveryError) {
      error.needRecovery = true
      error.message += `；${recoveryError.message}`
    }
    throw error
  }
  return {
    rollback,
    async commit() {
      // The database has committed. A cleanup failure must not roll the files back to the old state.
      return serialized(async () => {
        try {
          await finalizeConfigTransactions(done, new Set([transactionId]))
          done.length = 0
          return { success: true }
        } catch (error) {
          console.warn('配置已提交，事务日志保留至启动恢复', error.code || error.name)
          return { success: false, needRecovery: true }
        }
      })
    }
  }
}

export async function previewManagedConfigs(patches = [], gameRoot, { journalRoot = '', owner = '' } = {}) {
  const evidence = []
  for (const patch of patches) {
    const relative = configPath(patch.path)
    const { targetBoundaryRoot } = await resolveTargetBoundaryRoot(patch.base || 'game', gameRoot)
    const full = path.resolve(targetBoundaryRoot, ...relative.split('/'))
    if (!(await createPlanningPathChecker()(targetBoundaryRoot, full))) fail('配置预览路径越界')
    const raw = await readText(full)
    const document = createConfigDocument(patch.format, raw || '')
    let journalFingerprint
    if (journalRoot) {
      const journalFile = path.join(journalRoot, `${hash(full.toLowerCase())}.json`)
      const journal = await loadJournal(journalFile, journalRoot, full, targetBoundaryRoot, { readOnly: true })
      if (journal.format && journal.format !== patch.format) fail('同一配置文件不能使用不同格式编辑')
      if (journal.transactions.some((entry) => entry.owner === owner)) fail('该模组存在未完成配置事务，请先恢复')
      const owned = journal.fields.filter((field) => field.owner === owner)
      const keys = patch.changes.map((change) => configFieldKey(patch.format, change))
      if (journal.fields.some((field) => field.owner !== owner && keys.some((key) => overlap(field.key, key, patch.format)))) fail('配置字段已由其他模组管理，请先解决组件冲突')
      revertOwnedFields(document, owned)
      journalFingerprint = hash(JSON.stringify({ owner, fields: journal.fields, transactions: journal.transactions }))
    }
    for (const change of patch.changes) {
      const key = configFieldKey(patch.format, change)
      const before = document.get(key)
      if (
        change.expected !== undefined &&
        (!before.exists || !sameConfigValue(before.value, change.expected))
      )
        fail('配置前置值不符合规则要求')
      document.set(
        key,
        patch.format === 'lines'
          ? { exists: true, value: change.present !== false }
          : change.remove
            ? { exists: false }
            : { exists: true, value: change.value }
      )
    }
    evidence.push({
      path: relative,
      base: patch.base || 'game',
      fingerprint: hash(JSON.stringify(raw)),
      ...(journalFingerprint ? { journalFingerprint } : {})
    })
  }
  return evidence
}

export async function assertManagedConfigPreviewCurrent(plan, gameRoot, { journalRoot = '', owner = '' } = {}) {
  for (const entry of plan?.replayContext?.declarative?.configEvidence || []) {
    const relative = configPath(entry.path)
    const { targetBoundaryRoot } = await resolveTargetBoundaryRoot(entry.base || 'game', gameRoot)
    const file = path.resolve(targetBoundaryRoot, ...relative.split('/'))
    if (entry.journalFingerprint) {
      if (!journalRoot) throw new InstallEngineError('install_engine.preview_stale', '缺少配置归属上下文，请重新预览')
      const journal = await loadJournal(path.join(journalRoot, `${hash(file.toLowerCase())}.json`), journalRoot, file, targetBoundaryRoot, { readOnly: true })
      if (hash(JSON.stringify({ owner, fields: journal.fields, transactions: journal.transactions })) !== entry.journalFingerprint)
        throw new InstallEngineError('install_engine.preview_stale', '配置归属在预览后发生变化，请重新预览')
    }
    if (
      !(await createPlanningPathChecker()(targetBoundaryRoot, file)) ||
      hash(JSON.stringify(await readText(file))) !== entry.fingerprint
    ) {
      throw new InstallEngineError(
        'install_engine.preview_stale',
        '配置在预览后发生变化，请重新预览'
      )
    }
  }
}

// Reconcile durable ownership with committed database records after process interruption.
// Unknown game roots are preserved for diagnosis, never used as authority for arbitrary writes.
export async function recoverManagedConfigOwners({
  journalRoot,
  owners = new Map(),
  boundaries = []
}) {
  const failures = []
  const previous = new Map()
  const userBoundaries = await Promise.all(
    ['local_appdata', 'roaming_appdata'].map((base) => resolveTargetBoundaryRoot(base))
  )
  const entries = await fs.readdir(journalRoot).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (entries.length > 5000) fail('配置日志数量超过启动恢复预算')
  for (const name of entries.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))) {
    try {
      const file = path.join(journalRoot, name)
      if (!(await createPlanningPathChecker()(journalRoot, file))) fail('配置日志真实路径越界')
      const raw = JSON.parse(await readText(file, 16 * MAX_BYTES))
      const boundary = [
        ...boundaries,
        ...userBoundaries.map((entry) => entry.targetBoundaryRoot)
      ].find((root) => path.resolve(root).toLowerCase() === String(raw.boundary).toLowerCase())
      if (
        !boundary ||
        !isPathInside(boundary, raw.target) ||
        `${hash(String(raw.target).toLowerCase())}.json` !== name
      )
        fail('配置日志缺少可信游戏边界，保留等待处理')
      const journal = await loadJournal(file, journalRoot, raw.target, raw.boundary)
      const participants = [...journal.fields, ...journal.transactions]
      for (const owner of new Set(participants.map((field) => field.owner))) {
        const field = participants.find((entry) => entry.owner === owner)
        const originGame = field.gameRoot || raw.boundary
        if (
          !boundaries.some((root) => path.resolve(root).toLowerCase() === originGame.toLowerCase())
        )
          fail('配置归属缺少可信游戏目录')
        const key = `${owner}:${originGame}`
        if (!previous.has(key)) previous.set(key, { owner, gameRoot: originGame, patches: [], entries: [], transactions: new Set() })
        previous.get(key).entries.push({ journalRoot, target: raw.target, boundary: raw.boundary })
        for (const transaction of journal.transactions.filter((item) => item.owner === owner)) previous.get(key).transactions.add(transaction.id)
        previous
          .get(key)
          .patches.push({
            path: path.relative(raw.boundary, raw.target).replace(/\\/g, '/'),
            base: field.baseType || 'game',
            format: journal.format,
            changes: []
          })
      }
    } catch (error) {
      failures.push({ journal: name, message: error.message })
    }
  }
  for (const entry of previous.values()) {
    try {
      const committed = owners.get(entry.owner)
      if (
        committed &&
        path.resolve(committed.gameRoot).toLowerCase() !== entry.gameRoot.toLowerCase()
      )
        fail('配置归属的游戏位置发生变化，保留等待处理')
      const transition = await transitionManagedConfigs({
        journalRoot,
        owner: entry.owner,
        gameRoot: entry.gameRoot,
        patches: committed?.patches || [],
        previousPatches: entry.patches,
        active: committed?.active === true,
        recoveryTransactions: [...entry.transactions]
      })
      const result = await transition.commit()
      if (!result.success) fail('配置状态已恢复，事务日志清理失败，请保留日志后重试')
      await serialized(() => finalizeConfigTransactions(entry.entries, entry.transactions))
    } catch (error) {
      failures.push({ owner: entry.owner, message: error.message })
    }
  }
  for (const [owner, committed] of owners) {
    if (committed.active && committed.patches?.length && ![...previous.values()].some((entry) => entry.owner === owner)) {
      failures.push({ owner, message: '启用模组缺少配置归属证据，不能自动覆盖当前文件，请重新预检' })
    }
  }
  return {
    success: failures.length === 0,
    recoveredOwners: [...previous.values()].filter((entry) => !failures.some((failure) => failure.owner === entry.owner)).length,
    failures
  }
}
