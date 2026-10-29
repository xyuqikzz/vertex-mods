<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  normalizeTranslationConfig,
  resolveTranslationConfig,
  TRANSLATION_BATCH_SIZE_OPTIONS,
  TRANSLATION_TARGET_LANGUAGES
} from '../../../../../shared/translation/translation-config.js'
import { probeTranslationRuntimeStatus } from '@renderer/utils/translation-runtime.js'
import { $message } from '@renderer/common/message.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import {
  VxButton,
  VxConfirmModal,
  VxInput,
  VxModal,
  VxSegmented,
  VxSelect,
  VxSwitch
} from '@renderer/component/vertex-ui'
import { ToolEmpty, ToolIcon, ToolIconButton } from '@renderer/component/tool-page'
import AgentDefinitionSetting from './agentDefinitionSetting.vue'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import {
  AI_API_CONFIG_SCOPES,
  AI_API_CONFIG_SCOPE_OPTIONS,
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiApiConfigs,
  normalizeAiTranslationConfig,
  resolveAiApiConfigForScope
} from '../../../../../shared/translation/ai-translation-config.js'
import {
  DEFAULT_AI_AGENT_CONFIG,
  normalizeAiAgentConfig
} from '../../../../../shared/ai/config/ai-agent-config.js'

const { t } = useI18n()
const translationConfig = ref(resolveTranslationConfig())
const translationProbeLoading = ref(false)
const translationProbeResult = ref('')

async function checkTranslation() {
  if (translationProbeLoading.value) return
  translationProbeLoading.value = true
  translationProbeResult.value = ''
  try {
    const status = await probeTranslationRuntimeStatus({ reason: 'translation_settings' })
    translationProbeResult.value = status.edge.available ? 'available' : 'unavailable'
  } catch {
    translationProbeResult.value = 'unavailable'
  } finally {
    translationProbeLoading.value = false
  }
}

const props = defineProps({
  // services：模型服务；translate：模组翻译；assistant：AI 助手
  section: { type: String, default: 'services' },
  modelValue: {
    type: Object,
    default: () => ({
      aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG),
      aiAgent: normalizeAiAgentConfig(DEFAULT_AI_AGENT_CONFIG)
    })
  }
})

const emit = defineEmits(['update:modelValue', 'navigate'])
const isSyncingFromModel = ref(false)
const aiTranslationConfig = ref(normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG))
const aiAgentConfig = ref(normalizeAiAgentConfig(DEFAULT_AI_AGENT_CONFIG))
const selectedApiConfigId = ref('')
const isCreateApiConfigVisible = ref(false)
const editingApiConfigId = ref('')
const isShowCreateApiKey = ref(false)
const createApiConfigForm = ref(createEmptyAiApiConfigForm())
const pendingRemoveConfigId = ref('')
const toolLogLoading = ref(false)
const toolLogRows = ref([])
const createApiModelOptions = ref([])
const createApiModelLoading = ref(false)
const createApiModelLoaded = ref(false)
const createApiModelMessage = ref('')

const batchSizeOptions = computed(() =>
  TRANSLATION_BATCH_SIZE_OPTIONS.map((value) => ({
    label: t('modelSettings.batchOption', { count: value }),
    value
  }))
)

const targetLanguageOptions = computed(() => {
  const options = TRANSLATION_TARGET_LANGUAGES.map((value) => ({
    value,
    label: t(`modelSettings.languages.${value}`)
  }))
  const current = translationConfig.value.targetLanguage
  // 兼容此前手填的其他语言，避免打开设置时丢失已保存的选择。
  if (current && !TRANSLATION_TARGET_LANGUAGES.includes(current)) {
    options.push({ value: current, label: t('modelSettings.savedLanguage', { language: current }) })
  }
  return options
})

