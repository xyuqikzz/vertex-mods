<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: undefined },
  target: { type: Array, default: () => [] },
  notice: { type: Object, default: null },
  showSelected: { type: Boolean, default: false },
  selectedFiles: { type: Array, default: () => [] },
  selectedLabel: { type: String, default: undefined },
  selectedEmptyText: { type: String, default: undefined },
  versionSummary: { type: Object, default: null },
  dependencies: { type: Object, default: null },
  total: { type: Object, default: null },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['remove', 'dependency-toggle', 'dependency-action', 'notice-action'])

// 需要用户处理的排在前面，已满足的排在最后。
const STATUS_ORDER = ['manual', 'dlc', 'install', 'pending', 'resolving', 'installed', 'skipped']

const dependencyItems = computed(() => {
  const items = Array.isArray(props.dependencies?.items) ? props.dependencies.items : []
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = STATUS_ORDER.indexOf(a.item.status)
      const right = STATUS_ORDER.indexOf(b.item.status)
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.index - b.index
    })
    .map(({ item }) => item)
})
const dependencyCount = computed(() => {
  const explicit = Number(props.dependencies?.count)
  return Number.isFinite(explicit) && explicit >= 0 ? explicit : dependencyItems.value.length
})
const dependencyResolving = computed(() => props.dependencies?.state === 'resolving')
</script>

