<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { useAiAssistantStore } from '@renderer/store/aiAssistantStore.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'
import {
  AI_MASCOT_PET_ROWS,
  AI_MASCOT_ROW_FRAME_COUNTS,
  AI_MASCOT_SPRITESHEET_LAYOUT,
  getAllAiMascotPets,
  getAiMascotPet,
  normalizeAiMascotConfig
} from '@renderer/component/ai-mascot-pets.js'
import { normalizeAiAgentConfig } from '../../../shared/ai/config/ai-agent-config.js'

const MASCOT_SCALE = 0.4
const MASCOT_MARGIN_RIGHT = 22
const MASCOT_MARGIN_BOTTOM = 18
const DRAG_START_DISTANCE = 3
const IDLE_FRAME_DURATION = 220
const HOVER_FRAME_DURATION = 120
const PRESSED_FRAME_DURATION = 220
const RUNNING_FRAME_DURATION = 90
const MOMENT_FRAME_DURATION = 150
const FAILED_FRAME_DURATION = 140
const IDLE_MOMENT_INTERVAL = 8500
const IDLE_MOMENT_RETRY_INTERVAL = 1800

const mascotRef = ref(null)
const mascotConfig = ref(normalizeAiMascotConfig())
const normalizedDefaultAiAgentConfig = normalizeAiAgentConfig()
const aiAgentEnabled = ref(normalizedDefaultAiAgentConfig.enabled)
const customMascotPets = ref([])
const frameIndex = ref(0)
const activeMoment = ref(null)
const isHovering = ref(false)
const isPressed = ref(false)
const isDragging = ref(false)
const dragDirection = ref('right')
const reduceMotion = ref(false)
const frameWidth = AI_MASCOT_SPRITESHEET_LAYOUT.frameWidth * MASCOT_SCALE
const frameHeight = AI_MASCOT_SPRITESHEET_LAYOUT.frameHeight * MASCOT_SCALE
const position = ref(getDefaultPosition())
const aiAssistantStore = useAiAssistantStore()

const availableMascotPets = computed(() => getAllAiMascotPets(customMascotPets.value))
const selectedPet = computed(() =>
  getAiMascotPet(mascotConfig.value.selectedPetId, availableMascotPets.value)
)
const isVisible = computed(
  () => aiAgentEnabled.value && mascotConfig.value.enabled && availableMascotPets.value.length > 0
)
const shouldPlayMoment = computed(() => {
  if (!activeMoment.value || isDragging.value || isPressed.value) return false
  return activeMoment.value.lockHover || !isHovering.value
})
const activeRow = computed(() => {
  if (isDragging.value) {
    return dragDirection.value === 'left'
      ? AI_MASCOT_PET_ROWS.runningLeft
      : AI_MASCOT_PET_ROWS.runningRight
  }

  if (isPressed.value) {
    return AI_MASCOT_PET_ROWS.pressed
  }

  if (shouldPlayMoment.value) {
    return activeMoment.value.row
  }

  if (isHovering.value) {
    return AI_MASCOT_PET_ROWS.hover
  }

  const row = selectedPet.value?.row
  return Number.isFinite(row) ? row : AI_MASCOT_PET_ROWS.idle
})
const activeFrameCount = computed(() => {
  const count = AI_MASCOT_ROW_FRAME_COUNTS[activeRow.value]
  return Number.isFinite(count) && count > 0 ? count : AI_MASCOT_SPRITESHEET_LAYOUT.columns
})
const activeFrameDuration = computed(() => {
  if (isDragging.value) return RUNNING_FRAME_DURATION
  if (isPressed.value) return PRESSED_FRAME_DURATION
  if (shouldPlayMoment.value && Number.isFinite(activeMoment.value.duration)) {
    return activeMoment.value.duration
  }
  if (isHovering.value) return HOVER_FRAME_DURATION
  return IDLE_FRAME_DURATION
})
const mascotStatusClass = computed(() => `is-${aiAssistantStore.displayStatusTone}`)
const mascotTitle = computed(() => uiText('ui.aIModAssistantValue', { value1: (aiAssistantStore.displayStatusLabel) }))
const pendingCount = computed(() => Number(aiAssistantStore.displayPendingResultCount || 0))

