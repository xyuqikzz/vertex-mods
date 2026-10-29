// DLSS5-Swapper v2.2.7, Copyright (c) 2026 Rakan Alkhaldi, MIT.
// A manual choice describes the game's active renderer, not its DLL names.
// DX11 and DX12 share ReShade's dxgi hook but must retain distinct labels for
// installation-route eligibility. Detection itself is never overwritten.

const choices = [
  { value: 'ddraw', api: 'ddraw', label: 'DirectDraw' },
  { value: 'd3d8', api: 'd3d8', label: 'DirectX 8' },
  { value: 'd3d9', api: 'd3d9', label: 'DirectX 9' },
  { value: 'd3d10', api: 'd3d10', label: 'DirectX 10' },
  { value: 'd3d11', api: 'dxgi', label: 'DirectX 11' },
  { value: 'd3d12', api: 'dxgi', label: 'DirectX 12' },
  { value: 'vulkan', api: 'vulkan', label: 'Vulkan' },
  { value: 'opengl', api: 'opengl', label: 'OpenGL' }
]
const valid = (value) => value === 'auto' || choices.some((item) => item.value === value)
function exact(api, label) {
  if (api === 'dxgi')
    return choices.find((item) => item.api === 'dxgi' && item.label === label)?.value || 'dxgi'
  return choices.find((item) => item.value === api)?.value || null
}
const label = (api) =>
  choices.find((item) => item.value === api)?.label ||
  (api === 'dxgi' ? 'DirectX（具体版本待确认）' : '待确认')
function resolve(target, value = 'auto') {
  if (!target) return null
  if (value === 'auto' || value == null) {
    if (!target.rendering) return { api: target.api, label: target.apiLabel }
    const plannedApi = target.rendering.recommendedApi || target.rendering.installationPlan?.api
    const selected = choices.find((item) => item.value === plannedApi)
    return selected
      ? { api: selected.api, label: selected.label }
      : {
          api: plannedApi === 'dxgi' ? 'dxgi' : null,
          label: plannedApi === 'dxgi' ? 'DirectX (DXGI)' : null
        }
  }
  // Compatibility with existing internal callers using ReShade's hook key.
  if (value === 'dxgi')
    return { api: 'dxgi', label: target.api === 'dxgi' ? target.apiLabel : 'DirectX 11/12' }
  const chosen = choices.find((item) => item.value === value)
  if (!chosen) throw Object.assign(new Error('errApiChoice'), { code: 'errApiChoice' })
  return { api: chosen.api, label: chosen.label }
}
function effective(target, value = 'auto') {
  if (!target) return null
  const selected = resolve(target, value)
  return {
    ...target,
    api: selected.api,
    apiLabel: selected.label,
    renderApi: exact(selected.api, selected.label),
    deploymentSource:
      value !== 'auto'
        ? 'manual'
        : target.rendering?.recommendedApi
          ? target.rendering.recommendationSource
          : target.rendering?.installationPlan?.source ||
            target.rendering?.recommendationSource ||
            'static',
    dx12: exact(selected.api, selected.label) === 'd3d12'
  }
}
const api = { choices, valid, resolve, effective, exact, label }

export default api
