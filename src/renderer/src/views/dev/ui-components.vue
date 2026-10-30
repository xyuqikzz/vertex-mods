<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import PageBody from '@renderer/component/page-body.vue'
import Pagination from '@renderer/component/Pagination.vue'
import { ToolCoverCard, ToolFilterPills } from '@renderer/component/tool-page'
import {
  VxBadge,
  VxButton,
  VxCheckbox,
  VxConfirmModal,
  VxDialogActions,
  VxDrawer,
  VxInput,
  VxModal,
  VxProgress,
  VxRadioGroup,
  VxSegmented,
  VxSelect,
  VxSwitch,
  VxTag,
  VxTextarea
} from '@renderer/component/vertex-ui'
import { messageTip } from '@renderer/common/message-tip.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'

const route = useRoute()
const { setMenuName: setPageMenuName } = useMenuName()

const form = ref({
  name: '默认安装规则',
  apiKey: '',
  get description() { return uiText('ui.useSharedClientComponentsForFormsDialogsSelectionAndFeedback') },
  source: 'vertex',
  mode: 'basic',
  autoUpdate: true,
  backup: true,
  profileType: 'local'
})

const loadingPreview = ref(false)
const paginationPreview = ref(1)
const paginationLoading = ref(false)
let paginationTimer
function previewPaginationChange(page) {
  if (paginationLoading.value) return
  paginationLoading.value = true
  paginationTimer = setTimeout(() => {
    paginationPreview.value = page
    paginationLoading.value = false
  }, 900)
}
onUnmounted(() => clearTimeout(paginationTimer))
const toolFilterPreview = ref('all')
const toolFilterOptions = computed(() => [
  { value: 'all', label: uiText('tools.all'), count: 194 },
  { value: 'online', label: uiText('tools.online'), count: 193 },
  { value: 'downloaded', label: uiText('tools.downloaded'), count: 2 },
  { value: 'unavailable', label: uiText('tools.unavailable'), count: 0 }
])
const longToolFilterOptions = computed(() => [
  { value: 'all', label: uiText('ui.vertexCommunityLongInstallationSourceNameWithEnglishMixedTextWithoutSpaces0123456789'), count: 194 },
  { value: 'online', label: uiText('tools.online'), count: 0 }
])
const validationPreview = ref(false)
const stressValue = ref('long')
const stressOptions = [
  { value: 'disabled', get label() { return uiText('ui.unavailableSource') }, disabled: true },
  {
    value: 'long',
    get label() { return uiText('ui.vertexCommunityLongInstallationSourceNameWithEnglishMixedTextWithoutSpaces0123456789') },
    get description() { return uiText('ui.aMultilineDescriptionChecksWrappingAndOptionDensityInNarrow') }
  },
  { value: 'short', get label() { return uiText('ui.localConfiguration') } }
]
const showCommonDialog = ref(false)
const showConfirmDialog = ref(false)
const showSimpleConfirmDialog = ref(false)
const showDrawer = ref(false)
const simulateConfirmFailure = ref(false)
const commonDialogCloseOnOverlay = ref(false)
const commonDialogLongHeading = ref(false)
const confirmResult = ref('')
const commonDialogExtraItems = ref([])
const confirmDialogExtraItems = ref([])
const confirmDialogDraft = ref(
  '第一行：用于测试确认弹窗的多行文本。\n第二行：继续检查换行和间距是否稳定。\n第三行：长路径 D:\\Code\\Vertex\\vertex\\src\\renderer\\src\\component\\vertex-ui\\VxConfirmModal.vue 也应能正常折行。'
)

const selectOptions = [
  { get label() { return uiText('ui.vertexSource') }, value: 'vertex', get description() { return uiText('ui.defaultInstallationAndConfigurationSource') } },
  { label: 'Nexus Mods', value: 'nexus', get description() { return uiText('ui.thirdPartyModSite') } },
  { label: 'Mod.io', value: 'modio', get description() { return uiText('ui.crossPlatformCommunitySource') } },
  { label: 'Thunderstore', value: 'thunderstore', get description() { return uiText('ui.multigameModPlatform') } }
]

