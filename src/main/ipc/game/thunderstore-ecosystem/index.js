import path from 'path'
import fs from 'fs-extra'
import axios from 'axios'
import { app, BrowserWindow } from 'electron'
import { requestBackendApi } from '../../../utils/require.js'
import { getConfiguredThunderstoreStoragePaths } from '../../../services/profiles/thunderstoreStorage.js'
import { createThunderstoreEcosystemManager } from './manager.js'

const THUNDERSTORE_ECOSYSTEM_REMOTE_URL =
  'https://raw.githubusercontent.com/ebkr/r2modmanPlus/master/src/assets/data/ecosystem.json'
const THUNDERSTORE_HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vertex/1.0 Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*'
}

function buildBundledEcosystemFilePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'data', 'ecosystem.json')
  }
  return path.join(app.getAppPath(), 'resources', 'data', 'ecosystem.json')
}

function getCacheFilePath() {
  return getConfiguredThunderstoreStoragePaths().ecosystemCacheFile
}

const bundledAdapter = {
  async read() {
    return await fs.readJson(buildBundledEcosystemFilePath())
  }
}

const cacheAdapter = {
  async read() {
    const cacheFile = getCacheFilePath()
    if (!(await fs.pathExists(cacheFile))) {
      return null
    }
    return await fs.readJson(cacheFile)
  },
  async write(record) {
    const cacheFile = getCacheFilePath()
    const tempFile = `${cacheFile}.${process.pid}.tmp`
    await fs.ensureDir(path.dirname(cacheFile))
    try {
      await fs.writeJson(tempFile, record, { spaces: 2 })
      await fs.move(tempFile, cacheFile, { overwrite: true })
    } finally {
      await fs.remove(tempFile).catch(() => {})
    }
  }
}

const upstreamAdapter = {
  async fetch({ etag = '' } = {}) {
    const response = await axios.get(THUNDERSTORE_ECOSYSTEM_REMOTE_URL, {
      timeout: 60000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        ...THUNDERSTORE_HTTP_HEADERS,
        ...(etag ? { 'If-None-Match': etag } : {})
      },
      validateStatus: (status) => status === 200 || status === 304
    })
    if (Number(response?.status) === 304) {
      return { status: 'not_modified', etag }
    }
    return {
      status: 'ok',
      etag: String(response?.headers?.etag || ''),
      data: response?.data
    }
  }
}

const backendAdapter = {
  async fetch({ etag = '' } = {}) {
    const response = await requestBackendApi(
      {
        url: '/install-config/thunderstore/ecosystem-overlay/latest',
        method: 'GET',
        timeout: 30000,
        headers: etag ? { 'If-None-Match': etag } : {},
        validateStatus: (status) => status === 200 || status === 304
      },
      { useAuth: false }
    )
    if (Number(response?.status) === 304) {
      return { status: 'not_modified', etag }
    }
    const result = response?.data || {}
    if (Number(result?.code) !== 200 || !result?.data) {
      throw new Error(String(result?.message || '后端未返回有效 Thunderstore Overlay'))
    }
    return {
      status: 'ok',
      etag: String(response?.headers?.etag || ''),
      envelope: result.data
    }
  }
}

function notifyEcosystemUpdated(snapshot) {
  const payload = {
    effectiveHash: String(snapshot?.metadata?.effectiveHash || ''),
    backendRevision: Number(snapshot?.metadata?.backendRevision || 0),
    conflictCount: Array.isArray(snapshot?.metadata?.conflicts)
      ? snapshot.metadata.conflicts.length
      : 0
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window || window.isDestroyed()) {
      continue
    }
    window.webContents.send('thunderstore-ecosystem-updated', payload)
  }
}

const ecosystemManager = createThunderstoreEcosystemManager({
  bundledAdapter,
  upstreamAdapter,
  backendAdapter,
  cacheAdapter,
  onUpdated: notifyEcosystemUpdated
})

export async function loadThunderstoreEcosystem(forceRefresh = false) {
  const snapshot = await ecosystemManager.load({ forceRefresh: forceRefresh === true })
  return snapshot.data
}

export function getThunderstoreEcosystemStatus() {
  return ecosystemManager.getStatus()
}
