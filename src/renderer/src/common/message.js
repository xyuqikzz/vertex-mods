import { messageTip } from '@renderer/common/message-tip.js'

class MessageManager {
  static instance = null
  currentMessage = null

  constructor() {
    if (!MessageManager.instance) {
      MessageManager.instance = this
    }
    return MessageManager.instance
  }

  show({ type = 'info', content, duration = 2 }) {
    const controller = messageTip.show({
      type,
      title: content,
      content: '',
      duration
    })

    this.currentMessage = controller
    return controller
  }

  success(content, duration = 3) {
    return this.show({ type: 'success', content, duration })
  }

  info(content, duration = 3) {
    return this.show({ type: 'info', content, duration })
  }

  error(content, duration = 3) {
    return this.show({ type: 'error', content, duration })
  }

  warning(content, duration = 3) {
    return this.show({ type: 'warning', content, duration })
  }

  destroy() {
    messageTip.closeAll()
    this.currentMessage = null
  }
}

export const $message = new MessageManager()
