import { useModioRuleConfigPage, validateModioRuleEditorText } from '@views/game/modio/useModioRuleConfigPage.js'
import {
  useNexusRuleConfigPage,
  validateNexusRuleEditorText
} from '@views/game/nexus/useNexusRuleConfigPage.js'
import {
  useFicsitRuleConfigPage,
  validateFicsitRuleEditorText
} from '@views/game/ficsit/useFicsitRuleConfigPage.js'
import {
  useVamhubRuleConfigPage,
  validateVamhubRuleEditorText
} from '@views/game/vamhub/useVamhubRuleConfigPage.js'
import { resolveSourcePlatformLabel } from '../../../../../shared/sources/source-platform-registry.js'

const NEXUS_SOURCE_LABEL = resolveSourcePlatformLabel('nexus', 'Nexus')
const MODIO_SOURCE_LABEL = resolveSourcePlatformLabel('modio', 'Mod.io')
const FICSIT_SOURCE_LABEL = resolveSourcePlatformLabel('ficsit', 'Ficsit')
const VAMHUB_SOURCE_LABEL = resolveSourcePlatformLabel('vamhub', 'VAM-Hub')

const SOURCE_INSTALL_CONFIG_MAP = Object.freeze({
  nexus: {
    sourcePlatform: 'nexus',
    platformLabel: NEXUS_SOURCE_LABEL,
    listRouteName: 'GameNexusModList',
    usePageState: useNexusRuleConfigPage,
    validateEditorText: validateNexusRuleEditorText
  },
  modio: {
    sourcePlatform: 'modio',
    platformLabel: MODIO_SOURCE_LABEL,
    listRouteName: 'GameModioModList',
    usePageState: useModioRuleConfigPage,
    validateEditorText: validateModioRuleEditorText
  },
  ficsit: {
    sourcePlatform: 'ficsit',
    platformLabel: FICSIT_SOURCE_LABEL,
    listRouteName: 'GameFicsitModList',
    usePageState: useFicsitRuleConfigPage,
    validateEditorText: validateFicsitRuleEditorText
  },
  vamhub: {
    sourcePlatform: 'vamhub',
    platformLabel: VAMHUB_SOURCE_LABEL,
    listRouteName: 'GameVamHubModList',
    usePageState: useVamhubRuleConfigPage,
    validateEditorText: validateVamhubRuleEditorText
  }
})

export function normalizeSourceInstallConfigPlatform(value = '', fallback = 'nexus') {
  const sourcePlatform = String(value || '')
    .trim()
    .toLowerCase()
  return SOURCE_INSTALL_CONFIG_MAP[sourcePlatform] ? sourcePlatform : fallback
}

export function resolveSourceInstallConfigPlatform(route = {}) {
  const routeSource = String(route?.params?.sourcePlatform || route?.query?.sourcePlatform || '').trim()
  if (routeSource) {
    return normalizeSourceInstallConfigPlatform(routeSource)
  }

  const metaSource = String(route?.meta?.sourcePlatform || '').trim()
  if (metaSource) {
    return normalizeSourceInstallConfigPlatform(metaSource)
  }

  const routeName = String(route?.name || '').trim().toLowerCase()
  if (routeName.includes('modio')) {
    return 'modio'
  }
  return 'nexus'
}

export function getSourceInstallConfigDefinition(sourcePlatform = '') {
  const platform = normalizeSourceInstallConfigPlatform(sourcePlatform)
  return SOURCE_INSTALL_CONFIG_MAP[platform] || SOURCE_INSTALL_CONFIG_MAP.nexus
}

export function useSourceInstallConfigPage(options = {}) {
  const definition = getSourceInstallConfigDefinition(options?.sourcePlatform)
  const pageState = definition.usePageState({
    routeId: options.routeId,
    routeQuery: options.routeQuery
  })

  return {
    ...pageState,
    sourcePlatform: definition.sourcePlatform,
    platformLabel: definition.platformLabel,
    listRouteName: definition.listRouteName,
    validateEditorText: definition.validateEditorText
  }
}

export function validateSourceInstallConfigEditorText(sourcePlatform = '', text = '') {
  const definition = getSourceInstallConfigDefinition(sourcePlatform)
  return definition.validateEditorText(text)
}
