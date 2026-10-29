import { uiMessage } from '../../../../i18n/message.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { getManagedModRecordId } from '../../../../../../shared/games/mod-management-location.js'

export async function openManagedModLocation(record = {}) {
  try {
    const result = await ipcRenderer.invoke('mod:open-location', {
      id: getManagedModRecordId(record)
    })
    if (!result?.success) $message.warning(result?.message || '无法打开模组目录')
    return result
  } catch {
    $message.error(uiMessage('ui.couldNotOpenTheModFolderPleaseTryAgain'))
    return { success: false }
  }
}
