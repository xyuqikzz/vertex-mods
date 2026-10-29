// 仅管理账号请求的生命周期，不清理设备级游戏、下载或第三方配置。
let controller = new AbortController()

export function getAccountSessionSignal() {
  return controller.signal
}

export function resetAccountSession() {
  controller.abort()
  controller = new AbortController()
}
