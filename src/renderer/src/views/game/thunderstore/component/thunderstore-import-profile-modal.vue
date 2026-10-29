<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false
  },
  confirmLoading: {
    type: Boolean,
    default: false
  },
  code: {
    type: String,
    default: ''
  },
  activeProfileName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'confirm', 'update:code'])
</script>

<template>
  <a-modal
    :open="open"
    :title="$t('ui.readShareCode')"
    :z-index="1010"
    :confirm-loading="confirmLoading"
    :ok-text="$t('ui.startInstallation')"
    :cancel-text="$t('ui.cancel')"
    @ok="emit('confirm')"
    @cancel="emit('close')"
    @update:open="(value) => !value && emit('close')"
  >
    <div class="version-modal">
      <div class="row">
        <span class="label">{{ $t('ui.shareCode') }}</span>
        <a-textarea
          :value="code"
          :rows="4"
          :placeholder="$t('ui.enterAVertexShareCode')"
          @update:value="(value) => emit('update:code', value)"
        />
      </div>
      <div class="hint">{{ $t('ui.addTheThunderstoreModsInThisShareCodeToInstallation') }}{{ activeProfileName }}。</div>
    </div>
  </a-modal>
</template>

<style scoped lang="scss">
.version-modal {
  .row {
    margin-bottom: 12px;
  }

  .label {
    display: block;
    margin-bottom: 6px;
    color: #334155;
    font-size: 13px;
  }

  .hint {
    margin-top: 8px;
    color: #64748b;
    font-size: 12px;
  }
}
</style>
