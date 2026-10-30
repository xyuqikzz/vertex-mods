<template>
  <nav v-if="shouldShowPagination" class="vx-pagination" :aria-label="t('pagination.label')">
    <div class="vx-pagination__row">
      <button
        type="button"
        class="vx-pagination__btn is-arrow"
        :disabled="currentPage <= 1 || loading"
        :aria-label="t('pagination.previous')"
        :title="t('pagination.previous')"
        @click="handlePageChange(currentPage - 1)"
      >
        <span
          v-if="loading && pendingDirection === -1"
          class="vx-pagination__spinner"
        ></span>
        <ToolIcon v-else name="chevron-left" :size="16" />
      </button>

      <!-- 总页数已知：固定 7 个位置，翻页时整行宽度不跳动 -->
      <template v-if="hasKnownTotalPages">
        <ol class="vx-pagination__list">
          <li v-for="item in displayedPages" :key="item.key">
            <span v-if="item.gap" class="vx-pagination__gap" aria-hidden="true">…</span>
            <button
              v-else
              type="button"
              class="vx-pagination__btn"
              :class="{ 'is-current': item.page === currentPage }"
              :aria-current="item.page === currentPage ? 'page' : undefined"
              :aria-label="t('pagination.goTo', { page: item.page })"
              :disabled="loading && item.page !== currentPage"
              @click="handlePageChange(item.page)"
            >
              <span
                v-if="loading && pendingPage === item.page"
                class="vx-pagination__spinner"
              ></span>
              <template v-else>{{ item.page }}</template>
            </button>
          </li>
        </ol>
        <!-- 窄容器：只显示「3 / 62」 -->
        <span class="vx-pagination__compact">
          <strong>{{ currentPage }}</strong> / {{ totalPages }}
        </span>
      </template>
      <span v-else class="vx-pagination__page-only" aria-live="polite">
        {{ t('pagination.page', { page: currentPage }) }}
      </span>

      <button
        type="button"
        class="vx-pagination__btn is-arrow"
        :disabled="currentPage >= totalPages || loading"
        :aria-label="t('pagination.next')"
        :title="t('pagination.next')"
        @click="handlePageChange(currentPage + 1)"
      >
        <span
          v-if="loading && pendingDirection === 1"
          class="vx-pagination__spinner"
        ></span>
        <ToolIcon v-else name="chevron-right" :size="16" />
      </button>
      <span v-if="showJumperControl" class="vx-pagination__jump-group">
        <span class="vx-pagination__divider" aria-hidden="true"></span>
        <label class="vx-pagination__jumper">
          <span aria-hidden="true">{{ t('pagination.jumpTo') }}</span>
          <input
            v-model="jumpValue"
            type="text"
            inputmode="numeric"
            class="vx-pagination__jumper-input"
            :placeholder="t('pagination.jumpPlaceholder')"
            :aria-label="t('pagination.jumpLabel', { pages: formatNumber(totalPages) })"
            :disabled="loading"
            @keydown.enter.prevent="submitJump"
            @blur="submitJump"
          />
        </label>
      </span>
      <template v-if="summaryText">
        <span class="vx-pagination__divider" aria-hidden="true"></span>
        <span class="vx-pagination__summary">{{ summaryText }}</span>
      </template>
    </div>
  </nav>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolIcon from '@renderer/component/tool-page/ToolIcon.vue'

const { t, locale } = useI18n()

const props = defineProps({
  current: { type: Number, default: 1 },
  pages: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  // 当前页实际数据的长度：没有总页数和总条数时，用它推断是否还有下一页。
  currentCount: { type: Number, default: 0 },
  showTotal: { type: Boolean, default: false },
  // 保留旧参数；新版固定 7 个位置。
  maxDisplayPages: { type: Number, default: 7 },
  size: { type: Number, default: 20 },
  // 正在读取目标页时，在被点的按钮上显示加载圈。
  loading: { type: Boolean, default: false },
  // 页数较多时显示「跳至 __ 页」输入框。
  showJumper: { type: Boolean, default: false }
})