<template>
  <aside class="icd-plan" aria-labelledby="icd-plan-title">
    <h3 id="icd-plan-title" class="icd-plan__title">{{ title }}</h3>
    <div class="icd-plan__body vx-ui-scrollbar">
      <section v-if="target.length || notice" class="icd-plan__section" :aria-label="$t('ui.target')">
        <h4 class="icd-plan__label">{{ $t('ui.target') }}</h4>
        <dl v-if="target.length" class="icd-plan__dl">
          <template v-for="row in target" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd :class="{ 'is-mono': row.mono, 'is-small': row.small }">
              <span v-if="row.tag" class="icd-tag" :class="`is-${row.tag.tone || 'neutral'}`">
                <svg v-if="row.tag.tone === 'success'" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
                {{ row.tag.text }}
              </span>
              <template v-else>{{ row.value }}</template>
            </dd>
          </template>
        </dl>
        <div
          v-if="notice"
          class="icd-plan__notice"
          :class="`is-${notice.tone || 'warning'}`"
          role="note"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2l6.5 11.5h-13z" />
            <path d="M8 6.5v3" />
            <path d="M8 11.5v.2" />
          </svg>
          <span>
            {{ notice.text }}
            <button
              v-if="notice.actionText"
              type="button"
              class="icd-plan__notice-action"
              @click="emit('notice-action')"
            >
              {{ notice.actionText }}
            </button>
          </span>
        </div>
      </section>

      <section v-if="showSelected" class="icd-plan__section" :aria-label="$t('ui.selectedFiles')">
        <h4 class="icd-plan__label">
          {{ (selectedLabel ?? $t('ui.selectedFiles')) }} <span class="icd-mono">{{ selectedFiles.length }}</span>
        </h4>
        <ul v-if="selectedFiles.length" class="icd-plan__files">
          <li v-for="file in selectedFiles" :key="file.key">
            <span class="icd-plan__file-name" :title="file.title">{{ file.title }}</span>
            <span v-if="file.sizeText" class="icd-mono icd-plan__file-size">{{
              file.sizeText
            }}</span>
            <button
              v-if="file.removable !== false"
              type="button"
              class="icd-icon-button is-small"
              :aria-label="$t('ui.removeValueVariant2', { value1: (file.title) })"
              :disabled="disabled"
              @click="emit('remove', file.key)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>
            </button>
          </li>
        </ul>
        <p v-else class="icd-plan__empty">{{ (selectedEmptyText ?? $t('ui.selectFilesHint')) }}</p>
      </section>

      <section v-if="versionSummary" class="icd-plan__section" :aria-label="$t('tools.version')">
        <h4 class="icd-plan__label">{{ $t('tools.version') }}</h4>
        <div v-if="versionSummary.current" class="icd-plan__switch">
          <span>
            <small>{{ $t('tools.current') }}</small>
            <span class="icd-mono">{{ versionSummary.current }}</span>
          </span>
          <svg viewBox="0 0 16 16" role="img" :aria-label="$t('ui.switchTo')">
            <path d="M3 8h10" />
            <path d="M9 4l4 4-4 4" />
          </svg>
          <span>
            <small>{{ $t('ui.target') }}</small>
            <strong class="icd-mono">{{ versionSummary.target || '--' }}</strong>
          </span>
        </div>
        <div v-else class="icd-plan__version">
          <strong class="icd-mono">{{ versionSummary.target || '--' }}</strong>
          <span
            v-if="versionSummary.tag"
            class="icd-tag"
            :class="`is-${versionSummary.tag.tone || 'neutral'}`"
          >
            {{ versionSummary.tag.text }}
          </span>
        </div>
        <p
          v-if="versionSummary.note"
          class="icd-plan__hint"
          :class="{ 'is-warning': versionSummary.noteTone === 'warning' }"
        >
          {{ versionSummary.note }}
        </p>
      </section>

      <section v-if="dependencies" class="icd-plan__section" :aria-label="$t('taskCenter.detail.dependency')">
        <h4 class="icd-plan__label is-row">
          <span
            >{{ $t('taskCenter.detail.dependency') }}
            <span class="icd-mono">{{ dependencyResolving ? '…' : dependencyCount }}</span></span
          >
          <span
            v-if="dependencies.summary"
            class="icd-plan__summary"
            :class="`is-${dependencies.summary.tone || 'muted'}`"
          >
            {{ dependencies.summary.text }}
          </span>
        </h4>
        <p
          v-if="dependencyResolving && !dependencyItems.length"
          class="icd-plan__status"
          role="status"
        >
          <span class="icd-spinner" aria-hidden="true"></span>
          {{ dependencies.progressText || $t('ui.resolvingDependencies') }}
        </p>
        <ul v-if="dependencyItems.length" class="icd-plan__deps">
          <li
            v-for="dep in dependencyItems"
            :key="dep.key"
            class="icd-dep"
            :class="`is-${dep.status || 'pending'}`"
          >
            <label v-if="dep.checkable" class="icd-dep__check">
              <input
                type="checkbox"
                :checked="dep.checked"
                :disabled="disabled || dep.disabled"
                :aria-label="$t('ui.alsoHandleValue', { value1: (dep.name) })"
                @change="emit('dependency-toggle', dep.key, $event.target.checked)"
              />
              <i aria-hidden="true"></i>
            </label>
            <span v-else class="icd-dep__icon" aria-hidden="true">
              <svg v-if="dep.status === 'installed'" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M5.5 8.2l1.8 1.8 3.2-3.8" />
              </svg>
              <svg v-else-if="dep.status === 'manual'" viewBox="0 0 16 16">
                <path d="M8 2l6.5 11.5h-13z" />
                <path d="M8 6.5v3" />
                <path d="M8 11.5v.2" />
              </svg>
              <svg v-else-if="dep.status === 'dlc'" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M8 7.2v4" />
                <path d="M8 4.8v.2" />
              </svg>
              <span v-else-if="dep.status === 'resolving'" class="icd-spinner"></span>
              <svg v-else viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M8 5v6" />
                <path d="M5 8h6" />
              </svg>
            </span>
            <span class="icd-dep__main">
              <span class="icd-dep__name-line">
                <span class="icd-dep__name">{{ dep.name }}</span>
                <span v-if="dep.kind" class="icd-tag">{{ dep.kind }}</span>
              </span>
              <span v-if="dep.meta" class="icd-dep__meta icd-mono">{{ dep.meta }}</span>
              <span v-if="dep.note" class="icd-dep__note">{{ dep.note }}</span>
            </span>
            <button
              v-if="dep.actionText"
              type="button"
              class="icd-dep__action"
              :disabled="disabled"
              @click="emit('dependency-action', dep.key)"
            >
              {{ dep.actionText }}
            </button>
            <span v-else class="icd-dep__status">{{ dep.statusText }}</span>
          </li>
        </ul>
        <p
          v-if="dependencyResolving && dependencyItems.length"
          class="icd-plan__status"
          role="status"
        >
          <span class="icd-spinner" aria-hidden="true"></span>
          {{ dependencies.progressText || $t('ui.loadingAdditionalDependencyDetails') }}
        </p>
        <p v-if="!dependencyResolving && !dependencyItems.length" class="icd-plan__ok">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M5.5 8.2l1.8 1.8 3.2-3.8" />
          </svg>
          {{ dependencies.emptyText || $t('ui.noDependenciesToHandle') }}
        </p>
        <p v-if="dependencies.moreText" class="icd-plan__hint">{{ dependencies.moreText }}</p>
      </section>
    </div>
    <div v-if="total" class="icd-plan__total">
      <div>
        <span>{{ total.label || $t('ui.estimatedDownload') }}</span>
        <strong class="icd-mono">{{ total.value }}</strong>
      </div>
      <p v-if="total.note">{{ total.note }}</p>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.icd-plan {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-soft);
  border-left: 1px solid var(--color-border);
}

.icd-plan__title {
  margin: 0;
  padding: var(--space-4) var(--space-5) 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  line-height: 22px;
}

.icd-plan__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: var(--space-3) var(--space-5) var(--space-4);
}

.icd-plan__section {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-surface-strong);

  &:first-child {
    padding-top: 0;
    border-top: 0;
  }

  &:last-child {
    padding-bottom: 0;
  }
}

.icd-plan__label {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 20px;

  &.is-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
}

