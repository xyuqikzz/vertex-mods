<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { VxButton } from '@renderer/component/vertex-ui'
import {
  CheckOutlined,
  CloseOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  SyncOutlined
} from '@ant-design/icons-vue'
import {
  resolvePlanConflictItems,
  resolvePlanExecutionState,
  resolvePlanMissingDependencies
} from './agentPlanCardView.js'
import {
  canAnalyzeTaskLogs,
  resolveTaskCompletionSummary,
  resolveTaskFailureSummary,
  resolveTaskLinkedJobId,
  resolveTaskPostRollbackActionItems,
  resolveTaskPostRollbackSummary
} from './agentTaskPanelView.js'
import { formatAgentPermissionLine } from './agentPermissionView.js'

const props = defineProps({
  kind: { type: String, required: true },
  plan: { type: Object, default: null },
  confirmation: { type: Object, default: null },
  task: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
  actionBusyTaskId: { type: String, default: '' }
})

const emit = defineEmits([
  'submit-plan',
  'decide-plan',
  'manual-download-plan',
  'cancel-plan',
  'confirm',
  'cancel-confirmation',
  'cancel-task',
  'retry-task',
  'rollback-task',
  'analyze-logs',
  'repair-post-rollback',
  'view-task',
  'refresh-tasks'
])

const detailOpen = ref(false)
const fullDetailOpen = ref(false)
const credentialSecretInput = ref({
  apiKey: ''
})

const stageLabelMap = Object.freeze({
  get queued() { return uiText('taskCenter.states.queued') },
  get analyzing() { return uiText('ui.analyzing') },
  get cancelling() { return uiText('ui.stopping') },
  get waiting_confirmation() { return uiText('ui.waitingForConfirmation') },
  get partial() { return uiText('ui.partiallyComplete') },
  get submitted() { return uiText('ui.taskSubmitted') },
  get searching() { return uiText('ui.searching') },
  get resolving_dependencies() { return uiText('ui.resolvingDependenciesVariant2') },
  get downloading() { return uiText('tools.downloading') },
  get inspecting() { return uiText('taskCenter.itemStates.prechecking') },
  get planning() { return uiText('ui.planning') },
  get detecting_conflicts() { return uiText('ui.checkingConflicts') },
  get backing_up() { return uiText('ui.backingUp') },
  get installing() { return uiText('taskCenter.itemStates.installing') },
  get verifying() { return uiText('taskCenter.itemStates.health_checking') },
  get repairing() { return uiText('ui.repairingVariant2') },
  get completed() { return uiText('tools.completed') },
  get failed() { return uiText('ui.failed') },
  get cancelled() { return uiText('taskCenter.views.cancelled') },
  get rollbacking() { return uiText('ui.rollingBack') },
  get rolled_back() { return uiText('ui.rolledBack') }
})

function safeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function safeNumber(value = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function clampProgress(value = 0) {
  return Math.max(0, Math.min(100, safeNumber(value)))
}

function isPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function toSafeList(value = []) {
  return Array.isArray(value) ? value : []
}

function formatStage(stage = '') {
  const key = safeText(stage)
  return stageLabelMap[key] || key || '--'
}

function getStageTone(stage = '') {
  const key = safeText(stage)
  if (['completed', 'rolled_back'].includes(key)) return 'success'
  if (key === 'failed') return 'danger'
  if (key === 'cancelled') return 'muted'
  if (key === 'queued') return 'pending'
  return 'processing'
}

function formatTime(value = '') {
  const text = safeText(value)
  if (!text) return '--'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function resolveTaskId(task = {}) {
  return safeText(task.taskId || task.task_id || task.agentTaskId || task.agent_task_id)
}

function hasExecutionId(task = {}) {
  return Boolean(
    task.executionId ||
      task.execution_id ||
      task?.plan?.executionId ||
      task?.plan?.execution_id ||
      task?.result?.lastChatResult?.executionId ||
      task?.result?.retryResult?.executionId
  )
}

function isTerminalTask(task = {}) {
  return ['completed', 'failed', 'cancelled', 'rolled_back'].includes(safeText(task.stage))
}

function hasRetryRequest(task = {}) {
  return Boolean(
    task?.plan?.retryRequest || task?.plan?.retry_request || task?.result?.retryRequest
  )
}

function canCancelTask(task = {}) {
  return Boolean(
    task.cancelable && (resolveTaskLinkedJobId(task) || hasExecutionId(task)) && !isTerminalTask(task)
  )
}

function canRetryTask(task = {}) {
  return Boolean(
    (resolveTaskLinkedJobId(task) || hasRetryRequest(task)) &&
      ['failed', 'cancelled'].includes(safeText(task.stage))
  )
}

function canRollbackTask(task = {}) {
  return Boolean(
    resolveTaskLinkedJobId(task) && ['completed', 'failed'].includes(safeText(task.stage))
  )
}

function getStandardPreflight(plan = {}) {
  return isPlainObject(plan?.standardPreflight) ? plan.standardPreflight : {}
}

function getStandardPlan(plan = {}) {
  const standardPreflight = getStandardPreflight(plan)
  return isPlainObject(standardPreflight.standardInstallPlan)
    ? standardPreflight.standardInstallPlan
    : {}
}

const planExecutionState = computed(() => resolvePlanExecutionState(props.plan, props.submitting))
const planStandardPreflight = computed(() => getStandardPreflight(props.plan || {}))
const planStandardPlan = computed(() => getStandardPlan(props.plan || {}))
const planConflictResult = computed(() => {
  const preflightConflict = planStandardPreflight.value?.conflictResult
  const planConflict = planStandardPlan.value?.conflictResult
  return isPlainObject(preflightConflict)
    ? preflightConflict
    : isPlainObject(planConflict)
      ? planConflict
      : {}
})
const planMissingDependencies = computed(() => resolvePlanMissingDependencies(props.plan || {}, 4))
const planOperationPreview = computed(() => {
  const operations = toSafeList(planStandardPlan.value?.operations)
  const routes = toSafeList(planStandardPlan.value?.routes)
  return [
    ...operations.slice(0, 4).map((item) => ({
      label: safeText(item.relativePath || item.relativeTargetPath || item.targetPath, uiText('ui.fileOperations')),
      meta: safeText(item.kind || item.type, 'copy')
    })),
    ...routes.slice(0, 3).map((item) => ({
      label: safeText(item.targetRelativePath || item.targetRoot, uiText('ui.routeTarget')),
      meta: safeText(item.routeId, 'route')
    }))
  ].slice(0, 5)
})
const planRiskItems = computed(() => {
  const risks = toSafeList(planStandardPreflight.value?.risks).length
    ? toSafeList(planStandardPreflight.value?.risks)
    : toSafeList(planStandardPlan.value?.risks)
  const warnings = toSafeList(planStandardPreflight.value?.warnings).length
    ? toSafeList(planStandardPreflight.value?.warnings)
    : toSafeList(planStandardPlan.value?.warnings)
  return [...resolvePlanConflictItems(planConflictResult.value, 3), ...risks, ...warnings].slice(
    0,
    5
  )
})
const hasPlanFullDetails = computed(() =>
  Boolean(
    safeText(planStandardPreflight.value?.payloadHash) ||
      safeText(planStandardPreflight.value?.message) ||
      safeText(planConflictResult.value?.level) ||
      planOperationPreview.value.length ||
      planMissingDependencies.value.length ||
      planRiskItems.value.some((item) =>
        safeText(item?.message || item?.reason || item?.action || item?.code)
      )
  )
)
const planPreflightText = computed(() => {
  const status = safeText(planStandardPreflight.value?.status)
  const reason = safeText(planStandardPreflight.value?.reason)
  if (status === 'completed') return uiText('ui.preflightComplete')
  if (reason === 'missing_archive') return uiText('ui.waitingForDownloadBeforePreflight')
  if (reason === 'archive_not_found') return uiText('ui.localPackageDoesNotExist')
  if (status === 'failed') return uiText('ui.preflightFailed')
  return safeText(props.plan?.precheckText, uiText('ui.waitingForDownloadBeforePreflight'))
})
const planHasPreflightSignal = computed(() =>
  Boolean(
    planStandardPreflight.value?.status ||
      planStandardPreflight.value?.reason ||
      props.plan?.precheckText
  )
)

const confirmationArgs = computed(() => {
  if (isPlainObject(props.confirmation?.argsPreview)) return props.confirmation.argsPreview
  return isPlainObject(props.confirmation?.args) ? props.confirmation.args : {}
})
const confirmationInput = computed(() =>
  isPlainObject(props.confirmation?.confirmationInput) ? props.confirmation.confirmationInput : {}
)
const isCredentialConfirmation = computed(
  () => safeText(confirmationInput.value.kind) === 'source_credential'
)
const isScriptConfirmation = computed(() => props.confirmation?.toolName === 'vertex.script.run')
const isDlssConfirmation = computed(() => props.confirmation?.toolName === 'vertex.dlss.execute')
const scriptPreview = computed(() => props.confirmation?.scriptPreview || {})
const credentialSource = computed(() => safeText(confirmationArgs.value.source))
const credentialGuide = computed(() => {
  const guides = isPlainObject(confirmationInput.value.sourceGuides)
    ? confirmationInput.value.sourceGuides
    : {}
  const guide = guides[credentialSource.value]
  return isPlainObject(guide) ? guide : {}
})
const credentialApiKeyText = computed(() => safeText(credentialSecretInput.value.apiKey))
const confirmationStatus = computed(() => safeText(props.confirmation?.status, 'pending'))
const confirmationPermission = computed(() =>
  isPlainObject(props.confirmation?.permission) ? props.confirmation.permission : {}
)
const confirmationPermissionSummary = computed(() => {
  return formatAgentPermissionLine({
    ...props.confirmation,
    permission: confirmationPermission.value
  })
})
const confirmationTarget = computed(() => {
  if (isDlssConfirmation.value) return confirmationArgs.value.game || 'DLSS5 安装方案'
  if (isScriptConfirmation.value) return scriptPreview.value.reason || '运行本地脚本'
  const plan = confirmationArgs.value.installPlan || confirmationArgs.value.plan || {}
  const repairAction = confirmationArgs.value.action || confirmationArgs.value.repairAction || {}
  const executionPayload = repairAction.executionPayload || repairAction || {}
  return safeText(
    plan.modName ||
      plan.name ||
      repairAction.title ||
      repairAction.targetRelativePath ||
      executionPayload.targetRelativePath ||
      executionPayload.actionType ||
      confirmationArgs.value.modName ||
      confirmationArgs.value.agentTaskId,
    '待确认操作'
  )
})
const canCreateGrant = computed(() => {
  if (isCredentialConfirmation.value) return false
  if (props.confirmation?.allowGrant === false) return false
  return Boolean(confirmationArgs.value?.operationType || props.confirmation?.toolName)
})

const taskProgress = computed(() => clampProgress(props.task?.progress))
const taskTone = computed(() => getStageTone(props.task?.stage))
const taskTitle = computed(() =>
  safeText(
    // 优先展示真正在安装的模组名，避免回显用户原始提问当作任务标题。
    props.task?.modName ||
      props.task?.plan?.modName ||
      props.task?.currentTarget ||
      props.task?.current_target ||
      props.task?.type,
    'Agent 任务'
  )
)
const taskSummary = computed(
  () =>
    safeText(props.task?.errorMessage || props.task?.error_message) ||
    resolveTaskFailureSummary(props.task || {}) ||
    resolveTaskCompletionSummary(props.task || {}) ||
    resolveTaskPostRollbackSummary(props.task || '')
)
const taskPostRollbackActions = computed(() => resolveTaskPostRollbackActionItems(props.task || {}))
const taskBusy = computed(() => props.actionBusyTaskId === resolveTaskId(props.task || {}))
const hasSecondaryActions = computed(() => {
  if (props.kind === 'plan') return !props.plan?.submitted && !props.plan?.completed
  if (props.kind === 'confirmation') return confirmationStatus.value === 'pending'
  if (props.kind === 'task') return true
  return false
})

const rowTone = computed(() => {
  if (props.kind === 'task') return taskTone.value
  if (props.kind === 'confirmation') {
    if (confirmationStatus.value === 'running') return 'processing'
    if (confirmationStatus.value === 'completed') return 'success'
    if (confirmationStatus.value === 'approved') return 'success'
    if (confirmationStatus.value === 'failed') return 'danger'
    if (confirmationStatus.value === 'cancelled') return 'muted'
    return 'pending'
  }
  if (props.submitting) return 'processing'
  if (props.plan?.submitted || props.plan?.completed) return 'success'
  if (planExecutionState.value.tone === 'danger') return 'danger'
  if (planExecutionState.value.tone === 'warning') return 'pending'
  return 'pending'
})

const rowTitle = computed(() => {
  if (props.kind === 'task') return taskTitle.value
  if (props.kind === 'confirmation') return confirmationTarget.value
  return safeText(props.plan?.modName || props.plan?.name, uiText('ui.modAwaitingConfirmation'))
})

const rowMeta = computed(() => {
  if (isDlssConfirmation.value) return confirmationArgs.value.operation || 'DLSS5 安装或还原'
  if (isScriptConfirmation.value) return scriptPreview.value.type === 'ps1' ? 'PowerShell 脚本' : 'BAT 脚本'
  if (props.kind === 'task') {
    return [
      formatTime(props.task?.updatedAt || props.task?.createdAt),
      resolveTaskId(props.task || {})
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (props.kind === 'confirmation') {
    return [safeText(props.confirmation?.toolName, '授权'), safeText(props.confirmation?.mode)]
      .filter(Boolean)
      .join(' · ')
  }
  return [
    safeText(props.plan?.sourceLabel || props.plan?.source, '来源待确认'),
    safeText(props.plan?.version, 'latest')
  ]
    .filter(Boolean)
    .join(' · ')
})

const rowStatusText = computed(() => {
  if (props.kind === 'task') return formatStage(props.task?.stage)
  if (props.kind === 'confirmation') {
    const map = {
      pending: '待授权',
      approved: '已允许',
      running: '运行中',
      completed: '已完成',
      cancelled: '已取消',
      failed: '失败'
    }
    return map[confirmationStatus.value] || uiText('ui.awaitingAuthorization')
  }
  if (props.submitting) return uiText('ui.submitting')
  if (props.plan?.completed) return uiText('tools.completed')
  if (props.plan?.submitted) return uiText('ui.submitted')
  if (planExecutionState.value.action === 'manual_download') return uiText('ui.awaitingAuthorization')
  if (planExecutionState.value.action === 'decide') return uiText('ui.missingInformation')
  if (planHasPreflightSignal.value) return planPreflightText.value
  return uiText('tools.unconfirmed')
})

const primaryText = computed(() => {
  if (props.kind === 'task') {
    if (taskBusy.value) return uiText('ui.processingVariant4')
    if (canCancelTask(props.task || {})) return uiText('ui.cancel')
    if (canRetryTask(props.task || {})) return uiText('tools.retry')
    return uiText('ui.viewTask')
  }
  if (props.kind === 'confirmation') {
    if (isScriptConfirmation.value) {
      if (confirmationStatus.value === 'running') return uiText('tools.running3')
      if (confirmationStatus.value === 'completed') return uiText('tools.completed')
      if (confirmationStatus.value === 'failed') return uiText('ui.prepareAgain')
      if (confirmationStatus.value === 'pending') return uiText('ui.runScript')
    }
    if (confirmationStatus.value === 'approved') return uiText('ui.allowed')
    if (confirmationStatus.value === 'cancelled') return uiText('taskCenter.views.cancelled')
    if (confirmationStatus.value === 'failed') return uiText('tools.retry')
    return uiText('ui.allow')
  }
  if (props.plan?.submitted || props.plan?.completed) return uiText('ui.viewTask')
  if (props.submitting) return uiText('ui.submitting')
  if (planExecutionState.value.action === 'manual_download') {
    return planExecutionState.value.primaryText
  }
  if (planExecutionState.value.action === 'decide') return uiText('taskCenter.bulk.resume')
  return uiText('modBrowser.install')
})

const primaryDisabled = computed(() => {
  if (props.kind === 'task') return taskBusy.value
  if (props.kind === 'confirmation') {
    if (isScriptConfirmation.value) return confirmationStatus.value !== 'pending' || !scriptPreview.value.scriptContent
    if (
      isCredentialConfirmation.value &&
      ['pending', 'failed'].includes(confirmationStatus.value)
    ) {
      return !credentialApiKeyText.value
    }
    return ['approved', 'cancelled'].includes(confirmationStatus.value)
  }
  if (props.plan?.submitted || props.plan?.completed) return false
  return planExecutionState.value.disabled
})

function toggleDetails() {
  detailOpen.value = !detailOpen.value
}

function handlePrimaryAction() {
  if (props.kind === 'task') {
    if (canCancelTask(props.task || {})) {
      emit('cancel-task', props.task)
      return
    }
    if (canRetryTask(props.task || {})) {
      emit('retry-task', props.task)
      return
    }
    emit('view-task', props.task)
    return
  }
  if (props.kind === 'confirmation') {
    if (confirmationStatus.value === 'failed') {
      emit('confirm', buildConfirmationSubmitPayload())
      return
    }
    if (confirmationStatus.value !== 'pending') return
    emit('confirm', buildConfirmationSubmitPayload())
    return
  }
  if (props.plan?.submitted || props.plan?.completed) {
    emit('view-task', props.plan)
    return
  }
  if (planExecutionState.value.action === 'decide') {
    emit('decide-plan', props.plan)
    return
  }
  if (planExecutionState.value.action === 'manual_download') {
    emit('manual-download-plan', props.plan)
    return
  }
  if (planExecutionState.value.action === 'submit') {
    emit('submit-plan', props.plan)
  }
}

function confirmWithGameGrant() {
  emit('confirm', {
    ...props.confirmation,
    grantScope: 'game'
  })
}

function buildConfirmationSubmitPayload() {
  if (!isCredentialConfirmation.value) {
    return props.confirmation
  }
  return {
    ...props.confirmation,
    secretInput: {
      apiKey: credentialApiKeyText.value
    }
  }
}

watch(
  () => props.confirmation?.id,
  () => {
    credentialSecretInput.value = {
      apiKey: ''
    }
    if (isCredentialConfirmation.value || isScriptConfirmation.value || isDlssConfirmation.value) {
      detailOpen.value = true
    }
  },
  { immediate: true }
)
</script>

<template>
  <article class="agent-action-row" :class="[`is-${rowTone}`, `kind-${kind}`]">
    <div class="agent-action-row__line">
      <span class="agent-action-row__icon" aria-hidden="true">
        <CheckOutlined v-if="rowTone === 'success'" />
        <CloseOutlined v-else-if="rowTone === 'danger'" />
        <SafetyCertificateOutlined v-else-if="kind === 'confirmation'" />
        <SyncOutlined v-else-if="rowTone === 'processing'" />
        <FileSearchOutlined v-else />
      </span>

      <div class="agent-action-row__main" :title="`${rowTitle} ${rowMeta}`">
        <strong>{{ rowTitle }}</strong>
        <span>{{ rowMeta }}</span>
      </div>

      <div
        v-if="kind === 'task'"
        class="agent-action-row__progress"
        role="progressbar"
        :aria-valuenow="taskProgress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${taskProgress}%` }"></i>
      </div>

      <span class="agent-action-row__status">
        <i></i>
        {{ rowStatusText }}
      </span>

      <VxButton
        v-if="isScriptConfirmation"
        class="agent-action-row__script-run"
        variant="danger"
        size="sm"
        :loading="confirmationStatus === 'running'"
        :disabled="primaryDisabled"
        :aria-label="`${primaryText}：${rowTitle}`"
        @click="handlePrimaryAction"
      >
        {{ primaryText }}
      </VxButton>
      <button
        v-else
        class="agent-action-row__primary"
        type="button"
        :disabled="primaryDisabled"
        :aria-label="`${primaryText}：${rowTitle}`"
        @click="handlePrimaryAction"
      >
        {{ primaryText }}
      </button>

      <button
        class="agent-action-row__more-toggle"
        type="button"
        :aria-label="$t('ui.valueDetailsValue', { value1: (detailOpen ? $t('ui.collapse') : $t('ui.expand')), value2: (rowTitle) })"
        :aria-expanded="detailOpen"
        @click="toggleDetails"
      >
        ⋯
      </button>
    </div>

    <div v-if="detailOpen" class="agent-action-row__detail">
      <template v-if="kind === 'plan'">
        <span>{{ $t('ui.target') }} {{ plan?.gameName || '--' }}</span>
        <span>{{ $t('tools.file') }} {{ plan?.fileName || '--' }}</span>
        <span
          >{{ $t('taskCenter.detail.dependency') }} {{ Number(plan?.dependencyCount || planMissingDependencies.length || 0) }} {{ $t('ui.itemsVariant2') }}</span
        >
        <span>{{ $t('taskCenter.stages.precheck') }} {{ planPreflightText }}</span>
        <p v-if="plan?.targetSummary">{{ plan.targetSummary }}</p>
        <button v-if="hasPlanFullDetails" type="button" @click="fullDetailOpen = !fullDetailOpen">
          {{ fullDetailOpen ? $t('ui.collapseAll') : $t('ui.expandAll') }}
        </button>
        <ul v-if="fullDetailOpen && hasPlanFullDetails">
          <li v-if="planStandardPreflight?.payloadHash">
            Hash {{ String(planStandardPreflight.payloadHash).slice(0, 8) }}
          </li>
          <li v-if="planStandardPreflight?.message">
            {{ planStandardPreflight.message }}
          </li>
          <li v-if="planConflictResult?.level">
            {{ $t('ui.conflictLevel') }}{{ planConflictResult.level }} ·
            {{ planConflictResult.requiresUserConfirm ? $t('taskCenter.detail.checkWarning') : $t('ui.readyToContinue') }}
          </li>
          <li v-for="item in planOperationPreview" :key="`${item.meta}:${item.label}`">
            {{ item.label }} · {{ item.meta }}
          </li>
          <li v-for="item in planMissingDependencies" :key="item.id || item.name">
            {{ $t('taskCenter.detail.dependency') }} {{ item.name || item.id }} · {{ item.installState || 'missing' }}
          </li>
          <li v-for="item in planRiskItems" :key="item.code || item.message || item.action">
            {{ item.message || item.reason || item.action || item.code }}
          </li>
        </ul>
      </template>

      <template v-else-if="kind === 'confirmation'">
        <div v-if="isDlssConfirmation">
          <p>{{ confirmationArgs.operation }} · {{ confirmationArgs.executable || $t('ui.registeredGame') }}</p>
          <p>{{ $t('ui.plan') }}{{ confirmationArgs.route || $t('ui.currentlyInstalledSetup') }} · {{ confirmationArgs.hasBackup ? $t('ui.existingBackup') : $t('ui.createABackupDuringInstallation') }}</p>
          <p v-if="confirmationArgs.antiCheatWarning">{{ $t('ui.antiCheatComponentsWereDetectedTheInstallerWillRequireA') }}</p>
          <p>{{ confirmationArgs.notice }}</p>
        </div>
        <div v-if="isScriptConfirmation" class="agent-action-row__script">
          <p>{{ scriptPreview.type?.toUpperCase() }} {{ $t('ui.timeout') }} {{ (scriptPreview.timeoutMs || 60000) / 1000 }} {{ $t('ui.secondsVariant2') }}</p>
          <p>{{ $t('ui.workingDirectoryVariant2') }}{{ scriptPreview.workingDirectory || $t('ui.separateTemporaryFolder') }}</p>
          <pre tabindex="0" :aria-label="$t('ui.scriptToRun')"><code>{{ scriptPreview.scriptContent }}</code></pre>
          <p v-if="confirmationStatus === 'failed'">{{ $t('ui.theScriptMayHaveMadePartialChangesCheckTheOutput') }}</p>
        </div>
        <div v-if="isCredentialConfirmation" class="agent-action-row__credential">
          <label>
            <span>{{ credentialGuide.inputLabel || 'API Key' }}</span>
            <input
              v-model.trim="credentialSecretInput.apiKey"
              type="password"
              autocomplete="off"
              :placeholder="credentialGuide.inputPlaceholder || $t('ui.pasteAPIKey')"
            />
          </label>
          <a
            v-if="credentialGuide.helpUrl"
            :href="credentialGuide.helpUrl"
            target="_blank"
            rel="noreferrer"
          >
            {{ $t('ui.getAPIKey') }}
          </a>
          <p v-if="credentialGuide.helpText">{{ credentialGuide.helpText }}</p>
        </div>
        <p v-if="isScriptConfirmation">{{ $t('ui.scriptsRunWithTheClientSCurrentPermissionsAndMay') }}</p>
        <template v-else-if="!isDlssConfirmation">
          <span>{{ $t('modelSettings.tool') }} {{ confirmation?.toolName || '--' }}</span>
          <span>{{ $t('ui.mode') }} {{ confirmation?.mode || '--' }}</span>
          <span v-if="confirmationPermissionSummary">{{ confirmationPermissionSummary }}</span>
          <p v-if="confirmationArgs.reason || confirmation?.description">
            {{ confirmationArgs.reason || confirmation.description }}
          </p>
        </template>
      </template>

      <template v-else>
        <span>{{ $t('taskCenter.table.progress') }} {{ taskProgress }}%</span>
        <span>{{ $t('taskCenter.detail.facts.updated') }} {{ formatTime(task?.updatedAt || task?.createdAt) }}</span>
        <span v-if="resolveTaskLinkedJobId(task)">{{ $t('taskCenter.table.task') }} {{ resolveTaskLinkedJobId(task) }}</span>
        <p v-if="taskSummary">{{ taskSummary }}</p>
      </template>

      <div v-if="hasSecondaryActions" class="agent-action-row__detail-actions">
        <button
          v-if="kind === 'plan' && !plan?.submitted"
          type="button"
          @click="emit('cancel-plan')"
        >
          {{ $t('ui.notNowVariant2') }}
        </button>
        <button
          v-if="kind === 'confirmation' && confirmationStatus === 'pending' && canCreateGrant"
          type="button"
          @click="confirmWithGameGrant"
        >
          {{ $t('ui.allowForThisGameFor24Hours') }}
        </button>
        <button
          v-if="kind === 'confirmation' && confirmationStatus === 'pending'"
          type="button"
          @click="emit('cancel-confirmation', confirmation)"
        >
          {{ $t('ui.cancel') }}
        </button>
        <button
          v-if="kind === 'task' && canAnalyzeTaskLogs(task)"
          type="button"
          @click="emit('analyze-logs', task)"
        >
          {{ $t('ui.analyzeLogs') }}
        </button>
        <template v-if="kind === 'task'">
          <button
            v-for="action in taskPostRollbackActions"
            :key="action.id"
            type="button"
            @click="emit('repair-post-rollback', { task, action: action.action })"
          >
            {{ action.label }}
          </button>
        </template>
        <button
          v-if="kind === 'task' && canRollbackTask(task)"
          class="is-danger"
          type="button"
          @click="emit('rollback-task', task)"
        >
          {{ $t('ui.rollBack') }}
        </button>
        <button v-if="kind === 'task'" type="button" @click="emit('refresh-tasks')">
          {{ $t('ui.refreshTask') }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.agent-action-row {
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid #dfe6f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    0 6px 18px rgba(15, 23, 42, 0.045),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &.is-pending {
    border-color: #e2e8f0;
  }

  &.is-processing {
    border-color: #bfdbfe;
    background: #f8fbff;
  }

  &.is-success {
    border-color: #bbf7d0;
    background: #f7fef9;
  }

  &.is-danger {
    border-color: #fecaca;
    background: #fff7f7;
  }

  &.is-muted {
    border-color: #e2e8f0;
    background: #f8fafc;
  }

  &:hover {
    border-color: #cbd8e7;
    box-shadow:
      0 8px 22px rgba(31, 41, 55, 0.07),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }
}

.agent-action-row__line {
  min-width: 0;
  min-height: 40px;
  padding: 0 7px 0 8px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 7px;
}

.agent-action-row__icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  box-sizing: border-box;
}

.is-pending .agent-action-row__icon {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #c2410c;
}

.is-processing .agent-action-row__icon {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #2563eb;
}

.is-success .agent-action-row__icon {
  background: #dcfce7;
  border-color: #bbf7d0;
  color: #15803d;
}

.is-danger .agent-action-row__icon {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}

.is-muted .agent-action-row__icon {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #64748b;
}

.agent-action-row__main {
  min-width: 0;

  strong,
  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #111827;
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
  }

  span {
    color: #64748b;
    font-size: 11px;
    line-height: 14px;
  }
}

.agent-action-row__progress {
  flex-shrink: 0;
  width: 46px;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background: #e5eaf2;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #2563eb;
    transition: width 0.2s ease;
  }
}

.agent-action-row__status {
  flex-shrink: 0;
  max-width: 150px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid #e5eaf2;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.76);
  color: #475569;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #d97706;
  }
}

