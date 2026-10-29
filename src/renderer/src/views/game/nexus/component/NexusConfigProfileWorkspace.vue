<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

import { computed, ref, watch } from 'vue'
import { $message } from '@renderer/common/message.js'
import NexusJsonEditorPanel from './NexusJsonEditorPanel.vue'
import {
  buildDefaultPlayerConfigRuleText,
  formatInstallConfigTime,
  resolveInstallConfigOwnerLabel,
  resolveInstallConfigScopeLabel,
  validateInstallConfigRuleJsonText
} from '../nexus-config-profile-utils.js'

const WORKSPACE_MODE = Object.freeze({
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit'
})

const props = defineProps({
  mode: {
    type: String,
    default: 'view'
  },
  loading: {
    type: Boolean,
    default: false
  },
  profile: {
    type: Object,
    default: () => ({})
  },
  gameContext: {
    type: Object,
    default: () => ({})
  },
  defaultRuleJsonText: {
    type: String,
    default: ''
  },
  activeProfileKey: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['submit', 'close'])

const activeTab = ref('basic')
const localProfile = ref({
  id: null,
  configName: '',
  configDesc: '',
  ruleJsonText: '',
  configScope: '',
  ownerDisplayName: '',
  sourcePlatform: '',
  gameName: '',
  domainName: '',
  useCount: 0,
  ruleVersion: 0,
  updatedAt: '',
  publishedAt: '',
  profileKey: ''
})

const isReadOnly = computed(() => props.mode === WORKSPACE_MODE.VIEW)

const ruleValidation = computed(() => {
  return validateInstallConfigRuleJsonText(localProfile.value?.ruleJsonText)
})

const workspaceMetaRows = computed(() => {
  const profile = localProfile.value
  const rows = [
    {
      get label() { return uiText('ui.configurationSource') },
      value: resolveInstallConfigScopeLabel(profile?.configScope || 'player')
    },
    {
      get label() { return uiText('ui.platform') },
      value:
        String(profile?.sourcePlatform || props.gameContext?.sourcePlatform || 'nexus').trim() ||
        'nexus'
    },
    {
      get label() { return uiText('taskCenter.table.game') },
      value:
        String(
          profile?.gameName ||
            props.gameContext?.gameName ||
            profile?.domainName ||
            props.gameContext?.domainName ||
            '--'
        ).trim() || '--'
    }
  ]

  if (isReadOnly.value) {
    rows.push(
      {
        get label() { return uiText('ui.uploadedBy') },
        value: resolveInstallConfigOwnerLabel(profile)
      },
      {
        get label() { return uiText('ui.use') },
        value: Number(profile?.useCount || 0).toLocaleString('zh-CN')
      },
      {
        get label() { return uiText('taskCenter.table.updated') },
        value: formatInstallConfigTime(profile?.updatedAt || profile?.publishedAt)
      }
    )
  } else {
    rows.push({
      get label() { return uiText('ui.domain') },
      value: String(profile?.domainName || props.gameContext?.domainName || '--').trim() || '--'
    })
  }

  return rows
})

const ruleStatusText = computed(() => {
  if (ruleValidation.value.valid) {
    return isReadOnly.value ? uiText('ui.readOnlyView') : uiText('ui.formatCheckPassed')
  }
  return ruleValidation.value.message || uiText('ui.ruleJSONIsNotReady')
})

const displayDesc = computed(() => {
  const text = String(localProfile.value?.configDesc || '').trim()
  if (text) {
    return text
  }
  return isReadOnly.value ? '暂无配置说明' : ''
})

function normalizeWorkspaceProfile(profile = {}) {
  const source = profile && typeof profile === 'object' ? profile : {}
  return {
    id: Number(source?.id || 0) || null,
    configName: String(source?.configName || '').trim(),
    configDesc: String(source?.configDesc || ''),
    ruleJsonText:
      String(source?.ruleJsonText || '').trim() ||
      buildDefaultPlayerConfigRuleText(props.defaultRuleJsonText),
    configScope: String(source?.configScope || 'player').trim() || 'player',
    ownerDisplayName: String(source?.ownerDisplayName || '').trim(),
    sourcePlatform:
      String(source?.sourcePlatform || props.gameContext?.sourcePlatform || 'nexus').trim() ||
      'nexus',
    gameName:
      String(source?.gameName || props.gameContext?.gameName || source?.domainName || '').trim() ||
      '',
    domainName: String(source?.domainName || props.gameContext?.domainName || '').trim() || '',
    useCount: Number(source?.useCount || 0),
    ruleVersion: Number(source?.ruleVersion || 0),
    updatedAt: String(source?.updatedAt || ''),
    publishedAt: String(source?.publishedAt || ''),
    profileKey: String(source?.profileKey || '').trim()
  }
}

function syncProfile(nextProfile = {}) {
  localProfile.value = normalizeWorkspaceProfile(nextProfile)
}

function handleRestoreCurrentRule() {
  localProfile.value = {
    ...localProfile.value,
    ruleJsonText: buildDefaultPlayerConfigRuleText(props.defaultRuleJsonText)
  }
}

function handleSubmit() {
  const configName = String(localProfile.value?.configName || '').trim()
  if (!configName) {
    $message.warning(uiMessage('ui.enterAConfigurationName'))
    activeTab.value = 'basic'
    return
  }

  if (!ruleValidation.value.valid) {
    $message.warning(ruleValidation.value.message || '规则 JSON 无效')
    activeTab.value = 'rule'
    return
  }

  emit('submit', {
    ...localProfile.value,
    configName,
    configDesc: String(localProfile.value?.configDesc || '').trim(),
    ruleJsonText: String(
      ruleValidation.value.formattedText || localProfile.value.ruleJsonText || ''
    )
  })
}

watch(
  () => [props.mode, props.profile],
  () => {
    activeTab.value = 'basic'
    syncProfile(props.profile)
  },
  {
    immediate: true,
    deep: true
  }
)
</script>

<template>
  <div class="profile-workspace">
    <!-- 顶部操作栏：始终可见，不会被内容顶走 -->
    <header v-if="!isReadOnly" class="profile-workspace__header">
      <span class="profile-workspace__header-hint">{{ $t('ui.theConfigurationIsCheckedAutomaticallyBeforeSaving') }}</span>
      <a-button
        type="primary"
        class="profile-workspace__submit-btn"
        :loading="loading"
        @click="handleSubmit"
      >
        {{ mode === 'edit' ? $t('modelSettings.saveChanges') : $t('dialogs.configUpload.upload') }}
      </a-button>
    </header>

    <a-spin :spinning="loading" class="profile-workspace__spin">
      <!-- 紧凑元信息条：一行标签展示 -->
      <div class="profile-workspace__meta-bar">
        <span
          v-for="item in workspaceMetaRows"
          :key="item.label"
          class="profile-workspace__meta-tag"
        >
          <span class="profile-workspace__meta-label">{{ item.label }}</span>
          <span class="profile-workspace__meta-value">{{ item.value }}</span>
        </span>
      </div>

      <!-- Tab 切换：基础信息 / 规则 JSON -->
      <a-tabs v-model:active-key="activeTab" class="profile-workspace__tabs">
        <a-tab-pane key="basic" :tab="$t('ui.basicInformationText')">
          <div class="profile-workspace__tab-content">
            <template v-if="isReadOnly">
              <div class="profile-workspace__field">
                <div class="profile-workspace__field-label">{{ $t('dialogs.configUpload.name') }}</div>
                <div class="profile-workspace__field-value is-title">
                  {{ localProfile.configName || $t('ui.configurationNameMissing') }}
                </div>
              </div>
              <div class="profile-workspace__field">
                <div class="profile-workspace__field-label">{{ $t('dialogs.configUpload.desc') }}</div>
                <div class="profile-workspace__field-value is-desc">
                  {{ displayDesc }}
                </div>
              </div>
            </template>

            <a-form v-else layout="vertical" class="profile-workspace__form">
              <a-form-item :label="$t('dialogs.configUpload.name')" required>
                <a-input
                  v-model:value="localProfile.configName"
                  :maxlength="64"
                  :placeholder="$t('ui.enterACommunityConfigurationName')"
                />
              </a-form-item>
              <a-form-item :label="$t('dialogs.configUpload.desc')">
                <a-textarea
                  v-model:value="localProfile.configDesc"
                  :maxlength="500"
                  :auto-size="{ minRows: 4, maxRows: 8 }"
                  :placeholder="$t('ui.optionalCompatibleVersionsPrerequisitesOrRecommendedInstallationMethod')"
                />
              </a-form-item>
            </a-form>
          </div>
        </a-tab-pane>

        <a-tab-pane key="rule" :tab="$t('ui.ruleJson')">
          <div class="profile-workspace__tab-content is-rule">
            <div class="profile-workspace__rule-bar">
              <span
                class="profile-workspace__rule-status"
                :class="{
                  'is-valid': ruleValidation.valid,
                  'is-invalid': !ruleValidation.valid
                }"
              >
                {{ ruleStatusText }}
              </span>
              <a-button
                v-if="!isReadOnly"
                size="small"
                class="profile-workspace__rule-action"
                @click="handleRestoreCurrentRule"
              >
                {{ $t('ui.useCurrentRules') }}
              </a-button>
            </div>
            <div class="profile-workspace__rule-editor">
              <nexus-json-editor-panel
                v-model="localProfile.ruleJsonText"
                :read-only="isReadOnly"
                :validation-error="
                  isReadOnly ? '' : ruleValidation.valid ? '' : ruleValidation.message
                "
                height="100%"
              />
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-spin>
  </div>
