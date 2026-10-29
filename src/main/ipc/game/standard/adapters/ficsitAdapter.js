import {
  ficsitInstallDownloadedMods,
  ficsitInstallMod,
  ficsitPrepareInstallPlan
} from '../../ficsit.js'
import { legacySourceAdapter } from './legacySourceAdapter.js'
import { STANDARD_METADATA_SCHEMA_VERSION, STANDARD_SOURCE } from '../constants.js'
import { createPayloadHash, normalizeFicsitRequest, pickInspectToken } from '../payloadValidator.js'
import { consumeInspectPreview, putInspectPreview } from '../previewStore.js'
import { createStandardError } from '../errors.js'
import { STANDARD_ERROR_CODE } from '../constants.js'
import { createInstallPlan, createStandardSourceAdapter } from '../contracts.js'

function withStandardMetadata(payload = {}) {
  return {
    ...payload,
    metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION
  }
}

function isStandardArchivePayload(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  return !!String(target.filePath || target.data?.archivePath || '').trim()
}

function normalizeFicsitStandardPayload(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  const data = target.data && typeof target.data === 'object' ? target.data : {}
  return {
    ...target,
    source: STANDARD_SOURCE.FICSIT,
    sourceType: STANDARD_SOURCE.FICSIT,
    sourcePlatform: STANDARD_SOURCE.FICSIT,
    data: {
      ...data,
      source: STANDARD_SOURCE.FICSIT,
      sourceType: STANDARD_SOURCE.FICSIT,
      sourcePlatform: STANDARD_SOURCE.FICSIT,
      sourceAdapter: data.sourceAdapter || STANDARD_SOURCE.FICSIT
    }
  }
}

export const ficsitAdapter = createStandardSourceAdapter({
  source: STANDARD_SOURCE.FICSIT,
  domain: 'standard',

  async inspect({ event, payload }) {
    if (isStandardArchivePayload(payload)) {
      return await legacySourceAdapter.inspect({
        event,
        payload: normalizeFicsitStandardPayload(payload)
      })
    }

    const request = normalizeFicsitRequest(payload)
    const payloadHash = createPayloadHash(request)
    const result = await ficsitPrepareInstallPlan(request)
    const inspectToken = putInspectPreview({
      source: STANDARD_SOURCE.FICSIT,
      payloadHash,
      installPlan: result?.installPlan || null,
      standardPayload: request
    })

    return {
      ...result,
      inspectToken,
      payloadHash,
      standardInstallPlan: createInstallPlan({
        source: STANDARD_SOURCE.FICSIT,
        packageKey: request.modReference || request.name || '',
        dependencies: result?.reusedInstalledDependencies || [],
        operations: Array.isArray(result?.installPlan) ? result.installPlan : [],
        legacyPlan: result?.installPlan || null
      }),
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
      standardSource: STANDARD_SOURCE.FICSIT
    }
  },

  async install({ event, payload, mode = 'online' }) {
    if (isStandardArchivePayload(payload)) {
      return await legacySourceAdapter.install({
        event,
        payload: normalizeFicsitStandardPayload(payload)
      })
    }

    const request = normalizeFicsitRequest(payload)
    let inspectToken = pickInspectToken(request)
    const payloadHash = createPayloadHash(request)

    if (!inspectToken) {
      inspectToken = putInspectPreview({
        source: STANDARD_SOURCE.FICSIT,
        payloadHash,
        installPlan: Array.isArray(request?.items) ? request.items : null,
        standardPayload: request,
        inlineInspect: true
      })
    }

    if (inspectToken) {
      const entry = consumeInspectPreview(inspectToken, { consume: true })
      if (entry.payloadHash && entry.payloadHash !== payloadHash) {
        throw createStandardError(
          STANDARD_ERROR_CODE.INSTALL_PAYLOAD_CHANGED,
          'Ficsit 安装参数与预检参数不一致，请重新生成安装计划',
          { recoverable: true }
        )
      }
    }

    const installPayload = withStandardMetadata(request)
    const result =
      mode === 'downloaded'
        ? await ficsitInstallDownloadedMods(event, installPayload)
        : await ficsitInstallMod(event, installPayload)

    return {
      ...result,
      inspectToken: inspectToken || '',
      payloadHash,
      metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
      standardSource: STANDARD_SOURCE.FICSIT
    }
  }
})
