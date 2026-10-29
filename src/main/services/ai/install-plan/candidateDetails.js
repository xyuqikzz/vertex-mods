// 补齐候选详情并判断预览前是否需要查询。
import { toSafeText, toSafeNumber, pickFirstText, toPlainJson } from './values.js'
import { hasSourceLogo } from './images.js'
import {
  resolveNexusVersion,
  resolveModioVersion,
  resolveFicsitVersion,
  resolveVamHubFileName,
  resolveThunderstoreDownloadUrl,
  resolveThunderstoreVersion
} from './fileMetadata.js'
import { resolveVamHubDownloadUrl, resolveVamHubPackageName } from './sources/vamhub.js'

function shouldResolveDetailBeforePreview(candidate = {}) {
  if (candidate.sourceInstallTaskPayload?.items?.length) return false
  const source = toSafeText(candidate?.source).toLowerCase()
  if (!source) {
    return false
  }
  const missingLogo = !hasSourceLogo(candidate)

  if (source === 'nexus') {
    return (
      missingLogo ||
      !toSafeNumber(candidate?.fileId, 0) ||
      !toSafeText(candidate?.downloadUrl) ||
      !resolveNexusVersion(candidate)
    )
  }

  if (source === 'modio') {
    return (
      missingLogo ||
      !toSafeNumber(candidate?.fileId, 0) ||
      !toSafeText(candidate?.downloadUrl) ||
      !resolveModioVersion(candidate)
    )
  }

  if (source === 'thunderstore') {
    return (
      missingLogo ||
      !pickFirstText(
        candidate?.fullName,
        candidate?.packageFullName,
        candidate?.modId,
        candidate?.id
      ) ||
      !resolveThunderstoreDownloadUrl(candidate) ||
      !resolveThunderstoreVersion(candidate)
    )
  }

  if (source === 'vamhub') {
    return (
      missingLogo ||
      !resolveVamHubPackageName(candidate) ||
      !resolveVamHubDownloadUrl(candidate) ||
      !resolveVamHubFileName(candidate)
    )
  }

  if (source === 'ficsit') {
    return (
      missingLogo ||
      !pickFirstText(candidate?.modReference, candidate?.modId, candidate?.id) ||
      !toSafeText(candidate?.downloadUrl) ||
      !resolveFicsitVersion(candidate)
    )
  }

  return !toSafeText(candidate?.version)
}

export async function hydrateInstallPlanCandidate(candidate = {}, context = {}, resolveDetail) {
  const safeCandidate = toPlainJson(candidate, {})
  if (!shouldResolveDetailBeforePreview(safeCandidate)) {
    return {
      candidate: safeCandidate,
      detailResolved: false
    }
  }

  let resolveDetailFn = resolveDetail
  if (typeof resolveDetailFn !== 'function') {
    const modSourceService = await import('../../mod-source/runtime.js')
    resolveDetailFn = modSourceService.getModSourceDetail
  }

  try {
    const detailResult = await resolveDetailFn({
      ...safeCandidate,
      context
    })
    const detailRecord = toPlainJson(detailResult?.record, null)
    if (detailResult?.errorCode === 'requested_mod_file_unavailable') {
      return {
        candidate: safeCandidate,
        detailResolved: false,
        errorCode: detailResult.errorCode,
        message: detailResult.message
      }
    }
    if (detailResult?.success && detailRecord && Object.keys(detailRecord).length) {
      const requestedFileId = pickFirstText(safeCandidate.fileId, safeCandidate.selectedFileId)
      const fetchedFileId = pickFirstText(detailRecord.fileId, detailRecord.selectedFileId)
      let selectedEvidence = {}
      if (
        !requestedFileId &&
        safeCandidate.version &&
        safeCandidate.version !== 'latest' &&
        detailRecord.version &&
        safeCandidate.version !== detailRecord.version
      ) {
        return {
          candidate: safeCandidate,
          detailResolved: false,
          errorCode: 'requested_mod_file_unavailable',
          message:
            '详情返回的版本与指定版本不一致，请按指定版本的真实 fileId 重新读取；未采用新版下载信息。'
        }
      }
      if (requestedFileId && fetchedFileId && requestedFileId !== fetchedFileId) {
        const file = (detailRecord.files || []).find(
          (item) => String(item.fileId || item.file_id || item.id) === requestedFileId
        )
        if (!file)
          return {
            candidate: safeCandidate,
            detailResolved: false,
            errorCode: 'requested_mod_file_unavailable',
            message: '详情没有返回指定文件，不能使用其他版本的下载信息。'
          }
        selectedEvidence = {
          primaryFile: file,
          selectedFile: file,
          fileName: file.fileName || file.file_name || file.name || safeCandidate.fileName || '',
          fileSize: file.fileSize || file.size || Number(file.size_kb || 0) * 1024,
          downloadUrl: file.downloadUrl || file.download_url || safeCandidate.downloadUrl || '',
          version: file.version || safeCandidate.version || ''
        }
      }
      return {
        candidate: {
          ...safeCandidate,
          ...detailRecord,
          ...selectedEvidence,
          // 详情提供最新列表，但不能覆盖用户已经选择的文件和版本。
          ...Object.fromEntries(
            [
              'fileId',
              'file_id',
              'selectedFileId',
              'selected_file_id',
              'selectedFile',
              'selectedVersionId',
              'selectedVersionName',
              'version',
              'modVersion',
              'profileName',
              'endpointType',
              'installChoices'
            ]
              .filter(
                (key) =>
                  safeCandidate[key] !== undefined &&
                  safeCandidate[key] !== '' &&
                  safeCandidate[key] !== 'latest'
              )
              .map((key) => [key, safeCandidate[key]])
          )
        },
        detailResolved: true
      }
    }
  } catch {
    return {
      candidate: safeCandidate,
      detailResolved: false
    }
  }

  return {
    candidate: safeCandidate,
    detailResolved: false
  }
}
