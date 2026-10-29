import {
  listSourceModpackImportSources,
  normalizeSourcePlatform
} from '../../../../shared/sources/source-platform-registry.js'
import { vamhubSourceModpackAdapter } from './vamhub.js'
import { NexusShareAdapter } from './nexus.js'
import { ModioShareAdapter } from './modio.js'
import { FicsitShareAdapter } from './ficsit.js'
import { ThunderstoreShareAdapter } from './thunderstore.js'

const SOURCE_MODPACK_ADAPTERS = Object.freeze({
  nexus: NexusShareAdapter,
  modio: ModioShareAdapter,
  ficsit: FicsitShareAdapter,
  thunderstore: ThunderstoreShareAdapter,
  vamhub: vamhubSourceModpackAdapter
})

export function getSourceModpackAdapter(source = '') {
  return SOURCE_MODPACK_ADAPTERS[normalizeSourcePlatform(source)] || null
}

export function listRegisteredSourceModpackAdapters() {
  const supportedSources = new Set(listSourceModpackImportSources())
  return Object.keys(SOURCE_MODPACK_ADAPTERS).filter((source) => supportedSources.has(source))
}
