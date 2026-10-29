<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({
  src: { type: String, default: '' },
  fallbacks: { type: Array, default: () => [] },
  loading: { type: String, default: 'lazy' },
  name: { type: String, default: '' }
})
const failed = ref([])
const sources = computed(() =>
  [...new Set([props.src, ...props.fallbacks])].filter(
    (url) => typeof url === 'string' && /^https?:\/\//i.test(url)
  )
)
const source = computed(() => sources.value.find((url) => !failed.value.includes(url)))
watch(
  () => sources.value.join('\n'),
  () => {
    failed.value = []
  }
)
function imageFailed(event) {
  failed.value = [...failed.value, event.target.getAttribute('src')]
}
</script>
<template>
  <span class="dlss-art" aria-hidden="true">
    <img v-if="source" :key="source" :src="source" alt="" :loading="loading" @error="imageFailed" />
    <span v-else class="dlss-art-fallback">{{ name.slice(0, 2).toUpperCase() || 'DL' }}</span>
  </span>
</template>
<style scoped>
.dlss-art {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--color-surface-strong);
  color: var(--color-text-secondary);
}
.dlss-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dlss-art-fallback {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.02em;
}
</style>
