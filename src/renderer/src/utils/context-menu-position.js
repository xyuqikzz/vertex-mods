const DEFAULT_GAP = 4
const DEFAULT_VIEWPORT_PADDING = 8

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function resolveContextMenuPosition(options = {}) {
  const anchorX = toFiniteNumber(options.anchorX)
  const anchorY = toFiniteNumber(options.anchorY)
  const menuWidth = Math.max(0, toFiniteNumber(options.menuWidth))
  const menuHeight = Math.max(0, toFiniteNumber(options.menuHeight))
  const viewportWidth = Math.max(0, toFiniteNumber(options.viewportWidth))
  const viewportHeight = Math.max(0, toFiniteNumber(options.viewportHeight))
  const gap = Math.max(0, toFiniteNumber(options.gap, DEFAULT_GAP))
  const padding = Math.max(
    0,
    toFiniteNumber(options.viewportPadding, DEFAULT_VIEWPORT_PADDING)
  )

  const maxLeft = Math.max(padding, viewportWidth - menuWidth - padding)
  const maxTop = Math.max(padding, viewportHeight - menuHeight - padding)
  const preferredLeft = anchorX + gap
  const preferredTop = anchorY + gap
  const fallbackLeft = anchorX - menuWidth - gap
  const fallbackTop = anchorY - menuHeight - gap

  return {
    left: Math.round(
      Math.min(maxLeft, Math.max(padding, preferredLeft <= maxLeft ? preferredLeft : fallbackLeft))
    ),
    top: Math.round(
      Math.min(maxTop, Math.max(padding, preferredTop <= maxTop ? preferredTop : fallbackTop))
    )
  }
}
