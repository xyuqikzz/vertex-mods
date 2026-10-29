<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import VxDialogActions from '@renderer/component/vertex-ui/VxDialogActions.vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxTag from '@renderer/component/vertex-ui/VxTag.vue'

const DEFAULT_DIALOG_WIDTH = 520

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  description: { type: String, default: '' },
  tone: { type: String, default: 'default' },
  toneLabel: { type: String, default: '' },
  confirmText: { type: String, default: undefined },
  cancelText: { type: String, default: undefined },
  showCancel: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  error: { type: String, default: '' },
  closeOnMask: { type: Boolean, default: true },
  focusAction: { type: String, default: '' },
  width: { type: [Number, String], default: 520 },
  showIcon: { type: Boolean, default: true },
  details: {
    type: Array,
    default: () => []
  },
  impacts: {
    type: Array,
    default: () => []
  },
  tags: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['confirm', 'cancel', 'close'])
const shellRef = ref(null)

const panelStyle = computed(() => {
  const width = typeof props.width === 'number' ? Number(props.width) : props.width
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return { '--client-confirm-width': `${Math.round(width)}px` }
  }

  const resolvedWidth = String(width || '').trim()
  const parsedWidth = Number.parseInt(resolvedWidth, 10)
  const normalizedWidth =
    Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : DEFAULT_DIALOG_WIDTH
  return { '--client-confirm-width': `${normalizedWidth}px` }
})

const resolvedTone = computed(() => {
  const tone = String(props.tone || 'default').trim()
  if (tone === 'danger' || tone === 'warning' || tone === 'success') {
    return tone
  }
  return 'default'
})

const resolvedFocusAction = computed(() => {
  const action = String(props.focusAction || '').trim()
  if (action === 'confirm' || action === 'cancel') {
    return action
  }
  return resolvedTone.value === 'danger' && props.showCancel ? 'cancel' : 'confirm'
})

const visibleDetails = computed(() =>
  (Array.isArray(props.details) ? props.details : []).filter(
    (item) => String(item?.label || '').trim() && String(item?.value || '').trim()
  )
)

const visibleTags = computed(() =>
  (Array.isArray(props.tags) ? props.tags : []).filter((item) => String(item?.text || '').trim())
)

const modalDescription = computed(() => props.subtitle || props.description || '')
const confirmVariant = computed(() => (resolvedTone.value === 'danger' ? 'danger' : 'primary'))
const modalVisible = computed(() => Boolean(props.open))

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    const panel = shellRef.value
    const selector =
      resolvedFocusAction.value === 'cancel'
        ? '.vx-dialog-actions__left .vx-button'
        : '.vx-dialog-actions__right .vx-button:last-child'
    panel?.querySelector?.(selector)?.focus?.()
  }
)

function handleCancel() {
  if (props.loading) return
  emit('cancel')
  emit('close')
}

function handleConfirm() {
  if (props.loading || props.disabled) return
  emit('confirm')
}

function handleModalUpdate(value) {
  if (value || props.loading) return
  handleCancel()
}
</script>

