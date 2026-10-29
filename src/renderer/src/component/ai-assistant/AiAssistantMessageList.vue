<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import AgentActionRow from './AgentActionRow.vue'
import AgentToolTraceItem from './AgentToolTraceItem.vue'
import AiModCandidateCard from './AiModCandidateCard.vue'
import { filterInstallRelatedAgentTasks } from './agentTaskPanelView.js'
import {
  escapeAiAgentMarkdownHtml,
  normalizeAiAgentMarkdownLinkHref,
  renderAiAgentMarkdownLink
} from '../../../../shared/ai/conversation/ai-agent-markdown-link.js'
import { splitAiAssistantReasoningContent } from '../../../../shared/ai/conversation/ai-assistant-message-reasoning.js'
import { getAiAgentOutcomeLabel } from '../../../../shared/ai/conversation/ai-agent-outcome.js'
import { VxButton } from '@renderer/component/vertex-ui'
import { ExclamationCircleOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  sessionId: { type: String, default: '' },
  processing: { type: Boolean, default: false },
  phase: { type: String, default: '' },
  candidates: { type: Array, default: () => [] },
  installPlan: { type: Object, default: null },
  submittingPlan: { type: Boolean, default: false },
  tasks: { type: Array, default: () => [] },
  taskLoading: { type: Boolean, default: false },
  actionBusyTaskId: { type: String, default: '' },
  // 当前这一轮正在执行的步骤（实时推送）
  liveSteps: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'retry-message',
  'open-settings',
  'confirm-action',
  'cancel-confirmation',
  'candidate-detail',
  'candidate-plan',
  'submit-plan',
  'decide-plan',
  'manual-download-plan',
  'cancel-plan',
  'cancel-task',
  'retry-task',
  'rollback-task',
  'analyze-logs',
  'repair-post-rollback',
  'view-task',
  'refresh-tasks'
])

const listRef = ref(null)
const following = ref(true)
const hasNewContent = ref(false)
const showAllCandidates = ref(false)
const markedRenderer = new marked.Renderer()

markedRenderer.html = ({ text = '' } = {}) => escapeAiAgentMarkdownHtml(text)
markedRenderer.link = renderAiAgentMarkdownLink

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer: markedRenderer
})