const showcaseSelectValue = ref('vertex')
const creatableSelectOptions = ref([
  { value: 'unavailable', get label() { return uiText('ui.unavailableSource') }, disabled: true },
  ...selectOptions
])
const creatableSelectValue = ref('nexus')

const segmentedOptions = [
  { get label() { return uiText('ui.basic') }, value: 'basic' },
  { get label() { return uiText('ui.advanced') }, value: 'advanced' },
  { get label() { return uiText('ui.danger') }, value: 'danger' }
]

const radioOptions = [
  { get label() { return uiText('ui.localConfiguration') }, value: 'local' },
  { get label() { return uiText('ui.cloudConfiguration') }, value: 'cloud' },
  { get label() { return uiText('dialogs.configDetail.official') }, value: 'official' }
]

const colorGroups = [
  {
    get title() { return uiText('ui.brandAndInteraction') },
    colors: [
      { name: 'Accent', token: '--color-accent', usage: '主按钮、焦点、关键操作' },
      { name: 'Accent Hover', token: '--color-accent-hover', usage: '主操作悬停' },
      { name: 'Accent Soft', token: '--color-accent-soft', usage: '轻量选中背景' }
    ]
  },
  {
    get title() { return uiText('ui.textAndSurfaces') },
    colors: [
      { name: 'Text', token: '--color-text', usage: '标题、主要内容' },
      { name: 'Muted', token: '--color-text-muted', usage: '说明、辅助信息' },
      { name: 'Surface', token: '--color-surface', usage: '卡片、弹窗、输入面' },
      { name: 'Surface Soft', token: '--color-surface-soft', usage: '弱层级容器' },
      { name: 'Border', token: '--color-border', usage: '边框、分隔线' }
    ]
  },
  {
    get title() { return uiText('ui.statusSemantics') },
    colors: [
      { name: 'Success', token: '--color-success', usage: '成功、启用、可用' },
      { name: 'Warning', token: '--color-warning', usage: '警告、待处理' },
      { name: 'Danger', token: '--color-danger', usage: '删除、失败、风险操作' },
      { name: 'Info', token: '--color-info', usage: '信息、提示、说明' }
    ]
  }
]

const commonDialogActions = [
  { key: 'download', get text() { return uiText('tools.download') }, variant: 'secondary' },
  { key: 'smart-install', get text() { return uiText('ui.smartInstallation') }, variant: 'primary' }
]

const confirmDialogActions = [{ key: 'download-log', get text() { return uiText('ui.downloadLogs') }, variant: 'secondary' }]

const confirmResultTextMap = {
  get confirmed() { return uiText('tools.confirmed') },
  get cancelled() { return uiText('taskCenter.views.cancelled') },
  get download() { return uiText('ui.downloadSelected') },
  get 'smart-install'() { return uiText('ui.smartInstallationSelected') },
  get 'download-log'() { return uiText('ui.downloadLogsSelected') }
}

async function handleConfirm() {
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (simulateConfirmFailure.value)
    throw new Error(uiText('ui.simulatedSubmissionFailureContentWasKeptTurnOffFailureSimulation'))
  confirmResult.value = 'confirmed'
}

function handleCancel() {
  confirmResult.value = 'cancelled'
}

function handleDialogAction(action) {
  confirmResult.value = action?.key || action?.text || 'action'
}

function addCommonDialogContent() {
  const index = commonDialogExtraItems.value.length + 1
  commonDialogExtraItems.value.push({
    id: `${Date.now()}-${index}`,
    title: uiText('ui.testContentValue', { value1: (index) }),
    get text() { return uiText('ui.multilineContentForTestingAutomaticDialogHeightAndInternalScrolling') }
  })
}

function resetCommonDialogContent() {
  commonDialogExtraItems.value = []
}

function addConfirmDialogContent() {
  const text = String(confirmDialogDraft.value || '').trim()
  if (!text) return

  const index = confirmDialogExtraItems.value.length + 1
  confirmDialogExtraItems.value.push({
    id: `${Date.now()}-${index}`,
    title: uiText('ui.confirmationContentValue', { value1: (index) }),
    text
  })
}