.icd-plan__summary {
  &.is-success {
    color: var(--color-success-strong);
  }

  &.is-warning {
    color: var(--color-warning-strong);
  }

  &.is-muted {
    color: var(--color-text-muted);
  }
}

.icd-plan__dl {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: var(--space-2) var(--space-3);
  align-items: center;
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 20px;

  dt {
    color: var(--color-text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;

    &.is-mono {
      font-family: var(--font-family-mono);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    &.is-small {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
  }

  .icd-tag svg {
    width: 12px;
    height: 12px;
    margin-right: 4px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.icd-plan__notice {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  line-height: 20px;

  &.is-warning {
    background: var(--color-warning-soft);
    color: var(--color-warning-strong);
  }

  &.is-info {
    background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--color-surface));
    color: var(--color-accent-strong);
  }

  svg {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.icd-plan__notice-action {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: var(--font-weight-semibold);
  text-decoration: underline;
  cursor: pointer;
}

.icd-plan__files,
.icd-plan__deps {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.icd-plan__files li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  height: var(--control-height-md);
  padding: 0 var(--space-1) 0 var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.icd-plan__file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icd-plan__file-size {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.icd-plan__empty {
  margin: 0;
  padding: var(--space-3);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 20px;
}

.icd-plan__version,
.icd-plan__switch {
  box-sizing: border-box;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.icd-plan__version {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--control-height-md);
  padding: 0 var(--space-3);
  font-size: var(--font-size-md);
}

.icd-plan__switch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);

  > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: var(--font-size-md);
    line-height: 22px;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }

  small {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    line-height: 20px;
  }

  strong {
    color: var(--color-text);
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.icd-plan__hint {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 20px;

  &.is-warning {
    color: var(--color-warning-strong);
  }
}

.icd-plan__status,
.icd-plan__ok {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 20px;
}

.icd-plan__status {
  margin-top: var(--space-2);

  &:first-of-type {
    margin-top: 0;
  }
}

.icd-plan__ok svg {
  width: 16px;
  height: 16px;
  flex: none;
  margin-top: 2px;
  fill: none;
  stroke: var(--color-success-strong);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icd-dep {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  &.is-manual {
    background: var(--color-warning-soft);
    border-color: color-mix(in srgb, var(--color-warning) 24%, var(--color-border) 76%);
  }
}

.icd-dep__icon {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.icd-dep.is-installed .icd-dep__icon,
.icd-dep.is-installed .icd-dep__status {
  color: var(--color-success-strong);
}

.icd-dep.is-manual .icd-dep__icon,
.icd-dep.is-manual .icd-dep__note,
.icd-dep.is-manual .icd-dep__status {
  color: var(--color-warning-strong);
}

.icd-dep.is-dlc .icd-dep__icon,
.icd-dep.is-dlc .icd-dep__status,
.icd-dep.is-install .icd-dep__status,
.icd-dep.is-pending .icd-dep__status {
  color: var(--color-accent-strong);
}

.icd-dep.is-install .icd-dep__icon,
.icd-dep.is-pending .icd-dep__icon {
  color: var(--color-accent-active);
}

.icd-dep.is-resolving .icd-dep__icon,
.icd-dep.is-resolving .icd-dep__status,
.icd-dep.is-skipped .icd-dep__icon,
.icd-dep.is-skipped .icd-dep__status {
  color: var(--color-text-muted);
}

.icd-dep__check {
  position: relative;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;

  input {
    position: absolute;
    inset: -6px;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  i {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    background: var(--control-bg);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xs);
    pointer-events: none;
  }

  i::after {
    content: '';
    width: 7px;
    height: 4px;
    border-bottom: 2px solid var(--color-accent);
    border-left: 2px solid var(--color-accent);
    opacity: 0;
    transform: rotate(-45deg) translate(1px, -1px);
  }

  input:checked + i {
    background: color-mix(in srgb, var(--color-accent-soft) 58%, var(--control-bg) 42%);
    border-color: var(--color-accent);
  }

  input:checked + i::after {
    opacity: 1;
  }

  input:focus-visible + i {
    box-shadow: var(--focus-ring);
    outline: 2px solid var(--color-accent-active);
    outline-offset: 2px;
  }

  input:disabled + i {
    background: var(--control-bg-disabled);
    border-color: var(--color-border);
  }

  input:disabled:checked + i::after {
    border-color: var(--color-text-subtle);
  }
}

.icd-dep__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.icd-dep__name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.icd-dep__name {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.icd-dep__meta {
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.icd-dep__note {
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.icd-dep__status {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 20px;
  white-space: nowrap;
}

.icd-dep__action {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-active);
    outline-offset: 2px;
  }
}

.icd-plan__total {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);

  > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 20px;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }

  p {
    margin: 2px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    line-height: 20px;
  }
}

@media (max-width: 760px) {
  .icd-plan {
    flex: none;
    min-height: auto;
    border-top: 1px solid var(--color-border);
    border-left: 0;
  }

  .icd-plan__body {
    overflow: visible;
  }
}
</style>