// context 是页面上下文记录，continuation 是确认后自动续跑的内部提示，都不在对话里显示。
const HIDDEN_MESSAGE_TYPES = new Set(['context', 'continuation'])
const renderedMessages = computed(() =>
  props.messages
    .filter((message) => !HIDDEN_MESSAGE_TYPES.has(message?.type))
    .filter((message, index, list) => message.executionId || !isDuplicateAssistantMessage(list[index - 1], message))
    .map((message) => {
      const contentParts =
        message?.role === 'assistant'
          ? splitAiAssistantReasoningContent(message.content)
          : {
              answerContent: message.content,
              reasoningContent: '',
              hasReasoning: false,
              reasoningPending: false
            }
      return {
        ...message,
        htmlContent: renderMarkdown(message.executionId ? contentParts.answerContent : normalizeMessageContent(contentParts.answerContent)),
        reasoningHtmlContent: renderMarkdown(
          normalizeMessageContent(contentParts.reasoningContent)
        ),
        hasReasoning: contentParts.hasReasoning,
        reasoningPending: contentParts.reasoningPending
      }
    })
)
const messageRenderSignature = computed(() =>
  props.messages
    .filter((message) => message?.type !== 'context')
    .map(
      (message) =>
        `${message.id}:${String(message.content || '').length}:${message.streaming ? '1' : '0'}`
    )
    .join('|')
)
const visibleCandidates = computed(() =>
  showAllCandidates.value ? props.candidates : props.candidates.slice(0, 3)
)
const hiddenCandidateCount = computed(() =>
  Math.max(0, props.candidates.length - visibleCandidates.value.length)
)
// 一旦已经生成安装计划（或已提交/落任务），候选选择即完成使命，立即收起，
// 避免与计划/任务行重复展示，也不再让用户对同一需求二次选择。
const shouldShowCandidates = computed(() => props.candidates.length > 0 && !props.installPlan)
const installPlanTaskId = computed(() =>
  String(props.installPlan?.agentTaskId || props.installPlan?.taskId || '').trim()
)
const planLinkedTask = computed(() => {
  const taskId = installPlanTaskId.value
  if (!taskId) return null
  return props.tasks.find(
    (task) => String(task?.taskId || task?.agentTaskId || '').trim() === taskId
  )
})
const shouldShowInstallPlan = computed(
  () => Boolean(props.installPlan) && !(props.installPlan?.submitted && planLinkedTask.value)
)
const installRelatedTasks = computed(() => filterInstallRelatedAgentTasks(props.tasks))
const visibleTasks = computed(() => installRelatedTasks.value.slice(0, 4))
const hasInlineActions = computed(
  () => shouldShowCandidates.value || shouldShowInstallPlan.value || visibleTasks.value.length > 0
)
const inlineActionSignature = computed(() =>
  [
    props.candidates.map((item) => item?.id || item?.modId || item?.name).join(','),
    props.installPlan?.modName || '',
    props.installPlan?.submitted ? '1' : '0',
    props.submittingPlan ? '1' : '0',
    installRelatedTasks.value
      .map((task) => `${task?.taskId}:${task?.stage}:${Number(task?.progress || 0)}`)
      .join(',')
  ].join('|')
)
const progressText = computed(() => props.phase || '正在处理')
// 工具执行中时步骤列表已显示当前动作，进度行只在思考、分析结果等间隙出现。
const hasRunningStep = computed(() => props.liveSteps.some((step) => step?.status === 'running'))
const shouldShowProgress = computed(() => {
  if (!props.processing) return false

  const visibleMessages = props.messages.filter((message) => message?.type !== 'context')
  const lastUserMessageIndex = visibleMessages.findLastIndex((message) => message?.role === 'user')
  const currentTurnMessages =
    lastUserMessageIndex >= 0 ? visibleMessages.slice(lastUserMessageIndex + 1) : visibleMessages
  const hasAssistantContent = currentTurnMessages.some(
    (message) => message?.role === 'assistant' && String(message.content || '').trim()
  )

  return !hasAssistantContent
})
const orphanPunctuationPattern = /^[。！？!?，,；;：:、]+$/
const sentencePunctuationPattern = /[。！？!?，,；;：:、]$/
const duplicateTailLineMinLength = 6
const duplicateAssistantMessageMinLength = 12

// 结果状态的语气色：等待确认用主色，部分完成用警示色，未完成用危险色。
const outcomeToneMap = {
  waiting_confirmation: 'accent',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
  submitted: 'success'
}

function getOutcomeTone(outcome = '') {
  return outcomeToneMap[outcome] || 'neutral'
}

function getNoticeTone(message = {}) {
  if (message.outcome === 'cancelled' || message.error?.kind === 'cancelled') return 'neutral'
  if (message.outcome === 'partial') return 'warning'
  return message.outcome === 'failed' || message.type === 'error' ? 'danger' : 'warning'
}

function renderMarkdown(value = '') {
  const content = String(value ?? '')
  if (!content.trim()) {
    return ''
  }
  return marked.parse(content)
}

function handleMessageContentClick(event) {
  const target = event.target?.closest?.('a[href]')
  if (!target) return
  const safeHref = normalizeAiAgentMarkdownLinkHref(target.getAttribute('href'))
  event.preventDefault()
  if (safeHref) {
    window.open(safeHref, '_blank', 'noopener,noreferrer')
  }
}

function normalizeMessageContent(value = '') {
  const content = String(value ?? '').trim()
  if (/^(AI\s*)?请求失败[：:]\s*Request was aborted\.?$/i.test(content)) {
    return '用户中止'
  }
  return removeDuplicateTailLines(mergeOrphanPunctuationLines(content))
}

