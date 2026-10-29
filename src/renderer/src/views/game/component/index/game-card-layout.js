// 模组中心游戏卡片的网格尺寸。game-card.vue 的列宽和 index.vue 的每页数量都从这里读取，
// 两边算出的列数才能一致：每页正好铺满 GAME_CARD_ROWS 行，最后一行不留空位。

export const GAME_CARD_LAYOUT = Object.freeze({
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape'
})

// 与 CSS 中 repeat(auto-fill, minmax(<最小列宽>, 1fr)) 的最小列宽保持一致。
export const GAME_CARD_MIN_COLUMN = Object.freeze({
  [GAME_CARD_LAYOUT.PORTRAIT]: 176,
  [GAME_CARD_LAYOUT.LANDSCAPE]: 260
})

// 网格间距，对应 --space-4。
export const GAME_CARD_GAP = 16

export const GAME_CARD_ROWS = 5

// 还量不到宽度时（例如页面在后台标签、整合包面板遮住列表）按常见窗口宽度估算。
const FALLBACK_COLUMNS = Object.freeze({
  [GAME_CARD_LAYOUT.PORTRAIT]: 6,
  [GAME_CARD_LAYOUT.LANDSCAPE]: 4
})

export function normalizeGameCardLayout(layout) {
  return layout === GAME_CARD_LAYOUT.PORTRAIT
    ? GAME_CARD_LAYOUT.PORTRAIT
    : GAME_CARD_LAYOUT.LANDSCAPE
}

/**
 * 按容器宽度计算网格列数，算法与 CSS auto-fill 相同：
 * 在宽度内能放下多少个「最小列宽 + 间距」，最后一列不需要间距。
 */
export function resolveGameCardColumns(width, layout) {
  const key = normalizeGameCardLayout(layout)
  const containerWidth = Number(width)
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return FALLBACK_COLUMNS[key]
  const minColumn = GAME_CARD_MIN_COLUMN[key]
  return Math.max(1, Math.floor((containerWidth + GAME_CARD_GAP) / (minColumn + GAME_CARD_GAP)))
}

/**
 * 每页数量 = 列数 × 行数。maxPageSize 用于有单页上限的接口（如 Banana），
 * 超出时减少行数，仍保持整行，不让最后一行只放半排。
 */
export function resolveGameCardPageSize(
  width,
  layout,
  { rows = GAME_CARD_ROWS, maxPageSize } = {}
) {
  const columns = resolveGameCardColumns(width, layout)
  let rowCount = Math.max(1, Math.floor(Number(rows) || GAME_CARD_ROWS))
  const limit = Math.floor(Number(maxPageSize))
  if (Number.isFinite(limit) && limit > 0) {
    if (columns >= limit) return limit
    rowCount = Math.min(rowCount, Math.floor(limit / columns))
  }
  return columns * rowCount
}

/**
 * 每页数量变化后，换算出仍包含当前第一条记录的页码，避免缩放窗口后跳回第一页或跳过内容。
 */
export function remapPageForSize(page, previousSize, nextSize) {
  const current = Math.max(1, Math.floor(Number(page) || 1))
  const before = Math.max(1, Math.floor(Number(previousSize) || 1))
  const after = Math.max(1, Math.floor(Number(nextSize) || 1))
  return Math.floor(((current - 1) * before) / after) + 1
}
