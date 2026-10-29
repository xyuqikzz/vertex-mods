// Nexus 游戏与来源身份。
import { pickFirstText, toSafeNumber } from '../values.js'

export function resolveNexusDomainName(candidate = {}, context = {}, binding = null) {
  return pickFirstText(
    candidate?.domainName,
    candidate?.sourceSlug,
    candidate?.sourceGameSlug,
    binding?.domainName,
    context?.game?.domainName,
    context?.game?.gameDomainName,
    context?.game?.nexusGameDomain,
    context?.game?.sourceSlug,
    context?.route?.query?.domainName,
    context?.route?.query?.gameDomainName,
    context?.route?.query?.nexusGameDomain,
    context?.route?.params?.id
  )
}

export function resolveNexusAppId(candidate = {}, context = {}, binding = null) {
  return toSafeNumber(
    pickFirstText(
      binding?.appId,
      context?.game?.appId,
      context?.route?.query?.appId,
      context?.route?.query?.appid,
      context?.route?.query?.steamAppId,
      candidate?.appId,
      candidate?.appid
    ),
    0
  )
}

export function resolveNexusGameRoot(context = {}, binding = null) {
  return pickFirstText(
    context?.game?.installRoot,
    binding?.detectedRootPath,
    context?.route?.query?.clientRootPath
  )
}