const apiScopeOptions = computed(() =>
  AI_API_CONFIG_SCOPE_OPTIONS.filter((item) => item.key !== AI_API_CONFIG_SCOPES.TRANSLATION).map(
    (item) => ({ key: item.key, label: t('modelSettings.scope.' + item.key) })
  )
)
const apiScopeSegmentOptions = computed(() =>
  apiScopeOptions.value.map((item) => ({
    value: item.key,
    label: item.label
  }))
)
const aiApiConfigList = computed(() =>
  (Array.isArray(aiTranslationConfig.value.apiConfigs)
    ? aiTranslationConfig.value.apiConfigs
    : []
  ).map((item) =>
    item.scope === AI_API_CONFIG_SCOPES.TRANSLATION ? { ...item, enabled: false } : item
  )
)
const activeAssistantApiConfig = computed(() =>
  resolveAiApiConfigForScope(aiTranslationConfig.value, AI_API_CONFIG_SCOPES.ASSISTANT)
)
const aiApiStatusText = computed(() => {
  const enabledReadyCount = aiApiConfigList.value.filter(
    (item) => item.enabled && isAiApiConfigReady(item)
  ).length
  if (enabledReadyCount) return t('modelSettings.enabledCount', { count: enabledReadyCount })
  return t('modelSettings.notFilled')
})
// 状态胶囊：停用为灰色，已配置为绿色，缺接口或模型为橙色。
function toolLogStatusClass(row = {}) {
  const status = String(row.result_status || row.resultStatus || '').toLowerCase()
  if (status === 'ok' || status === 'success') return 'is-success'
  if (status === 'error' || status === 'failed') return 'is-danger'
  if (status === 'denied') return 'is-warning'
  return ''
}
function featureStatusTone(enabled, apiConfig) {
  if (!enabled) return ''
  return isAiApiConfigReady(apiConfig) ? 'is-success' : 'is-warning'
}
const aiAssistantStatusText = computed(() =>
  !aiAgentConfig.value.enabled
    ? t('modelSettings.disabled')
    : isAiApiConfigReady(activeAssistantApiConfig.value)
      ? t('modelSettings.configured')
      : t('modelSettings.needsModel')
)
const aiAssistantStatusClass = computed(() =>
  featureStatusTone(aiAgentConfig.value.enabled, activeAssistantApiConfig.value)
)
const aiAssistantApiStatusText = computed(
  () => activeAssistantApiConfig.value?.name || t('modelSettings.noActive')
)
const toolLogSummaryText = computed(() =>
  t('modelSettings.recentLogs', { count: toolLogRows.value.length })
)
const pendingRemoveConfig = computed(
  () => aiApiConfigList.value.find((item) => item.id === pendingRemoveConfigId.value) || null
)
const aiAgentEnabled = computed({
  get: () => aiAgentConfig.value.enabled === true,
  set: (value) => {
    aiAgentConfig.value = { ...aiAgentConfig.value, enabled: value === true }
    handleAiAgentEnabledChange(value === true)
  }
})
const isEditingApiConfig = computed(() => !!editingApiConfigId.value)
const apiConfigModalTitle = computed(() =>
  isEditingApiConfig.value ? t('modelSettings.editConfig') : t('modelSettings.newConfig')
)
const apiConfigModalDescription = computed(() =>
  isEditingApiConfig.value ? t('modelSettings.editDescription') : t('modelSettings.newDescription')
)
const apiConfigModalTipText = computed(() =>
  isEditingApiConfig.value
    ? aiApiConfigList.value.find((item) => item.id === editingApiConfigId.value)?.enabled
      ? t('modelSettings.saveActiveHint')
      : t('modelSettings.saveInactiveHint')
    : t('modelSettings.newServiceHint')
)
const apiConfigModalSubmitText = computed(() =>
  isEditingApiConfig.value ? t('modelSettings.saveChanges') : t('modelSettings.saveConfig')
)
const canFetchCreateApiModels = computed(
  () =>
    Boolean(String(createApiConfigForm.value.baseURL || '').trim()) &&
    Boolean(String(createApiConfigForm.value.apiKey || '').trim())
)
const createApiModelSelectOptions = computed(() => {
  const options = Array.isArray(createApiModelOptions.value) ? createApiModelOptions.value : []
  const currentModel = String(createApiConfigForm.value.model || '').trim()
  if (!currentModel || options.some((item) => item.value === currentModel)) {
    return options
  }

  return [
    {
      label: currentModel,
      value: currentModel,
      description: createApiModelLoaded.value
        ? t('modelSettings.missingCurrentModel')
        : t('modelSettings.savedModel')
    },
    ...options
  ]
})
const createApiModelHintText = computed(() => {
  if (createApiModelMessage.value) return t(createApiModelMessage.value)
  if (!canFetchCreateApiModels.value) return t('modelSettings.modelsCredentialsHint')
  if (createApiModelLoading.value) return t('modelSettings.loadingModels')
  if (createApiModelOptions.value.length) {
    return t('modelSettings.modelCountHint', { count: createApiModelOptions.value.length })
  }
  if (String(createApiConfigForm.value.model || '').trim()) {
    return t('modelSettings.savedModelHint')
  }
  return t('modelSettings.modelsHint')
})

function isAiApiConfigReady(config = {}) {
  return Boolean(config?.baseURL && config?.apiKey && config?.model)
}

