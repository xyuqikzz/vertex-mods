<script setup>
import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { toolServiceText as serviceText } from '@renderer/i18n/tool-service-text.js'
import { computed } from 'vue'
import { VxProgress } from '@renderer/component/vertex-ui'

const props = defineProps({ progress: { type: Object, required: true } })
const component = computed(() =>
  [props.progress.name, props.progress.version].filter(Boolean).join(' ')
)
const title = computed(() => {
  const phase = props.progress.phase
  if (phase === 'complete')
    return props.progress.kind === 'restore' ? tt('还原完成') : tt('安装完成，游戏内效果待验证')
  if (phase === 'failed')
    return props.progress.kind === 'restore'
      ? tt('还原失败，请查看错误提示')
      : tt('安装失败，请查看错误提示')
  return (
    {
      preparing: tt('正在准备安装…'),
      checking: tt("正在检查 {0}…", [component.value]),
      cached:
        props.progress.source === 'bundled'
          ? tt('正在使用安装包内置组件')
          : tt("正在使用缓存：{0}", [component.value]),
      downloading: tt("正在下载 {0}", [component.value]),
      verifying: tt("正在校验 {0}…", [component.value]),
      saved: tt("下载完成，已缓存：{0}", [component.value]),
      extracting: tt("正在解压 {0}…", [component.value]),
      ready: tt('组件准备完成'),
      installing: tt('正在安装组件…'),
      restoring: tt('正在还原原文件…'),
      fallback: tt('正在使用内置替代组件'),
      cancelled: tt('已取消安装')
    }[phase] || tt('正在处理…')
  )
})
const percent = computed(() =>
  props.progress.phase === 'downloading' && props.progress.total > 0
    ? Math.min(100, Math.floor((props.progress.received / props.progress.total) * 100))
    : null
)
function bytes(value) {
  const amount = Math.max(0, Number(value) || 0)
  if (amount < 1024) return `${Math.round(amount)} B`
  if (amount < 1048576) return `${(amount / 1024).toFixed(1)} KB`
  return `${(amount / 1048576).toFixed(1)} MB`
}
const summary = computed(() =>
  [
    props.progress.bundled ? tt('已使用内置组件') : '',
    props.progress.cached?.length ? tt("已复用 {0} 项缓存", [props.progress.cached.length]) : '',
    props.progress.phase === 'complete' && props.progress.downloaded?.length
      ? tt('下载组件已缓存，其他游戏可复用')
      : ''
  ]
    .filter(Boolean)
    .join(' · ')
)
</script>

<template>
  <section class="install-progress" :aria-label="tt('安装进度')" :data-phase="progress.phase">
    <div class="progress-heading">
      <strong role="status" aria-live="polite">{{ title }}</strong>
      <span v-if="percent !== null">{{ percent }}%</span>
    </div>
    <VxProgress v-if="percent !== null" :value="percent" :aria-label="tt('当前文件下载进度')" />
    <p v-if="progress.phase === 'downloading'" class="transfer-details">
      <span v-if="progress.fileCount > 1"
        >{{ tt("文件") }} {{ progress.fileIndex }} / {{ progress.fileCount }} ·
      </span>
      {{ bytes(progress.received)
      }}{{ progress.total > 0 ? ' / ' + bytes(progress.total) : tt(' · 总大小未知') }}
      <span v-if="progress.bytesPerSecond > 0"> {{ tt("· 平均") }} {{ bytes(progress.bytesPerSecond) }}/s</span>
    </p>
    <p v-if="summary" class="progress-summary">{{ summary }}</p>
    <p v-for="warning in progress.warnings" :key="warning" class="progress-warning">
      {{ serviceText(warning) }}
    </p>
  </section>
</template>

<style scoped lang="scss">
.install-progress {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  font-size: var(--font-size-sm);
  font-family: var(--font-family-base);
  color: var(--color-text-secondary);
}
.progress-heading {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  strong {
    font-weight: 600;
    color: var(--color-text);
  }
}
.install-progress :deep(.vx-progress) {
  width: 100%;
}
.install-progress p {
  margin: 0;
  overflow-wrap: anywhere;
}
.transfer-details {
  font-variant-numeric: tabular-nums;
}
.progress-warning {
  color: var(--color-warning);
}
</style>
