import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { h } from 'vue'
import SourceModpackInspectionConfirmContent from '@renderer/views/game/sourceModpack/component/SourceModpackInspectionConfirmContent.vue'

export function requestSourceModpackInspectionConfirmation(Modal, inspection = {}) {
  const mode = String(inspection.mode || '')
  if (mode === 'latest') return Promise.resolve(false)
  if (mode === 'conflict') {
    // 冲突时只告知原因，不提供继续安装；用统一的确认弹窗（只有「知道了」）。
    Modal.confirm({
      get title() { return uiText('ui.thisModpackConflictsWithLocalMods') },
      content: h(SourceModpackInspectionConfirmContent, { inspection, conflictMode: true }),
      width: 780,
      centered: true,
      tone: 'danger',
      showCancel: false,
      focusAction: 'confirm',
      get okText() { return uiText('ui.gotItVariant2') }
    })
    return Promise.resolve(false)
  }
  const title =
    mode === 'install' ? '安装分享整合包' : mode === 'repair' ? '修复分享整合包' : '更新分享整合包'
  return new Promise((resolve) => {
    Modal.confirm({
      title,
      content: h(SourceModpackInspectionConfirmContent, { inspection }),
      width: 780,
      centered: true,
      icon: null,
      okText:
        mode === 'repair' ? uiText('ui.repairToTheSharedVersion') : mode === 'install' ? uiText('ui.addToInstallationTasks') : uiText('ui.confirmUpdate'),
      get cancelText() { return uiText('ui.cancel') },
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}
