<script setup>
import { computed } from 'vue'

// 控制台页面内使用的线性图标，统一 24 网格与 1.6 描边，颜色继承 currentColor。
const ICONS = {
  folder: [
    'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'
  ],
  database: [
    'M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3z',
    'M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6',
    'M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6'
  ],
  archive: ['M3 5h18v4H3z', 'M5 9v10h14V9', 'M10 13h4'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 4 8 20', 'M16 4l-2 16'],
  code: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M13.5 5l-3 14'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  send: ['M4 12 20 4l-6 16-3-7z', 'M11 13l9-9'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  plus: ['M12 5v14', 'M5 12h14'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  alert: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8v5', 'M12 16h.01'],
  history: ['M12 7v5l3 2', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01']
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 }
})

const paths = computed(() => ICONS[props.name] || [])
</script>

<template>
  <svg
    class="dev-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>

<style scoped>
.dev-icon {
  display: block;
  flex: none;
}
</style>