function normalizeComparableText(value = '') {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isDuplicateAssistantMessage(previousMessage = null, currentMessage = null) {
  if (previousMessage?.role !== 'assistant' || currentMessage?.role !== 'assistant') {
    return false
  }

  const previousText = normalizeComparableText(previousMessage.content)
  const currentText = normalizeComparableText(currentMessage.content)
  return (
    currentText.length >= duplicateAssistantMessageMinLength &&
    previousText.length > currentText.length &&
    previousText.endsWith(currentText)
  )
}

function mergeOrphanPunctuationLines(content = '') {
  const lines = String(content ?? '').split(/\r?\n/)
  const normalizedLines = []

  lines.forEach((line) => {
    const text = line.trim()
    if (!orphanPunctuationPattern.test(text)) {
      normalizedLines.push(line)
      return
    }

    while (normalizedLines.length && !normalizedLines[normalizedLines.length - 1].trim()) {
      normalizedLines.pop()
    }

    if (!normalizedLines.length) {
      normalizedLines.push(line)
      return
    }

    const previousLine = normalizedLines[normalizedLines.length - 1].trimEnd()
    normalizedLines[normalizedLines.length - 1] = sentencePunctuationPattern.test(previousLine)
      ? previousLine
      : `${previousLine}${text}`
  })

  return normalizedLines.join('\n')
}

function removeDuplicateTailLines(content = '') {
  const lines = String(content ?? '').split(/\r?\n/)
  const normalizedLines = []
  let previousText = ''

  lines.forEach((line) => {
    const text = line.trim()
    if (
      text.length >= duplicateTailLineMinLength &&
      previousText &&
      previousText !== text &&
      previousText.endsWith(text)
    ) {
      while (normalizedLines.length && !normalizedLines[normalizedLines.length - 1].trim()) {
        normalizedLines.pop()
      }
      return
    }

    normalizedLines.push(line)
    if (text) {
      previousText = text
    }
  })

  return normalizedLines.join('\n')
}

function scrollToBottom() {
  following.value = true
  hasNewContent.value = false
  nextTick(() => {
    if (!listRef.value) return
    listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

function handleScroll() {
  const list = listRef.value
  if (!list) return
  following.value = list.scrollHeight - list.clientHeight - list.scrollTop < 48
  if (following.value) hasNewContent.value = false
}

watch(
  () => [messageRenderSignature.value, inlineActionSignature.value, props.processing, props.phase],
  () => {
    if (following.value) scrollToBottom()
    else hasNewContent.value = true
  },
  { flush: 'post' }
)
watch(() => props.sessionId, () => { showAllCandidates.value = false; scrollToBottom() })
watch(() => props.messages.findLast((message) => message.role === 'user')?.id, scrollToBottom)

onMounted(() => {
  scrollToBottom()
})
</script>

<template>
  <div class="ai-message-thread">
  <div ref="listRef" class="ai-message-list" @scroll="handleScroll">
    <article
      v-for="message in renderedMessages"
      :key="message.id"
      class="ai-message"
      :class="[`is-${message.role}`, `type-${message.type || 'text'}`, { 'has-outcome': Boolean(message.outcome) }]"
    >
      <div class="ai-message__body">
        <div
          v-if="getAiAgentOutcomeLabel(message.outcome) || (message.role === 'assistant' && (message.toolCalls?.length || (message.streaming && liveSteps.length)))"
          class="ai-message__meta"
        >
          <span
            v-if="getAiAgentOutcomeLabel(message.outcome)"
            class="ai-message__status"
            :class="`tone-${getOutcomeTone(message.outcome)}`"
            role="status"
          >{{ getAiAgentOutcomeLabel(message.outcome) }}</span>
          <AgentToolTraceItem
            v-if="message.role === 'assistant'"
            :tool-calls="message.streaming && !message.toolCalls?.length ? liveSteps : message.toolCalls || []"
          />
        </div>
        <details v-if="message.hasReasoning" class="ai-message__reasoning">
          <summary>
            <span
              class="ai-message__reasoning-dot"
              :class="{ 'is-pending': message.reasoningPending }"
              aria-hidden="true"
            ></span>
            <span>{{ message.reasoningPending ? $t('ui.thinking') : $t('ui.reasoning') }}</span>
            <span class="ai-message__reasoning-chevron" aria-hidden="true"></span>
          </summary>
          <!-- 思考内容沿用正文的 Markdown 安全渲染规则。 -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            v-if="message.reasoningHtmlContent"
            class="ai-message__content ai-message__reasoning-content"
            @click.capture="handleMessageContentClick"
            v-html="message.reasoningHtmlContent"
          ></div>
        </details>
        <!-- 已在 renderMarkdown 中转义原始 HTML，并限制 Markdown 链接协议。 -->
        <!-- 部分完成时回答本身可用，正文照常展示；只有整轮失败才把回答收起到提示块的详情里。 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          v-if="message.htmlContent && (!message.error || message.outcome === 'partial')"
          class="ai-message__content"
          @click.capture="handleMessageContentClick"
          v-html="message.htmlContent"
        ></div>
        <div v-if="message.error" class="ai-message__notice" :class="`tone-${getNoticeTone(message)}`">
          <ExclamationCircleOutlined v-if="getNoticeTone(message) === 'danger'" class="ai-message__notice-icon" aria-hidden="true" />
          <InfoCircleOutlined v-else-if="getNoticeTone(message) === 'neutral'" class="ai-message__notice-icon" aria-hidden="true" />
          <WarningOutlined v-else class="ai-message__notice-icon" aria-hidden="true" />
          <div class="ai-message__notice-body">
            <p class="ai-message__failure">{{ message.error.message }}</p>
            <details v-if="message.outcome !== 'partial' && message.content && message.content !== message.error.message" class="ai-message__details">
              <summary>{{ $t('ui.viewResponseDetails') }}</summary>
              <!-- 已按上方相同的 Markdown 安全规则处理。 -->
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="ai-message__content" @click.capture="handleMessageContentClick" v-html="message.htmlContent"></div>
            </details>
            <div v-if="message.canRetry || message.error.settings" class="ai-message__recovery">
              <VxButton v-if="message.canRetry" size="sm" variant="secondary" :disabled="processing" @click="emit('retry-message', message)">{{ $t('ui.retryQuery') }}</VxButton>
              <VxButton v-if="message.error.settings" size="sm" variant="secondary" @click="emit('open-settings', message.error)">{{ message.error.settingsTarget === 'sources' ? $t('ui.openSourceSettings') : $t('ui.openAISettings') }}</VxButton>
            </div>
          </div>
        </div>
        <div v-else-if="message.canRetry" class="ai-message__recovery">
          <VxButton size="sm" variant="secondary" :disabled="processing" @click="emit('retry-message', message)">{{ $t('ui.retryQuery') }}</VxButton>
        </div>
        <AgentActionRow
          v-for="confirmation in message.confirmations || []"
          :key="confirmation.id"
          kind="confirmation"
          :confirmation="confirmation"
          @confirm="emit('confirm-action', $event)"
          @cancel-confirmation="emit('cancel-confirmation', $event)"
        />
      </div>
    </article>

    <section v-if="hasInlineActions" class="ai-inline-actions" :aria-label="$t('ui.aIActions')">
      <div v-if="shouldShowCandidates" class="ai-candidates">
        <header class="ai-candidates__head">
          <span class="ai-candidates__title">{{ $t('ui.modCandidates') }}</span>
          <span class="ai-candidates__count">{{ candidates.length }}</span>
          <span class="ai-candidates__note">{{ $t('ui.sortedByRelevance') }}</span>
        </header>
        <AiModCandidateCard
          v-for="(candidate, index) in visibleCandidates"
          :key="candidate.id || candidate.modId || candidate.name"
          :candidate="candidate"
          :recommended="index === 0"
          @detail="emit('candidate-detail', $event)"
          @plan="emit('candidate-plan', $event)"
        />
        <button
          v-if="hiddenCandidateCount"
          class="ai-candidates__more"
          type="button"
          @click="showAllCandidates = true"
        >
          {{ $t('ui.showRemaining') }} {{ hiddenCandidateCount }} {{ $t('ui.itemsVariant2') }}
        </button>
      </div>

      <AgentActionRow
        v-if="shouldShowInstallPlan"
        kind="plan"
        :plan="installPlan"
        :submitting="submittingPlan"
        @submit-plan="emit('submit-plan', $event)"
        @decide-plan="emit('decide-plan', $event)"
        @manual-download-plan="emit('manual-download-plan', $event)"
        @cancel-plan="emit('cancel-plan')"
        @view-task="emit('view-task', $event)"
      />

      <div v-if="taskLoading && visibleTasks.length" class="ai-inline-actions__loading">
        {{ $t('ui.loadingInstallationTasks') }}
      </div>
      <div v-if="visibleTasks.length" class="ai-inline-actions__group">
        <AgentActionRow
          v-for="task in visibleTasks"
          :key="task.taskId"
          kind="task"
          :task="task"
          :action-busy-task-id="actionBusyTaskId"
          @cancel-task="emit('cancel-task', $event)"
          @retry-task="emit('retry-task', $event)"
          @rollback-task="emit('rollback-task', $event)"
          @analyze-logs="emit('analyze-logs', $event)"
          @repair-post-rollback="emit('repair-post-rollback', $event)"
          @view-task="emit('view-task', $event)"
          @refresh-tasks="emit('refresh-tasks')"
        />
        <button
          v-if="installRelatedTasks.length > visibleTasks.length"
          class="ai-inline-actions__more"
          type="button"
          @click="emit('refresh-tasks')"
        >
          {{ $t('ui.another') }} {{ installRelatedTasks.length - visibleTasks.length }} {{ $t('ui.installationTasks') }}
        </button>
      </div>
    </section>

    <article
      v-if="shouldShowProgress"
      class="ai-message is-assistant type-progress"
      aria-live="polite"
    >
      <div class="ai-message__body">
        <div v-if="!hasRunningStep" class="ai-progress">
          <span class="ai-progress__dot" aria-hidden="true"></span>
          <span class="ai-progress__text">{{ progressText }}</span>
        </div>
        <div v-if="liveSteps.length" class="ai-message__meta">
          <AgentToolTraceItem :tool-calls="liveSteps" live />
        </div>
      </div>
    </article>
  </div>
  <VxButton v-if="hasNewContent" class="ai-message-thread__latest" size="sm" variant="secondary" @click="scrollToBottom">{{ $t('ui.jumpToLatestMessage') }}</VxButton>
  </div>
</template>

<style scoped lang="scss">
.ai-message-thread {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  // 结果状态与提示块的语气色，统一从 vertex-ui token 派生。
  --ai-tone-danger: var(--color-danger);
  --ai-tone-danger-strong: #b91c1c;
  --ai-tone-danger-soft: var(--color-danger-soft);
  --ai-tone-warning: var(--color-warning);
  --ai-tone-warning-strong: var(--color-warning-strong);
  --ai-tone-warning-soft: var(--color-warning-soft);
}

.ai-message-thread__latest {
  position: absolute;
  bottom: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-md);
}

.ai-message-list {
  min-height: 0;
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  background: var(--ai-thread-bg, var(--color-surface));
  // 以容器宽度（而非视口）驱动子组件的精简布局：窄抽屉里自动收起次要信息，
  // 宽全页里展示完整字段，互不影响。
  container: ai-thread / inline-size;
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;

  &::-webkit-scrollbar {
    width: 7px;
  }

  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: var(--default-border-radius);
    margin: 24px 0;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
    min-height: 40px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
}

.ai-message {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
  user-select: text;
  -webkit-user-select: text;
}

.ai-message__body {
  min-width: 0;
  max-width: min(100%, 660px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: text;
  -webkit-user-select: text;
}

// 助手回复占满可读宽度，提示块与正文左右对齐，不随文字长短忽宽忽窄。
.ai-message:not(.is-user) > .ai-message__body {
  flex: 1 1 auto;
}

// 结果状态与工具调用记录同处一行，正文之前只占一行高度。
.ai-message__meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.ai-message__status {
  height: 20px;
  padding: 0 7px;
  border-radius: var(--radius-xs);
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-xs);
  font-weight: 600;
  line-height: 1;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);

  &.tone-warning {
    color: var(--ai-tone-warning-strong);
    background: var(--ai-tone-warning-soft);
  }

  &.tone-danger {
    color: var(--ai-tone-danger-strong);
    background: var(--ai-tone-danger-soft);
  }

  &.tone-success {
    color: var(--color-success-strong);
    background: var(--color-success-soft);
  }

  &.tone-accent {
    color: var(--color-accent-strong);
    background: var(--color-accent-soft);
  }
}

// 失败或部分完成的说明：图标 + 文字 + 恢复操作，正文颜色保持中性，便于阅读。
.ai-message__notice {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ai-tone-warning) 26%, var(--color-surface));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--ai-tone-warning-soft) 42%, var(--color-surface));

  &.tone-danger {
    border-color: color-mix(in srgb, var(--ai-tone-danger) 24%, var(--color-surface));
    background: color-mix(in srgb, var(--ai-tone-danger-soft) 40%, var(--color-surface));

    .ai-message__notice-icon {
      color: var(--ai-tone-danger);
    }
  }

  &.tone-neutral {
    border-color: var(--color-border);
    background: var(--color-surface-soft);

    .ai-message__notice-icon {
      color: var(--color-text-muted);
    }
  }
}

