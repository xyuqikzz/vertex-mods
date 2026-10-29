// 启动入口负责创建窗口；功能模块只读取同一引用，不反向加载启动流程。
export let mainWindow = null

export function setMainWindow(window) {
  mainWindow = window
}

export function getMainWindow() {
  return mainWindow
}
