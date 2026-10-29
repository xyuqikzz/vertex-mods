import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { GET_SOURCE_MODPACK_BY_CODE } from '@renderer/api/modules/source-modpack.js'

import { listSourceModpackImportSources } from '../../../shared/sources/source-platform-registry.js'
import { createSourceModpackShareCoordinator } from './source-modpack-coordinator.js'
import { getSourceModpackAdapter } from './source-modpack-adapters/registry.js'
import { getRemoteItems } from './source-modpack-adapters/common.js'
import {
  getVamHubPackageDetail,
  resolveVamHubDownloadUrl,
  resolveVamHubDependencies
} from '@views/game/vamhub/vamhub-service.js'

function toText(value = '') {
  return String(value ?? '').trim()
}

function toPlain(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback))
  } catch {
    return fallback
  }
}

function createRuntimeError(result = {}, fallback = '分享整合包操作失败') {
  return Object.assign(new Error(toText(result?.message) || fallback), {
    code: toText(result?.code || 'source_modpack_instance_error'),
    detail: result?.detail || {}
  })
}

async function fetchShareByCode(shareCode = '') {
  try {
    return await GET_SOURCE_MODPACK_BY_CODE(shareCode)
  } catch (error) {
    const message = toText(error?.message)
    const reasonCode = ['share_removed', 'share_unpublished'].find((code) =>
      message.startsWith(code)
    )
    if (reasonCode) {
      await ipcRenderer.invoke('source-modpack-instance:orphan', {
        shareCode: toText(shareCode),
        reasonCode,
        message
      }).catch(() => null)
    }
    throw error
  }
}

