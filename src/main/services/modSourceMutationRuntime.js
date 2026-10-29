import { updateModSourceLockState } from '../db/mods/mods.js'
import { lockModSource, unlockModSource } from './modSourceFileLock.js'
import { requestElevatedModSourceRepair } from './modSourceProtectionElevation.js'

export function getModSourceMutationRuntimeDependencies() {
  return {
    lockModSource,
    unlockModSource,
    requestElevatedModSourceRepair,
    updateModSourceLockState
  }
}