function toPlainJson(data, fallback = {}) {
  try {
    const text = JSON.stringify(data ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function normalizeCreateApiModelOption(record = {}) {
  const id = toSafeText(record?.id || record?.value || record?.name || record?.model)
  if (!id) return null
  return {
    label: toSafeText(record?.name || record?.label || id, id),
    value: id,
    description: toSafeText(record?.description || record?.owned_by || record?.ownedBy)
  }
}

function normalizeCreateApiModelOptions(models = []) {
  const modelIdSet = new Set()
  return (Array.isArray(models) ? models : [])
    .map((item) => normalizeCreateApiModelOption(item))
    .filter(Boolean)
    .filter((item) => {
      if (modelIdSet.has(item.value)) return false
      modelIdSet.add(item.value)
      return true
    })
}

function resetCreateApiModelState() {
  createApiModelOptions.value = []
  createApiModelLoaded.value = false
  createApiModelMessage.value = ''
}

function formatToolLogStatus(row = {}) {
  const status = toSafeText(row.result_status || row.resultStatus)
  if (status === 'ok' || status === 'success') return t('modelSettings.success')
  if (status === 'error' || status === 'failed') return t('modelSettings.failed')
  if (status === 'denied') return t('modelSettings.denied')
  return status || t('modelSettings.unknown')
}

function formatToolLogMeta(row = {}) {
  const permission = toSafeText(row.permission_level || row.permissionLevel, 'read')
  const duration = Number(row.duration_ms || row.durationMs || 0)
  return duration > 0 ? `${permission} / ${duration}ms` : permission
}

async function refreshToolLogs() {
  toolLogLoading.value = true
  try {
    const rows = await ipcRenderer.invoke('agent-tool-log:list', { limit: 20 })
    toolLogRows.value = Array.isArray(rows) ? toPlainJson(rows, []) : []
  } catch {
    toolLogRows.value = []
  } finally {
    toolLogLoading.value = false
  }
}

function handleAiAgentEnabledChange(checked) {
  $message.info(
    t(
      checked
        ? 'modelSettings.assistantEnabledNextStart'
        : 'modelSettings.assistantDisabledNextStart'
    ),
    3
  )
}

function pickAiApiRuntimeFields(config = {}) {
  const source = config && typeof config === 'object' ? config : {}
  return {
    providerType: source.providerType,
    baseURL: source.baseURL,
    apiKey: source.apiKey,
    model: source.model
  }
}

function createSyncedAiAgentConfig(agentConfig = {}, translationConfig = {}) {
  const normalizedTranslation = normalizeAiTranslationConfig(translationConfig)
  const normalizedAgent = normalizeAiAgentConfig(agentConfig)
  const assistantApiConfig = resolveAiApiConfigForScope(
    normalizedTranslation,
    AI_API_CONFIG_SCOPES.ASSISTANT
  )

  return normalizeAiAgentConfig({
    ...normalizedAgent,
    ...(assistantApiConfig
      ? pickAiApiRuntimeFields(assistantApiConfig)
      : {
          providerType: 'custom',
          baseURL: '',
          apiKey: '',
          model: ''
        })
  })
}

function ensureSelectedApiConfigId(configs = aiApiConfigList.value) {
  const safeConfigs = Array.isArray(configs) ? configs : []
  if (!safeConfigs.length) {
    selectedApiConfigId.value = ''
    return
  }

  if (!safeConfigs.some((item) => item.id === selectedApiConfigId.value)) {
    selectedApiConfigId.value = safeConfigs[0].id
  }
}

function updateAiApiConfigs(configs = []) {
  const normalizedConfigs = normalizeAiApiConfigs(configs, aiTranslationConfig.value)
  const nextTranslationConfig = normalizeAiTranslationConfig({
    ...aiTranslationConfig.value,
    apiConfigs: normalizedConfigs
  })
  aiTranslationConfig.value = nextTranslationConfig
  aiAgentConfig.value = createSyncedAiAgentConfig(aiAgentConfig.value, nextTranslationConfig)
  ensureSelectedApiConfigId(nextTranslationConfig.apiConfigs)
}

function emitAiConfig() {
  if (isSyncingFromModel.value) return
  const currentConfig =
    props.modelValue && typeof props.modelValue === 'object' ? props.modelValue : {}
  const normalizedTranslation = normalizeAiTranslationConfig(aiTranslationConfig.value)
  const normalizedAgent = createSyncedAiAgentConfig(aiAgentConfig.value, normalizedTranslation)

  emit('update:modelValue', {
    ...currentConfig,
    aiTranslation: normalizedTranslation,
    aiAgent: normalizedAgent,
    translation: normalizeTranslationConfig(translationConfig.value)
  })
}

watch(
  () => props.modelValue,
  (newValue) => {
    const currentConfig = newValue && typeof newValue === 'object' ? newValue : {}
    const normalizedTranslation = normalizeAiTranslationConfig(currentConfig.aiTranslation)
    isSyncingFromModel.value = true
    aiTranslationConfig.value = normalizedTranslation
    translationConfig.value = resolveTranslationConfig(currentConfig)
    aiAgentConfig.value = createSyncedAiAgentConfig(currentConfig.aiAgent, normalizedTranslation)
    ensureSelectedApiConfigId(normalizedTranslation.apiConfigs)
    nextTick(() => {
      isSyncingFromModel.value = false
    })
  },
  { immediate: true, deep: true }
)

watch(
  [() => aiTranslationConfig.value, () => aiAgentConfig.value, () => translationConfig.value],
  () => emitAiConfig(),
  {
    deep: true
  }
)

onMounted(() => {
  refreshToolLogs()
})

function createEmptyAiApiConfigForm() {
  return {
    name: '',
    scope: AI_API_CONFIG_SCOPES.ASSISTANT,
    baseURL: '',
    apiKey: '',
    model: ''
  }
}

function getApiScopeLabel(scope = '') {
  return (
    apiScopeOptions.value.find((item) => item.key === scope)?.label ||
    t('modelSettings.legacyScope')
  )
}

function createAiApiConfigId() {
  return `api-config-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function selectAiApiConfig(id = '') {
  const safeId = String(id || '').trim()
  if (aiApiConfigList.value.some((item) => item.id === safeId)) {
    selectedApiConfigId.value = safeId
  }
}

function openCreateAiApiConfig() {
  editingApiConfigId.value = ''
  createApiConfigForm.value = {
    ...createEmptyAiApiConfigForm(),
    name: t('modelSettings.configName', { count: aiApiConfigList.value.length + 1 })
  }
  resetCreateApiModelState()
  isShowCreateApiKey.value = false
  isCreateApiConfigVisible.value = true
}

function closeCreateAiApiConfig() {
  isCreateApiConfigVisible.value = false
  editingApiConfigId.value = ''
  resetCreateApiModelState()
}

function openEditAiApiConfig(id = '') {
  const safeId = String(id || '').trim()
  const targetConfig = aiApiConfigList.value.find((item) => item.id === safeId)
  if (!targetConfig) return

  editingApiConfigId.value = targetConfig.id
  selectedApiConfigId.value = targetConfig.id
  createApiConfigForm.value = {
    name: targetConfig.name || '',
    scope:
      targetConfig.scope === AI_API_CONFIG_SCOPES.TRANSLATION
        ? AI_API_CONFIG_SCOPES.ASSISTANT
        : targetConfig.scope || AI_API_CONFIG_SCOPES.ALL,
    baseURL: targetConfig.baseURL || '',
    apiKey: targetConfig.apiKey || '',
    model: targetConfig.model || ''
  }
  resetCreateApiModelState()
  isShowCreateApiKey.value = false
  isCreateApiConfigVisible.value = true
}

function updateCreateApiConfigForm(patch = {}) {
  createApiConfigForm.value = {
    ...createApiConfigForm.value,
    ...patch
  }
}

function updateCreateApiConfigConnectionField(field = '', value = '') {
  updateCreateApiConfigForm({
    [field]: String(value || ''),
    model: ''
  })
  resetCreateApiModelState()
}

function handleCreateModelSelect(value = '') {
  updateCreateApiConfigForm({
    model: String(value || '').trim()
  })
}

async function fetchCreateApiModels() {
  if (createApiModelLoading.value) return

  const baseURL = String(createApiConfigForm.value.baseURL || '').trim()
  const apiKey = String(createApiConfigForm.value.apiKey || '').trim()
  if (!baseURL) {
    $message.info(t('modelSettings.enterUrl'), 3)
    return
  }
  if (!apiKey) {
    $message.info(t('modelSettings.enterKey'), 3)
    return
  }

  createApiModelLoading.value = true
  createApiModelMessage.value = ''
  try {
    const payload = toPlainJson({
      providerType: 'custom',
      baseURL,
      apiKey,
      model: String(createApiConfigForm.value.model || '').trim()
    })
    const response = await ipcRenderer.invoke('listAiTranslationModels', payload)
    const options = normalizeCreateApiModelOptions(response?.models)
    createApiModelOptions.value = options
    createApiModelLoaded.value = true

    if (!options.length) {
      updateCreateApiConfigForm({ model: '' })
      createApiModelMessage.value = 'modelSettings.noModels'
      $message.info(t('modelSettings.noModels'), 3)
      return
    }

    const currentModel = String(createApiConfigForm.value.model || '').trim()
    if (currentModel && !options.some((item) => item.value === currentModel)) {
      updateCreateApiConfigForm({ model: '' })
      createApiModelMessage.value = 'modelSettings.reselectModel'
    }
    $message.success(t('modelSettings.modelsLoaded', { count: options.length }), 3)
  } catch {
    createApiModelOptions.value = []
    createApiModelLoaded.value = false
    createApiModelMessage.value = 'modelSettings.modelsFailed'
    $message.error(t('modelSettings.modelsFailed'), 4)
  } finally {
    createApiModelLoading.value = false
  }
}

function submitCreateAiApiConfig() {
  const name = String(createApiConfigForm.value.name || '').trim()
  const baseURL = String(createApiConfigForm.value.baseURL || '').trim()
  const apiKey = String(createApiConfigForm.value.apiKey || '').trim()
  const model = String(createApiConfigForm.value.model || '').trim()

  if (!baseURL) {
    $message.info(t('modelSettings.fillUrl'), 3)
    return
  }

  if (!apiKey) {
    $message.info(t('modelSettings.fillKey'), 3)
    return
  }

  if (!model) {
    $message.info(t('modelSettings.selectModel'), 3)
    return
  }

  if (editingApiConfigId.value) {
    const targetConfig = aiApiConfigList.value.find((item) => item.id === editingApiConfigId.value)
    if (!targetConfig) {
      $message.info(t('modelSettings.configMissing'), 3)
      return
    }

    const nextConfigs = aiApiConfigList.value.map((item) =>
      item.id === targetConfig.id
        ? {
            ...item,
            name: name || item.name || t('modelSettings.unnamed'),
            scope: createApiConfigForm.value.scope,
            providerType: 'custom',
            baseURL,
            apiKey,
            model
          }
        : item
    )
    updateAiApiConfigs(
      targetConfig.enabled ? buildEnabledAiApiConfigs(nextConfigs, targetConfig.id) : nextConfigs
    )
    selectedApiConfigId.value = targetConfig.id
    isCreateApiConfigVisible.value = false
    editingApiConfigId.value = ''
    return
  }

  const nextConfig = {
    id: createAiApiConfigId(),
    name: name || t('modelSettings.configName', { count: aiApiConfigList.value.length + 1 }),
    enabled: false,
    scope: createApiConfigForm.value.scope,
    providerType: 'custom',
    baseURL,
    apiKey,
    model
  }
  updateAiApiConfigs([...aiApiConfigList.value, nextConfig])
  selectedApiConfigId.value = nextConfig.id
  isCreateApiConfigVisible.value = false
  editingApiConfigId.value = ''
}

function removeAiApiConfig(id = '') {
  const safeId = String(id || '').trim()
  const targetConfig = aiApiConfigList.value.find((item) => item.id === safeId)
  if (!targetConfig) return

  if (targetConfig.enabled) {
    $message.info(t('modelSettings.activeDeleteError'), 3)
    return
  }

  if (aiApiConfigList.value.length <= 1) {
    $message.info(t('modelSettings.lastConfigError'), 3)
    return
  }

  const nextConfigs = aiApiConfigList.value.filter((item) => item.id !== targetConfig.id)
  if (selectedApiConfigId.value === targetConfig.id) {
    selectedApiConfigId.value = nextConfigs[0]?.id || ''
  }
  updateAiApiConfigs(nextConfigs)
}

// 修改启用配置的用途时同样按显式启用规则处理，避免规范化按列表顺序停用被编辑项。
function buildEnabledAiApiConfigs(configs, id) {
  const targetConfig = configs.find((item) => item.id === id)
  if (!targetConfig) return configs
  return configs.map((item) => {
    if (item.id === targetConfig.id) {
      return {
        ...item,
        enabled: true
      }
    }

    if (targetConfig.scope === AI_API_CONFIG_SCOPES.ALL) {
      return {
        ...item,
        enabled: false
      }
    }

    if (item.scope === AI_API_CONFIG_SCOPES.ALL || item.scope === targetConfig.scope) {
      return {
        ...item,
        enabled: false
      }
    }

    return item
  })
}

function enableAiApiConfig(id = '') {
  const configs = aiApiConfigList.value.map((item) =>
    item.id === id && item.scope === AI_API_CONFIG_SCOPES.TRANSLATION
      ? { ...item, scope: AI_API_CONFIG_SCOPES.ASSISTANT }
      : item
  )
  updateAiApiConfigs(buildEnabledAiApiConfigs(configs, id))
  selectAiApiConfig(id)
}

function requestRemoveAiApiConfig(id = '') {
  pendingRemoveConfigId.value = String(id || '').trim()
}

function confirmRemoveAiApiConfig() {
  removeAiApiConfig(pendingRemoveConfigId.value)
  pendingRemoveConfigId.value = ''
}
</script>

<template>
  <div
    class="ai-translation-setting-root"
    :class="{ 'ai-agent-setting-root': section === 'assistant' }"
  >
    <!-- ==================== 模型服务 ==================== -->
    <template v-if="section === 'services'">
      <Teleport defer to="#settings-page-actions">
        <VxButton variant="secondary" size="sm" @click="openCreateAiApiConfig">
          <ToolIcon name="plus" :size="14" />
          {{ t('modelSettings.addService') }}
        </VxButton>
      </Teleport>

      <div v-if="!aiApiConfigList.length" class="setting-group__panel">
        <ToolEmpty
          icon="server"
          :title="t('modelSettings.noServices')"
          :description="t('modelSettings.servicesDescription')"
        >
          <VxButton @click="openCreateAiApiConfig">{{ t('modelSettings.addService') }}</VxButton>
        </ToolEmpty>
      </div>

      <template v-else>
        <SettingGroup :title="t('modelSettings.currentService')" :meta="aiApiStatusText">
          <SettingRow :label="t('modelSettings.assistant')">
            <span class="service-current">{{ aiAssistantApiStatusText }}</span>
            <span class="tool-status" :class="aiAssistantStatusClass">{{
              aiAssistantStatusText
            }}</span>
          </SettingRow>
        </SettingGroup>
        <p class="service-hint">
          {{ t('modelSettings.servicesHint') }}
        </p>

        <SettingGroup
          :title="t('modelSettings.added')"
          :meta="t('modelSettings.count', { count: aiApiConfigList.length })"
        >
          <div class="api-config-list">
            <div
              v-for="item in aiApiConfigList"
              :key="item.id"
              class="api-config-item"
              :class="{ 'is-enabled': item.enabled }"
            >
              <span class="api-config-item__icon" aria-hidden="true">
                <ToolIcon name="server" :size="16" />
              </span>
              <div class="api-config-item__main">
                <div class="api-config-item__name">
                  {{ item.name || t('modelSettings.unnamed') }}
                  <span class="tool-tag" :class="{ 'is-accent': item.scope !== 'all' }">{{
                    getApiScopeLabel(item.scope)
                  }}</span>
                </div>
                <div class="api-config-item__meta">
                  {{ item.providerType || 'custom' }} ·
                  <span class="tool-mono">{{ item.model || t('modelSettings.modelNotSet') }}</span>
                </div>
              </div>
              <div class="api-config-item__actions">
                <span v-if="item.enabled" class="tool-status is-success">{{
                  t('modelSettings.enabled')
                }}</span>
                <VxButton v-else variant="secondary" size="sm" @click="enableAiApiConfig(item.id)">
                  {{ t('modelSettings.enable') }}
                </VxButton>
                <VxButton
                  variant="ghost"
                  size="sm"
                  :aria-label="
                    t('modelSettings.editNamed', { name: item.name || t('modelSettings.unnamed') })
                  "
                  @click="openEditAiApiConfig(item.id)"
                >
                  {{ t('modelSettings.edit') }}
                </VxButton>
                <VxButton
                  v-if="!item.enabled"
                  variant="ghost"
                  size="sm"
                  class="setting-danger-button"
                  :aria-label="
                    t('modelSettings.deleteNamed', {
                      name: item.name || t('modelSettings.unnamed')
                    })
                  "
                  @click="requestRemoveAiApiConfig(item.id)"
                >
                  {{ t('modelSettings.remove') }}
                </VxButton>
              </div>
            </div>
          </div>
        </SettingGroup>
      </template>
    </template>

    <template v-else-if="section === 'translate'">
      <SettingGroup :title="t('modelSettings.translationProvider')">
        <SettingRow
          :label="t('modelSettings.microsoft')"
          :description="t('modelSettings.translationDescription')"
        >
          <VxButton
            variant="secondary"
            :loading="translationProbeLoading"
            :disabled="translationProbeLoading"
            @click="checkTranslation"
          >
            {{ t('modelSettings.checkConnection') }}
          </VxButton>
        </SettingRow>
        <p v-if="translationProbeResult" class="translation-status" role="status">
          {{ t('modelSettings.' + translationProbeResult) }}
        </p>
      </SettingGroup>
      <SettingGroup :title="t('modelSettings.translationPreferences')">
        <SettingRow
          :label="t('modelSettings.targetLanguage')"
          :description="t('modelSettings.targetLanguageHint')"
        >
          <VxSelect
            v-model="translationConfig.targetLanguage"
            class="setting-field--narrow"
            :aria-label="t('modelSettings.targetLanguage')"
            :placeholder="t('modelSettings.languagePlaceholder')"
            :options="targetLanguageOptions"
          />
        </SettingRow>
        <SettingRow
          :label="t('modelSettings.batchSize')"
          :description="t('modelSettings.batchHint')"
        >
          <VxSelect
            v-model="translationConfig.batchSize"
            class="setting-field--narrow"
            :aria-label="t('modelSettings.batchSize')"
            :options="batchSizeOptions"
          />
        </SettingRow>
      </SettingGroup>
    </template>

    <!-- ==================== AI 助手 ==================== -->
    <template v-else>
      <SettingGroup>
        <SettingRow>
          <template #label>
            {{ t('modelSettings.enableAssistant') }}
            <span class="tool-status" :class="aiAssistantStatusClass">{{
              aiAssistantStatusText
            }}</span>
          </template>
          <template #description>
            {{ t('modelSettings.assistantDescription', { name: aiAssistantApiStatusText }) }}
            <button type="button" class="setting-link-button" @click="emit('navigate', 'services')">
              {{ t('modelSettings.manageServices') }}
            </button>
          </template>
          <VxSwitch
            v-model="aiAgentEnabled"
            class="setting-switch"
            :label="t('modelSettings.enableAssistant')"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup :title="t('modelSettings.rolesSkills')">
        <AgentDefinitionSetting />
      </SettingGroup>

      <SettingGroup :title="t('modelSettings.toolLogs')" :meta="toolLogSummaryText">
        <template #actions>
          <ToolIconButton
            class="tool-log-refresh"
            icon="refresh"
            :label="t('modelSettings.refreshLogs')"
            size="sm"
            :busy="toolLogLoading"
            @click="refreshToolLogs"
          />
        </template>
        <div
          v-if="toolLogRows.length"
          class="tool-log-table"
          role="table"
          :aria-label="t('modelSettings.toolLogs')"
        >
          <div class="tool-log-head" role="row">
            <span role="columnheader">{{ t('modelSettings.tool') }}</span>
            <span role="columnheader">{{ t('modelSettings.result') }}</span>
            <span role="columnheader">{{ t('modelSettings.permissionsDuration') }}</span>
            <span role="columnheader">{{ t('modelSettings.arguments') }}</span>
          </div>
          <div v-for="row in toolLogRows" :key="row.id" class="tool-log-row" role="row">
            <span role="cell" class="tool-log-name tool-mono">{{
              row.tool_name || row.toolName
            }}</span>
            <span role="cell">
              <span class="tool-log-status tool-status" :class="toolLogStatusClass(row)">{{
                formatToolLogStatus(row)
              }}</span>
            </span>
            <span role="cell" class="tool-log-meta">{{ formatToolLogMeta(row) }}</span>
            <span
              role="cell"
              class="tool-log-digest tool-mono"
              :title="row.args_digest || row.argsDigest"
              >{{ row.args_digest || row.argsDigest }}</span
            >
          </div>
        </div>
        <p v-else class="tool-log-empty">{{ t('modelSettings.noLogs') }}</p>
      </SettingGroup>
    </template>

    <VxModal
      v-model="isCreateApiConfigVisible"
      :title="apiConfigModalTitle"
      :description="apiConfigModalDescription"
      :width="640"
      @close="closeCreateAiApiConfig"
    >
      <div class="api-config-create-modal">
        <div class="form-grid">
          <VxInput
            :model-value="createApiConfigForm.name"
            :label="t('modelSettings.name')"
            :placeholder="t('modelSettings.serviceNamePlaceholder')"
            spellcheck="false"
            @update:model-value="updateCreateApiConfigForm({ name: $event })"
          />
          <div class="field-block">
            <span id="api-config-scope-label" class="vx-field__label">{{
              t('modelSettings.scopeLabel')
            }}</span>
            <VxSegmented
              :model-value="createApiConfigForm.scope"
              role="group"
              aria-labelledby="api-config-scope-label"
              :options="apiScopeSegmentOptions"
              @update:model-value="updateCreateApiConfigForm({ scope: $event })"
            />
          </div>
          <VxInput
            class="field-block--full"
            :model-value="createApiConfigForm.baseURL"
            label="Base URL"
            :placeholder="t('modelSettings.urlPlaceholder')"
            spellcheck="false"
            @update:model-value="updateCreateApiConfigConnectionField('baseURL', $event)"
          />
          <div class="field-block--full input-row">
            <VxInput
              class="input-row__field"
              :model-value="createApiConfigForm.apiKey"
              label="API Key"
              :type="isShowCreateApiKey ? 'text' : 'password'"
              :placeholder="t('modelSettings.keyPlaceholder')"
              spellcheck="false"
              @update:model-value="updateCreateApiConfigConnectionField('apiKey', $event)"
            />
            <VxButton
              variant="secondary"
              :aria-pressed="isShowCreateApiKey"
              :aria-label="
                t(isShowCreateApiKey ? 'modelSettings.hideKey' : 'modelSettings.showKey')
              "
              @click="isShowCreateApiKey = !isShowCreateApiKey"
            >
              {{ isShowCreateApiKey ? t('modelSettings.hide') : t('modelSettings.show') }}
            </VxButton>
          </div>
          <div class="field-block--full input-row">
            <VxSelect
              class="input-row__field model-select"
              :model-value="createApiConfigForm.model"
              :options="createApiModelSelectOptions"
              :label="t('modelSettings.model')"
              :placeholder="t('modelSettings.modelPlaceholder')"
              :hint="createApiModelHintText"
              :loading="createApiModelLoading"
              :disabled="
                createApiModelLoading ||
                !canFetchCreateApiModels ||
                !createApiModelSelectOptions.length
              "
              @update:model-value="handleCreateModelSelect"
            />
            <VxButton
              variant="secondary"
              :loading="createApiModelLoading"
              :disabled="!canFetchCreateApiModels"
              @click="fetchCreateApiModels"
            >
              <ToolIcon v-if="!createApiModelLoading" name="refresh" :size="14" />
              {{ t('modelSettings.fetchModels') }}
            </VxButton>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="api-config-create-footer">
          <span class="api-config-create-footer__tip">{{ apiConfigModalTipText }}</span>
          <VxButton variant="secondary" @click="closeCreateAiApiConfig">{{
            t('modelSettings.cancel')
          }}</VxButton>
          <VxButton @click="submitCreateAiApiConfig">{{ apiConfigModalSubmitText }}</VxButton>
        </div>
      </template>
    </VxModal>

    <VxConfirmModal
      :model-value="Boolean(pendingRemoveConfig)"
      :title="
        t('modelSettings.confirmDelete', {
          name: pendingRemoveConfig?.name || t('modelSettings.unnamed')
        })
      "
      :description="t('modelSettings.deleteDescription')"
      :confirm-text="t('modelSettings.remove')"
      danger
      :confirm-action="confirmRemoveAiApiConfig"
      @update:model-value="(open) => !open && requestRemoveAiApiConfig('')"
    />
  </div>
</template>

<style scoped lang="scss">
.translation-status {
  margin: 0;
  padding: 0 var(--space-5) var(--space-4);
  color: var(--color-text-muted);
}

.ai-translation-setting-root > * + * {
  margin-top: 28px;
}

.ai-translation-setting-root > .service-hint {
  margin: var(--space-2) 2px 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.service-current {
  color: var(--color-text);
  font-size: 13.5px;
}

.api-config-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) 14px;
  padding: 14px var(--space-5);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }
}

.api-config-item__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  border-radius: var(--radius-md);
}

.api-config-item.is-enabled .api-config-item__icon {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
}

.api-config-item__main {
  flex: 1 1 220px;
  min-width: 0;
}

.api-config-item__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
}

.api-config-item__meta {
  margin-top: 3px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.api-config-item__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.tool-log-row,
.tool-log-head {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) 80px minmax(96px, 0.9fr) minmax(0, 2fr);
  gap: var(--space-3);
  align-items: center;
  padding: 10px var(--space-5);
  font-size: 12.5px;
}

.tool-log-row {
  border-top: 1px solid var(--color-surface-strong);
}

.tool-log-head {
  padding-top: var(--space-3);
  padding-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.tool-log-name,
.tool-log-digest {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tool-log-meta,
.tool-log-digest {
  color: var(--color-text-tertiary);
}

.tool-log-empty {
  margin: 0;
  padding: var(--space-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: center;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px var(--space-4);
}

.field-block {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
}

.field-block--full {
  grid-column: 1 / -1;
}

.input-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);

  > .vx-button {
    flex: 0 0 auto;
    margin-top: calc(var(--font-size-sm) * var(--line-height-base) + var(--space-1));
  }
}

.input-row__field {
  flex: 1 1 auto;
  min-width: 0;
}

.api-config-create-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}

.api-config-create-footer__tip {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}
</style>