function generateProfileId() {
  if (globalThis.crypto?.randomUUID) return `profile_${globalThis.crypto.randomUUID()}`
  return `profile_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function buildDefaultProfileName(remote = {}) {
  const suffix = toText(remote.shareCode).slice(-4)
  const base = toText(remote.name || '分享整合包')
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, suffix ? 27 : 32)
    .trim()
  return `${base || '分享整合包'}${suffix ? `-${suffix}` : ''}`.slice(0, 32)
}

async function prepareTargetContext({ detail, remote, request, targetContext }) {
  let target = toPlain(targetContext, {})
  const sourceDescriptors = new Map()
  const remoteItems = getRemoteItems(detail)
  for (const item of remoteItems) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const source = toText(
      item.sourcePlatform || item.source_platform || item.sourceType || item.source_type ||
      metadata.sourcePlatform
    ).toLowerCase()
    if (!source || sourceDescriptors.has(source)) continue
    sourceDescriptors.set(source, {
      sourcePlatform: source,
      sourceGameId: toText(
        item.sourceGameId || item.source_game_id || metadata.sourceGameId ||
        remote.sourceGameId || target.sourceGameId
      ),
      sourceGameSlug: toText(
        item.sourceGameSlug || item.source_game_slug || metadata.sourceGameSlug ||
        metadata.sourceGameDomain || remote.sourceGameSlug || target.sourceGameSlug
      )
    })
  }
  if (!target.sourcePlatform || target.sourcePlatform === 'mixed') {
    const firstItem = remoteItems[0] || {}
    const metadata = firstItem?.metadata && typeof firstItem.metadata === 'object' ? firstItem.metadata : {}
    target.sourcePlatform = firstItem.sourcePlatform || firstItem.source_platform || metadata.sourcePlatform || ''
    target.sourceGameId = firstItem.sourceGameId || firstItem.source_game_id || metadata.sourceGameId || target.sourceGameId
    target.sourceGameSlug = firstItem.sourceGameSlug || firstItem.source_game_slug || metadata.sourceGameSlug || metadata.sourceGameDomain || target.sourceGameSlug
  }
  const targetResult = await ipcRenderer.invoke('source-modpack-instance:resolve-target', target)
  if (!targetResult?.success) throw createRuntimeError(targetResult, '未找到目标游戏安装记录')
  target = {
    ...targetResult.data, ...target,
    gameRoot: toText(target.gameRoot) || targetResult.data.gameRoot,
    localGameInstallationId: targetResult.data.localGameInstallationId
  }
  const listResult = await ipcRenderer.invoke('source-modpack-instance:list', {
    remotePackUid: remote.packUid,
    localGameInstallationId: Number(target.localGameInstallationId || 0)
  })
  if (!listResult?.success) throw createRuntimeError(listResult, '读取本地整合包实例失败')
  const installNewCopy = request?.intent === 'install_new_copy'
  const existing = !installNewCopy && (Array.isArray(listResult?.data) ? listResult.data : []).find((item) => {
    return (
      Number(item?.endpointType || 0) === Number(target.endpointType || 0) &&
      toText(item?.instanceSlot || 'default') === toText(target.instanceSlot || 'default')
    )
  })
  const existingTarget = existing?.targets?.find((item) => {
    return !target.sourcePlatform || item.sourcePlatform === target.sourcePlatform
  })
  const requestedSlot = toText(target.instanceSlot)
  const instanceSlot = installNewCopy
    ? requestedSlot && requestedSlot !== 'default'
      ? requestedSlot
      : `copy_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`
    : requestedSlot || 'default'
  const copyProfileName = `${buildDefaultProfileName(remote).slice(0, 27)}-副本`.slice(0, 32)
  const defaultProfileId = installNewCopy
    ? toText(target.profileId) || generateProfileId()
    : toText(existingTarget?.profileId || target.profileId) || generateProfileId()
  const defaultProfileName = installNewCopy
    ? toText(target.profileName) || copyProfileName
    : toText(existingTarget?.profileName || target.profileName) || buildDefaultProfileName(remote)
  const sourceTargets = {}
  for (const [source, descriptor] of sourceDescriptors) {
    const existingSourceTarget = existing?.targets?.find((item) => item.sourcePlatform === source)
    const sourceOverride = target.sourceTargets?.[source] || {}
    sourceTargets[source] = {
      ...target,
      ...descriptor,
      ...sourceOverride,
      localGameInstallationId: targetResult.data.localGameInstallationId,
      profileId: installNewCopy
        ? toText(sourceOverride.profileId) ||
          (source === target.sourcePlatform ? defaultProfileId : generateProfileId())
        : toText(existingSourceTarget?.profileId || sourceOverride.profileId) ||
          (source === target.sourcePlatform ? defaultProfileId : generateProfileId()),
      profileName: installNewCopy
        ? toText(sourceOverride.profileName) || defaultProfileName
        : toText(existingSourceTarget?.profileName || sourceOverride.profileName) || defaultProfileName,
      instanceSlot
    }
  }
  return {
    ...target,
    profileId: defaultProfileId,
    profileName: defaultProfileName,
    instanceSlot,
    sourceTargets
  }
}

async function resolveManifest({ detail, targetContext }) {
  const sources = [...new Set(getRemoteItems(detail).map((item) => item.sourcePlatform))]
  const supportedSources = new Set(listSourceModpackImportSources())
  const items = []
  const warnings = []
  const manualActions = []
  for (const source of sources) {
    const adapter = getSourceModpackAdapter(source)
    if (!supportedSources.has(source) || !adapter?.resolveManifest) {
      throw createRuntimeError({ code: 'source_capability_disabled', message: `当前不支持导入来源：${source || '未知'}` })
    }
    const sourceTarget = {
      ...targetContext,
      ...(targetContext.sourceTargets?.[source] || {}),
      sourcePlatform: source
    }
    if (source === 'vamhub') {
      sourceTarget.vamhubApi = {
        getVamHubPackageDetail,
        resolveVamHubDownloadUrl,
        resolveVamHubDependencies
      }
    }
    // 任一来源缺失都会改变整包语义，必须重新解析完整清单后才能提交。
    const resolved = await adapter.resolveManifest({ detail, targetContext: sourceTarget })
    const sourceItems = Array.isArray(resolved) ? resolved : resolved?.items || []
    if (!sourceItems.length) throw new Error(`${source} 没有可解析的分享整合包条目`)
    items.push(...sourceItems)
    if (Array.isArray(resolved?.warnings)) warnings.push(...resolved.warnings)
    if (Array.isArray(resolved?.manualActions)) manualActions.push(...resolved.manualActions)
  }
  if (!items.length) throw new Error(warnings[0]?.message || uiText('ui.noSharedModpackEntriesCouldBeResolved'))
  return { items, warnings, manualActions }
}

const coordinator = createSourceModpackShareCoordinator({
  fetchShareByCode,
  prepareTargetContext,
  resolveManifest,
  inspectCanonicalPlan: async (payload) => {
    const result = await ipcRenderer.invoke('source-modpack-instance:inspect', toPlain(payload, {}))
    if (!result?.success) throw createRuntimeError(result)
    return result
  },
  applyCanonicalPlan: async (payload) => {
    const result = await ipcRenderer.invoke('source-modpack-instance:apply', toPlain(payload, {}))
    if (!result?.success) throw createRuntimeError(result)
    return result
  },
  getInstance: async (instanceId) => {
    const result = await ipcRenderer.invoke('source-modpack-instance:get', { instanceId })
    if (!result?.success) throw createRuntimeError(result)
    return result.data
  }
})

export const inspectShareImport = coordinator.inspectShareImport
export const applyShareImport = coordinator.applyShareImport
export const getShareInstance = coordinator.getShareInstance
