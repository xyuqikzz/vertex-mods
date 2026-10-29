<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  VxButton,
  VxConfirmModal,
  VxDialogActions,
  VxModal,
  VxSegmented,
  VxTextarea
} from '@renderer/component/vertex-ui'
import {
  canSaveImportedRule,
  prepareAiRuleSave,
  validateAiRuleInput
} from '../install-rule-ai-import.js'
import ruleReference from '@renderer/docs/install-rule-reference.md?raw'
import {
  buildInstallRuleAiPrompt,
  getInstallRuleAiIdentity,
  getInstallRuleAiSourceLabel
} from '../install-rule-ai-prompt.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  gameContext: { type: Object, default: () => ({}) },
  editorAvailable: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'open-editor', 'saved'])
const activeTab = ref('prompt')
const ruleText = ref('')
const ruleError = ref('')
const ruleFeedback = ref('')
const ruleWarnings = ref([])
const savedText = ref('')
const operation = ref('')
const confirmReplace = ref(false)
const busy = computed(() => !!operation.value)
const canSave = computed(() => canSaveImportedRule(props.gameContext))
let requestSerial = 0
let pendingSave = null

function clearRuleState() {
  requestSerial++
  activeTab.value = 'prompt'
  ruleText.value = ''
  ruleError.value = ''
  ruleFeedback.value = ''
  ruleWarnings.value = []
  savedText.value = ''
  operation.value = ''
  confirmReplace.value = false
  pendingSave = null
}

function updateRuleText(text) {
  ruleText.value = text
  ruleError.value = ''
  ruleFeedback.value = ''
  ruleWarnings.value = []
  savedText.value = ''
  pendingSave = null
}

async function pasteRule() {
  if (busy.value) return
  const serial = ++requestSerial
  operation.value = 'paste'
  try {
    const text = await navigator.clipboard.readText()
    if (serial === requestSerial) {
      updateRuleText(text)
      if (!text.trim()) ruleError.value = '剪贴板为空，请粘贴 AI 返回的规则 JSON。'
    }
  } catch {
    if (serial === requestSerial) ruleError.value = '读取剪贴板失败，请在输入框中使用 Ctrl+V 粘贴。'
  } finally {
    if (serial === requestSerial) operation.value = ''
  }
}

async function commitPreparedSave(serial = requestSerial) {
  const prepared = pendingSave
  if (!prepared || busy.value || serial !== requestSerial) return
  operation.value = 'save'
  try {
    await prepared.save()
    if (serial !== requestSerial) return
    savedText.value = ruleText.value
    pendingSave = null
    ruleFeedback.value = '本地安装规则已保存，当前游戏页面正在重新读取规则。'
    emit('saved')
  } catch (error) {
    if (serial === requestSerial)
      ruleError.value = error?.message || uiText('ui.saveFailedYourInputHasBeenKeptPleaseTryAgain')
    return { success: false, message: error?.message || uiText('ui.saveFailedYourInputHasBeenKeptPleaseTryAgain') }
  } finally {
    if (serial === requestSerial) operation.value = ''
  }
}

async function validateRule(save = false) {
  if (busy.value) return
  const serial = ++requestSerial
  const context = JSON.parse(JSON.stringify(props.gameContext))
  operation.value = 'validate'
  ruleError.value = ''
  ruleFeedback.value = ''
  ruleWarnings.value = []
  try {
    const result = await validateAiRuleInput(ruleText.value)
    if (serial !== requestSerial) return
    if (!result.valid) {
      ruleError.value = result.message
      return
    }
    ruleText.value = result.formattedText
    ruleWarnings.value = result.warnings.map((item) =>
      `${item.path || ''} ${item.message || item.code}`.trim()
    )
    ruleFeedback.value = 'JSON 格式和规则结构校验通过。实际匹配结果仍需通过模组安装预检确认。'
    if (!save || !canSave.value) return
    operation.value = 'prepare'
    const prepared = await prepareAiRuleSave(context, result.formattedText)
    if (serial !== requestSerial) return
    pendingSave = prepared
    operation.value = ''
    if (prepared.requiresConfirmation) confirmReplace.value = true
    else await commitPreparedSave(serial)
  } catch (error) {
    if (serial === requestSerial) ruleError.value = error?.message || '校验失败，请重试。'
  } finally {
    if (serial === requestSerial) operation.value = ''
  }
}

onBeforeUnmount(() => {
  requestSerial++
})
const details = ref('')
const copying = ref(false)
const copiedPrompt = ref('')
const copyError = ref('')
const prompt = computed(() =>
  buildInstallRuleAiPrompt(props.gameContext, ruleReference, details.value)
)
const copied = computed(() => copiedPrompt.value === prompt.value)
const promptLabel = computed(
  () => uiText('ui.fullPromptValueCharacters', { value1: (prompt.value.length.toLocaleString('zh-CN')) })
)

