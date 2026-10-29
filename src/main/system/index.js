import { nativeText, onNativeLanguageChanged } from '../services/uiLanguage.js'
const { app, Tray, Menu } = require('electron')
const path = require('path')
const { VITE_APP_NAME } = import.meta.env

let tray = null

const getProdIconPath = () => {
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../../resources')
  return path.join(basePath, 'icon.png')
}

// 创建系统托盘
export function createTray(mainWindow) {
  tray = new Tray(getProdIconPath())
  const updateMenu = () => {
    if (tray.isDestroyed()) return
    tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: nativeText('openVertex'),
      click: () => {
        mainWindow.setSkipTaskbar(false)
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: nativeText('quit'),
      click: () => {
        app.isQuiting = true
        app.quit()
      }
    }
    ]))
  }
  updateMenu()
  const stopListening = onNativeLanguageChanged(updateMenu)
  app.once('will-quit', stopListening)
  tray.setToolTip(VITE_APP_NAME)

  tray.on('double-click', () => {
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
    mainWindow.focus()
  })
}

export function registerAgreement() {
  const protocols = ['vertex', 'nxm']
  for (const protocol of protocols) {
    app.removeAsDefaultProtocolClient(protocol)
    if (process.env.NODE_ENV === 'development') {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(protocol)
    }
  }
}
