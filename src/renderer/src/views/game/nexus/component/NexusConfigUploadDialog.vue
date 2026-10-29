<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxModal, VxSegmented } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import { buildInstallRuleOutline } from '@views/game/source/install-rule-outline.js'
import {
  buildDefaultPlayerConfigRuleText,
  formatInstallConfigTime,
  validateInstallConfigRuleJsonText
} from '../nexus-config-profile-utils.js'

// 上传 / 编辑「我的配置」。规则只在「编辑规则」页签里改，这里只选用哪一份规则并填写名称和说明。
const NAME_LIMIT = 64
const DESC_LIMIT = 500
const RULE_SOURCE = Object.freeze({ BASE: 'base', EDITOR: 'editor' })

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'create' },
  // 读取已发布配置时为 true
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  // 编辑时是已发布的配置；复制时带着被复制的规则；新建时为草稿。
  profile: { type: Object, default: () => ({}) },
  // 「编辑规则」页签里当前的规则文本
  editorRuleJsonText: { type: String, default: '' },
  gameContext: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:open', 'submit', 'edit-rules'])

const { t, locale } = useI18n()

const configName = ref('')
const configDesc = ref('')
const ruleSource = ref(RULE_SOURCE.EDITOR)
const nameTouched = ref(false)

const isEdit = computed(() => props.mode === 'edit')
const title = computed(() =>
  isEdit.value ? t('dialogs.configUpload.editTitle') : t('dialogs.configUpload.createTitle')
)

const subtitle = computed(() => {
  const platform = String(props.gameContext?.sourcePlatform || 'nexus').trim()
  const platformLabel = platform === 'nexus' ? 'Nexus' : platform
  const game = String(props.gameContext?.gameName || props.gameContext?.domainName || '').trim()
  return [platformLabel, game, t('dialogs.configUpload.subtitle')].filter(Boolean).join(' · ')
})

function normalizeRuleText(text = '') {
  const source = String(text || '').trim()
  if (!source) return ''
  try {
    return JSON.stringify(JSON.parse(source))
  } catch {
    return source
  }
}

const editorText = computed(() => buildDefaultPlayerConfigRuleText(props.editorRuleJsonText))
const baseText = computed(() => String(props.profile?.ruleJsonText || '').trim())
// 已发布（或复制来的）规则和编辑器里的一样时，不需要让用户选。
const hasChoice = computed(
  () =>
    !!baseText.value && normalizeRuleText(baseText.value) !== normalizeRuleText(editorText.value)
)
const selectedText = computed(() =>
  hasChoice.value && ruleSource.value === RULE_SOURCE.BASE ? baseText.value : editorText.value
)

