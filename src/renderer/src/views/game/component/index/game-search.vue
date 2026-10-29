<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  getPageList: Function
})

const keyword = ref('')
const skipClearSearch = ref(false)

function searchGame() {
  const text = String(keyword.value || '').trim()
  if (!text) {
    return
  }

  skipClearSearch.value = false
  props.getPageList({
    keyword: text
  })
}

function clearKeyword() {
  keyword.value = ''
}

function eliminate(triggerSearch = true) {
  skipClearSearch.value = !triggerSearch
  keyword.value = ''
}

watch(keyword, (newValue, oldValue) => {
  const oldText = String(oldValue || '').trim()
  const newText = String(newValue || '').trim()

  if (newText) {
    skipClearSearch.value = false
  }

  if (oldText && !newText) {
    if (skipClearSearch.value) {
      skipClearSearch.value = false
      return
    }
    props.getPageList({
      keyword: ''
    })
  }
})

defineExpose({
  eliminate
})
</script>

<template>
  <div class="game-search" role="search">
    <label class="game-search__field">
      <svg class="game-search__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        v-model="keyword"
        type="text"
        class="game-search__input"
        :placeholder="$t('ui.searchGameNamesInChineseOrEnglish')"
        :aria-label="$t('tools.searchGames')"
        @keydown.enter.prevent="searchGame"
        @keydown.esc="clearKeyword"
      />
      <button
        v-if="keyword"
        type="button"
        class="game-search__clear"
        :aria-label="$t('modBrowser.clearSearch')"
        @click="clearKeyword"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7 7 17" />
        </svg>
      </button>
    </label>

    <button type="button" class="game-search__submit" @click="searchGame">{{ $t('tools.search') }}</button>
  </div>
</template>

<style scoped lang="scss">
.game-search {
  display: flex;
  align-items: stretch;
  min-width: 0;

  svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
}

.game-search__field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-height-sm);
  padding: 0 6px 0 10px;
  background: var(--control-bg);
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  cursor: text;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    position: relative;
    z-index: 1;
    border-color: var(--color-accent);
    border-right: 1px solid var(--color-accent);
    box-shadow: var(--focus-ring);
  }
}

.game-search__icon {
  flex: none;
  width: 15px;
  height: 15px;
  color: var(--color-text-muted);
}

.game-search__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: transparent;
  border: 0;
  outline: none;

  &::placeholder {
    color: var(--color-placeholder);
  }
}

.game-search__clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 0;
  }
}

.game-search__submit {
  flex: none;
  min-width: 64px;
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:active {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
</style>
