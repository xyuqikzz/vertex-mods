<script setup>
// 设置行：左侧名称 + 说明，右侧控件；stack 时控件放到文字下方并占满宽度。
defineProps({
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  stack: { type: Boolean, default: false },
  labelFor: { type: String, default: '' }
})
</script>

<template>
  <div class="setting-row" :class="{ 'is-stack': stack }">
    <div
      v-if="label || $slots.label || description || $slots.description"
      class="setting-row__text"
    >
      <component
        :is="labelFor ? 'label' : 'div'"
        v-if="label || $slots.label"
        class="setting-row__label"
        :for="labelFor || undefined"
      >
        <slot name="label">{{ label }}</slot>
      </component>
      <div v-if="description || $slots.description" class="setting-row__description">
        <slot name="description">{{ description }}</slot>
      </div>
    </div>
    <div v-if="$slots.default" class="setting-row__control">
      <slot></slot>
    </div>
  </div>
</template>
