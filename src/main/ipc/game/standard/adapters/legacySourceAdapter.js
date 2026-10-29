import {
  inspectSourceInstallPlan,
  installModsV2
} from '../../method.js'
import { STANDARD_METADATA_SCHEMA_VERSION, STANDARD_SOURCE } from '../constants.js'
import {
  buildLegacySourceHashRequest,
  createPayloadHash,
  normalizeLegacySourceInspectRequest,
  normalizeLegacySourceInstallRequest,
  pickInspectToken,
  resolveSourceFromPayload,
  validateArchiveFilePath
} from '../payloadValidator.js'
import { consumeInspectPreview, putInspectPreview } from '../previewStore.js'
import { createStandardError } from '../errors.js'
import { STANDARD_ERROR_CODE } from '../constants.js'
import { createInstallPlan, createStandardSourceAdapter } from '../contracts.js'

function resolveLegacyStagingToken(result = {}) {
  return String(result?.legacyStagingToken || result?.stagingToken || '').trim()
}

export const legacySourceAdapter = createStandardSourceAdapter({
  source: STANDARD_SOURCE.NEXUS,
  domain: 'standard',

  async inspect({ event, payload }) {
    const request = normalizeLegacySourceInspectRequest(payload)
    validateArchiveFilePath(request.filePath)
    const source = resolveSourceFromPayload(payload, STANDARD_SOURCE.NEXUS)
    const payloadHash = createPayloadHash(buildLegacySourceHashRequest(request))
    const result = await inspectSourceInstallPlan(event, {
      filePath: request.filePath,
      data: request.data,
      type: request.type
    })
    const legacyStagingToken = resolveLegacyStagingToken(result)
    const inspectToken = putInspectPreview({
      source,
      payloadHash,
      legacyStagingToken,
      installPlan: result?.installPlan || null,
      standardPayload: buildLegacySourceHashRequest(request)
    })

    return {
      ...result,
      stagingToken: inspectToken,
      inspectToken,
      payloadHash,
      legacyStagingToken,
      standardInstallPlan: createInstallPlan({
        ...(result?.installPlan && typeof result.installPlan === 'object' ? result.installPlan : {}),
        source,
        packageKey: request.filePath,
        legacyPlan: result?.installPlan || null
      }),
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
      standardSource: source
    }
  },

  async install({ event, payload }) {
    const request = normalizeLegacySourceInstallRequest(payload)
    validateArchiveFilePath(request.filePath)
    const source = resolveSourceFromPayload(payload, STANDARD_SOURCE.NEXUS)
    const nextData = {
      ...request.data,
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
    }
    let inspectToken = pickInspectToken({
      ...payload,
      data: nextData
    })

    if (!inspectToken) {
      inspectToken = putInspectPreview({
        source,
        payloadHash: createPayloadHash(buildLegacySourceHashRequest(request)),
        legacyStagingToken: '',
        standardPayload: buildLegacySourceHashRequest(request),
        inlineInspect: true
      })
    }

    if (inspectToken) {
      const entry = consumeInspectPreview(inspectToken, { consume: true })
      const payloadHash = createPayloadHash(buildLegacySourceHashRequest(request))
      if (entry.payloadHash && entry.payloadHash !== payloadHash) {
        throw createStandardError(
          STANDARD_ERROR_CODE.INSTALL_PAYLOAD_CHANGED,
          '安装参数与预检参数不一致，请重新执行预检',
          { recoverable: true }
        )
      }
      if (entry.legacyStagingToken) {
        nextData.nexusPreviewToken = entry.legacyStagingToken
      }
      nextData.inspectToken = inspectToken
      nextData.payloadHash = entry.payloadHash || payloadHash
    }

    const result = await installModsV2(event, request.filePath, nextData, request.type)
    return {
      ...result,
      standardSource: source,
      inspectToken: inspectToken || '',
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
    }
  }
})
