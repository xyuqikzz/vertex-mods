<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxDialogActions, VxModal } from '@renderer/component/vertex-ui'
import ToolIcon from '@renderer/component/tool-page/ToolIcon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  value: { type: String, default: '' },
  loggedIn: { type: Boolean, default: false },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'update:value', 'save'])

const { t } = useI18n()

const trimmedValue = computed(() => String(props.value || '').trim())
// 已登录时留空保存 = 清除 Cookie。
const willClear = computed(() => props.loggedIn && !trimmedValue.value)
const confirmText = computed(() =>
  willClear.value ? t('dialogs.vamCookie.clear') : t('dialogs.vamCookie.save')
)

function close() {
  if (props.saving) return
  emit('update:open', false)
}
</script>

<template>
  <VxModal
    :model-value="open"
    :title="t('dialogs.vamCookie.title')"
    :width="520"
    @update:model-value="(value) => !value && close()"
  >
    <div class="vam-cookie">
      <p class="vam-cookie__status">
        {{ t('dialogs.vamCookie.status') }}
        <span class="vam-cookie__chip" :class="{ 'is-on': loggedIn }">
          <span class="vam-cookie__dot" aria-hidden="true"></span>
          {{ loggedIn ? t('dialogs.vamCookie.signedIn') : t('dialogs.vamCookie.notSet') }}
        </span>
      </p>
      <p class="vam-cookie__lead">{{ t('dialogs.vamCookie.lead') }}</p>
      <div class="vam-cookie__field">
        <label for="vam-cookie-input" class="vam-cookie__label">Cookie</label>
        <textarea
          id="vam-cookie-input"
          class="vam-cookie__input vx-ui-scrollbar"
          rows="5"
          spellcheck="false"
          autocomplete="off"
          placeholder="vamhub_session=…; xf_user=…"
          :value="value"
          :disabled="saving"
          aria-describedby="vam-cookie-hint"
          @input="emit('update:value', $event.target.value)"
        ></textarea>
        <span id="vam-cookie-hint" class="vam-cookie__hint">
          {{ loggedIn ? t('dialogs.vamCookie.clearHint') : t('dialogs.vamCookie.emptyHint') }}
        </span>
      </div>
      <p class="vam-cookie__warning">
        <ToolIcon name="warning" :size="15" />
        <span>{{ t('dialogs.vamCookie.warning') }}</span>
      </p>
    </div>

    <template #footer>
      <VxDialogActions
        :cancel-text="t('dialogs.cancel')"
        :confirm-text="confirmText"
        :confirm-variant="willClear ? 'danger' : 'primary'"
        :confirm-disabled="!loggedIn && !trimmedValue"
        :confirm-loading="saving"
        :cancel-disabled="saving"
        @cancel="close"
        @confirm="emit('save')"
      />
    </template>
  </VxModal>
</template>

<style scoped>
.vam-cookie {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.vam-cookie__status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--color-text-tertiary, #5d6779);
  font-size: 13px;
}

.vam-cookie__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--color-surface-hover, #f1f4f8);
  color: var(--color-text-tertiary, #5d6779);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.vam-cookie__chip.is-on {
  background: var(--color-success-soft, #dcfce7);
  color: var(--color-success-strong, #15803d);
}

.vam-cookie__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-subtle, #98a2b3);
}

.vam-cookie__chip.is-on .vam-cookie__dot {
  background: var(--color-success, #16a34a);
}

.vam-cookie__lead {
  margin: 0;
  color: var(--color-text-secondary, #344054);
  font-size: 13.5px;
  line-height: 1.7;
}

.vam-cookie__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vam-cookie__label {
  color: var(--color-text-secondary, #344054);
  font-size: 13px;
  font-weight: 600;
}

.vam-cookie__input {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border-strong, #c4ceda);
  border-radius: var(--radius-md, 8px);
  background: var(--control-bg, #ffffff);
  color: var(--color-text, #151922);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  resize: vertical;
  word-break: break-all;
}

.vam-cookie__input::placeholder {
  color: var(--color-placeholder, #667085);
}

.vam-cookie__input:focus {
  outline: none;
  border-color: var(--color-accent, #0a96ff);
  box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
}

.vam-cookie__hint {
  color: var(--color-text-muted, #667085);
  font-size: 12.5px;
}

.vam-cookie__warning {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #f2d6a5;
  border-radius: 10px;
  background: #fffaf0;
  color: #7a3d06;
  font-size: 12.5px;
  line-height: 1.55;
}

.vam-cookie__warning :deep(svg) {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--color-warning-strong, #b45309);
}
</style>