watch(
  () => getInstallRuleAiIdentity(props.gameContext),
  () => {
    clearRuleState()
    details.value = ''
    copiedPrompt.value = ''
    copyError.value = ''
  }
)
watch(prompt, () => {
  copyError.value = ''
})
watch(
  () => props.modelValue,
  (open) => {
    copyError.value = ''
    if (!open) {
      requestSerial++
      operation.value = ''
      confirmReplace.value = false
      pendingSave = null
    }
  }
)

async function copyPrompt() {
  if (copying.value) return
  copying.value = true
  copyError.value = ''
  const text = prompt.value
  try {
    await navigator.clipboard.writeText(text)
    copiedPrompt.value = text
  } catch {
    copyError.value = '复制失败，请在下方提示词中全选后手动复制。'
  } finally {
    copying.value = false
  }
}

function openEditor() {
  emit('update:modelValue', false)
  emit('open-editor')
}
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="$t('modBrowser.aiRule')"
    :subtitle="$t('ui.copyThisToYourPreferredAIThenReturnHereTo')"
    :width="800"
    panel-class="install-rule-ai-prompt-panel"
    :close-on-esc="!busy"
    :show-close="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="rule-ai-prompt">
      <div class="rule-ai-prompt__game">
        <strong>{{ gameContext.gameName || gameContext.domainName || $t('ui.currentGame') }}</strong>
        <span
          >{{ getInstallRuleAiSourceLabel(gameContext) }} ·
          {{
            gameContext.sourceSlug ||
            gameContext.domainName ||
            gameContext.sourceGameId ||
            $t('ui.currentGame')
          }}</span
        >
      </div>

      <VxSegmented
        v-model="activeTab"
        :inert="busy"
        :options="[
          { value: 'prompt', label: '1. 获取提示词' },
          { value: 'json', label: '2. 粘贴规则 JSON' }
        ]"
      />

      <section
        v-if="activeTab === 'prompt'"
        class="rule-ai-prompt__workspace"
        :aria-label="$t('ui.getAIPrompt')"
      >
        <p class="rule-ai-prompt__feedback">
          {{ $t('ui.sendThisToChatGPTDeepSeekClaudeOrAnotherAIGame') }}
        </p>
        <p v-if="!editorAvailable" class="rule-ai-prompt__feedback">
          {{
            gameContext.sourcePlatform === 'thunderstore'
              ? $t('ui.thunderstoreUsesBuiltInInstallationLogicTheGeneratedJSONIs')
              : $t('ui.thisSourceDoesNotYetSupportLocalJSONImportThe')
          }}
        </p>

        <details class="rule-ai-prompt__details">
          <summary>{{ $t('ui.addInstallationInstructionsOrADirectoryTree') }} <span>{{ $t('localMod.optional') }}</span></summary>
          <VxTextarea
            v-model="details"
            :label="$t('ui.installationInstructionsOrDirectoryTree')"
            :placeholder="$t('ui.forExampleModInstallationInstructionsArchiveDirectoryTreeOrThe')"
            :hint="$t('ui.includeAREADMEOrModDirectoryTreeIfAvailableThe')"
            :rows="3"
          />
        </details>
        <VxTextarea
          class="rule-ai-prompt__preview"
          :model-value="prompt"
          :label="promptLabel"
          :hint="$t('ui.copyTheFullPromptToYourAIThenPasteIts')"
          readonly
          :rows="6"
        />
        <p v-if="copyError" class="rule-ai-prompt__error" role="alert">{{ copyError }}</p>
        <p v-else class="rule-ai-prompt__feedback" role="status">
          {{
            copied
              ? $t('ui.promptCopiedYouCanSendItToYourAI')
              : $t('ui.ifTheAINeedsMoreInformationAnswerItsQuestionsBefore')
          }}
        </p>
      </section>
      <section v-else class="rule-ai-prompt__workspace" :aria-label="$t('ui.validateAIRuleJSON')">
        <p class="rule-ai-prompt__feedback">
          {{
            canSave
              ? $t('ui.pasteTheFullJSONReturnedByYourAIValidateIt')
              : $t('ui.thisSourceOnlySupportsPastingAndValidatingJSONItWill')
          }}
        </p>
        <div class="rule-ai-prompt__json-tools">
          <VxButton variant="secondary" :disabled="busy" @click="pasteRule">{{ $t('ui.pasteFromClipboard') }}</VxButton>
          <VxButton
            v-if="canSave"
            variant="secondary"
            :disabled="busy || !ruleText.trim()"
            @click="validateRule(false)"
            >{{ $t('ui.validateAndFormat') }}</VxButton
          >
        </div>
        <VxTextarea
          class="rule-ai-prompt__json"
          :model-value="ruleText"
          :label="$t('ui.aIGeneratedInstallationRuleJSON')"
          :placeholder="$t('ui.pasteTheCompleteRuleJSONHere')"
          :hint="$t('ui.acceptsPlainJSONOrACompleteJsonCodeBlockComments')"
          :error="ruleError"
          :readonly="busy"
          :rows="6"
          @update:model-value="updateRuleText"
        />
        <p v-if="ruleFeedback" class="rule-ai-prompt__validation" role="status">
          {{ ruleFeedback }}
        </p>
        <ul v-if="ruleWarnings.length" class="rule-ai-prompt__warnings vx-ui-scrollbar">
          <li v-for="(warning, index) in ruleWarnings" :key="index">{{ warning }}</li>
        </ul>
      </section>
    </div>

    <template #footer>
      <div class="rule-ai-prompt__actions">
        <VxButton v-if="editorAvailable" variant="secondary" :disabled="busy" @click="openEditor"
          >{{ $t('ui.openRuleEditor') }}</VxButton
        >
        <VxDialogActions
          class="rule-ai-prompt__primary-actions"
          :cancel-text="$t('ui.close')"
          :confirm-text="
            activeTab === 'prompt'
              ? copied
                ? $t('ui.copyPromptAgain')
                : $t('ui.copyAIPrompt')
              : canSave
                ? $t('ui.validateAndSaveRules')
                : $t('ui.validateJSON')
          "
          :confirm-loading="activeTab === 'prompt' ? copying : busy"
          :confirm-disabled="
            activeTab === 'json' && (!ruleText.trim() || (!!savedText && savedText === ruleText))
          "
          :cancel-disabled="busy"
          @cancel="emit('update:modelValue', false)"
          @confirm="activeTab === 'prompt' ? copyPrompt() : validateRule(canSave)"
        />
      </div>
    </template>
  </VxModal>
  <VxConfirmModal
    v-model="confirmReplace"
    :title="$t('ui.replaceTheCurrentInstallationRules')"
    :description="$t('ui.saveThePastedJSONAsThisGameSLocalRules')"
    :confirm-text="$t('ui.confirmSavingLocalRules')"
    danger
    :confirm-action="() => commitPreparedSave()"
    @cancel="pendingSave = null"
  />
