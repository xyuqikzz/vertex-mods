<script setup>
import VxButton from './VxButton.vue'

defineProps({
  cancelText: { type: String, default: '' },
  confirmText: { type: String, default: '' },
  confirmVariant: { type: String, default: 'primary' },
  showCancel: { type: Boolean, default: true },
  showConfirm: { type: Boolean, default: true },
  cancelDisabled: { type: Boolean, default: false },
  confirmDisabled: { type: Boolean, default: false },
  confirmLoading: { type: Boolean, default: false },
  size: { type: String, default: 'md' },
  actions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['cancel', 'confirm', 'action'])

function handleAction(action) {
  if (action?.disabled || action?.loading) return
  emit('action', action)
}
</script>

<template>
  <div class="vx-dialog-actions">
    <div class="vx-dialog-actions__left">
      <VxButton
        v-if="showCancel"
        variant="secondary"
        :size="size"
        :disabled="cancelDisabled"
        @click="emit('cancel')"
      >
        {{ cancelText || $t('ui.cancel') }}
      </VxButton>
    </div>

    <div class="vx-dialog-actions__right">
      <VxButton
        v-for="action in actions"
        :key="action.key || action.value || action.text || action.label"
        :variant="action.variant || 'secondary'"
        :size="action.size || size"
        :disabled="Boolean(action.disabled)"
        :loading="Boolean(action.loading)"
        @click="handleAction(action)"
      >
        {{ action.text || action.label }}
      </VxButton>

      <VxButton
        v-if="showConfirm"
        :variant="confirmVariant"
        :size="size"
        :disabled="confirmDisabled"
        :loading="confirmLoading"
        @click="emit('confirm')"
      >
        {{ confirmText || $t('ui.confirm') }}
      </VxButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.vx-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  flex-wrap: wrap;
}

.vx-dialog-actions__left,
.vx-dialog-actions__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.vx-dialog-actions__right {
  justify-content: flex-end;
  margin-left: auto;
}
</style>
