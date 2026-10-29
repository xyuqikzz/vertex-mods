<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { DownOutlined } from '@ant-design/icons-vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { communityImageSource } from '../../../../shared/sources/source-network.js'

const props = defineProps({
  candidate: { type: Object, required: true },
  recommended: { type: Boolean, default: false }
})

const emit = defineEmits(['detail', 'plan'])
const expanded = ref(false)
const imageFailed = ref(false)
const detailId = `ai-candidate-detail-${Math.random().toString(36).slice(2, 9)}`

const title = computed(() => String(props.candidate?.name || '未命名模组').trim())
const source = computed(() => String(props.candidate?.sourceLabel || props.candidate?.source || '').trim())
const sourceText = computed(() => {
  const value = source.value
  return value && value.length <= 3 ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1)
})
// 没有具体版本号时不显示“latest”这类占位词。
const versionText = computed(() => {
  const value = String(props.candidate?.version || '').trim()
  if (!value || /^latest$/i.test(value)) return ''
  return /^v\d/i.test(value) ? value : `v${value}`
})
const downloadsText = computed(() => formatDownloads(props.candidate?.popularity))
const statusText = computed(() => String(props.candidate?.installStatusText || '').trim())
const summaryText = computed(() =>
  String(props.candidate?.summary || props.candidate?.description || '').trim()
)
const authorText = computed(() => String(props.candidate?.author || '').trim())
const updatedText = computed(() => formatDate(props.candidate?.updatedAt))
const dependencyText = computed(() => {
  const count = Number(props.candidate?.dependencyCount)
  return Number.isFinite(count) && props.candidate?.dependencyCount !== undefined ? uiText('ui.valueItems', { value1: (count) }) : ''
})
const metaParts = computed(() => [sourceText.value, versionText.value, downloadsText.value].filter(Boolean))
const monogram = computed(() => {
  const letter = title.value.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0)
  return (letter || '?').toUpperCase()
})
// 来源列表图直接加载；需要代理的社区图片在这里不展示，退回首字母占位。
const imageSrc = computed(() => {
  const value = String(props.candidate?.pictureUrl || '').trim()
  if (!/^https?:\/\//i.test(value) || communityImageSource(value)) return ''
  return value
})

watch(imageSrc, () => {
  imageFailed.value = false
})

function formatDownloads(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (!/^\d+(\.\d+)?$/.test(text)) return text
  const count = Number(text)
  if (count >= 10000) {
    const wan = count / 10000
    return uiText('ui.value10000Downloads', { value1: (wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))) })
  }
  return uiText('ui.valueDownloads', { value1: (count.toLocaleString('zh-CN')) })
}

function formatDate(value) {
  if (!value) return ''
  const numeric = Number(value)
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toggleDetail() {
  expanded.value = !expanded.value
  // 详情只补读一次；已读过的候选再展开不重复请求。
  if (expanded.value && !props.candidate?.detailLoaded) {
    emit('detail', props.candidate)
  }
}
</script>

<template>
  <article class="ai-candidate" :class="{ 'is-recommended': recommended, 'is-expanded': expanded }">
    <div class="ai-candidate__row">
      <button
        type="button"
        class="ai-candidate__summary"
        :aria-expanded="expanded"
        :aria-controls="detailId"
        :aria-label="$t('ui.valueDetailsValue', { value1: (expanded ? $t('ui.collapse') : $t('ui.expand')), value2: (title) })"
        @click="toggleDetail"
      >
        <span class="ai-candidate__thumb" aria-hidden="true">
          <img
            v-if="imageSrc && !imageFailed"
            :src="imageSrc"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="imageFailed = true"
          />
          <span v-else>{{ monogram }}</span>
        </span>
        <span class="ai-candidate__text">
          <span class="ai-candidate__name" :title="title">{{ title }}</span>
          <span class="ai-candidate__meta">
            <span v-if="recommended" class="ai-candidate__tag">{{ $t('tools.recommended') }}</span>
            <span v-if="statusText" class="ai-candidate__status">{{ statusText }}</span>
            <span v-for="part in metaParts" :key="part" class="ai-candidate__meta-item">{{ part }}</span>
          </span>
        </span>
        <DownOutlined class="ai-candidate__chevron" aria-hidden="true" />
      </button>
      <VxButton
        class="ai-candidate__install"
        size="sm"
        :variant="recommended ? 'primary' : 'secondary'"
        :aria-label="$t('ui.installValue', { value1: (title) })"
        @click="emit('plan', candidate)"
      >
        {{ $t('modBrowser.install') }}
      </VxButton>
    </div>

    <div v-if="expanded" :id="detailId" class="ai-candidate__detail">
      <p v-if="summaryText" class="ai-candidate__summary-text">{{ summaryText }}</p>
      <p v-else class="ai-candidate__summary-text is-empty">{{ $t('ui.theSourceDidNotProvideADescription') }}</p>
      <dl v-if="authorText || updatedText || dependencyText" class="ai-candidate__facts">
        <div v-if="authorText">
          <dt>{{ $t('localMod.author') }}</dt>
          <dd>{{ authorText }}</dd>
        </div>
        <div v-if="updatedText">
          <dt>{{ $t('taskCenter.table.updated') }}</dt>
          <dd>{{ updatedText }}</dd>
        </div>
        <div v-if="dependencyText">
          <dt>{{ $t('taskCenter.detail.dependency') }}</dt>
          <dd>{{ dependencyText }}</dd>
        </div>
      </dl>
    </div>
  </article>
</template>

<style scoped lang="scss">
.ai-candidate {
  min-width: 0;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover,
  &.is-expanded {
    background: var(--color-surface-soft);
  }
}

.ai-candidate__row {
  min-width: 0;
  padding: 8px 10px 8px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-candidate__summary {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 12px;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 1px;
  }
}

// 来源缩略图；没有图片或加载失败时显示模组名首字母。
.ai-candidate__thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-strong);
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.ai-candidate__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ai-candidate__name {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 18px;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ai-candidate__meta {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 8px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 18px;
}

// 元信息之间用细竖线分隔，不用符号拼接。
.ai-candidate__meta-item + .ai-candidate__meta-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  &::before {
    content: '';
    width: 1px;
    height: 10px;
    background: var(--color-border-strong);
  }
}

.ai-candidate__tag,
.ai-candidate__status {
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  line-height: 1;
}

.ai-candidate__tag {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
}

.ai-candidate__status {
  color: var(--color-text-secondary);
  background: var(--color-surface-strong);
}

.ai-candidate__chevron {
  justify-self: center;
  color: var(--color-text-subtle);
  font-size: 10px;
  transition: transform var(--duration-fast) var(--ease-standard);

  .is-expanded & {
    transform: rotate(180deg);
  }
}

.ai-candidate__install {
  flex: 0 0 auto;
}

.ai-candidate__detail {
  margin: 0 12px 0 60px;
  padding: 2px 0 12px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.ai-candidate__summary-text {
  margin: 0;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;

  &.is-empty {
    color: var(--color-text-muted);
  }
}

.ai-candidate__facts {
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;

  div {
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  dt {
    color: var(--color-text-muted);
  }

  dd {
    margin: 0;
    min-width: 0;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-candidate,
  .ai-candidate__chevron {
    transition: none;
  }
}
</style>
