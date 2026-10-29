import { BrowserWindow, clipboard, nativeImage, screen } from 'electron'
import { Monitor } from 'node-screenshots'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trustLocalWindow } from '../../security/windows.js'
import { restrictWindowNavigation } from '../../security/windowPolicy.js'

// 全局变量存储覆盖窗口
let overlayWindow = null

export async function createOverlay() {
  if (overlayWindow) return

  const displays = screen.getAllDisplays()

  overlayWindow = new BrowserWindow({
    transparent: true,
    frame: false,
    fullscreen: true, // 关键修改2：强制全屏模式
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enablePreferredSizeMode: true // 关键修改3：高DPI支持
    }
  })

  // 关键修改4：设置窗口覆盖所有显示器
  overlayWindow.setBounds({
    x: displays.reduce((minX, d) => Math.min(minX, d.bounds.x), 0),
    y: displays.reduce((minY, d) => Math.min(minY, d.bounds.y), 0),
    width: displays.reduce((sum, d) => sum + d.bounds.width * d.scaleFactor, 0),
    height: displays.reduce((sum, d) => sum + d.bounds.height * d.scaleFactor, 0)
  })

  const entry = join(__dirname, 'overlay/overlay.html')
  trustLocalWindow(overlayWindow, pathToFileURL(entry).href, 'overlay')
  restrictWindowNavigation(overlayWindow.webContents)
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await overlayWindow.loadFile(entry)
  overlayWindow.setIgnoreMouseEvents(false)
}

export function closeOverlay() {
  overlayWindow?.close()
  overlayWindow = null
}

export async function captureArea(event, rect) {
  try {
    const { x, y, width, height } = rect
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 32768 || height > 32768) throw new Error('invalid_capture_rectangle')

    // 鑾峰彇灞忓箷鍥惧儚
    const monitor = Monitor.fromPoint(x, y)
    const fullScreenImage = await monitor.captureImage()

    // 鎵ц瑁佸壀鎿嶄綔
    const targetImage = fullScreenImage.cropSync(x - monitor.x, y - monitor.y, width, height)

    // 杞崲涓?PNG Buffer
    const pngBuffer = await targetImage.toPng()

    // 鍒涘缓 Electron 鍘熺敓鍥惧儚瀵硅薄
    const image = nativeImage.createFromBuffer(pngBuffer)

    // 鍐欏叆鍓创鏉?
    clipboard.write({
      image: image
    })

    event.reply('capture-success')
  } catch (error) {
    event.reply('capture-error', error.message)
  }
}
