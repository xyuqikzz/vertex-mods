<template>
  <VxModal
    :model-value="modelValue"
    plain
    :width="560"
    :show-close="false"
    :aria-label="noticeTitle"
    @update:model-value="handleMaskClose"
  >
    <section ref="dialogRef" class="feature-dialog" tabindex="-1">
      <header class="feature-dialog__header">
        <h2 class="feature-dialog__title">{{ noticeTitle }}</h2>
        <p v-if="noticeSubtitle" class="feature-dialog__subtitle">{{ noticeSubtitle }}</p>
        <button
          type="button"
          class="feature-dialog__close"
          :aria-label="t('ui.closeDialog')"
          @click="handleConfirm"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </header>

      <div class="feature-dialog__body">
        <section
          v-for="group in featureGroups"
          :key="group.version"
          class="feature-group"
          :aria-label="group.version"
        >
          <h3 class="feature-group__version">
            {{ group.version }}
            <span>{{
              t('featureNotice.count', { count: group.items.length }, group.items.length)
            }}</span>
          </h3>
          <article
            v-for="item in group.items"
            :key="`${item.featureVersion}-${item.featureTitle}`"
            class="feature-item"
          >
            <div class="feature-item__text">
              <h4 class="feature-item__title">
                {{ item.featureTitle }}
                <span v-if="isHighlightItem(item)" class="feature-item__pill">
                  {{ t('featureNotice.highlight') }}
                </span>
              </h4>
              <p v-if="item.featureDesc" class="feature-item__desc">{{ item.featureDesc }}</p>
            </div>
            <button
              v-if="shouldShowAction(item)"
              class="feature-item__action"
              type="button"
              @click="emit('action', { item, suppressToday })"
            >
              {{ item.actionText || t('ui.goNow') }}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </article>
        </section>
      </div>

      <footer class="feature-dialog__footer">
        <VxCheckbox v-model="suppressToday" :label="t('ui.doNotShowAgainToday')" />
        <VxButton variant="primary" @click="handleConfirm">{{ t('ui.gotIt') }}</VxButton>
      </footer>
    </section>
  </VxModal>
</template>

<script setup>
// 首页新功能公告：按版本分组的更新列表（同一版本只显示一次版本号），每条右侧是「立即前往」。
// 高度随内容变化，内容多时只滚动列表，标题和底部固定。
import { useI18n } from 'vue-i18n'
import { computed, nextTick, ref, watch } from 'vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxButton from '@renderer/component/vertex-ui/VxButton.vue'
import VxCheckbox from '@renderer/component/vertex-ui/VxCheckbox.vue'

const { t } = useI18n()

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  notice: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'dismiss', 'action'])
const suppressToday = ref(false)
const dialogRef = ref(null)

const featureItems = computed(() => {
  const items = Array.isArray(props.notice?.items) ? props.notice.items : []
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const sortDiff = getFeatureItemSort(right.item) - getFeatureItemSort(left.item)
      return sortDiff || left.index - right.index
    })
    .map(({ item }) => item)
})

function formatVersion(value = '') {
  const version = String(value || '').trim()
  return version ? `v${version.replace(/^v/i, '')}` : ''
}

const noticeVersionText = computed(
  () => formatVersion(props.notice?.noticeVersion) || t('ui.featureUpdate')
)
const noticeTitle = computed(() => {
  return String(
    props.notice?.noticeTitle || t('ui.valueFeatureUpdate', { value1: noticeVersionText.value })
  ).trim()
})
const noticeSubtitle = computed(() => String(props.notice?.noticeSubtitle || '').trim())