.ai-message__notice-icon {
  margin-top: 3px;
  color: var(--ai-tone-warning);
  font-size: 14px;
}

.ai-message__notice-body {
  min-width: 0;
}

.ai-message__failure {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.ai-message__details {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);

  summary {
    width: fit-content;
    color: var(--color-text-muted);
    cursor: pointer;

    &:hover {
      color: var(--color-text-secondary);
    }
  }

  .ai-message__content {
    margin-top: 6px;
    font-size: var(--font-size-sm);
  }
}

.ai-message__recovery {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: 10px;

  .ai-message__body > & {
    margin-top: 2px;
  }
}

.ai-message__reasoning {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);

  summary {
    width: fit-content;
    min-height: 24px;
    margin-left: -6px;
    padding: 2px 8px 2px 6px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    box-sizing: border-box;
    cursor: pointer;
    list-style: none;
    line-height: 1.4;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    color: var(--color-text-secondary);
    background: var(--color-surface-hover);
  }

  summary:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 1px;
  }
}

.ai-message__reasoning-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--color-text-subtle);

  &.is-pending {
    background: var(--color-accent);
    animation: ai-progress-pulse 1.2s ease-in-out infinite;
  }
}

.ai-message__reasoning-chevron {
  width: 5px;
  height: 5px;
  margin: 0 2px 0 1px;
  border: solid currentColor;
  border-width: 0 1px 1px 0;
  transform: rotate(-45deg);
  transition: transform var(--duration-base) var(--ease-standard);
}

