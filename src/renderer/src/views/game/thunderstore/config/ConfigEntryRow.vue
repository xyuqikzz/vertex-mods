<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, useId } from 'vue'
import { VxInput, VxSegmented, VxSelect, VxSwitch } from '@renderer/component/vertex-ui'
import {
  describeConfigEntryType,
  describeConfigRange,
  hexColorPreview,
  mergePickedColor,
  splitFlagValue,
  toggleFlagValue
} from './cfg-document.js'

// 配置项一行：左侧名称 + 说明 + 类型 / 默认 / 范围，中间按类型选控件，右侧「撤销 / 恢复默认」。
// 控件规格见 Vertex 项目文档《Thunderstore 配置编辑器 UI 重设计方案》第 5 节。
const props = defineProps({
  entry: { type: Object, required: true },
  value: { type: String, default: '' },
  modified: { type: Boolean, default: false },
  canReset: { type: Boolean, default: false },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update', 'undo', 'reset'])

const labelId = `config-entry-${useId()}`
const expanded = ref(false)

const SEGMENT_MAX_OPTIONS = 3
const SEGMENT_MAX_CHARS = 24
const DESCRIPTION_CLAMP_CHARS = 160

const control = computed(() => {
  const { type, options = [] } = props.entry
  if (type === 'enum') {
    const totalChars = options.reduce((sum, option) => sum + option.length, 0)
    return options.length <= SEGMENT_MAX_OPTIONS && totalChars <= SEGMENT_MAX_CHARS
      ? 'segmented'
      : 'select'
  }
  if (['bool', 'flags', 'color', 'string'].includes(type)) return type
  return 'input'
})

const isMono = computed(() => ['int', 'float', 'key', 'text', 'color'].includes(props.entry.type))

const matchedOption = computed(() => {
  const value = String(props.value || '').trim()
  return (
    (props.entry.options || []).find((option) => option.toLowerCase() === value.toLowerCase()) ??
    value
  )
})

const optionItems = computed(() => {
  const items = (props.entry.options || []).map((option) => ({ label: option, value: option }))
  const current = matchedOption.value
  if (current && !items.some((item) => item.value === current)) {
    items.push({ label: uiText('ui.valueNotInAvailableOptions', { value1: (current) }), value: current })
  }
  return items
})

const selectedFlags = computed(
  () => new Set(splitFlagValue(props.value).map((item) => item.toLowerCase()))
)

const colorPreview = computed(() => hexColorPreview(props.value))

const descriptionClampable = computed(() => {
  const text = String(props.entry.description || '')
  return text.length > DESCRIPTION_CLAMP_CHARS || text.split('\n').length > 2
})

const defaultLabel = computed(() => {
  const value = props.entry.defaultValue
  if (value === undefined) return ''
  return value === '' ? uiText('ui.emptyVariant2') : value
})

const metaItems = computed(() => {
  const items = [describeConfigEntryType(props.entry)]
  if (props.entry.defaultValue !== undefined) items.push(uiText('ui.defaultValue', { value1: (defaultLabel.value) }))
  if (props.entry.range) items.push(uiText('ui.rangeValue', { value1: (describeConfigRange(props.entry.range)) }))
  if (props.entry.inferred) items.push('类型按当前值推断')
  return items
})

const inlineError = computed(() =>
  ['input', 'string', 'color'].includes(control.value) ? '' : props.error
)

function update(value) {
  if (props.disabled) return
  emit('update', String(value ?? ''))
}

function toggleFlag(option) {
  update(toggleFlagValue(props.entry, props.value, option))
}

function pickColor(event) {
  update(mergePickedColor(props.value, event.target.value))
}
</script>

<template>
  <div
    class="config-entry"
    :class="{ 'is-modified': modified, 'has-error': Boolean(error) }"
    :data-entry-id="entry.id"
  >
    <div class="config-entry__text">
      <div class="config-entry__name">
        <span :id="labelId" class="config-entry__key">{{ entry.key }}</span>
        <span v-if="modified" class="config-entry__mark">
          <span class="config-dot" aria-hidden="true"></span>{{ $t('ui.modified') }}
        </span>
      </div>
      <p
        v-if="entry.description"
        class="config-entry__description"
        :class="{ 'is-clamped': descriptionClampable && !expanded }"
      >
        {{ entry.description }}
      </p>
      <div class="config-entry__meta">
        <button
          v-if="descriptionClampable"
          type="button"
          class="config-link"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          {{ expanded ? $t('tools.collapse') : $t('dialogs.vamDetail.expand') }}
        </button>
        <span v-for="item in metaItems" :key="item">{{ item }}</span>
      </div>
    </div>

    <div class="config-entry__control">
      <VxSwitch
        v-if="control === 'bool'"
        class="config-entry__switch"
        :model-value="value === 'true'"
        :label="entry.key"
        :disabled="disabled"
        @update:model-value="update($event ? 'true' : 'false')"
      />

      <div
        v-else-if="control === 'segmented'"
        class="config-entry__segmented"
        role="group"
        :aria-labelledby="labelId"
      >
        <VxSegmented
          :model-value="matchedOption"
          :options="optionItems"
          @update:model-value="update"
        />
      </div>

      <VxSelect
        v-else-if="control === 'select'"
        class="config-entry__select"
        :model-value="matchedOption"
        :options="optionItems"
        :aria-label="entry.key"
        :disabled="disabled"
        @update:model-value="update"
      />

      <div
        v-else-if="control === 'flags'"
        class="config-entry__flags"
        role="group"
        :aria-labelledby="labelId"
      >
        <button
          v-for="option in entry.options"
          :key="option"
          type="button"
          class="config-flag"
          :class="{ 'is-on': selectedFlags.has(option.toLowerCase()) }"
          :aria-pressed="selectedFlags.has(option.toLowerCase())"
          :disabled="disabled"
          @click="toggleFlag(option)"
        >
          {{ option }}
        </button>
      </div>

      <div v-else-if="control === 'color'" class="config-entry__color">
        <label
          class="config-entry__swatch"
          :class="{ 'is-empty': !colorPreview }"
          :style="colorPreview ? { background: colorPreview } : null"
          :title="$t('ui.chooseAColorForValue', { value1: (entry.key) })"
        >
          <input
            type="color"
            class="tool-visually-hidden"
            :value="(colorPreview || '#ffffff').toLowerCase()"
            :aria-label="$t('ui.chooseAColorForValue', { value1: (entry.key) })"
            :disabled="disabled"
            @input="pickColor"
          />
        </label>
        <VxInput
          class="config-entry__input is-mono"
          :model-value="value"
          :error="error"
          :aria-label="entry.key"
          :disabled="disabled"
          @update:model-value="update"
        />
      </div>

      <VxInput
        v-else
        class="config-entry__input"
        :class="{ 'is-mono': isMono }"
        :model-value="value"
        :error="error"
        :placeholder="control === 'string' ? $t('ui.emptyVariant2') : ''"
        :aria-label="entry.key"
        :disabled="disabled"
        @update:model-value="update"
      />

      <p v-if="inlineError" class="config-entry__error" role="alert">{{ inlineError }}</p>
    </div>

    <div class="config-entry__actions">
      <button v-if="modified" type="button" class="config-link" @click="emit('undo')">{{ $t('ui.undo') }}</button>
      <button
        v-else-if="canReset"
        type="button"
        class="config-link"
        :title="$t('ui.restoreDefaultValueValue', { value1: (defaultLabel) })"
        @click="emit('reset')"
      >
        {{ $t('ui.restoreDefault') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.config-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
  padding: 14px var(--space-4) 14px var(--space-5);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }
}

.config-entry__text {
  flex: 1 1 auto;
  min-width: 0;
}

.config-entry__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--space-2);
  min-height: 22px;
}