const emit = defineEmits(['update:current', 'update:size', 'change'])

const currentPage = ref(props.current)
const localSize = ref(props.size)
const pendingPage = ref(0)
const pendingDirection = ref(0)

const hasKnownTotalPages = computed(() => props.pages > 0 || props.total > 0)

const totalPages = computed(() => {
  if (props.pages > 0) return props.pages
  if (props.total > 0) return Math.ceil(props.total / localSize.value)
  // 都没有时：当前页装满了就假设还有下一页，否则当前页就是最后一页。
  if (props.currentCount >= localSize.value) {
    return Math.max(currentPage.value + 1, 1)
  }
  return Math.max(currentPage.value, 1)
})

const shouldShowPagination = computed(() => totalPages.value > 1)

watch(
  () => props.current,
  (val) => {
    currentPage.value = val
    if (!props.loading) {
      pendingPage.value = 0
      pendingDirection.value = 0
    }
  }
)
watch(
  () => props.size,
  (val) => {
    localSize.value = val
  }
)
watch(
  () => props.loading,
  (val) => {
    if (!val) {
      // 请求失败时父级页码可能未变化，结束加载后也需恢复已确认的页码。
      currentPage.value = props.current
      pendingPage.value = 0
      pendingDirection.value = 0
    }
  }
)

// 删除数据后页码可能越界，跳回最后一页。
watch(totalPages, (newVal) => {
  if (currentPage.value > newVal) {
    handlePageChange(newVal)
  }
})

const SLOT_COUNT = 7

const displayedPages = computed(() => {
  if (!hasKnownTotalPages.value) return []
  const last = totalPages.value
  const page = currentPage.value
  let list
  if (last <= SLOT_COUNT) {
    list = Array.from({ length: last }, (_, index) => index + 1)
  } else if (page <= 4) {
    list = [1, 2, 3, 4, 5, 'gap-end', last]
  } else if (page >= last - 3) {
    list = [1, 'gap-start', last - 4, last - 3, last - 2, last - 1, last]
  } else {
    list = [1, 'gap-start', page - 1, page, page + 1, 'gap-end', last]
  }
  return list.map((item) =>
    typeof item === 'number'
      ? { key: `p${item}`, page: item, gap: false }
      : { key: item, page: 0, gap: true }
  )
})

const numberLocale = computed(() => (String(locale.value).startsWith('zh') ? 'zh-CN' : 'en-US'))

function formatNumber(value) {
  return Number(value || 0).toLocaleString(numberLocale.value)
}

const summaryText = computed(() => {
  if (!props.showTotal || props.total <= 0) return ''
  const from = (currentPage.value - 1) * localSize.value + 1
  const to = Math.min(currentPage.value * localSize.value, props.total)
  if (from > props.total) {
    return t('pagination.totalOnly', { total: formatNumber(props.total) })
  }
  return t('pagination.range', {
    from: formatNumber(from),
    to: formatNumber(to),
    total: formatNumber(props.total)
  })
})

const jumpValue = ref('')
const showJumperControl = computed(
  () => props.showJumper && hasKnownTotalPages.value && totalPages.value > SLOT_COUNT
)

// 只接受正整数，超出范围时跳到首页或末页；无效输入直接清空，不触发翻页。
function submitJump() {
  const text = String(jumpValue.value || '').trim()
  jumpValue.value = ''
  if (!/^\d+$/.test(text)) return
  const page = Math.min(Math.max(Number(text), 1), totalPages.value)
  handlePageChange(page)
}

const handlePageChange = (page) => {
  if (props.loading || page < 1 || page > totalPages.value || page === currentPage.value) return
  pendingPage.value = page
  pendingDirection.value = Math.sign(page - currentPage.value)
  currentPage.value = page
  emit('update:current', page)
  emit('change', page, localSize.value)
}
</script>