function resetConfirmDialogContent() {
  confirmDialogExtraItems.value = []
}

function showInfoTip() {
  messageTip.info('普通提示', {
    content: '这是一个普通提示消息，用于说明状态、过程或辅助信息。'
  })
}

function showSuccessTip() {
  messageTip.success('保存成功', {
    content: '配置已同步完成。\n支持多行文本展示和自动换行。'
  })
}

function showErrorTip() {
  messageTip.error('操作失败', {
    content: '请检查网络连接或权限配置后重试。'
  })
}

function showWarningTip() {
  messageTip.warning('警告提示', {
    content: '当前操作存在风险，请确认后继续。'
  })
}

function handleCreateSelectOption(option) {
  const nextOption = {
    label: String(option?.label || '').trim(),
    value: String(option?.value || '').trim()
  }

  if (!nextOption.label || !nextOption.value) return

  const exists = creatableSelectOptions.value.some((item) => {
    return String(item.value) === nextOption.value || String(item.label) === nextOption.label
  })

  if (exists) return

  creatableSelectOptions.value = [...creatableSelectOptions.value, nextOption]
  creatableSelectValue.value = nextOption.value
}

onMounted(() => {
  setPageMenuName('通用组件', route.path)
})

defineOptions({ name: 'DevUiComponents' })
</script>