.config-entry__key {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.config-entry__mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-warning-strong);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.config-entry__description {
  margin: 2px 0 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-line;
  overflow-wrap: anywhere;

  &.is-clamped {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.config-entry__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin-top: 4px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.config-entry__control {
  display: flex;
  flex: 0 0 264px;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
}

.config-entry__switch {
  margin-top: 2px;

  :deep(strong) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

.config-entry__segmented {
  max-width: 100%;
}

.config-entry__select,
.config-entry__input {
  width: 100%;
}

.config-entry__input.is-mono :deep(.vx-input) {
  font-family: var(--font-family-mono);
  font-size: 12.5px;
}

.config-entry__flags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.config-flag {
  height: 26px;
  padding: 0 10px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }

  &.is-on {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-semibold);
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.config-entry__color {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
}

.config-entry__swatch {
  position: relative;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;

  &.is-empty {
    background: repeating-linear-gradient(
      45deg,
      var(--color-surface-soft) 0 4px,
      var(--color-surface-strong) 4px 8px
    );
  }

  &:focus-within {
    box-shadow: var(--focus-ring);
  }
}

.config-entry__error {
  margin: 0;
  color: var(--color-danger-strong);
  font-size: var(--font-size-xs);
  text-align: right;
}

.config-entry__actions {
  display: flex;
  flex: 0 0 64px;
  justify-content: flex-end;
  padding-top: 4px;
}

.config-link {
  padding: 2px 4px;
  color: var(--color-accent-strong);
  font: inherit;
  font-size: 12.5px;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

.config-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  background: var(--color-warning);
  border-radius: 50%;
}

@media (max-width: 860px) {
  .config-entry {
    flex-wrap: wrap;
  }

  .config-entry__control {
    flex: 1 1 100%;
    align-items: stretch;
    order: 3;
  }

  .config-entry__actions {
    flex: 0 0 auto;
  }
}
</style>
