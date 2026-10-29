<script setup>
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxDialogActions from '@renderer/component/vertex-ui/VxDialogActions.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  code: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: undefined
  },
  placeholder: {
    type: String,
    default: undefined
  },
  hint: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  confirmText: {
    type: String,
    default: undefined
  }
})

const emit = defineEmits(['update:code', 'update:open', 'confirm', 'cancel'])

function updateCode(event) {
  emit('update:code', String(event?.target?.value || '').trim())
}

function handleCancel() {
  emit('cancel')
  emit('update:open', false)
}
</script>

<template>
  <VxModal
    :model-value="open"
    :title="(title ?? $t('ui.importShareCode'))"
    :close-on-overlay="!loading"
    :width="420"
    @update:model-value="(val) => !val && handleCancel()"
  >
    <div class="source-share-code-modal">
      <label class="field">
        <span class="label">{{ $t('ui.shareCode') }}</span>
        <input
          class="input"
          :value="props.code"
          :placeholder="(placeholder ?? $t('ui.enterAVertexShareCode'))"
          :disabled="loading"
          @input="updateCode"
          @keydown.enter="String(props.code || '').trim() && emit('confirm')"
        />
      </label>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="$t('ui.cancel')"
        :confirm-text="(confirmText ?? $t('ui.import'))"
        :confirm-disabled="!String(props.code || '').trim()"
        :confirm-loading="loading"
        @cancel="handleCancel"
        @confirm="emit('confirm')"
      />
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
.source-share-code-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: 14px;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:focus {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: not-allowed;
    background: var(--control-bg-disabled);
    color: var(--color-text-subtle);
  }
}

.hint {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>
