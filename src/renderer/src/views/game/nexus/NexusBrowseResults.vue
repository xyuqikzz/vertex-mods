<script setup>
import UnifiedModSearchBar from '@views/game/component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '@views/game/component/unifiedModList/UnifiedModListGrid.vue'
defineProps({
  keywordInput: String,
  loading: Boolean,
  hasNexusApiKey: Boolean,
  listType: String,
  typeOptions: Array,
  listNotice: Object,
  listItems: Array,
  nexusModFloatingActions: Array,
  query: Object,
  pages: Number,
  total: Number,
  pageMods: Array
})
const emit = defineEmits([
  'update:keyword',
  'update:filter-value',
  'search',
  'notice-action',
  'open-detail',
  'secondary-action',
  'item-action',
  'translate-item',
  'floating-action',
  'install',
  'page-change'
])
</script>

<template>
  <unified-mod-search-bar
    :keyword="keywordInput"
    :show-sort="false"
    :loading="loading"
    :disable-search="!hasNexusApiKey"
    :show-filter="true"
    :filter-value="listType"
    :filter-options="typeOptions"
    :keyword-placeholder="$t('ui.searchModNamesPlain')"
    @update:keyword="emit('update:keyword', $event)"
    @update:filter-value="emit('update:filter-value', $event)"
    @search="emit('search', $event)"
  />

  <unified-mod-list-grid
    :notice="listNotice"
    :loading="loading"
    :items="listItems"
    :floating-actions="nexusModFloatingActions"
    :current="query.page"
    :pages="pages"
    :total="total"
    :size="query.limit"
    :current-count="pageMods.length"
    :show-pagination="hasNexusApiKey && !loading && pages > 1"
    @notice-action="emit('notice-action', $event)"
    @open-detail="emit('open-detail', $event)"
    @secondary-action="emit('secondary-action', $event)"
    @item-action="emit('item-action', $event)"
    @translate-item="emit('translate-item', $event)"
    @floating-action="emit('floating-action', $event)"
    @install="emit('install', $event)"
    @page-change="emit('page-change', $event)"
  />
</template>
