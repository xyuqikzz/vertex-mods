<script setup>
import { useId } from 'vue'

// 设置组：组标题（可带数量或右侧操作）+ 白色面板，面板内放 SettingRow。
defineProps({
  title: { type: String, default: '' },
  meta: { type: String, default: '' },
  plain: { type: Boolean, default: false }
})

const headingId = useId()
</script>

<template>
  <section class="setting-group" :aria-labelledby="title ? headingId : undefined">
    <header v-if="title || meta || $slots.actions" class="setting-group__head">
      <h2 v-if="title" :id="headingId" class="setting-group__title">{{ title }}</h2>
      <div class="setting-group__aside">
        <span v-if="meta" class="setting-group__meta">{{ meta }}</span>
        <slot name="actions"></slot>
      </div>
    </header>
    <div v-if="plain" class="setting-group__plain"><slot></slot></div>
    <div v-else class="setting-group__panel"><slot></slot></div>
  </section>
</template>