<template>
  <div class="ui-guide-page">
    <PageBody>
      <div class="component-lab">
        <header class="component-lab-hero">
          <div class="component-lab-hero-content">
            <div>
              <h1>{{ $t('ui.clientUIComponents') }}</h1>
              <p>{{ $t('ui.checkSizesFormStatesAndKeyboardInteractions') }}</p>
            </div>
          </div>
          <div class="component-lab-actions">
            <VxButton variant="secondary" @click="showCommonDialog = true">{{ $t('ui.openDialog') }}</VxButton>
            <VxButton @click="showConfirmDialog = true">{{ $t('ui.openConfirmationDialog') }}</VxButton>
          </div>
        </header>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.colors') }}</h2>
              <p>{{ $t('ui.brandTextAndStatusColorsUseSharedTokens') }}</p>
            </div>
          </div>
          <div class="component-color-groups">
            <div v-for="group in colorGroups" :key="group.title" class="component-color-group">
              <div class="component-color-group-title">{{ group.title }}</div>
              <div class="component-color-grid">
                <div v-for="color in group.colors" :key="color.token" class="component-color-card">
                  <span
                    class="component-color-swatch"
                    :style="{ '--component-swatch-color': `var(${color.token})` }"
                  ></span>
                  <div class="component-color-meta">
                    <strong>{{ color.name }}</strong>
                    <code>{{ color.token }}</code>
                    <span>{{ color.usage }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.buttons') }}</h2>
              <p>{{ $t('ui.supportsTabFocusLoadingPreservesTheButtonWidth') }}</p>
            </div>
          </div>
          <div class="component-lab-toolbar">
            <VxButton>{{ $t('ui.saveSettings') }}</VxButton>
            <VxButton variant="secondary">{{ $t('ui.discardEdits') }}</VxButton>
            <VxButton variant="soft">{{ $t('hero.install') }}</VxButton>
            <VxButton variant="soft" loading>{{ $t('taskCenter.itemStates.installing') }}</VxButton>
            <VxButton variant="ghost">{{ $t('ui.viewLogs') }}</VxButton>
            <VxButton variant="danger">{{ $t('taskCenter.confirm.confirmRemove') }}</VxButton>
            <VxButton loading>{{ $t('ui.saveSettings') }}</VxButton>
            <VxButton disabled>{{ $t('tools.unavailable') }}</VxButton>
          </div>
          <div class="component-lab-control-grid">
            <ToolCoverCard
              v-for="state in ['ready', 'disabled', 'loading']"
              :key="state"
              :title="$t(state === 'loading' ? 'tools.downloading' : state === 'disabled' ? 'tools.unavailable' : 'tools.flingTrainer')"
              monogram="FL"
              :quick="{ label: $t('tools.download'), icon: 'download', disabled: state === 'disabled', busy: state === 'loading' }"
            />
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.forms') }}</h2>
              <p>{{ $t('ui.formControlsUseAConsistent36pxHeightAndSharedStates') }}</p>
            </div>
          </div>
          <div class="component-lab-form-grid">
            <VxInput v-model="form.name" :label="$t('dialogs.configUpload.name')" clearable :placeholder="$t('ui.enterAConfigurationName')" />
            <VxInput
              v-model="form.apiKey"
              :label="$t('ui.accessKey')"
              :error="$t('ui.keyRequired')"
              :placeholder="$t('ui.enterAnAccessKey')"
            />
            <VxInput
              model-value="D:\Vertex\Cache"
              :label="$t('ui.readOnlyPath')"
              readonly
              :hint="$t('ui.readOnlyFieldsCanBeFocusedAndCopiedButCannot')"
            />
            <VxSelect
              model-value="loading"
              :label="$t('ui.loadingSource')"
              loading
              :options="[{ label: '正在读取来源', value: 'loading' }]"
            />
            <VxSelect
              v-model="form.source"
              :label="$t('ui.installationSource')"
              :options="selectOptions"
              :hint="$t('ui.theSelectedSourceDeterminesTheRuleTemplate')"
            />
            <VxTextarea
              v-model="form.description"
              class="component-lab-field-wide"
              :label="$t('tools.description')"
              :rows="4"
            />
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.dropdownSelection') }}</h2>
              <p>{{ $t('ui.optionsHave4pxGapsAndDistinctHoverAndSelectedBackgrounds') }}</p>
            </div>
          </div>
          <div class="component-lab-select-grid">
            <div class="component-lab-select-card">
              <VxSelect
                v-model="showcaseSelectValue"
                :label="$t('ui.standardDropdown')"
                :options="selectOptions"
                :hint="$t('ui.chooseAnExistingOptionCreatingNewOptionsIsDisabled')"
              />
            </div>
            <div class="component-lab-select-card">
              <VxSelect
                v-model="creatableSelectValue"
                :label="$t('ui.dropdownWithCreation')"
                allow-create
                :options="creatableSelectOptions"
                :hint="$t('ui.withAllowCreateEnabledEnterANewOptionAndPressEnter')"
                @create="handleCreateSelectOption"
              />
            </div>
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.selectionAndStates') }}</h2>
              <p>{{ $t('ui.checkSelectedReadOnlyAndDisabledStatesRadioDotsAre') }}</p>
            </div>
          </div>
          <div class="component-lab-control-grid">
            <div class="component-lab-field component-lab-field-wide">
              <span>{{ $t('tools.filterByStatus') }}</span>
              <ToolFilterPills v-model="toolFilterPreview" variant="accent" :options="toolFilterOptions" :label="$t('tools.filterByStatus')" />
              <ToolFilterPills v-model="toolFilterPreview" variant="accent" :options="toolFilterOptions" :label="$t('tools.unavailable')" disabled />
              <ToolFilterPills v-model="toolFilterPreview" variant="accent" :options="longToolFilterOptions" :label="$t('ui.selectionAndStates')" />
            </div>
            <div class="component-lab-field component-lab-field-wide">
              <span>{{ $t('pagination.label') }}</span>
              <Pagination
                v-for="pages in [12, 0]"
                :key="pages"
                :current="paginationPreview"
                :pages="pages"
                :size="20"
                :current-count="20"
                :loading="paginationLoading"
                @change="previewPaginationChange"
              />
            </div>
            <div class="component-lab-field">
              <span>{{ $t('ui.configurationType') }}</span>
              <VxRadioGroup v-model="form.profileType" :options="radioOptions" />
              <VxRadioGroup
                model-value="local"
                :options="radioOptions"
                readonly
                :aria-label="$t('ui.readOnlyRadioGroup')"
              />
              <VxRadioGroup
                model-value="local"
                :options="radioOptions"
                disabled
                :aria-label="$t('ui.disabledRadioGroup')"
              />
              <VxRadioGroup
                model-value="local"
                :options="radioOptions"
                loading
                :aria-label="$t('ui.loadingRadioGroup')"
              />
              <VxRadioGroup
                :options="[
                  {
                    value: 'long',
                    label: '这是用于检查多行换行和选项对齐的长文本配置名称，选择前请阅读说明。'
                  }
                ]"
                :error="$t('ui.validConfigurationRequired')"
                :aria-label="$t('ui.radioGroupError')"
              />
            </div>

            <div class="component-lab-control-box">
              <span>{{ $t('ui.switches') }}</span>
              <VxSwitch v-model="form.autoUpdate" :label="$t('ui.checkForUpdatesAutomatically')" />
              <VxSwitch v-model="form.autoUpdate" size="sm" :label="$t('ui.compactSizeTableRow')" />
              <VxSwitch :model-value="true" size="sm" :label="$t('ui.disabledCompactSize')" disabled />
              <VxCheckbox v-model="form.backup" :label="$t('ui.backUpBeforeMakingChanges')" />
              <VxCheckbox :label="$t('ui.disabledBackupOption')" disabled />
              <VxCheckbox
                :label="$t('ui.longOptionBackUpTheCurrentConfigurationBeforeMakingChanges')"
              />
            </div>
            <div class="component-lab-control-box">
              <span>{{ $t('ui.segmentedControl') }}</span>
              <VxSegmented v-model="form.mode" :options="segmentedOptions" />
            </div>
            <div class="component-lab-control-box">
              <span>{{ $t('ui.statusBadges') }}</span>
              <div class="component-badge-row">
                <VxBadge tone="info">{{ $t('ui.informationVariant2') }}</VxBadge>
                <VxBadge tone="success">{{ $t('ui.success') }}</VxBadge>
                <VxBadge tone="warning">{{ $t('ui.warning') }}</VxBadge>
                <VxBadge tone="danger">{{ $t('ui.danger') }}</VxBadge>
              </div>
            </div>
            <div class="component-lab-control-box">
              <span>{{ $t('ui.tags') }}</span>
              <div class="component-badge-row">
                <VxTag>{{ $t('ui.default') }}</VxTag>
                <VxTag tone="accent">Vertex</VxTag>
                <VxTag tone="info">Nexus</VxTag>
                <VxTag tone="success">{{ $t('ui.enabled') }}</VxTag>
                <VxTag tone="warning">{{ $t('tools.unconfirmed') }}</VxTag>
                <VxTag tone="danger" closable>{{ $t('ui.highRisk') }}</VxTag>
              </div>
            </div>
            <div class="component-lab-control-box">
              <span>{{ $t('ui.taskProgress') }}</span>
              <VxProgress :value="68" />
              <VxProgress :value="42" tone="warning" />
            </div>
          </div>
        </section>

        <section class="component-panel" data-section="stress">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.edgeCasesAndStates') }}</h2>
              <p>{{ $t('ui.toggleRealStatesToCheckDimensionsAndWrapping') }}</p>
            </div>
          </div>
          <div class="component-lab-state-stack">
            <div class="component-lab-toolbar">
              <VxCheckbox v-model="loadingPreview" :label="$t('ui.loadingState')" />
              <VxCheckbox v-model="validationPreview" :label="$t('ui.showErrors')" />
            </div>
            <div class="component-lab-alignment-row">
              <VxInput
                :model-value="$t('ui.configurationExample')"
                :aria-label="$t('ui.alignInput')"
                :loading="loadingPreview"
              />
              <VxSelect
                v-model="stressValue"
                :aria-label="$t('ui.alignSelect')"
                :options="stressOptions"
                :loading="loadingPreview"
              />
              <VxButton :loading="loadingPreview" data-testid="stable-loading-button"
                >{{ $t('modelSettings.saveConfig') }}</VxButton
              >
            </div>
            <div class="component-lab-stress-layout">
              <div class="component-lab-form-grid">
                <VxInput
                  :label="$t('ui.fieldValidation')"
                  :hint="$t('ui.enterAConfigurationName')"
                  :error="validationPreview ? $t('ui.nameIsRequired') : ''"
                  placeholder="Configuration name"
                />
                <VxInput
                  :label="$t('ui.disabledInput')"
                  :model-value="$t('ui.defaultConfigurationExample')"
                  disabled
                  :hint="$t('ui.thisConfigurationIsManagedByTheSystem')"
                />
                <VxSelect :label="$t('ui.noOptionsVariant2')" :options="[]" :hint="$t('ui.anEmptyListStillProvidesClearFeedback')" />
                <VxSelect :label="$t('ui.readOnlySelect')" model-value="vertex" :options="selectOptions" readonly />
                <VxSelect :label="$t('ui.disabledSelect')" model-value="vertex" :options="selectOptions" disabled />
                <VxSelect :label="$t('ui.selectError')" :options="stressOptions" :error="$t('ui.validSourceRequired')" />
                <VxTextarea
                  :label="$t('ui.readOnlyDescription')"
                  :model-value="$t('ui.readonlyExample')"
                  readonly
                  :rows="3"
                />
                <VxTextarea :label="$t('ui.disabledDescription')" :model-value="$t('ui.disabledExample')" disabled :rows="3" />
                <VxTextarea :label="$t('ui.descriptionValidation')" :error="$t('ui.descriptionRequired')" :rows="3" />
              </div>
              <div class="component-lab-narrow">
                <VxSelect
                  v-model="stressValue"
                  :label="$t('ui.narrowContainer240pxLongText')"
                  :options="stressOptions"
                />
                <VxInput
                  :label="$t('ui.longLabelMixedLanguageConfigurationNameWithoutSpacesToCheckFirstLineAlignment')"
                  :hint="$t('ui.multilineDescriptionsWrapNaturallyWithoutExpandingTheContainer')"
                />
              </div>
            </div>
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.dialog') }}</h2>
              <p>{{ $t('ui.14pxBoldTitle12pxSubtitleAnd14pxBodyCheckBody') }}</p>
            </div>
          </div>
          <div class="component-lab-dialog-stack">
            <div class="component-lab-feedback">
              <span>{{ $t('ui.lastConfirmationResult') }}</span>
              <strong>{{ confirmResultTextMap[confirmResult] || $t('ui.noActionYet') }}</strong>
            </div>
            <div class="component-lab-toolbar">
              <VxButton type="button" @click="showCommonDialog = true">{{ $t('ui.openDialog') }}</VxButton>
              <VxButton variant="secondary" type="button" @click="showConfirmDialog = true">
                {{ $t('ui.openConfirmationDialog') }}
              </VxButton>
              <VxButton variant="secondary" @click="showSimpleConfirmDialog = true">
                {{ $t('ui.simpleConfirmationBody') }}
              </VxButton>
              <VxButton variant="secondary" @click="showDrawer = true">{{ $t('ui.rightDrawer') }}</VxButton>
            </div>
          </div>
        </section>

        <section class="component-panel">
          <div class="component-lab-section-head">
            <div>
              <h2>{{ $t('ui.notifications') }}</h2>
              <p>{{ $t('ui.notificationsAppearAtTheTopCenterForInformationSuccessFailure') }}</p>
            </div>
          </div>
          <div class="component-lab-toolbar">
            <VxButton type="button" @click="showInfoTip">{{ $t('ui.information') }}</VxButton>
            <VxButton type="button" @click="showSuccessTip">{{ $t('ui.success') }}</VxButton>
            <VxButton variant="danger" type="button" @click="showErrorTip">{{ $t('ui.failed') }}</VxButton>
            <VxButton variant="secondary" type="button" @click="showWarningTip">{{ $t('ui.warning') }}</VxButton>
          </div>
        </section>
      </div>
    </PageBody>

    <VxDrawer v-model="showDrawer" :title="$t('ui.readOnlyDetailsDrawer')" :subtitle="$t('ui.600pxCloseWithEscOrTheBackdrop')">
      <p class="component-lab-drawer-text">
        {{ $t('ui.drawersShowReadOnlyDetailsSuchAsRulesAndResources') }}
      </p>
      <p v-for="index in 24" :key="index" class="component-lab-drawer-text">
        {{ $t('ui.line') }} {{ index }} {{ $t('ui.rowsOfContentToCheckScrolling') }}
      </p>
      <template #footer>
        <span class="component-lab-drawer-spacer"></span>
        <VxButton variant="secondary" @click="showDrawer = false">{{ $t('ui.close') }}</VxButton>
        <VxButton @click="showDrawer = false">{{ $t('ui.primaryAction') }}</VxButton>
      </template>
    </VxDrawer>

    <VxModal
      v-model="showCommonDialog"
      :title="
        commonDialogLongHeading
          ? $t('ui.installationConfigurationAndResourceReviewLongTitlesWrapWhileKeeping')
          : $t('ui.sharedStyleDialog')
      "
      :subtitle="
        commonDialogLongHeading
          ? $t('ui.checkHowLongDescriptionsWrapInACompactHeaderTitles')
          : $t('ui.forCommonDialogContentSuchAsExplanationsEditingAndPreviews')
      "
      :close-on-overlay="commonDialogCloseOnOverlay"
    >
      <div class="component-lab-dialog-stack">
        <p>{{ $t('ui.thisDialogUsesTheSharedPanelStyleFormsListsAnd') }}</p>

        <div class="component-lab-toolbar">
          <VxSwitch v-model="commonDialogCloseOnOverlay" :label="$t('ui.allowClosingWithTheBackdrop')" />
          <VxCheckbox v-model="commonDialogLongHeading" :label="$t('ui.showLongTitleAndDescription')" />
        </div>

        <VxInput
          v-model="form.name"
          :label="$t('ui.inputFocusInDialog')"
          :hint="$t('ui.focusWithTabAndCheckThatTheFocusRingRemains')"
          :loading="loadingPreview"
          :error="validationPreview ? $t('ui.nameIsRequired') : ''"
          clearable
          data-testid="modal-focus-input"
        />
        <VxSelect
          v-model="form.source"
          :options="selectOptions"
          :label="$t('ui.dropdownLayeringInDialog')"
          :hint="$t('ui.checkThatDropdownMenusRemainVisibleAndClickableInsideDialogs')"
        />

        <div class="component-lab-dialog-tools">
          <VxButton type="button" @click="addCommonDialogContent">{{ $t('ui.addContent') }}</VxButton>
          <VxButton variant="secondary" type="button" @click="resetCommonDialogContent">
            {{ $t('ui.resetContent') }}
          </VxButton>
        </div>

        <div v-if="commonDialogExtraItems.length" class="component-lab-dialog-extra-list">
          <div
            v-for="item in commonDialogExtraItems"
            :key="item.id"
            class="component-lab-dialog-extra-item"
          >
            <strong>{{ item.title }}</strong>
            <p>{{ item.text }}</p>
          </div>
        </div>
      </div>

      <template #footer>
        <VxDialogActions
          :cancel-text="$t('ui.cancel')"
          :confirm-text="$t('modBrowser.install')"
          :actions="commonDialogActions"
          @cancel="showCommonDialog = false"
          @confirm="showCommonDialog = false"
          @action="handleDialogAction"
        />
      </template>
    </VxModal>

    <VxConfirmModal
      v-model="showSimpleConfirmDialog"
      :title="$t('taskCenter.confirm.clearHistoryTitle')"
      :description="$t('ui.thisClears6CompletedOrCancelledRecordsWithoutStoppingRunning')"
      :confirm-text="$t('taskCenter.confirm.confirmClear')"
      :cancel-text="$t('taskCenter.confirm.keep')"
      danger
      @confirm="confirmResult = 'confirmed'"
      @cancel="handleCancel"
    />

    <VxConfirmModal
      v-model="showConfirmDialog"
      :title="$t('ui.confirmDestructiveAction')"
      :subtitle="$t('ui.deletionOrOverwrite')"
      :content="$t('ui.confirmBeforeExecutionToAvoidAccidentalIrreversibleChanges')"
      :confirm-text="$t('ui.confirmAndContinue')"
      :cancel-text="$t('ui.notNow')"
      :actions="confirmDialogActions"
      danger
      :confirm-action="handleConfirm"
      @cancel="handleCancel"
      @action="handleDialogAction"
    >
      <div class="component-lab-dialog-stack">
        <VxCheckbox v-model="simulateConfirmFailure" :label="$t('ui.simulateSubmissionFailure')" />
        <p class="component-lab-dialog-text">
          {{ $t('ui.thisSimulatesDeletingOrOverwritingConfirmingUpdatesTheLatestResult') }}
        </p>

        <div class="component-lab-dialog-editor">
          <VxTextarea
            v-model="confirmDialogDraft"
            :label="$t('ui.contentToAdd')"
            :rows="5"
            :placeholder="$t('ui.enterMultilineTextThenClickAddToDisplayItIn')"
          />
          <div class="component-lab-dialog-tools">
            <VxButton type="button" @click="addConfirmDialogContent">{{ $t('ui.addContent') }}</VxButton>
            <VxButton variant="secondary" type="button" @click="resetConfirmDialogContent">
              {{ $t('ui.resetContent') }}
            </VxButton>
          </div>
        </div>

        <div v-if="confirmDialogExtraItems.length" class="component-lab-dialog-extra-list">
          <div
            v-for="item in confirmDialogExtraItems"
            :key="item.id"
            class="component-lab-dialog-extra-item"
          >
            <strong>{{ item.title }}</strong>
            <p>{{ item.text }}</p>
          </div>
        </div>
      </div>
    </VxConfirmModal>
  </div>
