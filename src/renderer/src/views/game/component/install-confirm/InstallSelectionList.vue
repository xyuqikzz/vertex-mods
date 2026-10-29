<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  type: { type: String, default: 'multi' },
  name: { type: String, default: '' },
  columns: { type: Array, default: () => [] },
  items: { type: Array, default: () => [] },
  selectedKeys: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  nameLabel: { type: String, default: undefined },
  ariaLabel: { type: String, default: '' }
})

const emit = defineEmits(['toggle', 'select', 'toggle-all'])

const DESCRIPTION_CLAMP_LENGTH = 90
const expandedKeys = ref(new Set())

const isMulti = computed(() => props.type === 'multi')
// none：只展示要处理的文件（如 VaM-Hub 一键安装会处理全部主文件），不提供选择控件。
const isReadonly = computed(() => props.type === 'none')
const selectedSet = computed(() => new Set(props.selectedKeys.map((key) => String(key))))
const gridTemplate = computed(() =>
  [
    isReadonly.value ? '' : '16px',
    'minmax(0, 1fr)',
    ...props.columns.map((column) => column.width || '80px')
  ]
    .filter(Boolean)
    .join(' ')
)
const selectableItems = computed(() => props.items.filter((item) => !item.disabled))
const selectedVisibleCount = computed(
  () => selectableItems.value.filter((item) => selectedSet.value.has(String(item.key))).length
)
const allSelected = computed(
  () =>
    selectableItems.value.length > 0 && selectedVisibleCount.value === selectableItems.value.length
)
const partlySelected = computed(() => selectedVisibleCount.value > 0 && !allSelected.value)

function isSelected(item) {
  return selectedSet.value.has(String(item.key))
}

function cellText(item, column) {
  const value = item.values?.[column.key]
  return value === undefined || value === null ? '' : String(value)
}

function cellTitle(item, column) {
  return item.values?.[`${column.key}Title`] || undefined
}

function describedBy(item) {
  return `${props.name}-meta-${item.key}`
}

function metaText(item) {
  return props.columns
    .map((column) => {
      const text = cellText(item, column)
      return text ? `${column.label} ${text}` : ''
    })
    .filter(Boolean)
    .join('，')
}

function descriptionLength(item) {
  return String(item.descriptionHtml || item.description || '').replace(/<[^>]+>/g, '').length
}

function canExpand(item) {
  return (
    descriptionLength(item) > DESCRIPTION_CLAMP_LENGTH ||
    /<br\s*\/?>/i.test(String(item.descriptionHtml || ''))
  )
}

function isExpanded(item) {
  return expandedKeys.value.has(String(item.key))
}