<style scoped>
/* 吸附在滚动容器底部，浮在列表上方；滚到最后时回到列表末尾，不会盖住最后一行。 */
.vx-pagination {
  position: sticky;
  bottom: 0;
  z-index: var(--z-index-pagination, 10);
  container-type: inline-size;
  display: flex;
  justify-content: center;
  width: 100%;
  padding: var(--space-3, 12px) 0;
  box-sizing: border-box;
  pointer-events: none;
}

.vx-pagination__row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-lg, 12px);
  background: color-mix(in srgb, var(--color-surface, #ffffff) 92%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(15, 23, 42, 0.08));
  pointer-events: auto;
}

.vx-pagination__list {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 4px;
  padding: 0;
  list-style: none;
}

.vx-pagination__btn {
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--color-text-tertiary, #5d6779);
  font: inherit;
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background var(--duration-fast, 0.15s) var(--ease-standard, ease),
    color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.vx-pagination__btn.is-arrow {
  color: var(--color-text-secondary, #344054);
}

.vx-pagination__btn:hover:not(:disabled):not(.is-current) {
  background: var(--color-bg, #eef1f5);
  color: var(--color-text, #151922);
}

.vx-pagination__btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring, 0 0 0 3px #d8efff);
}

.vx-pagination__btn:disabled {
  cursor: default;
}

.vx-pagination__btn.is-arrow:disabled {
  color: var(--color-border-strong, #c4ceda);
  cursor: not-allowed;
}

.vx-pagination__btn.is-current {
  background: var(--color-text, #151922);
  color: var(--color-text-inverse, #ffffff);
  font-weight: 600;
  cursor: default;
}

.vx-pagination__gap {
  min-width: 26px;
  display: inline-flex;
  justify-content: center;
  color: var(--color-text-subtle, #98a2b3);
  font-size: 13.5px;
  user-select: none;
}

.vx-pagination__page-only,
.vx-pagination__compact {
  min-width: 72px;
  padding: 0 8px;
  text-align: center;
  color: var(--color-text-secondary, #344054);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.vx-pagination__compact {
  display: none;
}

.vx-pagination__compact strong {
  color: var(--color-text, #151922);
  font-weight: 600;
}

.vx-pagination__divider {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--color-border, #d9e0e8);
}

.vx-pagination__summary {
  padding-right: 8px;
  white-space: nowrap;
  color: var(--color-text-muted, #667085);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.vx-pagination__spinner {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: vx-pagination-spin 0.7s linear infinite;
}

@keyframes vx-pagination-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vx-pagination__spinner {
    animation-duration: 2s;
  }
}

.vx-pagination__jump-group {
  display: inline-flex;
  align-items: center;
}

.vx-pagination__jumper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
  color: var(--color-text-muted, #667085);
  font-size: 12px;
  white-space: nowrap;
}

.vx-pagination__jumper-input {
  width: 52px;
  height: 30px;
  padding: 0 6px;
  box-sizing: border-box;
  color: var(--color-text, #151922);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  background: var(--control-bg, #ffffff);
  border: 1px solid var(--color-border, #d9e0e8);
  border-radius: var(--radius-sm, 6px);
  outline: none;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.vx-pagination__jumper-input:hover:not(:disabled) {
  border-color: var(--color-border-strong, #c4ceda);
}

.vx-pagination__jumper-input:focus {
  border-color: var(--color-border-strong, #c4ceda);
  box-shadow: inset 0 -2px 0 var(--color-accent, #0a96ff);
}

.vx-pagination__jumper-input::placeholder {
  color: var(--color-placeholder, #667085);
}

@container (max-width: 520px) {
  .vx-pagination__jump-group {
    display: none;
  }
}

@container (max-width: 380px) {
  .vx-pagination__list,
  .vx-pagination__divider,
  .vx-pagination__summary {
    display: none;
  }

  .vx-pagination__compact {
    display: inline-block;
  }
}
</style>
