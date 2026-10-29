import {
  buildNexusDownloadLinkQueryParams,
  matchNexusDownloadAuthorizationTarget,
  parseNexusDownloadAuthorization
} from '../../../shared/sources/nexus-download-link.js'
import { nexusError } from './accountService.js'

export function createNexusDownloadService(account) {
  return async function exchangeDownloadLink(payload = {}) {
    const target = parseNexusDownloadAuthorization(payload.target || payload)
    if (
      !/^[a-z0-9_-]+$/i.test(target.gameDomain) ||
      !Number.isSafeInteger(target.modId) ||
      target.modId <= 0 ||
      !Number.isSafeInteger(target.fileId) ||
      target.fileId <= 0
    )
      throw nexusError(
        'nexus_authorization_target_mismatch',
        '缺少有效的 Nexus 游戏、模组或文件标识'
      )
    const state = account.snapshot()
    const expectedRevision = account.revision()
    const authorization = payload.authorization || payload.downloadAuthorization
    if (authorization) {
      const match = matchNexusDownloadAuthorizationTarget(authorization, target)
      if (!match.matched)
        throw nexusError(
          match.reason === 'authorization_expired'
            ? 'nexus_authorization_expired'
            : 'nexus_authorization_target_mismatch',
          match.message
        )
      const normalized = parseNexusDownloadAuthorization(authorization)
      if (normalized.userId) {
        let id = state.credentialSource === 'oauth' ? state.user?.id : ''
        if (!id) {
          const profile = await account.request({
            url: 'https://api.nexusmods.com/v1/users/validate.json',
            method: 'GET',
            expectedRevision
          })
          if (profile.status !== 200)
            throw nexusError(
              'nexus_account_validation_failed',
              '无法验证 Nexus 下载账号，请重新连接账号',
              profile.status
            )
          id = profile.data?.user_id
        }
        if (String(id) !== normalized.userId)
          throw nexusError(
            'nexus_account_mismatch',
            '网页下载账号与 Vertex 中的 Nexus 账号不一致',
            400
          )
      }
    }
    const response = await account.request({
      url: `https://api.nexusmods.com/v1/games/${target.gameDomain}/mods/${target.modId}/files/${target.fileId}/download_link.json`,
      method: 'GET',
      params: buildNexusDownloadLinkQueryParams(authorization || {}),
      expectedRevision
    })
    if (response.status !== 200)
      throw nexusError(
        response.status === 403
          ? 'nexus_authorization_required'
          : 'nexus_download_link_exchange_failed',
        response.status === 403
          ? '需要在 Nexus 网页确认此文件下载'
          : `Nexus 下载地址获取失败（HTTP ${response.status}）`,
        response.status
      )
    const links = Array.isArray(response.data) ? response.data : []
    for (const link of links) {
      try {
        const url = new URL(link.URI || link.uri || link.download_url || link.downloadUrl)
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          ![
            'www.nexusmods.com',
            'users.nexusmods.com',
            'next.nexusmods.com',
            'nexusmods.com'
          ].includes(url.hostname)
        )
          return { downloadUrl: url.href, mirrorCount: links.length }
      } catch {
        /* Try the next mirror; never include a signed URL in errors. */
      }
    }
    throw nexusError('nexus_download_link_exchange_failed', 'Nexus 未返回有效的 HTTPS 文件下载地址')
  }
}
