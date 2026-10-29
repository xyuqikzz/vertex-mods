<script setup>
import { computed, ref, watch } from 'vue'
import { useDisplayImage } from '@renderer/composables/useDisplayImage.js'

// 游戏封面：同一张图解析一次，前景完整显示原图，背景用同一地址模糊铺满画框，
// 横版、竖版封面都不再出现黑边。加载逻辑与 AppImage 保持一致（社区图片走代理）。
const props = defineProps({
  src: { type: String, default: '' },
  fallbackSrcs: { type: Array, default: () => [] },
  alt: { type: String, default: '' },
  loading: { type: String, default: 'lazy' },
  fallbackText: { type: String, default: '' },
  // initials：小尺寸缩略图显示首字；name：大封面显示完整名称，避免大块空白只剩两个字母。
  fallbackMode: { type: String, default: 'initials' },
  // contain：始终完整显示原图，空白处用模糊背景补齐；
  // auto：原图比例与画框接近时直接铺满（不模糊），差距大时退回 contain。
  fit: { type: String, default: 'contain' }
})

// 宽高比相差在这个比例内就直接铺满，裁掉的边缘不超过约 9%。
const FILL_RATIO_TOLERANCE = 0.18

const sources = computed(() => [...new Set(
  [props.src, ...props.fallbackSrcs].map(src => String(src || '').trim()).filter(Boolean)
)])
const sourceIndex = ref(0)
const currentSrc = computed(() => sources.value[sourceIndex.value] || '')
watch(sources, () => { sourceIndex.value = 0 }, { flush: 'sync' })

const { host, resolvedSrc, isLoaded, isError, onLoad, onError } = useDisplayImage({
  get src() { return currentSrc.value },
  get loading() { return props.loading }
})

// 等当前地址的缩略图、原图或代理请求均失败后再切换；继续复用懒加载和取消机制。
watch(isError, failed => {
  if (failed && sourceIndex.value < sources.value.length - 1) sourceIndex.value += 1
})

const initials = computed(
  () =>
    Array.from(String(props.fallbackText || '').trim())
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
)
const showFallback = computed(() => !currentSrc.value || isError.value)

const fillsFrame = ref(false)
watch(resolvedSrc, () => {
  fillsFrame.value = false
})

function handleArtLoad(event) {
  onLoad(event)
  if (props.fit !== 'auto') return
  const image = event?.target
  const frame = host.value
  if (
    !image?.naturalWidth ||
    !image?.naturalHeight ||
    !frame?.clientWidth ||
    !frame?.clientHeight
  ) {
    return
  }
  const imageRatio = image.naturalWidth / image.naturalHeight
  const frameRatio = frame.clientWidth / frame.clientHeight
  fillsFrame.value = Math.abs(imageRatio / frameRatio - 1) <= FILL_RATIO_TOLERANCE
}

</script>

<template>
  <span
    ref="host"
    class="game-cover"
    :class="{ 'is-loaded': isLoaded, 'is-fallback': showFallback, 'is-fill': fillsFrame }"
  >
    <template v-if="resolvedSrc && !isError">
      <img class="game-cover__ambient" :src="resolvedSrc" alt="" aria-hidden="true" decoding="async" />
      <img
        :key="resolvedSrc"
        class="game-cover__art"
        :src="resolvedSrc"
        :alt="alt"
        decoding="async"
        @load="handleArtLoad"
        @error="onError"
      />
    </template>
    <span
      v-if="showFallback && fallbackMode === 'name' && fallbackText"
      class="game-cover__fallback is-name"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24">
        <path d="M6 9h4M8 7v4M15 10h.01M18 8h.01" />
        <path
          d="M7.5 4h9A5.5 5.5 0 0 1 22 9.5v3A5.5 5.5 0 0 1 16.5 18c-1.6 0-2.4-2-4.5-2s-2.9 2-4.5 2A5.5 5.5 0 0 1 2 12.5v-3A5.5 5.5 0 0 1 7.5 4z"
        />
      </svg>
      <span>{{ fallbackText }}</span>
    </span>
    <span v-else-if="showFallback" class="game-cover__fallback" aria-hidden="true">{{
      initials
    }}</span>
  </span>
</template>

<style scoped lang="scss">
.game-cover {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-text);
  isolation: isolate;
}

.game-cover__ambient,
.game-cover__art {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-standard);
}

.game-cover__ambient {
  z-index: 0;
  object-fit: cover;
  filter: blur(22px) saturate(1.25);
  transform: scale(1.25);
}

.game-cover__art {
  z-index: 1;
  object-fit: contain;
  object-position: center;
}

.game-cover.is-loaded {
  .game-cover__ambient {
    opacity: 0.6;
  }

  .game-cover__art {
    opacity: 1;
  }
}

.game-cover.is-fill {
  .game-cover__ambient {
    display: none;
  }

  .game-cover__art {
    object-fit: cover;
  }
}

.game-cover.is-fallback {
  background: var(--color-surface-strong);
}

.game-cover__fallback.is-name {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.4;
  text-align: center;

  svg {
    flex: none;
    width: 28px;
    height: 28px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.7;
  }

  span {
    display: -webkit-box;
    max-width: 100%;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}

.game-cover__fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
}
</style>
