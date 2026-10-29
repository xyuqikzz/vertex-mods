import { app } from 'electron'

const { VITE_APP_NAME } = import.meta.env

export default class AutoStartManager {
  constructor(options = {}) {
    this.options = {
      name: VITE_APP_NAME,
      hidden: false,
      args: ['--minimized'],
      ...options
    }

    // 获取可执行文件路径（兼容开发和生产环境）
    this.executablePath = app.getPath('exe')
  }

  /**
   * 启用开机自启动
   * @returns {Promise<boolean>}
   */
  async enable() {
    try {
      if (process.platform === 'win32') {
        this.executablePath = `"${this.executablePath}"`
      }

      app.setLoginItemSettings({
        openAtLogin: true,
        path: this.executablePath,
        args: this.options.args,
        enabled: true,
        name: this.options.name
      })

      // 二次验证确保设置成功
      return await this.isEnabled()
    } catch (error) {
      console.error('启用自启动失败:', error)
      throw new Error('无法设置开机自启动，请检查应用权限')
    }
  }

  /**
   * 禁用开机自启动
   * @returns {Promise<boolean>}
   */
  async disable() {
    try {
      app.setLoginItemSettings({
        openAtLogin: false,
        path: this.executablePath, // 必须与启用时的路径一致
        args: this.options.args, // 必须与启用时的参数一致
        name: this.options.name,
        enabled: false
      })

      // 二次验证确保设置已移除
      return !(await this.isEnabled())
    } catch (error) {
      console.error('禁用自启动失败:', error)
      throw new Error('无法修改启动项，请检查系统权限')
    }
  }

  /**
   * 检查自启动状态
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    try {
      const settings = app.getLoginItemSettings({
        path: this.executablePath,
        args: this.options.args
      })
      // 兼容不同平台的返回结果[1,3](@ref)
      return (
        settings.openAtLogin ||
        settings.launchItems?.some((item) => item.name === this.options.name)
      )
    } catch (error) {
      console.error('检查自启动状态失败:', error)
      return false
    }
  }
}
