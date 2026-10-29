import { toolText as tt } from '../../i18n/tool-text.js'
export const apiLabel = (value) =>
  ({
    D3D9: 'DirectX 9',
    D3D10: 'DirectX 10',
    D3D11: 'DirectX 11',
    D3D12: 'DirectX 12',
    Vulkan: 'Vulkan',
    OpenGL: 'OpenGL'
  })[value] || tt('尚未识别')
export const fileName = (value) =>
  String(value || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || ''
export const sizeLabel = (bytes) =>
  bytes ? (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB' : ''
export const sourceLabel = (record) =>
  record?.steamAppId
    ? 'Steam'
    : {
        Steam: 'Steam',
        'Epic Games': 'Epic Games',
        GOG: 'GOG',
        Xbox: 'Xbox',
        Ubisoft: 'Ubisoft',
        'Added by hand': tt('本地游戏'),
        'My folders': tt('我的文件夹'),
        nexus: 'Nexus Mods',
        modio: 'Mod.io',
        ficsit: 'Ficsit',
        thunderstore: 'Thunderstore',
        vamhub: 'VAMHub'
      }[record?.sourcePlatform] || tt('本地游戏')
export function gameStatus(record) {
  if (record?.swapperInstalled) return { label: tt('已安装'), tone: 'success' }
  const state = record?.sessions?.at(-1)?.state
  if (state === 'installed') return { label: tt('已安装'), tone: 'success' }
  if (state === 'restore-failed') return { label: tt('还原需处理'), tone: 'danger' }
  if (state && state !== 'restored') return { label: tt('待还原'), tone: 'warning' }
  if (record?.pathValid === false) return { label: tt('位置已失效'), tone: 'danger' }
  if (record?.plan?.reasons?.length) return { label: record.plan.statusLabel, tone: 'warning' }
  return { label: tt('待安装'), tone: 'info' }
}

export function installationAction(details, target, route, version, consumerPlan, reshadeProxy) {
  if (!details?.installedRoute) return { kind: 'install', label: tt('安装 DLSS5') }
  const relativeKey = (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .toLowerCase()
  const changed =
    route !== details.installedRoute ||
    relativeKey(target?.rel) !== relativeKey(details.installedExe) ||
    target?.api !== details.installedApi ||
    (details.installedApiLabel && target?.apiLabel !== details.installedApiLabel) ||
    (route === 'optiscaler' && version !== details.optiscaler?.version) ||
    (route !== 'optiscaler' &&
      reshadeProxy &&
      details.installedReShadeProxy &&
      ['dxgi', 'd3d11'].includes(details.installedReShadeProxy) &&
      reshadeProxy !== details.installedReShadeProxy) ||
    (consumerPlan && consumerPlan.sha256 !== details.installedConsumer?.sha256) ||
    details.recoveryPending
  if (changed) return { kind: 'switch', label: tt('切换 DLSS5') }
  if (
    (consumerPlan && details.installedComponents?.consumer?.sha256 !== consumerPlan.sha256) ||
    ['files_changed', 'consumer_changed', 'missing_files', 'component_version_mismatch'].includes(
      details.runtimeStatus?.code
    )
  )
    return { kind: 'repair', label: tt('修复安装') }
  if (details.componentsUpdateAvailable || details.installedComponents?.panelLocalization)
    return { kind: 'update', label: tt('更新组件') }
  return { kind: 'installed', label: tt('已安装') }
}