</template>

<style scoped lang="scss">
.profile-workspace {
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 100%;
}

.profile-workspace__spin {
  flex: 1;
  min-height: 0;

  :deep(.ant-spin-container) {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
  }
}

// ===== 紧凑元信息条 =====
.profile-workspace__meta-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.profile-workspace__meta-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  font-size: 12px;
  line-height: 1.5;
}

.profile-workspace__meta-label {
  color: rgba(0, 0, 0, 0.45);
}

.profile-workspace__meta-value {
  color: rgba(0, 0, 0, 0.82);
  font-weight: 500;
}

// ===== Tabs =====
.profile-workspace__tabs {
  flex: 1;
  min-height: 0;
  margin-top: 4px;

  :deep(.ant-tabs-nav) {
    margin-bottom: 0;
  }

  :deep(.ant-tabs-nav::before) {
    border-bottom-color: rgba(0, 0, 0, 0.06);
  }

  :deep(.ant-tabs-tab) {
    padding: 10px 4px;
    color: rgba(0, 0, 0, 0.55);
    font-size: 13px;
    font-weight: 500;
  }

  :deep(.ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn) {
    color: #0a84ff;
  }

  :deep(.ant-tabs-ink-bar) {
    background: #0a84ff;
  }

  :deep(.ant-tabs-content-holder),
  :deep(.ant-tabs-content),
  :deep(.ant-tabs-tabpane) {
    height: 100%;
  }
}

