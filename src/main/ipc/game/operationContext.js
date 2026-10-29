// 业务服务只接收通知端口，不持有 Electron event / WebContents。
// 保留既有安装引擎的 reply/sender.send 协议，避免改变进度与生命周期授权语义。
export function createGameOperationContext(event) {
  const sender = event?.sender
  const isDestroyed = () => typeof sender?.isDestroyed === 'function' && sender.isDestroyed()
  const reply = (channel, ...args) => {
    if (isDestroyed()) return false
    if (typeof event?.reply === 'function') return event.reply(channel, ...args)
    if (typeof sender?.send === 'function') return sender.send(channel, ...args)
    return false
  }
  const context = { reply }
  // 缺少 sender 时不伪造授权接收方；现有生命周期授权层仍按原策略拒绝。
  if (typeof sender?.send === 'function') {
    context.sender = Object.freeze({
      send(channel, ...args) {
        if (isDestroyed()) throw new Error('操作窗口已关闭')
        return sender.send(channel, ...args)
      }
    })
  }
  return Object.freeze(context)
}
