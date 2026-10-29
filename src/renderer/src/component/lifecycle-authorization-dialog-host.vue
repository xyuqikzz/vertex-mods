<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../i18n/message.js'

import { computed, onMounted, onUnmounted, ref } from 'vue'
import ClientConfirmDialog from '@views/game/component/modManagement/ClientConfirmDialog.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'

const REQUEST_CHANNEL = 'vertex:lifecycle:request-authorization'
const SUBMIT_CHANNEL = 'vertex:lifecycle:submit-authorization'

const pendingRequest = ref(null)
const submitting = ref(false)

const dialogOpen = computed(() => pendingRequest.value !== null)

const trustLevelLabel = computed(() => {
  const level = String(pendingRequest.value?.trustLevel || '').trim().toLowerCase()
  if (level === 'official') return uiText('ui.officialRules')
  if (level === 'community') return uiText('ui.communityRules')
  if (level === 'user') return uiText('ui.userRules')
  return level || uiText('ui.unknownSource')
})

const commandList = computed(() => {
  const commands = Array.isArray(pendingRequest.value?.commands) ? pendingRequest.value.commands : []
  return commands.map((cmd, index) => ({
    index: index + 1,
    action: String(cmd?.action || '').trim(),
    path: String(cmd?.path || '').trim(),
    executable: String(cmd?.executable || cmd?.path || '').trim(),
    workingDirectory: String(cmd?.workingDirectory || '').trim(),
    repeat: Number(cmd?.repeat || 1),
    requiresConsole: cmd?.requiresConsole === true,
    args: Array.isArray(cmd?.args) ? cmd.args.map((arg) => JSON.stringify(String(arg))).join(' ') : ''
  }))
})

function handleIpcRequest(_event, payload = {}) {
  const requestId = String(payload?.requestId || '').trim()
  if (!requestId) {
    console.warn('vertex:lifecycle:request-authorization 缺少 requestId', payload)
    return
  }
  if (pendingRequest.value) {
    // 已有弹窗未关闭，先拒绝前一个请求（避免 UI 卡死）
    submitResponse(pendingRequest.value.requestId, false)
  }
  pendingRequest.value = {
    requestId,
    trustLevel: String(payload?.trustLevel || '').trim().toLowerCase() || 'community',
    commands: Array.isArray(payload?.commands) ? payload.commands : []
  }
}

function submitResponse(requestId, confirmed) {
  try {
    ipcRenderer.send(SUBMIT_CHANNEL, {
      requestId: String(requestId || ''),
      confirmed: confirmed === true
    })
  } catch (error) {
    console.error('提交生命周期授权结果失败', error?.message || error)
    $message.error(uiMessage('ui.couldNotSubmitAuthorizationResultPleaseTryAgain'))
    return false
  }
  return true
}

function handleConfirm() {
  if (!pendingRequest.value || submitting.value) return
  submitting.value = true
  const requestId = pendingRequest.value.requestId
  const ok = submitResponse(requestId, true)
  submitting.value = false
  if (ok) {
    pendingRequest.value = null
  }
}

function handleCancel() {
  if (!pendingRequest.value || submitting.value) return
  submitting.value = true
  const requestId = pendingRequest.value.requestId
  const ok = submitResponse(requestId, false)
  submitting.value = false
  if (ok) {
    pendingRequest.value = null
  }
}

onMounted(() => {
  ipcRenderer.on(REQUEST_CHANNEL, handleIpcRequest)
})

onUnmounted(() => {
  ipcRenderer.removeListener(REQUEST_CHANNEL, handleIpcRequest)
})
</script>

<template>
  <ClientConfirmDialog
    :open="dialogOpen"
    :title="$t('ui.authorizeLifecycleCommands')"
    :subtitle="$t('ui.thisRuleComesFromValueAndContainsCommandsYourExplicit', { value1: (trustLevelLabel) })"
    :description="$t('ui.commandsFromUntrustedSourcesMayAffectSystemSecurityReviewThe')"
    tone="warning"
    :tone-label="$t('ui.riskWarning')"
    :confirm-text="$t('ui.allowExecution')"
    :cancel-text="$t('ui.denyAndAbort')"
    :close-on-mask="false"
    :loading="submitting"
    :width="640"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  >
    <div class="lifecycle-auth-dialog">
      <p class="lifecycle-auth-dialog__hint">
        {{ $t('ui.theseAreTheExecutableAndExpandedArgumentsUsedByThis') }}
      </p>
      <div v-if="commandList.length" class="lifecycle-auth-dialog__list">
        <div
          v-for="item in commandList"
          :key="item.index"
          class="lifecycle-auth-dialog__item"
        >
          <div class="lifecycle-auth-dialog__index">#{{ item.index }}</div>
          <div class="lifecycle-auth-dialog__body">
            <div class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.action') }}</span>
              <code class="lifecycle-auth-dialog__value">{{ item.action }}</code>
            </div>
            <div v-if="item.path" class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.path') }}</span>
              <code class="lifecycle-auth-dialog__value">{{ item.path }}</code>
            </div>
            <div v-if="item.args" class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.arguments') }}</span>
              <code class="lifecycle-auth-dialog__value">{{ item.args }}</code>
            </div>
            <div v-if="item.executable !== item.path" class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.executable') }}</span>
              <code class="lifecycle-auth-dialog__value">{{ item.executable }}</code>
            </div>
            <div v-if="item.workingDirectory" class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.workingDirectory') }}</span>
              <code class="lifecycle-auth-dialog__value">{{ item.workingDirectory }}</code>
            </div>
            <div v-if="item.repeat > 1 || item.requiresConsole" class="lifecycle-auth-dialog__row">
              <span class="lifecycle-auth-dialog__label">{{ $t('ui.executionMode') }}</span>
              <span class="lifecycle-auth-dialog__value">{{ $t('ui.execute') }} {{ item.repeat }} {{ $t('ui.times') }}{{ item.requiresConsole ? $t('ui.openTheConsole') : '' }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="lifecycle-auth-dialog__empty">{{ $t('ui.noCommandActions') }}</div>
    </div>
  </ClientConfirmDialog>
</template>

<style scoped lang="scss">
.lifecycle-auth-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 360px;
}

.lifecycle-auth-dialog__hint {
  margin: 0;
  color: var(--color-text-muted, #888);
  font-size: 13px;
  line-height: 1.5;
}

.lifecycle-auth-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}

.lifecycle-auth-dialog__item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg-elevated, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
}

.lifecycle-auth-dialog__index {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--color-text-muted, #888);
  font-size: 12px;
  min-width: 28px;
}

.lifecycle-auth-dialog__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.lifecycle-auth-dialog__row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  align-items: flex-start;
}

.lifecycle-auth-dialog__label {
  flex: 0 0 auto;
  color: var(--color-text-muted, #888);
  min-width: 32px;
}

.lifecycle-auth-dialog__value {
  flex: 1 1 auto;
  font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  word-break: break-all;
  white-space: pre-wrap;
  background: rgba(0, 0, 0, 0.18);
  padding: 1px 6px;
  border-radius: 4px;
}

.lifecycle-auth-dialog__empty {
  color: var(--color-text-muted, #888);
  font-size: 13px;
  padding: 12px;
  text-align: center;
}
</style>