</template>

<style scoped lang="scss">
:global(.install-rule-ai-prompt-panel) {
  box-sizing: border-box;
  max-width: calc(100vw - var(--space-6) * 2);
  height: min(720px, calc(100dvh - var(--space-6) * 2));
  max-height: calc(100dvh - var(--space-6) * 2);
  padding: 0;
  gap: 0;
}
:global(.install-rule-ai-prompt-panel .base-dialog-header) {
  padding: var(--space-5) var(--space-6) var(--space-4);
}
:global(.install-rule-ai-prompt-panel .base-dialog-body) {
  display: flex;
  flex: 1 1 auto;
  margin: 0;
  padding: 0 var(--space-6) var(--space-4);
  scrollbar-gutter: auto;
}
:global(.install-rule-ai-prompt-panel .base-dialog-footer) {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border);
}
.rule-ai-prompt {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: min-content;
  gap: var(--space-4);
  color: var(--color-text);
}
.rule-ai-prompt__game {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  overflow-wrap: anywhere;
  strong {
    font-size: var(--font-size-lg);
  }
  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
}
.rule-ai-prompt__workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 320px;
  gap: var(--space-3);
}
.rule-ai-prompt__preview,
.rule-ai-prompt__json {
  flex: 1;
  min-height: 180px;
  grid-template-rows: auto minmax(100px, 1fr) auto;
  align-content: stretch;
  gap: var(--space-2);
  :deep(textarea) {
    height: 100%;
    min-height: 0;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-relaxed);
    resize: none;
  }
}
.rule-ai-prompt :deep(.vx-segmented) {
  flex-shrink: 0;
  min-height: var(--control-height-md);
  box-sizing: border-box;
}
.rule-ai-prompt :deep(.vx-segmented button:focus-visible) {
  box-shadow: var(--focus-ring);
}
.rule-ai-prompt__json-tools {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.rule-ai-prompt__details {
  summary {
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-sm);
    span {
      color: var(--color-text-muted);
      margin-left: var(--space-2);
    }
    &:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
  }
  &[open] summary {
    margin-bottom: var(--space-3);
  }
}
.rule-ai-prompt__feedback,
.rule-ai-prompt__error,
.rule-ai-prompt__validation,
.rule-ai-prompt__warnings {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  color: var(--color-text-muted);
}
.rule-ai-prompt__error {
  color: var(--color-danger);
}
.rule-ai-prompt__validation {
  color: var(--color-text-secondary);
}
.rule-ai-prompt__warnings {
  max-height: 80px;
  overflow-y: auto;
  padding-left: var(--space-5);
}
.rule-ai-prompt__actions {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.rule-ai-prompt__primary-actions {
  width: auto;
  margin-left: auto;
}
@media (max-width: 600px) {
  :global(.install-rule-ai-prompt-panel .base-dialog-header),
  :global(.install-rule-ai-prompt-panel .base-dialog-footer) {
    padding: var(--space-4);
  }
  :global(.install-rule-ai-prompt-panel .base-dialog-body) {
    padding: 0 var(--space-4) var(--space-4);
  }
}
</style>
