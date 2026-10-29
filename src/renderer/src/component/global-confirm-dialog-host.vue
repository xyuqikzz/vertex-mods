<script setup>
import { computed, defineComponent, h } from 'vue'
import ClientConfirmDialog from '@views/game/component/modManagement/ClientConfirmDialog.vue'
import {
  confirmDialogContent,
  confirmDialogContentKind,
  confirmDialogState,
  handleCancelAction,
  handleConfirmAction
} from '@renderer/common/confirm-dialog.js'

const ConfirmDialogContent = defineComponent({
  name: 'ConfirmDialogContent',
  props: {
    kind: {
      type: String,
      default: 'text'
    },
    content: {
      type: [String, Number, Array, Object, Function],
      default: null
    }
  },
  setup(props) {
    return () => {
      if (props.kind === 'render' && typeof props.content === 'function') {
        return props.content()
      }

      if (props.kind === 'vnode') {
        return props.content
      }

      const text = String(props.content ?? '').trim()
      if (!text) return null

      return h('div', { class: 'global-confirm-dialog-host__text' }, text)
    }
  }
})

const hasContent = computed(() => {
  if (confirmDialogContentKind.value === 'render' || confirmDialogContentKind.value === 'vnode') {
    return Boolean(confirmDialogContent.value)
  }
  return String(confirmDialogContent.value ?? '').trim().length > 0
})
</script>

<template>
  <ClientConfirmDialog
    :open="confirmDialogState.open"
    :title="confirmDialogState.title"
    :subtitle="confirmDialogState.subtitle"
    :description="confirmDialogState.description"
    :tone="confirmDialogState.tone"
    :tone-label="confirmDialogState.toneLabel"
    :confirm-text="confirmDialogState.confirmText"
    :cancel-text="confirmDialogState.cancelText"
    :show-cancel="confirmDialogState.showCancel"
    :loading="confirmDialogState.loading"
    :disabled="confirmDialogState.disabled"
    :close-on-mask="confirmDialogState.closeOnMask"
    :focus-action="confirmDialogState.focusAction"
    :details="confirmDialogState.details"
    :impacts="confirmDialogState.impacts"
    :tags="confirmDialogState.tags"
    :width="confirmDialogState.width"
    :show-icon="confirmDialogState.showIcon"
    @confirm="handleConfirmAction"
    @cancel="handleCancelAction"
  >
    <ConfirmDialogContent
      v-if="hasContent"
      :kind="confirmDialogContentKind"
      :content="confirmDialogContent"
    />
  </ClientConfirmDialog>
</template>

<style scoped lang="scss">
.global-confirm-dialog-host__text {
  color: var(--color-text-muted);
  line-height: var(--line-height-base);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
