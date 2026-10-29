<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import { usesChineseContent } from '@renderer/i18n/content-policy.js'
import { translateTextBatchByEdge } from '@renderer/utils/ai-translation.js'
import { createSitePageTranslator } from '@renderer/utils/site-page-translation.js'

// 站点详情页工具栏里的翻译按钮。错误通过 error 事件交给页面显示在工具栏下方，
// 页面调用暴露的 retry() 重试。
const props = defineProps({
  webview: Object,
  url: String,
  ready: Boolean,
  auto: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
})
const emit = defineEmits(['error'])
const { t, locale } = useI18n()
const state = ref({ enabled: false, busy: false, error: '' })
let navigationGeneration = 0
let userStopped = false
const translator = createSitePageTranslator({
  getView: () => props.webview,
  translate: (items) =>
    translateTextBatchByEdge({
      source: 'webpage',
      scene: 'visible_page',
      targetLanguage: 'zh-Hans',
      items
    }),
  onState: (next) => {
    state.value = next
  }
})

const label = computed(() => {
  if (state.value.busy) return t('siteDetail.translate.busy')
  if (state.value.enabled) return t('siteDetail.translate.original')
  return usesChineseContent(locale.value)
    ? t('siteDetail.translate.label')
    : t('siteDetail.translate.labelEn')
})
const hint = computed(() => {
  if (!props.ready) return t('siteDetail.translate.waitHint')
  return state.value.enabled
    ? t('siteDetail.translate.stopHint')
    : t('siteDetail.translate.startHint')
})

async function toggle() {
  userStopped = state.value.enabled
  if (userStopped) await translator.stop()
  else translator.start()
}
async function retry() {
  userStopped = false
  await translator.stop()
  translator.start()
}
watch(
  () => state.value.error,
  (error) => emit('error', String(error || '')),
  { immediate: true }
)
watch(
  () => [props.url, props.webview, props.ready, props.active, props.auto],
  async (current, previous) => {
    const token = ++navigationGeneration
    if (!previous || current[0] !== previous[0] || current[1] !== previous[1]) {
      await translator.stop()
      if (token !== navigationGeneration) return
    }
    if (!props.active || !props.ready) {
      translator.suspend()
      return
    }
    await translator.resume()
    if (token === navigationGeneration && props.auto && !userStopped && !state.value.enabled)
      translator.start()
  },
  { immediate: true }
)
onDeactivated(() => {
  translator.suspend()
})
onActivated(() => {
  if (props.active) void translator.resume()
})
watch(
  () => props.active,
  (active) => {
    if (active) void translator.resume()
    else translator.suspend()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  navigationGeneration++
  void translator.stop()
})

defineExpose({ retry })
</script>

<template>
  <VxButton
    :variant="state.enabled ? 'soft' : 'secondary'"
    size="sm"
    class="site-translation-button"
    :disabled="!ready"
    :aria-pressed="state.enabled"
    :aria-busy="state.busy"
    :aria-label="label"
    :title="hint"
    @click="toggle"
  >
    <span v-if="state.busy" class="site-translation-button__spinner" aria-hidden="true"></span>
    <ToolIcon v-else name="translate" :size="14" />
    <span class="site-button__text">{{ label }}</span>
  </VxButton>
</template>

<style scoped>
.site-translation-button {
  /* 「翻译 / 翻译中… / 显示原文」切换时不挤动地址栏。 */
  min-width: 92px;
}

.site-translation-button :deep(.vx-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.site-translation-button__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: site-translation-spin 700ms linear infinite;
}

@keyframes site-translation-spin {
  to {
    transform: rotate(360deg);
  }
}

@container site-toolbar (max-width: 760px) {
  .site-button__text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .site-translation-button {
    min-width: 0;
    padding: 0 var(--space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-translation-button__spinner {
    animation-duration: 2s;
  }
}
</style>