</template>

<style scoped lang="scss">
.ui-guide-page {
  width: 100%;
  height: 100%;
}
.component-lab {
  max-width: 1440px;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: var(--font-size-sm) / var(--line-height-base) var(--font-family-base);
}
.component-lab-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
}
.component-lab-toolbar,
.component-lab-actions,
.component-badge-row,
.component-lab-dialog-tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.component-lab h1 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}
.component-lab h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}
.component-lab p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
}
.component-panel {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-6);
  padding: var(--space-5) var(--space-6);
  border-top: 1px solid var(--color-border);
}
.component-color-groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}
.component-color-group,
.component-color-grid {
  display: grid;
  align-content: start;
  gap: var(--space-3);
}
.component-color-group-title {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}
.component-color-card {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
}
.component-color-swatch {
  width: 28px;
  height: 28px;
  background: var(--component-swatch-color);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
}
.component-color-meta {
  display: grid;
  min-width: 0;
}
.component-color-meta strong {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}
.component-color-meta code {
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}
.component-color-meta span {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.component-lab-form-grid,
.component-lab-control-grid,
.component-lab-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  align-items: start;
  gap: var(--space-4) var(--space-5);
}
.component-lab-field-wide {
  max-width: 720px;
  grid-column: 1 / -1;
}
.component-lab-field,
.component-lab-control-box,
.component-lab-state-stack,
.component-lab-dialog-stack,
.component-lab-dialog-editor,
.component-lab-dialog-extra-list {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-width: 0;
}
.component-lab-field > span,
.component-lab-control-box > span {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}
.component-lab-feedback {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.component-lab-feedback strong {
  color: var(--color-text);
}
.component-lab-feedback span,
.component-lab-dialog-text {
  color: var(--color-text-muted);
}
.component-lab-alignment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
}
.component-lab-stress-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  align-items: start;
  gap: var(--space-5);
}
.component-lab-narrow {
  display: grid;
  gap: var(--space-4);
  width: min(100%, 240px);
}
.component-lab-dialog-extra-item {
  display: grid;
  gap: var(--space-2);
  padding-block: var(--space-3);
  border-top: 1px solid var(--color-border);
}
.component-lab-dialog-extra-item p,
.component-lab-dialog-text {
  margin: 0;
  line-height: var(--line-height-base);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
@media (max-width: 1100px) {
  .component-lab-stress-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .component-panel {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
}
@media (max-width: 700px) {
  .component-lab-hero {
    align-items: start;
    flex-direction: column;
  }
  .component-color-groups,
  .component-lab-alignment-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

.component-lab-drawer-text {
  margin: 0 0 12px;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.component-lab-drawer-spacer {
  flex: 1 1 auto;
}
</style>
