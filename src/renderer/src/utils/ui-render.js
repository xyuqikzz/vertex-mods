import { nextTick } from 'vue'

export async function waitForUiRender(frameCount = 1) {
  await nextTick()

  const safeFrameCount = Math.max(1, Number(frameCount || 1))
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return
  }

  for (let index = 0; index < safeFrameCount; index += 1) {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }
}
