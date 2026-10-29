<script setup>
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxDialogActions from '@renderer/component/vertex-ui/VxDialogActions.vue'

defineProps({
  open: {
    type: Boolean,
    default: false
  },
  confirmLoading: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    default: ''
  },
  maxLength: {
    type: Number,
    default: 32
  }
})

const emit = defineEmits(['close', 'confirm', 'update:name'])

function handleUpdateOpen(value) {
  if (!value) emit('close')
}
</script>

<template>
  <VxModal
    :model-value="open"
    :title="$t('ui.createModProfile')"
    :width="480"
    @update:model-value="handleUpdateOpen"
  >
    <div class="create-profile-modal">
      <div class="row">
        <span class="label">{{ $t('dialogs.configUpload.name') }}</span>
        <input
          class="name-input"
          :value="name"
          :maxlength="maxLength"
          :placeholder="$t('ui.forExampleMultiplayerSinglePlayerTest')"
          @input="(e) => emit('update:name', e.target.value)"
        />
      </div>
      <div class="hint">
        {{ $t('ui.profilesKeepModsShareCodesAndLaunchArgumentsSeparateNames') }}
      </div>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="$t('ui.cancel')"
        :confirm-text="$t('ui.create')"
        :confirm-loading="confirmLoading"
        @cancel="emit('close')"
        @confirm="emit('confirm')"
      />
    </template>
  </VxModal>
</template>

<style scoped lang="scss">
.create-profile-modal {
  .row {
    margin-argin-bottom: 12px;
  }

  .label {
    display: block;
    margin-bottom: 6px;
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 500;
  }

  .name-input {
    width: 100%;
    min-height: var(--control-height-md);
    padding: 0 var(--control-padding-x);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--control-bg);
    color: var(--color-text);
    font: var(--font-weight-regular) var(--font-size-md) / var(--line-height-base)
      var(--font-family-base);
    outline: none;
    transition:
      background var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);

    &::placeholder {
      color: var(--color-placeholder);
    }

    &:hover:not(:disabled) {
      background: var(--control-bg-hover);
      border-color: var(--color-border-strong);
    }

    &:focus {
      border-color: var(--color-accent);
      box-shadow: var(--control-shadow), var(--focus-ring);
    }
  }

  .hint {
    margin-top: 8px;
    color: var(--color-text-muted);
    font-size: 12px;
  }
}
</style>
