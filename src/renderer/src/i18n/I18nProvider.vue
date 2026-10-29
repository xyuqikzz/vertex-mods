<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import enUS from 'ant-design-vue/es/locale/en_US'

const { locale } = useI18n()
const componentLocale = computed(() => (locale.value === 'en-US' ? enUS : zhCN))
</script>

<template>
  <ConfigProvider :locale="componentLocale">
    <slot />
  </ConfigProvider>
</template>
