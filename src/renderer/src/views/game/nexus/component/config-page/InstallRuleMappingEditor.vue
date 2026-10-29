<script setup>
import { computed, ref } from 'vue'
import {
  VxButton,
  VxInput,
  VxModal,
  VxTextarea,
  VxDialogActions
} from '@renderer/component/vertex-ui'
import { buildManualMappingRule } from '../../../../../../../shared/installation/install-rule-authoring.js'
const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'apply'])
const rows = ref([{ source: '', target: '' }])
const pasted = ref('')
const error = computed(() => {
  try {
    buildManualMappingRule(rows.value)
    return ''
  } catch (error) {
    return error.message
  }
})
function importPaths() {
  rows.value = pasted.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((source) => ({ source, target: source }))
}
function apply() {
  if (!error.value) emit('apply', buildManualMappingRule(rows.value, `manual-${Date.now()}`))
}
</script>
<template>
  <VxModal :model-value="props.open" :width="900" :title="$t('ui.createFileMappingRules')" @close="emit('close')">
    <div class="mapping-editor">
      <p>
        {{ $t('ui.enterEachFileSRelativePathInsideTheArchiveAnd') }}
      </p>
      <VxTextarea v-model="pasted" :aria-label="$t('ui.batchSourcePaths')" :placeholder="$t('ui.oneArchiveFilePathPerLine')" />
      <VxButton variant="secondary" :disabled="!pasted.trim()" @click="importPaths"
        >{{ $t('ui.importPathList') }}</VxButton
      >
      <div class="mapping-editor__rows vx-ui-scrollbar">
        <div v-for="(row, index) in rows" :key="index" class="mapping-editor__row">
          <VxInput
            v-model="row.source"
            :aria-label="$t('ui.sourceFileValue', { value1: (index + 1) })"
            :placeholder="$t('ui.archiveFileForExampleWrapperExampleDll')"
          />
          <VxInput
            v-model="row.target"
            :aria-label="$t('ui.targetFileValue', { value1: (index + 1) })"
            :placeholder="$t('ui.gameFileForExampleModsExampleDll')"
          />
          <VxButton
            variant="secondary"
            :aria-label="$t('ui.removeMappingValue', { value1: (index + 1) })"
            @click="rows.splice(index, 1)"
            >{{ $t('ui.remove') }}</VxButton
          >
        </div>
      </div>
      <VxButton
        variant="secondary"
        :disabled="rows.length >= 1000"
        @click="rows.push({ source: '', target: '' })"
        >{{ $t('ui.addMapping') }}</VxButton
      >
      <p v-if="error" role="status">{{ error }}</p>
      <p v-else>{{ $t('ui.willGenerate') }} {{ rows.length }} {{ $t('ui.exactFileMappingsNothingHasBeenInstalledOrSavedYet') }}</p>
    </div>
    <template #footer>
      <VxDialogActions
        :confirm-text="$t('ui.addToRuleDraft')"
        :confirm-disabled="!!error"
        @cancel="emit('close')"
        @confirm="apply"
      />
    </template>
  </VxModal>
</template>
<style scoped>
.mapping-editor {
  display: grid;
  gap: var(--space-3);
}
.mapping-editor p {
  margin: 0;
  color: var(--color-text-secondary);
}
.mapping-editor__rows {
  max-height: 45vh;
  overflow: auto;
  display: grid;
  gap: var(--space-2);
}
.mapping-editor__row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: var(--space-2);
}
</style>