// ===== Tab 内容区 =====
.profile-workspace__tab-content {
  padding: 20px 0 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;

  &.is-rule {
    gap: 12px;
  }
}

// 只读字段展示
.profile-workspace__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-workspace__field-label {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  font-weight: 500;
}

.profile-workspace__field-value {
  color: rgba(0, 0, 0, 0.82);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;

  &.is-title {
    font-size: 16px;
    font-weight: 600;
  }

  &.is-desc {
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.03);
    font-size: 13px;
    white-space: pre-wrap;
    min-height: 60px;
  }
}

// 编辑表单
.profile-workspace__form {
  :deep(.ant-form-item-label > label) {
    color: rgba(0, 0, 0, 0.65);
    font-size: 13px;
    font-weight: 500;
  }

  :deep(.ant-input),
  :deep(.ant-input-affix-wrapper),
  :deep(.ant-input-textarea textarea) {
    border-radius: 8px;
    border-color: rgba(0, 0, 0, 0.12);
    background: #fafbfc;
    box-shadow: none;
    font-size: 14px;
  }

  :deep(.ant-input:hover),
  :deep(.ant-input-affix-wrapper:hover),
  :deep(.ant-input-textarea textarea:hover) {
    border-color: rgba(10, 132, 255, 0.4);
  }

  :deep(.ant-input:focus),
  :deep(.ant-input-affix-wrapper-focused),
  :deep(.ant-input-textarea textarea:focus) {
    border-color: #0a84ff;
    box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.08);
    background: #ffffff;
  }
}

// 规则 JSON tab
.profile-workspace__rule-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.profile-workspace__rule-status {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);

  &.is-valid {
    color: #34c759;
  }

  &.is-invalid {
    color: #ff3b30;
  }
}

.profile-workspace__rule-action {
  border-radius: 6px;
  font-size: 12px;
}

.profile-workspace__rule-editor {
  flex: 1;
  min-height: 320px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

// ===== 顶部操作栏（始终可见） =====
.profile-workspace__header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 0 0 12px;
  margin-bottom: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.profile-workspace__header-hint {
  color: rgba(0, 0, 0, 0.38);
  font-size: 12px;
}

.profile-workspace__submit-btn {
  border-radius: 8px;
  height: 34px;
  padding: 0 20px;
  font-size: 13px;
  font-weight: 500;
  background: #0a84ff;
  border-color: #0a84ff;

  &:hover {
    background: #409cff !important;
    border-color: #409cff !important;
  }
}
</style>