const mascotStyle = computed(() => {
  const pet = selectedPet.value

  return {
    '--mascot-spritesheet': `url("${pet.spritesheetUrl}")`,
    '--mascot-x': `${Math.round(position.value.x)}px`,
    '--mascot-y': `${Math.round(position.value.y)}px`,
    '--mascot-frame-width': `${frameWidth}px`,
    '--mascot-frame-height': `${frameHeight}px`,
    '--mascot-bg-x': `${frameIndex.value * frameWidth * -1}px`,
    '--mascot-bg-y': `${activeRow.value * frameHeight * -1}px`,
    '--mascot-columns': AI_MASCOT_SPRITESHEET_LAYOUT.columns,
    '--mascot-rows': AI_MASCOT_SPRITESHEET_LAYOUT.rows
  }
})

let animationFrameId = 0
let lastFrameAt = 0
let reducedMotionMedia = null
let momentFrameProgress = 0
let idleMomentTimer = 0
let idleMomentIndex = 0
const dragState = {
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  startX: 0,
  startY: 0,
  lastClientX: 0
}

function getDefaultPosition() {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }

  return {
    x: Math.max(0, window.innerWidth - frameWidth - MASCOT_MARGIN_RIGHT),
    y: Math.max(0, window.innerHeight - frameHeight - MASCOT_MARGIN_BOTTOM)
  }
}

function clampPosition(target) {
  if (typeof window === 'undefined') {
    return target
  }

  return {
    x: Math.min(Math.max(0, target.x), Math.max(0, window.innerWidth - frameWidth)),
    y: Math.min(Math.max(0, target.y), Math.max(0, window.innerHeight - frameHeight))
  }
}

function setFrame(value) {
  frameIndex.value = value % activeFrameCount.value
}

function clearIdleMomentTimer() {
  if (!idleMomentTimer) return
  clearTimeout(idleMomentTimer)
  idleMomentTimer = 0
}

function canPlayIdleMoment() {
  return (
    isVisible.value &&
    !reduceMotion.value &&
    !isDragging.value &&
    !isPressed.value &&
    !isHovering.value &&
    !activeMoment.value
  )
}

function playMoment(row, options = {}) {
  if (!isVisible.value || reduceMotion.value) return false

  activeMoment.value = {
    row,
    duration: Number.isFinite(options.duration) ? options.duration : MOMENT_FRAME_DURATION,
    loops: Number.isFinite(options.loops) ? Math.max(1, options.loops) : 1,
    lockHover: options.lockHover === true
  }
  momentFrameProgress = 0
  frameIndex.value = 0
  lastFrameAt = 0
  return true
}

function clearMoment(options = {}) {
  activeMoment.value = null
  momentFrameProgress = 0
  frameIndex.value = 0
  lastFrameAt = 0

  if (options.scheduleNext !== false) {
    scheduleIdleMoment()
  }
}

function scheduleIdleMoment(delay = IDLE_MOMENT_INTERVAL) {
  clearIdleMomentTimer()
  if (!isVisible.value || reduceMotion.value) return

  idleMomentTimer = window.setTimeout(() => {
    idleMomentTimer = 0
    if (!canPlayIdleMoment()) {
      scheduleIdleMoment(IDLE_MOMENT_RETRY_INTERVAL)
      return
    }

    const rows = [AI_MASCOT_PET_ROWS.waiting, AI_MASCOT_PET_ROWS.running, AI_MASCOT_PET_ROWS.review]
    const row = rows[idleMomentIndex % rows.length]
    idleMomentIndex += 1
    playMoment(row, {
      duration: MOMENT_FRAME_DURATION,
      loops: 2
    })
  }, delay)
}

function advanceFrame(stepCount) {
  if (shouldPlayMoment.value) {
    const totalMomentFrames = activeFrameCount.value * activeMoment.value.loops
    momentFrameProgress += stepCount
    if (momentFrameProgress >= totalMomentFrames) {
      clearMoment()
      return false
    }
  }

  setFrame(frameIndex.value + stepCount)
  return true
}

function animateMascot(timestamp) {
  if (reduceMotion.value) {
    animationFrameId = requestAnimationFrame(animateMascot)
    return
  }

  if (!lastFrameAt) {
    lastFrameAt = timestamp
  }

  const duration = activeFrameDuration.value
  const elapsed = timestamp - lastFrameAt
  if (elapsed >= duration) {
    const stepCount = Math.floor(elapsed / duration)
    const hasAdvancedFrame = advanceFrame(stepCount)
    lastFrameAt = hasAdvancedFrame ? lastFrameAt + stepCount * duration : timestamp
  }

  animationFrameId = requestAnimationFrame(animateMascot)
}

function startAnimation() {
  if (animationFrameId) return
  lastFrameAt = 0
  animationFrameId = requestAnimationFrame(animateMascot)
}

function stopAnimation() {
  if (!animationFrameId) return
  cancelAnimationFrame(animationFrameId)
  animationFrameId = 0
}

