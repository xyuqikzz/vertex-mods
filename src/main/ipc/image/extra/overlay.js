const { ipcRenderer } = window.electron

let startX,
  startY,
  isSelecting = false
const overlay = document.getElementById('overlay')
const selectionBox = document.getElementById('selection-box')

overlay.addEventListener('mousedown', (e) => {
  startX = e.screenX
  startY = e.screenY
  isSelecting = true
  selectionBox.style.display = 'block'
})

document.addEventListener('mousemove', (e) => {
  if (!isSelecting) return

  const currentX = e.screenX
  const currentY = e.screenY

  const rect = {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY)
  }

  selectionBox.style.left = `${rect.x}px`
  selectionBox.style.top = `${rect.y}px`
  selectionBox.style.width = `${rect.width}px`
  selectionBox.style.height = `${rect.height}px`
})

document.addEventListener('mouseup', async () => {
  if (!isSelecting) return
  isSelecting = false

  const rect = {
    x: parseInt(selectionBox.style.left),
    y: parseInt(selectionBox.style.top),
    width: parseInt(selectionBox.style.width),
    height: parseInt(selectionBox.style.height)
  }

  // 发送截图区域到主进程
  ipcRenderer.invoke('close-overlay')
  ipcRenderer.send('capture-area', rect)
})

// 接收显示器信息
ipcRenderer.on('set-monitors', (_, monitors) => {
  window.monitors = monitors
})

// 按ESC退出
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ipcRenderer.invoke('close-overlay')
  }
})
