<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxSelect } from '@renderer/component/vertex-ui'
import SettingRow from './SettingRow.vue'
import { languagePreference, setLanguage, SUPPORTED_LANGUAGES } from '@renderer/i18n'

const { t } = useI18n()
const saveFailed = ref(false)
const options = computed(() => [
  { value: 'system', label: t('language.system') },
  ...SUPPORTED_LANGUAGES
])

function changeLanguage(value) {
  saveFailed.value = !setLanguage(value)
}
</script>

<template>
  <SettingRow
    class="language-setting"
    :label="t('language.title')"
    :description="t('language.hint')"
  >
    <VxSelect
      class="language-setting__select"
      :model-value="languagePreference"
      :aria-label="t('language.title')"
      :options="options"
      :error="saveFailed ? t('language.saveFailed') : ''"
      @update:model-value="changeLanguage"
    />
  </SettingRow>
</template>

<style scoped>
.language-setting__select {
  width: 220px;
}
</style>
