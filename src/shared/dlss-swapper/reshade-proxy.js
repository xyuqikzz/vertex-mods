export function canChooseReShadeProxy(target, route) {
  if (!target || !['native', 'feeder', 'renodx'].includes(route)) return false
  return (
    (target.api === 'dxgi' && target.apiLabel === 'DirectX 11') ||
    (route === 'feeder' && ['ddraw', 'd3d8', 'd3d9'].includes(target.api))
  )
}
export const validReShadeProxy = (value) => ['dxgi', 'd3d11'].includes(value)
export const effectiveReShadeProxy = (target, route, choice = 'dxgi') =>
  canChooseReShadeProxy(target, route) && choice === 'd3d11' ? 'd3d11' : 'dxgi'