.ai-message__reasoning[open] .ai-message__reasoning-chevron {
  transform: rotate(45deg) translate(-1px, -1px);
}

.ai-message__reasoning-content.ai-message__content {
  max-height: 260px;
  margin: 4px 0 2px;
  padding: 8px 12px;
  overflow-y: auto;
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border-left: 2px solid var(--color-border);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: var(--font-size-xs);
  line-height: 1.65;
  box-sizing: border-box;

  :deep(strong) {
    color: var(--color-text-secondary);
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
  }
}

// 回答正文：不加卡片，按阅读排版处理。
.ai-message__content {
  margin: 0;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  line-height: 1.7;
  word-break: break-word;
  font-size: var(--font-size-md);
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;

  :deep(*) {
    max-width: 100%;
    user-select: text;
    -webkit-user-select: text;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    margin: 14px 0 4px;
    color: var(--color-text);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.5;
  }

  :deep(strong) {
    color: var(--color-text);
    font-weight: 600;
  }

  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(blockquote),
  :deep(pre),
  :deep(table) {
    margin: 8px 0 0;
  }

  :deep(p:first-child),
  :deep(ul:first-child),
  :deep(ol:first-child),
  :deep(blockquote:first-child),
  :deep(pre:first-child),
  :deep(table:first-child) {
    margin-top: 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 20px;
  }

  :deep(li + li) {
    margin-top: 4px;
  }

  :deep(li::marker) {
    color: var(--color-text-subtle);
  }

  :deep(code) {
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    background: var(--color-surface-hover);
    color: var(--color-text);
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
  }

  :deep(pre) {
    overflow-x: auto;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-soft);
    color: var(--color-text);
    line-height: 1.55;
    white-space: pre;
  }

  :deep(pre code) {
    padding: 0;
    background: transparent;
    color: inherit;
  }

  :deep(blockquote) {
    padding: 0 0 0 12px;
    border-left: 3px solid var(--color-border-strong);
    color: var(--color-text-muted);
  }

  :deep(hr) {
    margin: 12px 0;
    border: 0;
    border-top: 1px solid var(--color-border);
  }

  :deep(a) {
    color: var(--color-accent-active);
    text-decoration: none;
  }

  :deep(a:hover) {
    text-decoration: underline;
  }

  // 表格按内容收缩，放不下时自动换行，仍放不下才横向滚动。
  :deep(table) {
    display: block;
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  :deep(th),
  :deep(td) {
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }

  :deep(th + th),
  :deep(td + td) {
    border-left: 1px solid var(--color-border);
  }

  :deep(th) {
    color: var(--color-text);
    font-weight: 600;
    white-space: nowrap;
    background: var(--color-surface-soft);
  }

  :deep(tr:last-child td) {
    border-bottom: 0;
  }
}

