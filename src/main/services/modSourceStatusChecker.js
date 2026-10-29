import fs from 'node:fs'

const CONCURRENCY = 8

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value ?? fallback
  } catch {
    return fallback
  }
}

function toText(value) {
  return String(value ?? '').trim()
}

function checkLocalBoundSourceStatus(mod) {
  const metadata = parseJson(mod?.metadata_json || '{}', {})
  const items = Array.isArray(metadata?.items) ? metadata.items : []
  if (!items.length) return { status: 'unchecked', missingPaths: [] }

  const missingPaths = []
  for (const item of items) {
    const original = toText(item?.originalPath)
    const disabled = toText(item?.disabledPath)
    if (original && fs.existsSync(original)) continue
    if (disabled && fs.existsSync(disabled)) continue
    const candidate = original || disabled
    if (candidate) missingPaths.push(candidate)
  }

  return {
    status: missingPaths.length ? 'missing' : 'normal',
    missingPaths
  }
}

function checkManagedSourceStatus(mod) {
  const sourceRoot = toText(mod?.source_root_path)
  if (sourceRoot) {
    const exists = fs.existsSync(sourceRoot)
    return {
      status: exists ? 'normal' : 'missing',
      missingPaths: exists ? [] : [sourceRoot]
    }
  }

  const archivePath = toText(mod?.archive_path)
  const stagingPath = toText(mod?.staging_path)

  if (!archivePath && !stagingPath) {
    return { status: 'unchecked', missingPaths: [] }
  }

  if (!archivePath || !stagingPath) {
    return {
      status: 'missing',
      missingPaths: [!archivePath ? 'archive_path' : '', !stagingPath ? 'staging_path' : ''].filter(
        Boolean
      )
    }
  }

  const missingPaths = []
  if (archivePath && !fs.existsSync(archivePath)) missingPaths.push(archivePath)
  if (stagingPath && !fs.existsSync(stagingPath)) missingPaths.push(stagingPath)

  if (!missingPaths.length) {
    return { status: 'normal', missingPaths: [] }
  }

  return { status: 'missing', missingPaths }
}

export async function checkModSourceStatus(mod) {
  const installModel = toText(mod?.install_model).toLowerCase()

  if (installModel === 'bound') {
    return checkLocalBoundSourceStatus(mod)
  }

  return checkManagedSourceStatus(mod)
}

export async function checkAndPersistInactiveMods(mods) {
  const results = []
  if (!Array.isArray(mods) || !mods.length) return results

  const updateModSourceStatus = (
    await import('./modSourceStatusRuntime.js')
  ).getRuntimeModSourceStatusWriter()

  const queue = [...mods]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const mod = queue.shift()
      if (!mod) continue
      const r = await checkModSourceStatus(mod)
      try {
        updateModSourceStatus(mod.id, r.status)
      } catch (err) {
        console.error('[mod source status] 写回失败', mod?.id, err)
      }
      results.push({ id: mod.id, ...r })
    }
  })
  await Promise.all(workers)
  return results
}
