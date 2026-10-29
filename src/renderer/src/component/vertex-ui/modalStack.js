// 弹窗层级约定（从高到低）：
//   1. 消息提示（global-message-tip-host，z-index 由 --z-index-toast 控制）
//   2. 确认弹窗（VxConfirmModal）        → CONFIRM 基准
//   3. 通用弹窗（VxModal）               → BASE 基准
// 该文件负责为同一层内的弹窗分配自增 z-index，并隔离不同层之间的计数。

export const VX_MODAL_LAYER = Object.freeze({
  BASE: 'base',
  CONFIRM: 'confirm'
})

const VX_MODAL_LAYER_CONFIG = {
  [VX_MODAL_LAYER.BASE]: {
    base: 2000,
    step: 20
  },
  [VX_MODAL_LAYER.CONFIRM]: {
    base: 3000,
    step: 20
  }
}

const modalStack = []
const modalLayers = new Map()
const layerCounters = new Map()
let bodyOverflowBeforeLock = ''

function getBodyElement() {
  if (typeof document === 'undefined') return null
  return document.body || null
}

function lockBodyScroll() {
  const body = getBodyElement()
  if (!body || modalStack.length > 0) return

  bodyOverflowBeforeLock = body.style.overflow
  body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  const body = getBodyElement()
  if (!body || modalStack.length > 0) return

  body.style.overflow = bodyOverflowBeforeLock
  bodyOverflowBeforeLock = ''
  // 全部层都已卸载，重置所有层级计数器
  layerCounters.clear()
}

function normalizeLayer(layer) {
  return layer === VX_MODAL_LAYER.CONFIRM ? VX_MODAL_LAYER.CONFIRM : VX_MODAL_LAYER.BASE
}

export function registerVxModal(id, layer = VX_MODAL_LAYER.BASE) {
  if (modalLayers.has(id)) {
    return modalLayers.get(id)
  }

  const resolvedLayer = normalizeLayer(layer)
  const config = VX_MODAL_LAYER_CONFIG[resolvedLayer]
  const counter = layerCounters.get(resolvedLayer) || 0

  lockBodyScroll()

  const zIndex = config.base + counter * config.step
  layerCounters.set(resolvedLayer, counter + 1)
  modalStack.push(id)
  modalLayers.set(id, zIndex)
  return zIndex
}

export function unregisterVxModal(id) {
  const index = modalStack.indexOf(id)
  if (index >= 0) {
    modalStack.splice(index, 1)
  }
  modalLayers.delete(id)

  // 当前层仍存在弹窗时，不回收该层计数器；仅当整层都卸载时由 unlockBodyScroll 一并清空。
  unlockBodyScroll()
}

export function getVxModalZIndex(id) {
  return modalLayers.get(id) || VX_MODAL_LAYER_CONFIG[VX_MODAL_LAYER.BASE].base
}

export function isTopVxModal(id) {
  return modalStack[modalStack.length - 1] === id
}