// 按排序后的顺序分组：版本第一次出现的位置决定分组顺序
const featureGroups = computed(() => {
  const groups = []
  const groupByVersion = new Map()
  for (const item of featureItems.value) {
    const version = formatVersion(item?.featureVersion) || noticeVersionText.value
    let group = groupByVersion.get(version)
    if (!group) {
      group = { version, items: [] }
      groupByVersion.set(version, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
})

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      suppressToday.value = false
      // 打开时把焦点放在弹窗本身（VxModal 默认聚焦第一个按钮，会在关闭按钮上出现焦点框）；
      // Tab 仍从关闭按钮开始，焦点限制和关闭后还原焦点由 VxModal 负责。
      nextTick(() => {
        requestAnimationFrame(() => dialogRef.value?.focus({ preventScroll: true }))
      })
    }
  },
  { immediate: true }
)

function getFeatureItemSort(item = {}) {
  const sort = Number(item.sort)
  return Number.isFinite(sort) ? sort : 0
}

function isHighlightItem(item = {}) {
  const value = item.isHighlight
  return value === true || value === 1 || value === '1' || value === 'true'
}

function shouldShowAction(item = {}) {
  return (
    String(item.actionType || 'none')
      .trim()
      .toLowerCase() !== 'none'
  )
}

function closeDialog(payload) {
  emit('update:modelValue', false)
  emit('dismiss', payload)
}

function handleMaskClose(value) {
  if (!value && props.modelValue) {
    closeDialog({ suppressToday: suppressToday.value })
  }
}

function handleConfirm() {
  closeDialog({ suppressToday: suppressToday.value })
}
</script>

<style scoped lang="scss">
$accent: #0a96ff;
$ink: #1e293b;
$muted: #607086;
$line: #eef2f6;

.feature-dialog {
  position: relative;
  width: min(560px, calc(100vw - 48px));
  max-height: min(620px, calc(100vh - 64px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: #ffffff;
  color: $ink;
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.24),
    0 2px 8px rgba(15, 23, 42, 0.08);

  &:focus {
    outline: none;
  }
}

.feature-dialog__header {
  position: relative;
  flex: none;
  padding: 24px 60px 16px 24px;
}

.feature-dialog__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}

.feature-dialog__subtitle {
  margin: 4px 0 0;
  color: $muted;
  font-size: 13px;
  line-height: 1.5;
}

.feature-dialog__close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #7b8a9e;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  &:hover {
    background: #f1f5f9;
    color: #334155;
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }
}

// 列表在弹窗内部滚动，标题和底部固定
.feature-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 17px 8px 24px;
  overflow-y: auto;
  scrollbar-gutter: stable;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
    min-height: 40px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

.feature-group + .feature-group {
  margin-top: 6px;
}

.feature-group__version {
  height: 28px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #0a7fd9;
  font-size: 12px;
  font-weight: 700;

  span {
    color: #7b8a9e;
    font-weight: 600;
  }

  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e8edf3;
  }
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;

  & + & {
    border-top: 1px solid $line;
  }
}

.feature-item__text {
  flex: 1;
  min-width: 0;
}

.feature-item__title {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  color: $ink;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  word-break: break-word;
}

.feature-item__pill {
  height: 20px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(10, 150, 255, 0.1);
  color: #0a7fd9;
  font-size: 11px;
  font-weight: 700;
}

.feature-item__desc {
  margin: 3px 0 0;
  color: $muted;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.feature-item__action {
  flex: none;
  height: 32px;
  padding: 0 8px 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  border-radius: 8px;
  background: rgba(10, 150, 255, 0.08);
  color: #0a7fd9;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover {
    background: rgba(10, 150, 255, 0.14);
  }

  &:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.28);
    outline-offset: 2px;
  }
}

.feature-dialog__footer {
  flex: none;
  padding: 12px 24px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid $line;

  :deep(.vx-button) {
    min-width: 96px;
  }
}

@media (max-width: 720px) {
  .feature-dialog__header,
  .feature-dialog__footer {
    padding-left: 20px;
    padding-right: 20px;
  }

  .feature-dialog__body {
    padding-left: 20px;
    padding-right: 13px;
  }

  .feature-item {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature-dialog__close,
  .feature-item__action {
    transition: none;
  }
}
</style>