.ai-message.is-user {
  justify-content: flex-end;

  &:not(:first-child) {
    margin-top: 6px;
  }

  .ai-message__body {
    max-width: min(82%, 520px);
  }

  .ai-message__content {
    padding: 8px 12px;
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-strong) 72%, var(--color-surface));
    border-radius: var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg);
    line-height: 1.6;
  }
}

// 非智能体结果类的系统提示（例如安装任务结束反馈）保留轻量提示样式；
// 智能体结果的失败说明由 .ai-message__notice 承担，正文不再整体染色。
.ai-message.type-error:not(.has-outcome) .ai-message__content,
.ai-message.type-warning:not(.has-outcome) .ai-message__content {
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--ai-tone-warning) 26%, var(--color-surface));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--ai-tone-warning-soft) 42%, var(--color-surface));
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.ai-message.type-error:not(.has-outcome) .ai-message__content {
  border-color: color-mix(in srgb, var(--ai-tone-danger) 24%, var(--color-surface));
  background: color-mix(in srgb, var(--ai-tone-danger-soft) 40%, var(--color-surface));
}

.ai-inline-actions {
  width: min(100%, 660px);
  min-width: 0;
  max-width: 100%;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
}

// 候选模组：一块分组列表，行之间用细线分隔，不再在卡片里套卡片。
.ai-candidates {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;

  :deep(.ai-candidate + .ai-candidate) {
    border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-surface));
  }
}