function summarize(text = '') {
  const outline = buildInstallRuleOutline(text)
  const validation = validateInstallConfigRuleJsonText(text)
  const bytes = new Blob([String(text || '')]).size
  return {
    ruleCount: outline.ruleCount,
    schemaVersion: outline.schemaVersion,
    size: bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`,
    validation
  }
}

const baseSummary = computed(() => summarize(baseText.value))
const editorSummary = computed(() => summarize(editorText.value))
const selectedSummary = computed(() =>
  hasChoice.value && ruleSource.value === RULE_SOURCE.BASE ? baseSummary.value : editorSummary.value
)

const ruleOptions = computed(() => [
  {
    value: RULE_SOURCE.BASE,
    label: isEdit.value
      ? t('dialogs.configUpload.keepPublished', { count: baseSummary.value.ruleCount })
      : t('dialogs.configUpload.useCopied', { count: baseSummary.value.ruleCount })
  },
  {
    value: RULE_SOURCE.EDITOR,
    label: t('dialogs.configUpload.useEditor', { count: editorSummary.value.ruleCount })
  }
])

const ruleOriginText = computed(() => {
  if (hasChoice.value && ruleSource.value === RULE_SOURCE.BASE) {
    return isEdit.value
      ? t('dialogs.configUpload.originPublished')
      : t('dialogs.configUpload.originCopied')
  }
  return t('dialogs.configUpload.originEditor')
})

const ruleMetaText = computed(() => {
  const summary = selectedSummary.value
  return [
    t('dialogs.configUpload.ruleCount', { count: summary.ruleCount }),
    summary.schemaVersion ? `schema v${summary.schemaVersion}` : '',
    summary.size
  ]
    .filter(Boolean)
    .join(' · ')
})

const ruleValid = computed(() => !!selectedSummary.value.validation?.valid)
const nameText = computed(() => configName.value.trim())
const nameError = computed(() =>
  nameTouched.value && !nameText.value ? t('dialogs.configUpload.nameRequired') : ''
)
const canSubmit = computed(
  () => !props.loading && !props.saving && !!nameText.value && ruleValid.value
)

const primaryText = computed(() => {
  if (props.saving) {
    return isEdit.value ? t('dialogs.configUpload.saving') : t('dialogs.configUpload.uploading')
  }
  return isEdit.value ? t('dialogs.configUpload.save') : t('dialogs.configUpload.upload')
})

const publishedMeta = computed(() => {
  if (!isEdit.value || !props.profile?.id) return ''
  const parts = [
    t('dialogs.configUpload.usedCount', {
      count: Number(props.profile?.useCount || 0).toLocaleString(
        String(locale.value).startsWith('zh') ? 'zh-CN' : 'en-US'
      )
    })
  ]
  const time = props.profile?.updatedAt || props.profile?.publishedAt
  if (time) parts.push(t('dialogs.configUpload.updatedAt', { time: formatInstallConfigTime(time) }))
  return parts.join(' · ')
})

function charCount(text = '') {
  return [...String(text || '')].length
}

function limitText(text = '', limit = 0) {
  const chars = [...String(text || '')]
  return chars.length > limit ? chars.slice(0, limit).join('') : String(text || '')
}

function close() {
  if (props.saving) return
  emit('update:open', false)
}

function submit() {
  nameTouched.value = true
  if (!canSubmit.value) return
  const validation = selectedSummary.value.validation
  emit('submit', {
    ...props.profile,
    configName: nameText.value,
    configDesc: configDesc.value.trim(),
    ruleJsonText: String(validation?.formattedText || selectedText.value || '')
  })
}

watch(
  () => [props.open, props.profile],
  ([isOpen]) => {
    if (!isOpen) return
    configName.value = limitText(props.profile?.configName || '', NAME_LIMIT)
    configDesc.value = limitText(props.profile?.configDesc || '', DESC_LIMIT)
    // 编辑时默认保留已发布的规则，避免只改说明却连规则一起替换。
    ruleSource.value = RULE_SOURCE.BASE
    nameTouched.value = false
  },
  { immediate: true }
)
</script>

<template>
  <VxModal
    :model-value="open"
    :title="title"
    :subtitle="subtitle"
    :width="520"
    :close-on-esc="!saving"
    :show-close="!saving"
    @update:model-value="(value) => !value && close()"
  >
    <div class="cfg-upload" :aria-busy="loading">
      <p v-if="publishedMeta" class="cfg-upload__published">
        <span class="cfg-upload__badge">{{ t('dialogs.configUpload.published') }}</span>
        {{ publishedMeta }}
      </p>

      <div v-if="loading" class="cfg-upload__skeleton" aria-hidden="true">
        <span class="tool-skeleton is-line"></span>
        <span class="tool-skeleton is-line"></span>
        <span class="tool-skeleton is-short"></span>
      </div>

      <template v-else>
        <div class="cfg-upload__field">
          <div class="cfg-upload__label-row">
            <label for="cfg-upload-name" class="cfg-upload__label">
              {{ t('dialogs.configUpload.name') }} <span aria-hidden="true">*</span>
            </label>
            <span class="cfg-upload__count">{{ charCount(configName) }} / {{ NAME_LIMIT }}</span>
          </div>
          <input
            id="cfg-upload-name"
            v-model="configName"
            class="cfg-upload__input"
            type="text"
            :maxlength="NAME_LIMIT"
            :placeholder="t('dialogs.configUpload.namePlaceholder')"
            :disabled="saving"
            :aria-invalid="!!nameError"
            :aria-describedby="nameError ? 'cfg-upload-name-error' : undefined"
            required
            @blur="nameTouched = true"
          />
          <span v-if="nameError" id="cfg-upload-name-error" class="cfg-upload__error">{{
            nameError
          }}</span>
        </div>

        <div class="cfg-upload__field">
          <div class="cfg-upload__label-row">
            <label for="cfg-upload-desc" class="cfg-upload__label">
              {{ t('dialogs.configUpload.desc') }}
              <span class="cfg-upload__optional">{{ t('dialogs.configUpload.optional') }}</span>
            </label>
            <span class="cfg-upload__count">{{ charCount(configDesc) }} / {{ DESC_LIMIT }}</span>
          </div>
          <textarea
            id="cfg-upload-desc"
            v-model="configDesc"
            class="cfg-upload__input is-textarea vx-ui-scrollbar"
            rows="3"
            :maxlength="DESC_LIMIT"
            :placeholder="t('dialogs.configUpload.descPlaceholder')"
            :disabled="saving"
          ></textarea>
        </div>

        <div class="cfg-upload__field">
          <span id="cfg-upload-rule-label" class="cfg-upload__label">{{
            t('dialogs.configUpload.rules')
          }}</span>
          <VxSegmented
            v-if="hasChoice"
            v-model="ruleSource"
            :options="ruleOptions"
            aria-labelledby="cfg-upload-rule-label"
            class="cfg-upload__segmented"
          />
          <div class="cfg-upload__rule" :class="{ 'is-invalid': !ruleValid }">
            <span class="cfg-upload__rule-icon" aria-hidden="true">
              <ToolIcon name="code" :size="16" />
            </span>
            <div class="cfg-upload__rule-main">
              <span class="cfg-upload__rule-origin">{{ ruleOriginText }}</span>
              <span class="cfg-upload__rule-meta">{{ ruleMetaText }}</span>
              <span v-if="ruleValid" class="cfg-upload__rule-status is-valid">
                <ToolIcon name="check" :size="13" />
                {{ t('dialogs.configUpload.valid') }}
              </span>
              <span v-else class="cfg-upload__rule-status is-invalid" role="alert">
                <ToolIcon name="error" :size="13" />
                {{
                  t('dialogs.configUpload.invalid', {
                    reason: selectedSummary.validation?.message || ''
                  })
                }}
              </span>
            </div>
            <VxButton variant="secondary" size="sm" :disabled="saving" @click="emit('edit-rules')">
              {{ t('dialogs.configUpload.editRules') }}
            </VxButton>
          </div>
          <p class="cfg-upload__hint">{{ t('dialogs.configUpload.rulesHint') }}</p>
        </div>

        <p class="cfg-upload__notice">
          <ToolIcon name="info" :size="14" />
          <span>{{ t('dialogs.configUpload.notice') }}</span>
        </p>
      </template>
    </div>

    <template #footer>
      <VxButton variant="secondary" :disabled="saving" @click="close">
        {{ t('dialogs.cancel') }}
      </VxButton>
      <VxButton :disabled="!canSubmit" :loading="saving" @click="submit">{{
        primaryText
      }}</VxButton>
    </template>
  </VxModal>
</template>

<style scoped>
.cfg-upload {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cfg-upload__published {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 0;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.cfg-upload__badge {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--color-success-soft);
  color: var(--color-success-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.cfg-upload__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cfg-upload__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cfg-upload__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.cfg-upload__label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.cfg-upload__label [aria-hidden='true'] {
  color: var(--color-danger-strong);
}

.cfg-upload__optional {
  color: var(--color-text-muted);
  font-weight: 400;
}

.cfg-upload__count {
  color: var(--color-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.cfg-upload__input {
  width: 100%;
  height: 38px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
}

.cfg-upload__input.is-textarea {
  height: auto;
  min-height: 76px;
  padding: 9px 12px;
  line-height: 1.6;
  resize: vertical;
}

.cfg-upload__input::placeholder {
  color: var(--color-placeholder);
}

.cfg-upload__input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.cfg-upload__input[aria-invalid='true'] {
  border-color: var(--color-danger);
}

.cfg-upload__input:disabled {
  background: var(--control-bg-disabled);
}

.cfg-upload__error {
  color: var(--color-danger-strong);
  font-size: 12.5px;
}

.cfg-upload__segmented {
  box-sizing: border-box;
  margin-bottom: 2px;
}

.cfg-upload__rule {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-soft);
}

.cfg-upload__rule.is-invalid {
  border-color: #f3b9b9;
  background: var(--color-danger-soft);
}

.cfg-upload__rule-icon {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-tertiary);
}

.cfg-upload__rule-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cfg-upload__rule-origin {
  font-size: 13.5px;
  font-weight: 600;
}

.cfg-upload__rule-meta {
  color: var(--color-text-tertiary);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.cfg-upload__rule-status {
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 12.5px;
  line-height: 1.5;
}

.cfg-upload__rule-status :deep(svg) {
  margin-top: 2px;
}

.cfg-upload__rule-status.is-valid {
  color: var(--color-success-strong);
}

.cfg-upload__rule-status.is-invalid {
  color: var(--color-danger-strong);
}

.cfg-upload__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.cfg-upload__notice {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-info-soft);
  color: var(--color-accent-strong);
  font-size: 12.5px;
  line-height: 1.6;
}

.cfg-upload__notice :deep(svg) {
  flex: 0 0 auto;
  margin-top: 3px;
}
</style>
