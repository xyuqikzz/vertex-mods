import { pathKey } from '../files.js'

export function preferenceFor(record, exePath, profile) {
  const key = pathKey(exePath)
  const saved = record.swapperOptions || {}
  const launchProfile = profile ?? saved.activeProfiles?.[key] ?? 'auto'
  const options = saved.profiles?.[key]?.[launchProfile]
  return {
    launchProfile,
    api: options?.api ?? (launchProfile === 'auto' ? saved.apis?.[key] : undefined) ?? 'auto',
    route: options?.route ?? (launchProfile === 'auto' ? saved.route : undefined),
    consumerVersion: options?.consumerVersion || 'auto',
    reshadeProxy: options?.reshadeProxy || 'dxgi',
    consumerPlan: options?.consumerPlan || null,
    fingerprint: options?.fingerprint
  }
}

export const deploymentChoice = (preference) =>
  preference.api !== 'auto' ? preference.api : preference.launchProfile
