import {
  createLocalBoundMod,
  deleteLocalBoundMod,
  disableLocalBoundMod,
  enableLocalBoundMod,
  refreshLocalBoundMods,
  unbindLocalBoundMod
} from '../localBoundMod.js'

export async function createLocalManagedBinding(payload = {}) {
  return await createLocalBoundMod({
    ...payload,
    metadata: {
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      createdBy: 'local-mod-manager',
      managementMode: 'bind_existing'
    }
  })
}

export async function enableLocalManagedMod(payload = {}) {
  return await enableLocalBoundMod(payload)
}

export async function disableLocalManagedMod(payload = {}) {
  return await disableLocalBoundMod(payload)
}

export async function unbindLocalManagedMod(payload = {}) {
  return await unbindLocalBoundMod(payload)
}

export async function deleteLocalManagedMod(payload = {}) {
  return await deleteLocalBoundMod(payload)
}

export async function refreshLocalManagedMods(payload = {}) {
  return await refreshLocalBoundMods(payload)
}
