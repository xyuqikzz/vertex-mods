import { clientI18n } from './index.js'
import { toolMessageKeys } from './tool-messages.js'

// Only application-owned text belongs here. Never pass script output, mod names,
// device models or arbitrary source content through this adapter.
export function toolText(source, args = []) {
  if (source?.toolMessage) return toolText(source.source, source.args)
  const key = toolMessageKeys.get(source)
  return key
    ? clientI18n.i18n.global.t(
        key,
        Object.fromEntries(
          args.map((value, index) => [`p${index}`, value?.toolMessage ? toolText(value) : value])
        )
      )
    : source
}

// Store message identity for long-running operations so cached pages can switch language.
export const toolMessage = (source, args = []) => ({ toolMessage: true, source, args })
