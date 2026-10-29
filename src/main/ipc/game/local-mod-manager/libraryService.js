import {
  commitLocalModImport,
  createLibraryInstallTask,
  deleteLibraryItem,
  getLibraryItem,
  listLibrary,
  updateLibraryMeta
} from '../local-mod-import/commitService.js'

export async function saveLocalModToLibrary(payload = {}) {
  return await commitLocalModImport({
    ...payload,
    metadata: {
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      schemaVersion: 2,
      createdBy: 'local-mod-manager',
      managementMode: payload.managementMode || 'library'
    }
  })
}

export async function createLocalModInstallTask(event, payload = {}) {
  return await createLibraryInstallTask(event, payload)
}

export function listLocalModAssets(payload = {}) {
  return listLibrary(payload)
}

export function getLocalModAsset(payload = {}) {
  return getLibraryItem(payload)
}

export function updateLocalModAssetMeta(payload = {}) {
  return updateLibraryMeta(payload)
}

export async function deleteLocalModAsset(payload = {}) {
  return await deleteLibraryItem(payload)
}
