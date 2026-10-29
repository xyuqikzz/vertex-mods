import { computed, onScopeDispose, ref, toValue, watch } from 'vue'
import { canTranslateModContent } from '@renderer/i18n/content.js'
import {
  translateTextBatchByEdge,
  resolveAiTranslationConfig
} from '@renderer/utils/ai-translation.js'
import { createDescriptionTranslationPlan } from '@renderer/utils/mod-description-translation.js'

export function useSourceDescriptionTranslation({
  source,
  entries,
  systemConfig = {},
  active = true
}) {
  const results = ref(new Map())
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  const plans = computed(
    () =>
      new Map(
        (toValue(entries) || []).map((entry) => [
          String(entry.id),
          createDescriptionTranslationPlan(entry)
        ])
      )
  )
  watch(
    () => [
      canTranslateModContent(),
      toValue(active),
      toValue(source),
      toValue(entries),
      JSON.stringify(resolveAiTranslationConfig(toValue(systemConfig)))
    ],
    async (_value, _old, onCleanup) => {
      const token = ++generation
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      results.value = new Map()
      loading.value = false
      error.value = ''
      if (!toValue(active) || !canTranslateModContent()) return
      const items = [...plans.value.values()].flatMap((plan) => plan.items)
      if (!items.length) return
      loading.value = true
      try {
        const translated = await translateTextBatchByEdge({
          source: toValue(source),
          scene: 'mod_description',
          systemConfig: toValue(systemConfig),
          items,
          onChunkSettled: ({ resultMap }) => {
            if (!cancelled && token === generation) results.value = resultMap
          }
        })
        if (!cancelled && token === generation) {
          results.value = translated
          if ([...plans.value.values()].some((plan) => !plan.isComplete(translated))) {
            error.value = '部分说明暂未翻译，已保留原文'
          }
        }
      } catch (failure) {
        if (!cancelled && token === generation) error.value = '翻译暂不可用，已保留原文'
        console.warn('[模组说明] 自动翻译失败', failure?.message || failure)
      } finally {
        if (!cancelled && token === generation) loading.value = false
      }
    },
    { immediate: true, flush: 'sync' }
  )
  onScopeDispose(() => {
    generation++
  })
  return {
    loading,
    error,
    getText: (id, original = '') => {
      if (!canTranslateModContent()) return original
      return plans.value.get(String(id))?.apply(results.value) || original
    }
  }
}