<template>
  <VxModal
    :model-value="modalVisible"
    :plain="true"
    :aria-label="title || $t('ui.confirmAction')"
    :close-on-overlay="closeOnMask && !loading"
    :close-on-esc="!loading"
    :show-close="false"
    layer="confirm"
    @update:model-value="handleModalUpdate"
  >
    <section
      ref="shellRef"
      class="client-confirm-shell"
      :class="`is-${resolvedTone}`"
      :style="panelStyle"
    >
      <header class="client-confirm__header">
        <div
          v-if="showIcon"
          class="client-confirm__icon"
          :class="`is-${resolvedTone}`"
          aria-hidden="true"
        >
          <svg
            v-if="resolvedTone === 'danger'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 8v5" />
            <path d="M12 17h.01" />
            <path
              d="M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"
            />
          </svg>
          <svg
            v-else-if="resolvedTone === 'warning'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <svg
            v-else-if="resolvedTone === 'success'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m7.5 12.5 3 3 6-7" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>

        <div class="client-confirm__heading">
          <h3>{{ title || $t('ui.confirmAction') }}</h3>
          <p v-if="error" role="alert" style="color: var(--color-danger)">{{ error }}</p>
          <p v-if="modalDescription">{{ modalDescription }}</p>
          <p v-if="subtitle && description" class="client-confirm__secondary-copy">
            {{ description }}
          </p>
          <div v-if="toneLabel || visibleTags.length" class="client-confirm__tags">
            <VxTag
              v-if="toneLabel"
              size="sm"
              :tone="resolvedTone === 'default' ? 'info' : resolvedTone"
            >
              {{ toneLabel }}
            </VxTag>
            <VxTag
              v-for="tag in visibleTags"
              :key="`${tag.text}-${tag.tone || 'default'}`"
              size="sm"
              :tone="tag.tone || 'default'"
            >
              {{ tag.text }}
            </VxTag>
          </div>
        </div>
      </header>

      <div
        v-if="visibleDetails.length || $slots.default"
        class="client-confirm__body vx-ui-scrollbar"
      >
        <div v-if="visibleDetails.length" class="client-confirm__section">
          <div class="client-confirm__section-title">{{ $t('ui.itemsAffectedByThisOperation') }}</div>
          <div class="client-confirm__detail-grid">
            <div
              v-for="item in visibleDetails"
              :key="`${item.label}-${item.value}`"
              class="client-confirm__detail-card"
            >
              <span class="client-confirm__detail-label">{{ item.label }}</span>
              <strong class="client-confirm__detail-value">{{ item.value }}</strong>
            </div>
          </div>
        </div>

        <div v-if="$slots.default" class="client-confirm__section client-confirm__slot">
          <slot />
        </div>
      </div>

      <footer class="client-confirm__footer">
        <VxDialogActions
          :cancel-text="(cancelText ?? $t('ui.cancel'))"
          :confirm-text="loading ? $t('ui.processing') : (confirmText ?? $t('ui.confirm'))"
          :show-cancel="showCancel"
          :cancel-disabled="loading"
          :confirm-disabled="loading || disabled"
          :confirm-loading="loading"
          :confirm-variant="confirmVariant"
          @cancel="handleCancel"
          @confirm="handleConfirm"
        />
      </footer>
    </section>
  </VxModal>
</template>

<style scoped lang="scss">
.client-confirm-shell {
  width: min(var(--client-confirm-width, 520px), calc(100vw - 48px));
  min-width: min(520px, calc(100vw - 48px));
  max-height: min(78vh, 620px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  color: var(--color-text);
}

.client-confirm__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-5) var(--space-5) var(--space-4);
}

.client-confirm__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border: 1px solid color-mix(in srgb, var(--color-accent) 22%, var(--color-border) 78%);
  flex: 0 0 auto;
}

.client-confirm__icon.is-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: color-mix(in srgb, var(--color-danger) 22%, var(--color-border) 78%);
}

.client-confirm__icon.is-warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-color: color-mix(in srgb, var(--color-warning) 24%, var(--color-border) 76%);
}

.client-confirm__icon.is-success {
  color: var(--color-success);
  background: var(--color-success-soft);
  border-color: color-mix(in srgb, var(--color-success) 22%, var(--color-border) 78%);
}

.client-confirm__heading {
  min-width: 0;
  display: grid;
  gap: var(--space-2);
}

.client-confirm__heading h3 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}

.client-confirm__heading p,
.client-confirm__secondary-copy {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.client-confirm__secondary-copy {
  color: var(--color-text-secondary);
}

.client-confirm__body {
  min-height: 0;
  display: grid;
  gap: var(--space-4);
  padding: 0 var(--space-5) var(--space-4);
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.client-confirm__section {
  display: grid;
  gap: var(--space-2);
}

.client-confirm__section-title {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.client-confirm__tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.client-confirm__detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.client-confirm__detail-card {
  min-height: 54px;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
}

.client-confirm__detail-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.client-confirm__detail-value {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-base);
  word-break: break-word;
}

.client-confirm__footer {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

@media (max-width: 560px) {
  .client-confirm__detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
