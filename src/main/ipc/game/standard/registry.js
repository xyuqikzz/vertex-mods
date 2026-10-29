import { createRetiredSourceError } from '../../../../shared/sources/retired-source-policy.js'
import { STANDARD_ERROR_CODE, STANDARD_SOURCE } from './constants.js'
import { createStandardError } from './errors.js'
import { normalizeSourceKey } from './payloadValidator.js'
import { ficsitAdapter } from './adapters/ficsitAdapter.js'
import { legacySourceAdapter } from './adapters/legacySourceAdapter.js'

const adapterMap = new Map([
  ['gamebanana', legacySourceAdapter],
  ['steam-workshop', legacySourceAdapter],
  [STANDARD_SOURCE.NEXUS, legacySourceAdapter],
  [STANDARD_SOURCE.MODIO, legacySourceAdapter],
  [STANDARD_SOURCE.FICSIT, ficsitAdapter],
  [STANDARD_SOURCE.VAMHUB, legacySourceAdapter]
])

export function getStandardSourceAdapter(source = STANDARD_SOURCE.NEXUS) {
  const sourceKey = normalizeSourceKey(source)
  const retiredError = createRetiredSourceError(sourceKey)
  if (retiredError) throw retiredError
  if (sourceKey === 'mixed') {
    throw createStandardError(
      STANDARD_ERROR_CODE.SOURCE_UNSUPPORTED,
      '混合来源任务必须先按平台拆分',
      { recoverable: false }
    )
  }
  if (sourceKey === STANDARD_SOURCE.THUNDERSTORE) {
    throw createStandardError(
      STANDARD_ERROR_CODE.SOURCE_SPECIAL_DOMAIN,
      'Thunderstore 属于特殊生态安装域，不进入标准来源安装主线',
      { recoverable: false }
    )
  }

  const adapter = ['local', 'custom'].includes(sourceKey) ? legacySourceAdapter : adapterMap.get(sourceKey)
  if (!adapter) {
    throw createStandardError(
      STANDARD_ERROR_CODE.SOURCE_ADAPTER_MISSING,
      `未找到标准来源适配器：${sourceKey}`,
      { recoverable: false }
    )
  }
  return adapter
}
