/**
 * orchestrator/itemRecordFactory.js — 安装项记录工厂（纯函数）
 *
 * 从来源安装 payload/entry 构建安装项记录、汇总复用信息、归一任务标题。
 * 纯函数（仅依赖 contracts 工具），无 DB/事件副作用，可独立单测。
 */
import {
  ITEM_STATE,
  buildArtifactKey,
  buildDependencyKey,
  buildInstallKey,
  createId,
  resolveInstallPayload,
  resolveItemTitle,
  resolveItemType,
  resolveItemVersion,
  resolveSourceModKey,
  toPlainJson,
  toSafeText
} from '../contracts.js'
import { resolveNexusAuthorizationTarget } from '../nexusAuthorizationTask.js'

export function normalizeJobTitle(payload = {}) {
  return (
    toSafeText(payload.title) ||
    toSafeText(payload.mainItem?.name) ||
    toSafeText(payload.mainItem?.modName) ||
    toSafeText(payload.items?.[payload.items.length - 1]?.meta?.displayName) ||
    '来源安装任务'
  )
}

export function buildItemRecord(jobId = '', payload = {}, entry = {}) {
  const itemId = createId('item')
  const artifactKey = buildArtifactKey(payload, entry)
  const installPayload = resolveInstallPayload(entry)
  const metadata = {
    ...toPlainJson(entry.meta || {}, {}),
    entry: toPlainJson(entry, {}),
    installPayload,
    source: payload.source,
    sourceAdapter: payload.sourceAdapter,
    sortIndex: Number(entry?.meta?.sortIndex ?? 0)
  }
  const nexusAuthorization = resolveNexusAuthorizationTarget({ metadata })
  if (nexusAuthorization) {
    metadata.nexusAuthorization = nexusAuthorization
  }
  const downloadPurpose = toSafeText(entry?.item?.downloadPurpose).toLowerCase()
  metadata.purpose = downloadPurpose === 'download_only' ? 'download_only' : 'install'

  return {
    job_id: jobId,
    item_id: itemId,
    item_type: resolveItemType(entry),
    source_mod_key: resolveSourceModKey(entry),
    dependency_key: buildDependencyKey(payload, entry),
    install_key: buildInstallKey(payload, entry),
    artifact_key: artifactKey,
    title: resolveItemTitle(entry),
    version: resolveItemVersion(entry),
    state: ITEM_STATE.CREATED,
    progress: 0,
    metadata_json: metadata
  }
}

export function collectReusedInfo(items = []) {
  return {
    reusedArtifacts: items
      .filter((item) => item.reusedArtifact)
      .map((item) => ({
        artifactKey: item.artifact_key,
        title: item.title
      })),
    reusedInstalledItems: items
      .filter((item) => item.reusedInstalled)
      .map((item) => ({
        installKey: item.install_key,
        title: item.title
      }))
  }
}