.ai-candidates__head {
  min-width: 0;
  padding: 10px 12px 6px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--font-size-xs);
  line-height: 18px;
}

.ai-candidates__title {
  color: var(--color-text);
  font-weight: 600;
}

.ai-candidates__count {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.ai-candidates__note {
  margin-left: auto;
  color: var(--color-text-muted);
}

.ai-candidates__more {
  width: 100%;
  min-height: 36px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-surface));
  background: transparent;
  color: var(--color-accent-active);
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-soft);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: -2px;
  }
}

.ai-inline-actions__group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-inline-actions__more,
.ai-inline-actions__loading {
  min-height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.ai-inline-actions__more {
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    outline-offset: 1px;
  }
}

.ai-inline-actions__loading {
  display: flex;
  align-items: center;
  padding: 0 10px;
}

.ai-message.type-progress {
  margin-top: -4px;
}

.ai-progress {
  min-height: 22px;
  padding: 1px 0;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  line-height: 1.45;
}

.ai-progress__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--color-accent);
  animation: ai-progress-pulse 1.2s ease-in-out infinite;
}

.ai-progress__text {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ai-progress__dot,
  .ai-message__reasoning-dot.is-pending {
    animation: none;
  }

  .ai-message__reasoning summary,
  .ai-message__reasoning-chevron {
    transition: none;
  }
}

@keyframes ai-progress-pulse {
  0%,
  100% {
    opacity: 0.36;
  }
  50% {
    opacity: 1;
  }
}
</style>