function handlePointerDown(event) {
  if (event.button !== 0) return

  event.preventDefault()
  clearIdleMomentTimer()
  clearMoment({ scheduleNext: false })
  isPressed.value = true
  isDragging.value = false
  frameIndex.value = 0
  dragDirection.value = 'right'
  dragState.pointerId = event.pointerId
  dragState.startClientX = event.clientX
  dragState.startClientY = event.clientY
  dragState.startX = position.value.x
  dragState.startY = position.value.y
  dragState.lastClientX = event.clientX
  mascotRef.value?.setPointerCapture?.(event.pointerId)
}

function handlePointerEnter() {
  if (activeMoment.value && !activeMoment.value.lockHover) {
    clearMoment({ scheduleNext: false })
  }
  clearIdleMomentTimer()
  isHovering.value = true
}

function handlePointerLeave() {
  if (isPressed.value || isDragging.value) return
  isHovering.value = false
  scheduleIdleMoment()
}

function isPointerInsideMascot(event) {
  const rect = mascotRef.value?.getBoundingClientRect()
  if (!rect) return false

  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function handlePointerMove(event) {
  if (!isPressed.value || event.pointerId !== dragState.pointerId) return

  event.preventDefault()
  const totalDeltaX = event.clientX - dragState.startClientX
  const totalDeltaY = event.clientY - dragState.startClientY
  const hasDragStarted =
    Math.abs(totalDeltaX) > DRAG_START_DISTANCE || Math.abs(totalDeltaY) > DRAG_START_DISTANCE

  if (!isDragging.value && hasDragStarted) {
    isDragging.value = true
    frameIndex.value = 0
    lastFrameAt = 0
  }

  const frameDeltaX = event.clientX - dragState.lastClientX
  if (Math.abs(frameDeltaX) > 0) {
    dragDirection.value = frameDeltaX < 0 ? 'left' : 'right'
  }
  dragState.lastClientX = event.clientX

  if (!isDragging.value) return

  position.value = clampPosition({
    x: dragState.startX + totalDeltaX,
    y: dragState.startY + totalDeltaY
  })
}

function endDragging(event) {
  if (!isPressed.value || event.pointerId !== dragState.pointerId) return

  const wasDragging = isDragging.value
  const shouldOpenDrawer = !wasDragging && isPointerInsideMascot(event)
  isPressed.value = false
  isDragging.value = false
  isHovering.value = isPointerInsideMascot(event)
  frameIndex.value = 0
  dragState.pointerId = null
  mascotRef.value?.releasePointerCapture?.(event.pointerId)
  scheduleIdleMoment()

  if (shouldOpenDrawer) {
    openAiAssistantEntry()
  }
}

async function openAiAssistantEntry() {
  try {
    await ipcRenderer.invoke(
      'ai-assistant-window:open',
      sanitizeIpcPayload(
        {
          source: 'mascot'
        },
        {}
      )
    )
  } catch (error) {
    console.error('打开 AI 助手外置窗口失败:', error)
  }
}

function handleKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  openAiAssistantEntry()
}

function handleDoubleClick(event) {
  event.preventDefault()
  clearIdleMomentTimer()
  playMoment(AI_MASCOT_PET_ROWS.review, {
    duration: MOMENT_FRAME_DURATION,
    loops: 2,
    lockHover: true
  })
}

function handleContextMenu(event) {
  event.preventDefault()
  clearIdleMomentTimer()
  playMoment(AI_MASCOT_PET_ROWS.failed, {
    duration: FAILED_FRAME_DURATION,
    loops: 1,
    lockHover: true
  })
}

function handleResize() {
  position.value = clampPosition(position.value)
}

function updateReducedMotion() {
  reduceMotion.value = reducedMotionMedia?.matches === true
  if (reduceMotion.value) {
    clearIdleMomentTimer()
    clearMoment({ scheduleNext: false })
    frameIndex.value = 0
    return
  }

  scheduleIdleMoment()
}

function applySystemConfig(data = {}) {
  mascotConfig.value = normalizeAiMascotConfig(data?.aiMascot)
  const normalizedAgent = normalizeAiAgentConfig(data?.aiAgent)
  aiAgentEnabled.value = normalizedAgent.enabled
}

function requestSystemConfig() {
  ipcRenderer.send('getConfigByKey', {
    key: 'systemConfig.settings',
    replyName: 'get-ai-mascot-system-config'
  })
}

function handleMascotConfigChange(event) {
  mascotConfig.value = normalizeAiMascotConfig(event?.detail)
}