function toggleExpanded(item) {
  const next = new Set(expandedKeys.value)
  const key = String(item.key)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

function handleChange(item, event) {
  if (props.disabled || item.disabled) return
  if (isMulti.value) emit('toggle', item.key, Boolean(event.target.checked))
  else emit('select', item.key)
}

function handleToggleAll(event) {
  if (props.disabled) return
  emit('toggle-all', Boolean(event.target.checked))
}
</script>

<template>
  <div
    class="icd-list vx-ui-scrollbar"
    :role="isMulti || isReadonly ? 'group' : 'radiogroup'"
    :aria-label="ariaLabel || undefined"
  >
    <div class="icd-list__head" :style="{ gridTemplateColumns: gridTemplate }">
      <label v-if="isMulti" class="icd-choice" :class="{ 'is-mixed': partlySelected }">
        <input
          type="checkbox"
          :checked="allSelected"
          :disabled="disabled || !selectableItems.length"
          :aria-label="$t('ui.selectThisGroup')"
          @change="handleToggleAll"
        />
        <i aria-hidden="true"></i>
      </label>
      <span v-else-if="!isReadonly" aria-hidden="true"></span>
      <span aria-hidden="true">{{ (nameLabel ?? $t('tools.file')) }}</span>
      <span
        v-for="column in columns"
        :key="column.key"
        aria-hidden="true"
        :class="{ 'is-end': column.align === 'right' }"
      >
        {{ column.label }}
      </span>
    </div>

    <component
      :is="isReadonly ? 'div' : 'label'"
      v-for="item in items"
      :key="item.key"
      class="icd-row install-file-card"
      :class="{
        'is-on': !isReadonly && isSelected(item),
        'is-readonly': isReadonly,
        'is-disabled': item.disabled,
        'is-history': item.history,
        'is-compact': !isMulti && !item.description && !item.descriptionHtml
      }"
      :style="{ gridTemplateColumns: gridTemplate }"
    >
      <span v-if="!isReadonly" class="icd-choice" :class="{ 'is-radio': !isMulti }">
        <input
          :type="isMulti ? 'checkbox' : 'radio'"
          :name="isMulti ? undefined : name"
          :checked="isSelected(item)"
          :disabled="disabled || item.disabled"
          :aria-describedby="describedBy(item)"
          @change="handleChange(item, $event)"
        />
        <i aria-hidden="true"></i>
      </span>
      <span class="icd-row__main">
        <span class="icd-row__title-line">
          <span
            class="icd-row__title install-file-card__title"
            :class="{ 'is-mono': item.monoTitle }"
          >
            {{ item.title }}
          </span>
          <span
            v-for="tag in item.tags || []"
            :key="tag.text"
            class="icd-tag"
            :class="`is-${tag.tone || 'neutral'}`"
          >
            {{ tag.text }}
          </span>
        </span>
        <span v-if="item.originalTitle" class="icd-row__original">{{ item.originalTitle }}</span>
        <!-- descriptionHtml 只接收调用方清洗过的 HTML（见 Nexus 文件说明的白名单渲染）。 -->
        <!-- eslint-disable vue/no-v-html -->
        <span
          v-if="item.descriptionHtml"
          class="icd-row__desc install-file-card__description"
          :class="{ 'is-clamped': !isExpanded(item) }"
          v-html="item.descriptionHtml"
        ></span>
        <!-- eslint-enable vue/no-v-html -->
        <span
          v-else-if="item.description"
          class="icd-row__desc install-file-card__description"
          :class="{ 'is-clamped': !isExpanded(item) }"
        >
          {{ item.description }}
        </span>
        <button
          v-if="(item.description || item.descriptionHtml) && canExpand(item)"
          type="button"
          class="icd-row__expand"
          :aria-expanded="isExpanded(item)"
          @click.prevent.stop="toggleExpanded(item)"
        >
          {{ isExpanded(item) ? $t('tools.collapse') : $t('dialogs.vamDetail.expand') }}
        </button>
        <span v-if="item.disabledReason" class="icd-row__note is-danger">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M3.6 3.6l8.8 8.8" />
          </svg>
          {{ item.disabledReason }}
        </span>
        <span
          v-else-if="item.note"
          class="icd-row__note"
          :class="`is-${item.note.tone || 'muted'}`"
        >
          {{ item.note.text }}
        </span>
        <span :id="describedBy(item)" class="icd-sr-only">{{ metaText(item) }}</span>
      </span>
      <span
        v-for="column in columns"
        :key="column.key"
        class="icd-row__cell"
        :class="{ 'is-end': column.align === 'right', 'is-muted': column.muted || item.history }"
        :title="cellTitle(item, column)"
      >
        <template v-if="column.chips">
          <span
            v-for="chip in item.values?.[column.key] || []"
            :key="chip"
            class="icd-tag is-outline"
          >
            {{ chip }}
          </span>
        </template>
        <template v-else>{{ cellText(item, column) }}</template>
      </span>
    </component>
  </div>
</template>

<style scoped lang="scss">
.icd-list {
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.icd-list__head,
.icd-row {
  display: grid;
  gap: var(--space-3);
  padding: 0 var(--space-4);
}

.icd-list__head {
  position: sticky;
  top: 0;
  z-index: 1;
  align-items: center;
  height: 32px;
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.icd-row {
  align-items: start;
  padding-block: var(--space-3);
  border-bottom: 1px solid var(--color-bg);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  &.is-readonly {
    cursor: default;

    &:hover {
      background: transparent;
    }
  }

  &.is-on {
    background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--color-surface));
  }

  &.is-history {
    background: var(--color-surface-soft);
  }

  &.is-history.is-on {
    background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--color-surface));
  }

  &.is-disabled {
    background: var(--color-surface-soft);
    cursor: not-allowed;
  }

  &.is-compact {
    align-items: center;
    min-height: 48px;
    padding-block: var(--space-2);
  }

  &:has(input:focus-visible) {
    outline: 2px solid var(--color-accent-active);
    outline-offset: -2px;
  }
}

