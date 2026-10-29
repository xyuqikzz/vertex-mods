<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUpOutlined, StopOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  processing: { type: Boolean, default: false },
  cancelling: { type: Boolean, default: false },
  canCancel: { type: Boolean, default: true },
  sessionId: { type: String, default: '' },
  submitAction: { type: Function, default: null },
  model: { type: String, default: '' },
  models: { type: Array, default: () => [] },
  modelLoading: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'cancel', 'update:model'])
const text = ref('')
const textareaRef = ref(null)
const submitting = ref(false)
const composing = ref(false)
const drafts = new Map()
const canSend = computed(() => !submitting.value && !props.processing && !props.disabled && Boolean(text.value.trim()))
watch(() => props.sessionId, (id, previous) => {
  drafts.set(previous, text.value)
  text.value = drafts.get(id) || ''
})
watch(text, async () => {
  await nextTick()
  if (!textareaRef.value) return
  textareaRef.value.style.height = 'auto'
  textareaRef.value.style.height = `${Math.min(126, textareaRef.value.scrollHeight)}px`
})
const modelOptions = computed(() => {
  const modelMap = new Map()
  props.models.forEach((item) => {
    const id = String(item?.id || item?.name || item || '').trim()
    if (!id || modelMap.has(id)) return
    modelMap.set(id, {
      id,
      name: String(item?.name || item?.id || id).trim() || id
    })
  })
  if (props.model && !modelMap.has(props.model)) {
    modelMap.set(props.model, {
      id: props.model,
      name: props.model
    })
  }
  return [...modelMap.values()]
})

async function send() {
  const value = text.value.trim()
  if (!value || !canSend.value || composing.value) return
  const sessionId = props.sessionId
  submitting.value = true
  const clearAcceptedDraft = () => {
    drafts.delete(sessionId)
    if (props.sessionId === sessionId && text.value.trim() === value) text.value = ''
  }
  try {
    if (props.submitAction) {
      const result = await props.submitAction(value, { onAccepted: clearAcceptedDraft })
      if (result?.accepted === false) {
        drafts.set(sessionId, value)
        if (props.sessionId === sessionId && !text.value) text.value = value
      }
    } else {
      emit('send', value)
      clearAcceptedDraft()
    }
  } catch {
    drafts.set(sessionId, value)
    if (props.sessionId === sessionId && !text.value) text.value = value
  } finally { submitting.value = false }
}

function handleKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing.value || event.keyCode === 229 || event.repeat) return
  event.preventDefault()
  send()
}

function handleAction() {
  if (props.processing) {
    if (props.cancelling || !props.canCancel) return
    emit('cancel')
    return
  }
  send()
}

function updateModel(event) {
  emit('update:model', event?.target?.value || '')
}
</script>

<template>
  <footer class="ai-input">
    <div class="ai-input__panel">
      <textarea
        ref="textareaRef"
        v-model="text"
        rows="1"
        :placeholder="$t('ui.enterAQuestionOrAnActionToPerform')"
        :disabled="disabled"
        :aria-label="$t('ui.messageToSendToTheAgent')"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="handleKeydown"
      ></textarea>
      <div class="ai-input__toolbar">
        <span class="ai-input__hint">{{ $t('ui.shiftEnterForANewLine') }}</span>
        <div class="ai-input__right-tools">
          <label
            class="ai-input__select ai-input__select--model"
            :title="$t('ui.switchModel')"
          >
            <select
              :value="model"
              :title="model"
              :aria-label="$t('ui.chooseAConversationModel')"
              :disabled="disabled || modelLoading"
              @change="updateModel"
            >
              <option v-if="!modelOptions.length" value="">
                {{ modelLoading ? $t('ui.loadingVariant5') : $t('ui.chooseModel') }}
              </option>
              <option v-for="item in modelOptions" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <button
            class="ai-input__submit"
            type="button"
            :title="cancelling ? $t('ui.stopping') : processing ? (canCancel ? $t('ui.stop') : $t('ui.operationInProgress')) : $t('ui.send')"
            :aria-label="cancelling ? $t('ui.stopping') : processing ? $t('ui.stop') : $t('ui.send')"
            :class="{ 'is-cancel': processing }"
            :disabled="cancelling || (processing && !canCancel) || (!processing && !canSend)"
            @click="handleAction"
          >
            <StopOutlined v-if="processing" />
            <ArrowUpOutlined v-else />
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.ai-input {
  flex-shrink: 0;
  padding: 6px 12px 12px;
  background: var(--ai-thread-bg, var(--color-surface));
}

.ai-input__panel {
  min-height: 62px;
  padding: 10px 8px 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--duration-base) var(--ease-standard),
    box-shadow var(--duration-base) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 16%, transparent);
  }

  textarea {
    min-height: 21px;
    max-height: 126px;
    overflow-y: auto;
    resize: none;
    border: 0;
    background: transparent;
    color: var(--color-text);
    padding: 0 4px 0 0;
    box-sizing: border-box;
    outline: none;
    line-height: 21px;
    font-size: var(--font-size-md);
    font-family: inherit;

    &::placeholder {
      color: var(--color-placeholder);
    }

    &:disabled {
      background: transparent;
      color: var(--color-text-muted);
    }

    &::-webkit-scrollbar { width: 7px; }
    &::-webkit-scrollbar-track { background: var(--scrollbar-track-color); }
    &::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb-color); border-radius: 4px; }
    &::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
  }
}

.ai-input__toolbar,
.ai-input__right-tools {
  min-width: 0;
  display: flex;
  align-items: center;
}

.ai-input__toolbar {
  justify-content: space-between;
  gap: 8px;
}

.ai-input__hint {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ai-input__right-tools {
  flex: 0 1 auto;
  gap: 4px;
}

// 模型切换做成轻量的文字下拉，避免与发送按钮争夺视觉重心。
.ai-input__select {
  min-width: 0;
  height: 28px;
  padding: 0 4px 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  select {
    min-width: 0;
    max-width: 150px;
    border: 0;
    outline: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: var(--font-size-xs);
    font-weight: 500;
    cursor: pointer;
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-within {
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: var(--color-surface);
  }
}

.ai-input__submit {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-text-inverse);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  &:active:not(:disabled) {
    background: var(--color-accent-active);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 2px;
  }

  &:disabled {
    background: var(--color-surface-strong);
    color: var(--color-text-subtle);
    cursor: not-allowed;
  }

  // 停止不是破坏性操作，用中性深色表达“正在运行，可中止”。
  &.is-cancel {
    background: var(--color-text-secondary);
    color: var(--color-text-inverse);

    &:hover:not(:disabled) {
      background: var(--color-text);
    }

    &:disabled {
      background: var(--color-surface-strong);
      color: var(--color-text-subtle);
    }
  }
}

button:disabled,
select:disabled {
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .ai-input__panel,
  .ai-input__select,
  .ai-input__submit {
    transition: none;
  }
}
</style>
