import { isPlainObject, toSafeText } from '../contracts.js'
import { collectDirectorySnapshot } from '../fsSnapshot.js'
import * as genericAdapter from './genericAdapter.js'
import * as bepInExAdapter from './bepInExAdapter.js'
import * as melonLoaderAdapter from './melonLoaderAdapter.js'
import * as ue4ssAdapter from './ue4ssAdapter.js'
import * as unrealPakAdapter from './unrealPakAdapter.js'
import * as smapiAdapter from './smapiAdapter.js'
import * as thunderstoreManifestAdapter from './thunderstoreManifestAdapter.js'

export const PACKAGE_ADAPTERS = [
  thunderstoreManifestAdapter,
  smapiAdapter,
  bepInExAdapter,
  melonLoaderAdapter,
  ue4ssAdapter,
  unrealPakAdapter,
  genericAdapter
]

export async function resolvePackageProfile(context = {}) {
  const candidateRoot = toSafeText(
    context.candidateRoot || context.sourceRoot || context.stagingPath
  )
  const snapshot = isPlainObject(context.snapshot)
    ? context.snapshot
    : candidateRoot
      ? await collectDirectorySnapshot(candidateRoot, context.snapshotCache || new Map())
      : {}
  const profiles = []

  for (const adapter of PACKAGE_ADAPTERS) {
    const profile = await adapter.detectPackageProfile(snapshot, context)
    if (profile) {
      profiles.push(profile)
    }
  }

  profiles.sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))
  return {
    profile: profiles[0] || (await genericAdapter.detectPackageProfile(snapshot, context)),
    candidates: profiles,
    snapshot
  }
}
