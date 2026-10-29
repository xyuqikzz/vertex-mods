import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { inject, provide } from 'vue'

const MOD_MANAGEMENT_CONTROLLER_KEY = Symbol('MOD_MANAGEMENT_CONTROLLER')

export function provideModManagementController(controller = null) {
  provide(MOD_MANAGEMENT_CONTROLLER_KEY, controller)
}

export function useModManagementControllerContext() {
  const controller = inject(MOD_MANAGEMENT_CONTROLLER_KEY, null)
  if (!controller) {
    throw new Error(uiText('ui.modManagementContextWasNotFound'))
  }
  return controller
}
