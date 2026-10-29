<script setup>
import { computed } from 'vue'
import { VxSwitch } from '@renderer/component/vertex-ui'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'

const props = defineProps({ modelValue: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const enabled = computed({
  get: () => props.modelValue.statisticsEnabled === true,
  set: (statisticsEnabled) => emit('update:modelValue', { ...props.modelValue, statisticsEnabled })
})
</script>

<template>
  <SettingGroup :title="$t('ui.privacyAndDiagnostics')">
    <SettingRow :label="$t('ui.sendUsageStatisticsAndErrorReports')" :description="$t('ui.offByDefault')">
      <VxSwitch v-model="enabled" class="setting-switch" :label="$t('ui.allowUsageStatisticsAndErrorReports')" />
    </SettingRow>
    <dl class="privacy-details">
      <dt>{{ $t('ui.whenEnabledSends') }}</dt>
      <dd>{{ $t('ui.pageVisitsModOperationsAndErrorsToYourConfiguredVertex') }}</dd>
      <dt>{{ $t('ui.doesNotCollect') }}</dt>
      <dd>{{ $t('ui.hardwareIdentifiers') }}</dd>
      <dt>{{ $t('ui.whenDisabled') }}</dt>
      <dd>{{ $t('ui.stopsReportingAndClearsPendingDataLocalLogsAreKept') }}</dd>
    </dl>
  </SettingGroup>
</template>

<style scoped>
.privacy-details {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-4) var(--space-5);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  border-top: 1px solid var(--color-surface-strong);
}

.privacy-details dt {
  color: var(--color-text-muted);
}

.privacy-details dd {
  margin: 0;
  color: var(--color-text);
}
</style>