async function refreshCustomMascotPets() {
  try {
    const pets = await ipcRenderer.invoke('aiMascot:listCustomPets')
    customMascotPets.value = Array.isArray(pets) ? pets : []
  } catch (error) {
    console.error('读取自定义桌宠失败:', error)
  }
}

function handleMascotPetsChange(event) {
  customMascotPets.value = Array.isArray(event?.detail) ? event.detail : []
}

useIpc('get-ai-mascot-system-config', applySystemConfig)
useIpc('update-system-config', requestSystemConfig)

onMounted(() => {
  requestSystemConfig()
  refreshCustomMascotPets()
  aiAssistantStore.refreshRuntimeStatus()
  window.addEventListener('vertex-ai-mascot-config-change', handleMascotConfigChange)
  window.addEventListener('vertex-ai-mascot-pets-change', handleMascotPetsChange)
  window.addEventListener('resize', handleResize)

  reducedMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
  updateReducedMotion()
  reducedMotionMedia?.addEventListener?.('change', updateReducedMotion)
  startAnimation()
  scheduleIdleMoment()
})

onUnmounted(() => {
  stopAnimation()
  clearIdleMomentTimer()
  window.removeEventListener('vertex-ai-mascot-config-change', handleMascotConfigChange)
  window.removeEventListener('vertex-ai-mascot-pets-change', handleMascotPetsChange)
  window.removeEventListener('resize', handleResize)
  reducedMotionMedia?.removeEventListener?.('change', updateReducedMotion)
})

watch(isVisible, async (visible) => {
  if (!visible) return
  await nextTick()
  position.value = clampPosition(position.value)
})

watch(
  () => selectedPet.value?.id,
  () => {
    clearMoment({ scheduleNext: false })
    frameIndex.value = 0
    scheduleIdleMoment()
  }
)

watch(activeRow, () => {
  frameIndex.value = 0
  lastFrameAt = 0
  if (!shouldPlayMoment.value) {
    momentFrameProgress = 0
  }
})
</script>

<template>
  <aside
    v-if="isVisible"
    ref="mascotRef"
    class="ai-agent-mascot"
    :class="{ 'is-dragging': isDragging }"
    :style="mascotStyle"
    role="button"
    tabindex="0"
    :title="mascotTitle"
    :aria-label="$t('ui.valueAIModAssistant', { value1: (selectedPet.displayName) })"
    @pointerdown="handlePointerDown"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
    @pointermove="handlePointerMove"
    @pointerup="endDragging"
    @pointercancel="endDragging"
    @keydown="handleKeydown"
    @dblclick="handleDoubleClick"
    @contextmenu="handleContextMenu"
  >
    <div class="ai-agent-mascot__sprite"></div>
    <span class="ai-agent-mascot__status" :class="mascotStatusClass"></span>
    <span v-if="pendingCount > 0" class="ai-agent-mascot__badge">
      {{ pendingCount > 9 ? '9+' : pendingCount }}
    </span>
  </aside>
</template>

<style scoped lang="scss">
.ai-agent-mascot {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 930;
  width: var(--mascot-frame-width);
  height: var(--mascot-frame-height);
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  cursor: grab;
  filter: drop-shadow(0 10px 18px rgba(15, 23, 42, 0.14));
  transform: translate3d(var(--mascot-x), var(--mascot-y), 0);

  &:focus-visible {
    outline: 3px solid rgba(37, 99, 235, 0.25);
    outline-offset: 2px;
  }
}

.ai-agent-mascot.is-dragging {
  cursor: grabbing;
}

.ai-agent-mascot__sprite {
  width: 100%;
  height: 100%;
  background-image: var(--mascot-spritesheet);
  background-repeat: no-repeat;
  background-size: calc(var(--mascot-frame-width) * var(--mascot-columns))
    calc(var(--mascot-frame-height) * var(--mascot-rows));
  background-position: var(--mascot-bg-x) var(--mascot-bg-y);
  image-rendering: auto;
}

.ai-agent-mascot__status {
  position: absolute;
  right: 10px;
  bottom: 12px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f59e0b;
  border: 2px solid #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);

  &.is-ready {
    background: #22c55e;
  }

  &.is-processing {
    background: #2563eb;
    animation: mascot-status-pulse 1s ease-in-out infinite;
  }
}

.ai-agent-mascot__badge {
  position: absolute;
  top: 10px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #2563eb;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.28);
}

@keyframes mascot-status-pulse {
  0%,
  100% {
    transform: scale(0.9);
    opacity: 0.72;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-agent-mascot__status.is-processing {
    animation: none;
  }
}
</style>