.is-processing .agent-action-row__status i {
  background: #2563eb;
}

.is-processing .agent-action-row__status {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.is-success .agent-action-row__status i {
  background: #16a34a;
}

.is-success .agent-action-row__status {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}

.is-danger .agent-action-row__status i {
  background: #dc2626;
}

.is-danger .agent-action-row__status {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.is-muted .agent-action-row__status i {
  background: #94a3b8;
}

.is-muted .agent-action-row__status {
  background: #f8fafc;
  color: #64748b;
}

.agent-action-row__primary,
.agent-action-row__more-toggle {
  height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;

  &:active {
    transform: translateY(1px);
  }
}

.agent-action-row__primary {
  padding: 0 10px;
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;

  &:hover:not(:disabled) {
    border-color: #1d4ed8;
    background: #1d4ed8;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.18);
  }

  &:disabled {
    border-color: #cbd5e1;
    background: #cbd5e1;
    cursor: not-allowed;
  }
}

.agent-action-row__more-toggle {
  width: 28px;
  border: 1px solid #d7deea;
  background: #ffffff;
  color: #475569;
  font-size: 16px;
  line-height: 1;

  &:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
  }

  &[aria-expanded='true'] {
    border-color: #bfdbfe;
    background: #eff6ff;
    color: #2563eb;
  }
}

.agent-action-row__detail {
  margin: 0 8px 8px 35px;
  padding: 8px 0 0;
  border-top: 1px solid rgba(237, 242, 247, 0.92);
  color: #64748b;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 10px;
  font-size: 11px;
  line-height: 1.45;

  span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    flex-basis: 100%;
    margin: 0;
    color: #475569;
  }

  button {
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #2563eb;
    font-size: 11px;
    cursor: pointer;
  }

  ul {
    flex-basis: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  li {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.agent-action-row__credential {
  flex-basis: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 6px 8px;

  label {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label span {
    color: #334155;
    font-weight: 600;
  }

  input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #ffffff;
    color: #0f172a;
    font-size: 12px;
    box-sizing: border-box;
    outline: none;

    &:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
    }
  }

  a {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    color: #2563eb;
    font-size: 11px;
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }
  }

  p {
    grid-column: 1 / -1;
  }
}

.agent-action-row__detail-actions {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  button {
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    color: #334155;

    &:hover {
      color: #1d4ed8;
      background: #eff6ff;
    }

    &.is-danger {
      color: #b91c1c;

      &:hover {
        background: #fef2f2;
      }
    }
  }
}

.agent-action-row__script {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;

  pre {
    max-height: 280px;
    overflow: auto;
    padding: var(--space-3, 12px);
    border-radius: var(--radius-md, 8px);
    background: var(--color-bg-card);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;

    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    &::-webkit-scrollbar { width: 7px; }
    &::-webkit-scrollbar-track { background: var(--scrollbar-track-color); }
    &::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb-color); border-radius: 4px; }
    &::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
  }
}

// 抽屉等窄容器（≤400px）下隐藏次要信息，把空间留给标题与主操作，避免标题被截断。
@container ai-thread (max-width: 480px) {
  .agent-action-row__line {
    grid-template-columns: 20px minmax(0, 1fr) auto auto;
  }

  .agent-action-row__progress,
  .agent-action-row__status {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-action-row,
  .agent-action-row__progress i,
  .agent-action-row__primary,
  .agent-action-row__more-toggle {
    transition: none;
  }
}
</style>
