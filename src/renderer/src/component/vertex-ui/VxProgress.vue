<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  tone: { type: String, default: 'primary' }
})

const normalizedValue = computed(() => Math.max(0, Math.min(100, Number(props.value) || 0)))
</script>

<template>
  <div
    class="vx-progress"
    :class="`vx-progress-${tone}`"
    role="progressbar"
    :aria-valuenow="normalizedValue"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <span :style="{ width: `${normalizedValue}%` }"></span>
  </div>
</template>

<style scoped lang="scss">
.vx-progress {
  width: min(420px, 100%);
  height: 8px;
  overflow: hidden;
  background: var(--color-surface-strong);
  border-radius: var(--radius-pill);
}

.vx-progress span {
  display: block;
  height: 100%;
  background: var(--color-accent);
  border-radius: inherit;
  transition: width var(--duration-base) var(--ease-standard);
}

.vx-progress-success span {
  background: var(--color-success);
}

.vx-progress-warning span {
  background: var(--color-warning);
}

.vx-progress-danger span {
  background: var(--color-danger);
}
</style>
