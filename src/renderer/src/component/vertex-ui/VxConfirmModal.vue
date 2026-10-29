<script setup>
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import VxDialogActions from './VxDialogActions.vue'
import VxModal from './VxModal.vue'

const { t } = useI18n()
const props = defineProps({
  // Async writes use this callback; the legacy confirm event remains for synchronous choices.
  confirmAction: { type: Function, default: null },
  confirmLoading: { type: Boolean, default: false },
  confirmDisabled: { type: Boolean, default: false },
  modelValue: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  subtitle: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    default: ''
  },
  // 兼容现有确认调用：description 表达操作正文，不作为头部副标题。
  description: {
    type: String,
    default: ''
  },
  confirmText: {
    type: String,
    default: ''
  },
  cancelText: {
    type: String,
    default: ''
  },
  danger: {
    type: Boolean,
    default: false
  },
  actions: {
    type: Array,
    default: () => []
  },
  showCancel: {
    type: Boolean,
    default: true
  },
  closeOnOverlay: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel', 'close', 'action'])

const confirmVariant = computed(() => (props.danger ? 'danger' : 'primary'))
const submitting = ref(false)
const failure = ref('')
const busy = computed(() => submitting.value || props.confirmLoading)
let revision = 0
watch(
  () => props.modelValue,
  () => {
    revision++
    failure.value = ''
  }
)
onBeforeUnmount(() => {
  revision++
})

function closeDialog() {
  if (busy.value) return
  emit('update:modelValue', false)
  emit('close')
}

function handleCancel() {
  if (busy.value) return
  emit('cancel')
  closeDialog()
}

async function handleConfirm() {
  if (busy.value || props.confirmDisabled) return
  if (!props.confirmAction) {
    emit('confirm')
    closeDialog()
    return
  }
  const current = revision
  submitting.value = true
  failure.value = ''
  try {
    const result = await props.confirmAction()
    if (result === false || result?.success === false)
      throw new Error(result?.message || t('ui.operationIncomplete'))
    if (current === revision && props.modelValue) {
      emit('update:modelValue', false)
      emit('close')
    }
  } catch (error) {
    if (current === revision && props.modelValue)
      failure.value = error?.message || t('ui.operationFailed')
  } finally {
    submitting.value = false
  }
}

function handleAction(action) {
  if (busy.value) return
  emit('action', action)
  if (action?.closeOnClick !== false) {
    closeDialog()
  }
}
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    :content="content || description"
    :close-on-overlay="closeOnOverlay && !busy"
    :close-on-esc="!busy"
    :show-close="!busy"
    layer="confirm"
    @update:model-value="!busy && emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <slot></slot>

    <template #footer>
      <p v-if="failure" class="vx-confirm-error" role="alert">{{ failure }}</p>
      <VxDialogActions
        :cancel-text="cancelText"
        :confirm-text="confirmText"
        :confirm-variant="confirmVariant"
        :show-cancel="showCancel"
        :actions="actions.map((action) => ({ ...action, disabled: busy || action.disabled }))"
        :confirm-loading="busy"
        :confirm-disabled="confirmDisabled || busy"
        :cancel-disabled="busy"
        @cancel="handleCancel"
        @confirm="handleConfirm"
        @action="handleAction"
      />
    </template>
  </VxModal>
</template>

<style scoped>
.vx-confirm-error {
  flex-basis: 100%;
  color: var(--color-danger);
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
