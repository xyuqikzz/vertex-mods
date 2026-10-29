const allowedSections = new Set([
  'RenoDX.DLSS5',
  'DLSS5_Feed.fx',
  'vort_Motion.fx',
  'STYLE',
  'INPUT'
])
export function numericSettings(text) {
  const sections = Object.create(null)
  let section = ''
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (heading) {
      section = heading[1]
      continue
    }
    if (!allowedSections.has(section)) continue
    const pair = line.match(
      /^\s*([A-Za-z][A-Za-z0-9_]{0,80})\s*=\s*(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)*|true|false)\s*$/i
    )
    if (!pair || ['constructor', 'prototype'].includes(pair[1])) continue
    sections[section] ||= Object.create(null)
    sections[section][pair[1]] = pair[2]
  }
  return sections
}
const serialize = (sections) =>
  Object.entries(sections)
    .map(
      ([name, values]) =>
        `[${name}]\n${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')}\n`
    )
    .join('')
function feederSettings(text) {
  const settings = {
    enabled: '1',
    mode: '2',
    hdr: '-1',
    depth_inverted: '-1',
    flags: '-1',
    reset_every: '0',
    warmup_rebuild: '180',
    rebuild: '0',
    log_frames: '3',
    create_delay: '60',
    preset: '0',
    work_resolution: '100',
    mv_scale_x: '1.000',
    mv_scale_y: '1.000',
    host_window: '0',
    async_home: '1'
  }
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (match && Object.hasOwn(settings, match[1])) settings[match[1]] = match[2]
  }
  return Object.entries(settings)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
}
export function sessionConfiguration(input) {
  const options = typeof input === 'boolean' ? { feeder: input, api: 'Vulkan' } : input
  const { feeder, api, profile = {} } = options
  const layer = (name, library, apiVersion, functions = {}) =>
    JSON.stringify({
      file_format_version: '1.2.0',
      layer: {
        name,
        type: 'GLOBAL',
        library_path: `.\\${library}`,
        api_version: apiVersion,
        implementation_version: '1',
        description: 'Vertex per-process layer',
        functions
      }
    })
  const files = []
  if (api === 'Vulkan') {
    files.push({
      target: 'ReShade64.json',
      component: 'reshade',
      content: layer('VK_LAYER_reshade', 'ReShade64.dll', '1.3.268')
    })
    if (feeder)
      files.push({
        target: 'VkLayer_feed_vk.json',
        component: 'feeder',
        content: layer('VK_LAYER_feed_vk', 'VkLayer_feed_vk.dll', '1.3.280', {
          vkNegotiateLoaderLayerInterfaceVersion: 'vkNegotiateLoaderLayerInterfaceVersion'
        })
      })
  }
  // Only numeric tuning is carried forward. Search paths, proxy libraries and
  // add-on loading remain confined to this new, verified session.
  const tuning = numericSettings(profile['ReShade.ini'])
  tuning['RenoDX.DLSS5'] = {
    EnableHooks: '2',
    NeuralUplift: '1',
    NREnableUpscaling: '0',
    ...tuning['RenoDX.DLSS5']
  }
  files.push({
    target: 'ReShade.ini',
    component: 'reshade',
    content:
      `[GENERAL]\nEffectSearchPaths=.\\reshade-shaders\\Shaders\\**\nTextureSearchPaths=.\\reshade-shaders\\Textures\\**\nPresetPath=.\\VertexPreset.ini\n${feeder ? 'PreprocessorDefinitions=DLSS5_MV_PROVIDER=2\n' : ''}[ADDON]\nAddonPath=.\n` +
      serialize(tuning)
  })
  files.push({
    target: 'VertexPreset.ini',
    component: 'reshade',
    content:
      (feeder
        ? 'Techniques=vort_MotionEffects@vort_Motion.fx,DLSS5_Feed@DLSS5_Feed.fx\nTechniqueSorting=vort_MotionEffects@vort_Motion.fx,DLSS5_Feed@DLSS5_Feed.fx\n'
        : 'Techniques=\n') + serialize(numericSettings(profile['VertexPreset.ini']))
  })
  if (feeder)
    files.push({
      target: 'dlss5-feed.cfg',
      component: 'feeder',
      content: feederSettings(profile['dlss5-feed.cfg'])
    })
  return files
}
