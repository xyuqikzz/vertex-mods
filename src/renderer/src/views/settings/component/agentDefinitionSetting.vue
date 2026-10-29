<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { computed, onMounted, ref } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import {
  VxButton,
  VxModal,
  VxTextarea,
  VxSelect,
  VxDialogActions
} from '@renderer/component/vertex-ui'
import SettingRow from './SettingRow.vue'
import {
  mergeBuiltInAiAgentSkills,
  validateAiAgentDefinition
} from '../../../../../shared/ai/config/ai-agent-definition.js'

const visible = ref(false)
const busy = ref(false)
const draft = ref('')
const revision = ref('')
const error = ref('')
const savedConfig = ref(null)
const summary = computed(() => {
  const config = savedConfig.value
  if (!config) return uiText('ui.manageRolesSkillsAndToolsTogether')
  return uiText('ui.valueValueSkillsValueTools', { value1: (config.rolePresets.find((p) => p.id === config.activeRolePreset)?.title || ''), value2: (config.skills.filter((s) => s.enabled).length), value3: (config.tools.filter((t) => t.enabled).length) })
})
const parsed = computed(() => {
  try {
    return JSON.parse(draft.value)
  } catch {
    return null
  }
})
const roleOptions = computed(() =>
  Array.isArray(parsed.value?.rolePresets)
    ? parsed.value.rolePresets
        .filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string')
        .map((p) => ({ value: p.id, label: p.title }))
    : []
)

async function invoke(payload) {
  return ipcRenderer.invoke('ai-agent:definition', JSON.parse(JSON.stringify(payload)))
}
async function read(open = false) {
  busy.value = true
  error.value = ''
  try {
    const result = await invoke({ action: 'read' })
    draft.value = result.text || ''
    revision.value = result.revision || ''
    savedConfig.value = result.config || null
    error.value = result.success ? '' : result.message
    if (open) visible.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
function selectRole(id) {
  if (!parsed.value) return
  draft.value = JSON.stringify({ ...parsed.value, activeRolePreset: id }, null, 2)
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    validateAiAgentDefinition(JSON.parse(draft.value))
    const result = await invoke({ action: 'save', text: draft.value, revision: revision.value })
    if (!result.success) throw new Error(result.message)
    draft.value = result.text
    revision.value = result.revision
    savedConfig.value = result.config
    visible.value = false
    $message.success(uiMessage('ui.agentConfigurationSavedChangesApplyToTheNextRequest'))
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function reveal() {
  busy.value = true
  try {
    const result = await invoke({ action: 'reveal' })
    if (!result.success) throw new Error(result.message)
    if (revision.value === 'default') revision.value = result.revision
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
function mergeSkills() {
  try {
    const config = validateAiAgentDefinition(JSON.parse(draft.value))
    draft.value = JSON.stringify(mergeBuiltInAiAgentSkills(config), null, 2)
    error.value = ''
    $message.success(uiMessage('ui.missingEntriesWereAddedToTheDraftNewToolsAre'))
  } catch (e) {
    error.value = e.message
  }
}
function handleAction(action) {
  if (action.key === 'merge-skills') mergeSkills()
  else reveal()
}
onMounted(() => read())
</script>

<template>
  <div class="agent-definition-setting">
    <SettingRow
      :label="$t('ui.agentConfiguration')"
      :description="$t('ui.valueEditRolePresetsSkillInstructionsAndToolSwitchesSaved', { value1: (summary) })"
    >
      <VxButton variant="secondary" size="sm" :disabled="busy" @click="read(true)"
        >{{ $t('ui.editConfiguration') }}</VxButton
      >
    </SettingRow>
    <SettingRow :label="$t('ui.configurationFile')" :description="$t('ui.changesMadeToAiAgentJsonInAnExternalEditor')">
      <VxButton variant="ghost" size="sm" :disabled="busy" @click="reveal">{{ $t('ui.showFile') }}</VxButton>
    </SettingRow>
    <p v-if="error && !visible" class="definition-error setting-inline-error" role="alert">
      {{ error }}
    </p>
    <VxModal
      v-model="visible"
      :title="$t('ui.agentConfiguration')"
      :description="$t('ui.editRolePresetsSkillInstructionsAndToolSwitchesChangesApply')"
      :width="860"
      :close-on-esc="!busy"
      :show-close="!busy"
    >
      <div class="definition-editor">
        <VxSelect
          :model-value="parsed?.activeRolePreset || ''"
          :options="roleOptions"
          :label="$t('ui.rolePreset')"
          :disabled="busy || !roleOptions.length"
          @update:model-value="selectRole"
        />
        <VxTextarea
          v-model="draft"
          :label="$t('ui.jSONConfiguration')"
          :rows="18"
          :disabled="busy"
          :error="error"
          :hint="$t('ui.supportsRoleRolePresetsSkillsToolsRuntimeAndRoutingSkillsSupport')"
          spellcheck="false"
        />
        <p class="definition-note">
          {{ $t('ui.externalChangesToAiAgentJsonAreLoadedAutomaticallyIf') }}
        </p>
      </div>
      <template #footer>
        <VxDialogActions
          :confirm-text="$t('modelSettings.saveConfig')"
          :confirm-loading="busy"
          :cancel-disabled="busy"
          :actions="[
            { key: 'merge-skills', text: '补齐内置技能', disabled: busy },
            { key: 'reveal', text: '定位 JSON 文件', disabled: busy }
          ]"
          @cancel="visible = false"
          @confirm="save"
          @action="handleAction"
        />
      </template>
    </VxModal>
  </div>
</template>

<style scoped lang="scss">
.definition-editor {
  display: grid;
  gap: var(--space-4);
}
.definition-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.definition-editor :deep(textarea) {
  height: clamp(150px, 28vh, 360px);
  resize: none;
  font-family: var(--font-family-mono, monospace);
}
.definition-error {
  padding: 0 var(--space-5) var(--space-4);
}
</style>