.icd-row.is-compact .icd-choice {
  margin-top: 0;
}

.icd-row.is-compact .icd-row__cell {
  padding-top: 0;
}

.is-end {
  text-align: right;
  justify-content: flex-end;
}

/* 与 VxCheckbox / VxRadioGroup 同一套外观；整行作为 label，所以这里不能嵌套组件自带的 label。 */
.icd-choice {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--choice-size);
  height: var(--choice-size);
  margin-top: 3px;

  input {
    position: absolute;
    inset: -6px;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  i {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: var(--choice-size);
    height: var(--choice-size);
    background: var(--control-bg);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xs);
    box-shadow: var(--control-shadow);
    pointer-events: none;
    transition:
      background var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
  }

  i::after {
    content: '';
    width: 7px;
    height: 4px;
    border-bottom: 2px solid var(--color-accent);
    border-left: 2px solid var(--color-accent);
    opacity: 0;
    transform: rotate(-45deg) translate(1px, -1px) scale(0.7);
    transition:
      opacity var(--duration-fast) var(--ease-standard),
      transform var(--duration-fast) var(--ease-standard);
  }

  &.is-radio i {
    position: relative;
    border-radius: 50%;
  }

  &.is-radio i::after {
    position: absolute;
    inset: 0;
    width: var(--space-2);
    height: var(--space-2);
    margin: auto;
    border: 0;
    border-radius: 50%;
    background: var(--color-accent);
    transform: scale(0.5);
  }

  input:checked + i,
  &.is-mixed i {
    background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--control-bg) 42%);
    border-color: var(--color-accent);
  }

  input:checked + i::after {
    opacity: 1;
    transform: rotate(-45deg) translate(1px, -1px) scale(1);
  }

  &.is-radio input:checked + i::after {
    transform: scale(1);
  }

  &.is-mixed input:not(:checked) + i::after {
    width: 8px;
    height: 0;
    border-left: 0;
    opacity: 1;
    transform: none;
  }

  input:focus-visible + i {
    border-color: color-mix(in srgb, var(--color-accent) 58%, var(--color-border) 42%);
    box-shadow: var(--control-shadow), var(--focus-ring);
  }

  input:disabled + i {
    background: var(--control-bg-disabled);
    border-color: var(--color-border);
    box-shadow: none;
  }

  input:disabled:checked + i::after {
    border-color: var(--color-text-subtle);
  }

  &.is-radio input:disabled:checked + i::after {
    background: var(--color-text-subtle);
  }
}

.icd-row:not(.is-disabled):hover .icd-choice input:not(:disabled) + i {
  border-color: color-mix(in srgb, var(--color-accent) 58%, var(--color-border) 42%);
  box-shadow: var(--control-shadow), var(--focus-ring);
}

.icd-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.icd-row__title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--space-2);
  min-width: 0;
}

.icd-row__title {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 22px;
  overflow-wrap: anywhere;

  &.is-mono {
    font-family: var(--font-family-mono);
  }
}

.icd-row.is-history .icd-row__title,
.icd-row.is-disabled .icd-row__title {
  color: var(--color-text-secondary);
}

.icd-row.is-disabled .icd-row__title {
  color: var(--color-text-muted);
}

.icd-row__original {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.icd-row__desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 20px;
  overflow-wrap: anywhere;

  &.is-clamped {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  :deep(a) {
    color: var(--color-accent-active);
  }
}

.icd-row__expand {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-active);
  font: inherit;
  font-size: var(--font-size-xs);
  line-height: 20px;
  cursor: pointer;

  &:hover {
    color: var(--color-accent-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-active);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
}

.icd-row__note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  line-height: 20px;

  svg {
    width: 12px;
    height: 12px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  &.is-danger {
    color: var(--color-danger-strong);
  }

  &.is-warning {
    color: var(--color-warning-strong);
  }

  &.is-muted {
    color: var(--color-text-muted);
  }
}

.icd-row__cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  padding-top: 2px;
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: 20px;
  overflow-wrap: anywhere;

  &.is-muted {
    color: var(--color-text-muted);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icd-row,
  .icd-choice i,
  .icd-choice i::after {
    transition: none;
  }
}
</style>
