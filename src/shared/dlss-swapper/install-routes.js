// DLSS5-Swapper v2.2.7, Copyright (c) 2026 Rakan Alkhaldi, MIT.
// Keep the sheet and installer on the same compatibility policy. A copied
// nvngx DLL alone does not prove that the game has native NGX calls.
import renderingApi from './rendering-api.js'

function nativeDlssPresent(scan, target) {
  const normalize = (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .toLowerCase()
  const added = new Set((scan.install?.added || []).map(normalize))
  const files = scan.dlssFiles || (scan.primaryDlss ? [scan.primaryDlss] : [])
  return files.some((file) => {
    const rel = normalize(file.rel)
    if (!/^(?:.*\/)?(?:_?nvngx|nvngx_dlss)\.dll$/.test(rel) || added.has(rel)) return false
    if (!target) return true
    if (file.bitness && file.bitness !== target.bitness) return false
    const exeDir = normalize(target.rel).replace(/[^/]+$/, '')
    const fileDir = rel.replace(/[^/]+$/, '')
    if (fileDir === exeDir) return true
    if (target.engine?.kind === 'unreal') {
      const project = normalize(target.rel).split('/binaries/')[0]
      return (
        (rel.startsWith(project + '/plugins/') || rel.startsWith('engine/plugins/')) &&
        /\/(?:dlss|streamline)\//.test(rel)
      )
    }
    if (target.engine?.kind === 'unity') {
      const stem = normalize(target.rel).replace(/\.exe$/, '')
      return rel.startsWith(stem + '_data/plugins/')
    }
    return false
  })
}
function optiReason(target, api = target && target.api) {
  if (!target || target.bitness !== 64 || target.emulator) return 'optiUnsupported'
  if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10')
    return 'optiUnsupported'
  if (!target.hasNativeDlss) return 'optiNeedsDlss'
  return null
}
function routesFor(target, api = target && target.api) {
  if (!target || ![32, 64].includes(target.bitness)) return []
  if (target.architecture && !['x64', 'x86'].includes(target.architecture)) return []
  if (target.roleReasons?.includes('invalid-executable-target')) return []
  if (
    ['helper', 'launcher', 'dedicated-server', 'interpreter'].includes(target.role) &&
    !target.manualSelection
  )
    return []
  if (target.rendering?.state === 'conflict') return []
  if (api === 'd3d10' || (api === 'dxgi' && target.apiLabel === 'DirectX 10')) return []
  // DirectDraw and DX8 both reach modern hardware only through dgVoodoo's
  // 32-bit wrapper, so the Feeder route is the only one either can take.
  if (api === 'd3d8' || api === 'ddraw') return target.bitness === 32 ? ['feeder'] : []
  if (['d3d9', 'opengl', 'vulkan'].includes(api)) {
    const list = !optiReason(target, api) ? ['feeder', 'optiscaler'] : ['feeder']
    // The DLSS Tool presents on D3D9 itself - "D3D9 and D3D11 use a
    // same-adapter, device-only D3D12 endpoint" - so it does not need
    // dgVoodoo's translation the way the Feeder route does here. OpenGL and
    // Vulkan are not on its list, and the add-on is 64-bit only.
    if (api === 'd3d9' && target.bitness === 64) list.push('renodx')
    return list
  }
  if (api !== 'dxgi') return []
  const routes =
    target.bitness === 32 ||
    target.emulator ||
    (target.renderApi || renderingApi.exact(api, target.apiLabel)) !== 'd3d12' ||
    target.hasNativeDlss === false
      ? ['feeder']
      : ['native', 'feeder']
  if (!optiReason(target, api)) routes.push('optiscaler')
  // #251. The DLSS Tool hooks Present, and its own description says what that
  // covers: "Present supports D3D9, D3D11, and D3D12 presentation. D3D9 and
  // D3D11 use a same-adapter, device-only D3D12 endpoint." So DX11 is offered
  // too - it is the larger half of the games with no DLSS of their own, and
  // the reason this route exists. D3D9 goes through dgVoodoo here and is a
  // separate question. 32-bit is out: the add-on is 64-bit only.
  if (target.bitness === 64) routes.push('renodx')
  return routes
}
function recommendedRoute(scan, target = scan.chosen) {
  const routes = routesFor(target)
  const nativeDlss = target?.hasNativeDlss ?? nativeDlssPresent(scan)
  const wanted =
    scan.install && scan.install.route === 'feeder' ? 'feeder' : nativeDlss ? 'native' : 'feeder'
  return routes.includes(wanted) ? wanted : routes[0] || null
}
function routeError(target, requestedRoute) {
  const routes = routesFor(target)
  if (routes.length && (!requestedRoute || routes.includes(requestedRoute))) return null
  if (target?.rendering?.state === 'conflict') return 'errRenderingConflict'
  if (!target?.api) return 'api_unconfirmed'
  if (target.api === 'd3d10' || (target.api === 'dxgi' && target.apiLabel === 'DirectX 10'))
    return 'unsupportedRendererHint'
  if (requestedRoute === 'optiscaler') return optiReason(target) || 'optiUnsupported'
  return routes.length ? 'errRouteUnavailable' : 'errRendererUnsupported'
}
const api = { routesFor, recommendedRoute, nativeDlssPresent, optiReason, routeError }

export default api
