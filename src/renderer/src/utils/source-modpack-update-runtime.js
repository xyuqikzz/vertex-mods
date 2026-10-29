import {
  GET_MY_SOURCE_MODPACK_LIST,
  GET_SOURCE_MODPACK_INFO,
  UPDATE_SOURCE_MODPACK
} from '@renderer/api/modules/source-modpack.js'
import {
  buildSourceModpackUpdatePayload,
  normalizeSourceModpackEditorDraft
} from '@renderer/utils/source-modpack-share.js'
import { createSourceModpackUpdateCoordinator } from './source-modpack-update-coordinator.js'

export const sourceModpackUpdateCoordinator = createSourceModpackUpdateCoordinator({
  listOwnedPage: GET_MY_SOURCE_MODPACK_LIST,
  getDetail: GET_SOURCE_MODPACK_INFO,
  update: UPDATE_SOURCE_MODPACK,
  normalizeDraft: normalizeSourceModpackEditorDraft,
  buildUpdatePayload: buildSourceModpackUpdatePayload
})
