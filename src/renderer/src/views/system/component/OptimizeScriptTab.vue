<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { toolText as tt, toolMessage as tm } from '@renderer/i18n/tool-text.js'

import {
  toolServiceText as serviceText,
  toolLogText as formatLog
} from '@renderer/i18n/tool-service-text.js'
import { contentLocale } from '@renderer/i18n/content.js'
import { ref, onMounted, computed, nextTick } from 'vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { useIpc } from '@renderer/hooks/useIpc.js'
import { $message } from '@renderer/common/message.js'
import { VxButton, VxModal } from '@renderer/component/vertex-ui/index.js'
import {
  ToolEmpty,
  ToolFilterPills,
  ToolIcon,
  ToolIconButton,
  ToolNotice,
  ToolSearchField
} from '@renderer/component/tool-page/index.js'
import {
  GET_SYSTEM_SCRIPTS,
  GET_SYSTEM_SCRIPTS_BY_TYPE,
  GET_SYSTEM_SCRIPT_DETAIL
} from '@renderer/api/modules/index.js'

const scriptList = ref([])
const loading = ref(false)
const executing = ref(false)
const selectedType = ref('all')
const currentScript = ref(null)
const showExecuteDialog = ref(false)
const executeResult = ref(null)
const executeLogs = ref([])
const logContainerRef = ref(null)
const latestFetchRequestId = ref(0)
const keyword = ref('')
const listError = ref('')
const dialogView = ref('log')

// 分类值是后端识别用的中文标识，只翻译显示文字。
const scriptTypes = [
  { get label() { return uiText('tools.all') }, value: 'all', icon: 'wrench' },
  { get label() { return uiText('tools.performance') }, value: '性能优化', icon: 'bolt' },
  { get label() { return uiText('tools.systemCleanup') }, value: '系统清理', icon: 'clean' },
  { get label() { return uiText('tools.network') }, value: '网络优化', icon: 'globe' },
  { get label() { return uiText('tools.other') }, value: '其他', icon: 'wrench' }
]
const typeOptions = computed(() =>
  scriptTypes.map((type) => ({ value: type.value, label: tt(type.label) }))
)
const selectedTypeLabel = computed(() =>
  tt(scriptTypes.find((type) => type.value === selectedType.value)?.label || '全部')
)
const filteredScripts = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  if (!value) return scriptList.value
  return scriptList.value.filter((script) =>
    [script.name, script.effectDesc, script.type]
      .map((text) => String(text || '').toLowerCase())
      .some((text) => text.includes(value))
  )
})
const statusView = computed(
  () =>
    ({
      running: { tone: 'is-progress', label: tt('运行中') },
      success: { tone: 'is-success', label: tt('已完成') },
      error: { tone: 'is-danger', label: tt('运行失败') }
    })[executeStatus.value] || { tone: '', label: tt('未运行') }
)
// 控制台空闲时显示的提示符，只用来营造控制台观感，不代表真实工作目录。
const consolePrompt = computed(() =>
  getShellName(currentScript.value) === 'PowerShell' ? 'PS C:\\>' : 'C:\\>'
)
const scriptLines = computed(() =>
  String(currentScript.value?.scriptContent || '')
    .replaceAll('\r\n', '\n')
    .split('\n')
)

function getTypeIcon(type) {
  return scriptTypes.find((item) => item.value === type)?.icon || 'wrench'
}

function getShellName(script) {
  return String(script?.scriptType || 'bat').toLowerCase() === 'ps1' ? 'PowerShell' : 'CMD'
}

function refreshScripts() {
  fetchScripts(selectedType.value, { clearBeforeLoad: !scriptList.value.length })
}

// 执行状态
const executeStatus = computed(() => {
  if (executing.value) return 'running'
  if (executeResult.value?.success) return 'success'
  if (executeResult.value?.success === false) return 'error'
  return 'idle'
})

// 添加日志（最多保留100条）
const MAX_LOG_COUNT = 100
const addLog = (type, content) => {
  const timestamp = new Date().toLocaleTimeString(contentLocale.value, { hour12: false })
  executeLogs.value.push({ type, content, timestamp })
  // 超过最大数量时，移除最旧的日志
  if (executeLogs.value.length > MAX_LOG_COUNT) {
    executeLogs.value = executeLogs.value.slice(-MAX_LOG_COUNT)
  }
  // 滚动到底部
  nextTick(() => {
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  })
}

// 清空日志
const clearLogs = () => {
  executeLogs.value = []
}

const ensureScriptContent = async (script) => {
  if (!script || script.scriptContent || !script.id) return script

  try {
    const detail = await GET_SYSTEM_SCRIPT_DETAIL(script.id)
    if (detail?.scriptContent) {
      script.scriptContent = detail.scriptContent
    }
    if (detail?.scriptType) {
      script.scriptType = detail.scriptType
    }
    if (detail?.name) {
      script.name = detail.name
    }
  } catch {
    $message.error(tt('获取脚本详情失败'))
  }

  return script
}

// 获取脚本列表
const fetchScripts = async (type = 'all', options = {}) => {
  const { clearBeforeLoad = false } = options
  const currentRequestId = latestFetchRequestId.value + 1
  latestFetchRequestId.value = currentRequestId

  loading.value = true
  listError.value = ''
  if (clearBeforeLoad) {
    scriptList.value = []
  }
  try {
    const res = type === 'all' ? await GET_SYSTEM_SCRIPTS() : await GET_SYSTEM_SCRIPTS_BY_TYPE(type)
    if (currentRequestId !== latestFetchRequestId.value) {
      return
    }
    scriptList.value = res || []
  } catch {
    if (currentRequestId !== latestFetchRequestId.value) {
      return
    }
    // 失败原因在列表上方的错误提示条里显示，并提供重试。
    listError.value = tt('获取脚本列表失败')
  } finally {
    if (currentRequestId === latestFetchRequestId.value) {
      loading.value = false
    }
  }
}

// 切换类型
const switchType = (type) => {
  if (type === selectedType.value && !loading.value) {
    return
  }
  selectedType.value = type
  fetchScripts(type, { clearBeforeLoad: true })
}

// 打开脚本弹窗：运行和预览共用一个弹窗，view 决定默认显示的页签。
const openScriptDialog = (script, view = 'log') => {
  if (currentScript.value !== script) {
    executeResult.value = null
    clearLogs()
  }
  currentScript.value = script
  dialogView.value = view
  showExecuteDialog.value = true
  if (view === 'code') loadScriptContent()
}

const openExecuteDialog = (script) => openScriptDialog(script, 'log')

const previewLoading = ref(false)

async function loadScriptContent() {
  const script = currentScript.value
  if (!script || script.scriptContent) return
  previewLoading.value = true
  try {
    await ensureScriptContent(script)
  } finally {
    previewLoading.value = false
  }
}

const openPreviewDialog = (script) => openScriptDialog(script, 'code')

function switchDialogView(view) {
  dialogView.value = view
  if (view === 'code') loadScriptContent()
}

// 关闭弹窗；脚本在外部窗口中运行，关闭不会中断它。
const closeExecuteDialog = () => {
  showExecuteDialog.value = false
  if (executing.value) return
  currentScript.value = null
  executeResult.value = null
  clearLogs()
}

// 执行脚本
const executeScript = async () => {
  if (!currentScript.value) return

  await ensureScriptContent(currentScript.value)
  if (!currentScript.value?.scriptContent) {
    $message.error(tt('脚本内容为空'))
    return
  }

  executing.value = true
  executeResult.value = null
  clearLogs()

  // 添加开始执行日志
  const shellType =
    (currentScript.value.scriptType || 'bat').toLowerCase() === 'ps1' ? 'PowerShell' : 'CMD'
  addLog('info', tm('准备执行脚本: {0}', [currentScript.value.name]))
  addLog('info', tm('脚本类型: {0}', [currentScript.value.scriptType || 'bat']))
  addLog('info', tm('执行方式: 外部 {0} 窗口', [shellType]))
  addLog('info', tm('字符编码: UTF-8'))
  addLog('info', tm('正在创建临时脚本文件...'))

  ipcRenderer.send('executeSystemScript', {
    locale: contentLocale.value,
    scriptContent: currentScript.value.scriptContent,
    name: currentScript.value.name,
    type: currentScript.value.scriptType || 'bat'
  })
}

// 复制输出
const copyOutput = () => {
  const logText = executeLogs.value.map((log) => `[${log.timestamp}] ${formatLog(log)}`).join('\n')
  if (!logText) return

  navigator.clipboard.writeText(logText).then(() => {
    $message.success(tt('已复制到剪贴板'))
  })
}

// 复制脚本原文，不做任何转换。
const copyScript = () => {
  const content = currentScript.value?.scriptContent
  if (!content) return
  navigator.clipboard.writeText(content).then(() => {
    $message.success(tt('已复制到剪贴板'))
  })
}

onMounted(() => {
  fetchScripts()
})

useIpc('executeSystemScriptOutput', (payload) => {
  if (!payload || typeof payload.data !== 'string') return
  const logType = payload.stream === 'stderr' ? 'error' : 'output'
  addLog(logType, payload.data)
})

// 监听脚本执行结果
useIpc('executeSystemScriptResult', (result) => {
  executing.value = false
  executeResult.value = result

  // 添加执行结果日志
  if (result.success) {
    addLog('success', result.message || tm('脚本执行成功'))
    if (result.externalWindow) {
      addLog('info', tm('已弹出 {0} 执行窗口', [result.shellType || tt('命令行')]))
      addLog('info', tm('完整执行输出请查看外部执行窗口'))
    }
    // 解析标准输出
    if (result.output && !result.streamed) {
      const outputLines = result.output.split('\n').filter((line) => line.trim())
      outputLines.forEach((line) => {
        addLog('output', line)
      })
    }
    $message.success(serviceText(result.message))
  } else {
    addLog('error', tm('执行失败: {0}', [serviceText(result.message)]))
    // 解析错误输出
    if (result.error && !result.streamed) {
      const errorLines = result.error.split('\n').filter((line) => line.trim())
      errorLines.forEach((line) => {
        addLog('error', line)
      })
    }
    // 解析标准输出（可能也包含有用信息）
    if (result.output && !result.streamed) {
      const outputLines = result.output.split('\n').filter((line) => line.trim())
      outputLines.forEach((line) => {
        addLog('output', line)
      })
    }
    $message.error(serviceText(result.message))
  }
})
</script>

<template>
  <div class="optimize-tab tool-section">
    <header class="tool-toolbar">
      <ToolFilterPills
        :model-value="selectedType"
        variant="accent"
        :options="typeOptions"
        :label="tt('按类型筛选')"
        class="type-filter"
        @update:model-value="switchType"
      />
      <div class="tool-toolbar__tools">
        <ToolSearchField v-model="keyword" :placeholder="tt('搜索脚本')" :label="tt('搜索脚本')" />
        <ToolIconButton
          icon="refresh"
          :label="tt('刷新脚本列表')"
          :busy="loading"
          @click="refreshScripts"
        />
      </div>
    </header>

    <ToolNotice tone="info">
      {{
        tt(
          '脚本会在外部 CMD 或 PowerShell 窗口中运行，可能修改系统设置。不确定时，先点“预览”查看脚本内容。'
        )
      }}
    </ToolNotice>

    <ToolNotice v-if="listError" tone="danger" :title="listError">
      <template #actions>
        <VxButton variant="secondary" size="sm" @click="refreshScripts">{{ tt('重试') }}</VxButton>
      </template>
    </ToolNotice>

    <section class="scripts-section" :aria-busy="loading" :aria-label="selectedTypeLabel">
      <div class="tool-section-head">
        <h2 class="tool-section-title">
          {{ selectedTypeLabel === tt('全部') ? tt('全部脚本') : selectedTypeLabel
          }}<small v-if="!loading || scriptList.length">{{
            tt('{0} 个', [filteredScripts.length])
          }}</small>
        </h2>
        <p v-if="loading" class="tool-section-hint" role="status">
          <span class="tool-inline-spinner" aria-hidden="true"></span>
          {{ tt('正在加载脚本列表...') }}
        </p>
      </div>

      <div v-if="loading && !scriptList.length" class="scripts-grid" aria-hidden="true">
        <div v-for="index in 6" :key="index" class="script-card is-skeleton">
          <span class="script-card__head">
            <span class="tool-skeleton skeleton-icon"></span>
            <span class="skeleton-lines">
              <span class="tool-skeleton skeleton-line is-wide"></span>
              <span class="tool-skeleton skeleton-line"></span>
            </span>
          </span>
          <span class="tool-skeleton skeleton-line is-full"></span>
          <span class="tool-skeleton skeleton-line is-wide"></span>
        </div>
      </div>

      <div v-else-if="filteredScripts.length" class="scripts-grid">
        <article v-for="script in filteredScripts" :key="script.id" class="script-card">
          <div class="script-card__head">
            <span class="script-card__icon" aria-hidden="true">
              <ToolIcon :name="getTypeIcon(script.type)" :size="18" />
            </span>
            <span class="script-card__title">
              <h3 :title="script.name">{{ script.name }}</h3>
              <span class="script-card__meta">
                {{ tt(script.type) }} ·
                <span class="tool-mono">{{ (script.scriptType || 'bat').toUpperCase() }}</span>
              </span>
            </span>
          </div>
          <p class="script-card__desc">{{ script.effectDesc || tt('暂无描述') }}</p>
          <div class="script-card__actions">
            <VxButton
              variant="ghost"
              size="sm"
              class="preview-btn"
              :aria-label="tt('预览 {0}', [script.name])"
              @click="openPreviewDialog(script)"
            >
              <span class="optimize-button-content">
                <ToolIcon name="eye" :size="14" />
                {{ tt('预览') }}
              </span>
            </VxButton>
            <VxButton
              variant="secondary"
              size="sm"
              class="execute-btn"
              :aria-label="tt('运行 {0}', [script.name])"
              @click="openExecuteDialog(script)"
            >
              <span class="optimize-button-content">
                <ToolIcon name="play" :size="12" />
                {{ tt('运行…') }}
              </span>
            </VxButton>
          </div>
        </article>
      </div>

      <ToolEmpty
        v-else-if="!listError"
        :icon="keyword.trim() ? 'search' : 'file'"
        :title="keyword.trim() ? tt('没有找到相关脚本') : tt('这个分类下还没有脚本')"
        :description="keyword.trim() ? tt('换个关键词试试。') : tt('换个分类看看，或稍后刷新。')"
      >
        <VxButton v-if="keyword.trim()" variant="secondary" @click="keyword = ''">
          {{ tt('清除搜索') }}
        </VxButton>
        <VxButton v-else-if="selectedType !== 'all'" variant="secondary" @click="switchType('all')">
          {{ tt('查看全部脚本') }}
        </VxButton>
      </ToolEmpty>
    </section>

    <VxModal
      :model-value="showExecuteDialog"
      :title="currentScript?.name || ''"
      :subtitle="
        currentScript
          ? tt('{0} · {1} · 在外部 {2} 窗口中运行', [
              tt(currentScript.type),
              (currentScript.scriptType || 'bat').toUpperCase(),
              getShellName(currentScript)
            ])
          : ''
      "
      :width="720"
      panel-class="script-dialog"
      @close="closeExecuteDialog"
    >
      <div class="script-dialog__summary">
        <span class="tool-status" :class="statusView.tone">{{ statusView.label }}</span>
        <p>{{ currentScript?.effectDesc || tt('暂无描述') }}</p>
      </div>

      <!-- 控制台窗口：页签放在标题栏里，日志和脚本内容共用同一块深色屏幕，只在屏幕内部滚动。 -->
      <div class="script-console" :class="{ 'is-running': executing }">
        <div class="script-console__bar">
          <span class="script-console__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="script-console__tabs" role="tablist" :aria-label="tt('脚本详情')">
            <button
              type="button"
              role="tab"
              class="script-console__tab"
              :aria-selected="dialogView === 'log'"
              :class="{ 'is-active': dialogView === 'log' }"
              @click="switchDialogView('log')"
            >
              <ToolIcon name="terminal" :size="13" />
              {{ tt('执行日志') }}
            </button>
            <button
              type="button"
              role="tab"
              class="script-console__tab"
              :aria-selected="dialogView === 'code'"
              :class="{ 'is-active': dialogView === 'code' }"
              @click="switchDialogView('code')"
            >
              <ToolIcon name="file" :size="13" />
              {{ tt('脚本内容') }}
            </button>
          </div>
          <span class="script-console__meta">
            {{
              dialogView === 'code'
                ? currentScript?.scriptContent
                  ? tt('{0} 行', [scriptLines.length])
                  : ''
                : getShellName(currentScript)
            }}
          </span>
          <span class="script-console__actions">
            <template v-if="dialogView === 'log'">
              <button
                v-if="executeLogs.length"
                type="button"
                class="script-console__action"
                :aria-label="tt('复制日志')"
                :title="tt('复制日志')"
                @click="copyOutput"
              >
                <ToolIcon name="copy" :size="14" />
              </button>
              <button
                v-if="executeLogs.length && !executing"
                type="button"
                class="script-console__action"
                :aria-label="tt('清空日志')"
                :title="tt('清空日志')"
                @click="clearLogs"
              >
                <ToolIcon name="trash" :size="14" />
              </button>
            </template>
            <button
              v-else-if="currentScript?.scriptContent"
              type="button"
              class="script-console__action"
              :aria-label="tt('复制脚本')"
              :title="tt('复制脚本')"
              @click="copyScript"
            >
              <ToolIcon name="copy" :size="14" />
            </button>
          </span>
        </div>

        <div v-show="dialogView === 'log'" class="script-log" role="tabpanel">
          <div
            ref="logContainerRef"
            class="script-log__body script-console__scroll"
            role="log"
            aria-live="polite"
          >
            <template v-if="!executeLogs.length && !executing">
              <p class="console-line">
                <span class="console-prompt">{{ consolePrompt }}</span
                ><span class="console-cursor" aria-hidden="true"></span>
              </p>
              <p class="console-line is-comment">
                {{ tt('还没有运行。点“开始执行”后，这里会显示运行过程。') }}
              </p>
            </template>
            <div
              v-for="(log, index) in executeLogs"
              :key="index"
              class="log-line console-line"
              :class="log.type"
            >
              <span class="log-time">{{ log.timestamp }}</span>
              <span class="log-content">{{ formatLog(log) }}</span>
            </div>
            <div v-if="executing" class="log-line console-line running">
              <span class="log-time">{{
                new Date().toLocaleTimeString(contentLocale, { hour12: false })
              }}</span>
              <span class="log-content">
                {{ tt('正在执行中') }}<span class="console-cursor" aria-hidden="true"></span>
              </span>
            </div>
          </div>
        </div>

        <div v-show="dialogView === 'code'" class="script-log" role="tabpanel">
          <div v-if="previewLoading" class="script-code__loading" aria-hidden="true">
            <span v-for="index in 8" :key="index" class="console-skeleton"></span>
          </div>
          <div v-else class="script-code script-console__scroll">
            <div class="script-code__inner">
              <span class="script-code__lines" aria-hidden="true">
                <span v-for="(line, index) in scriptLines" :key="index">{{ index + 1 }}</span>
              </span>
              <pre class="code-content">{{ currentScript?.scriptContent || tt('无内容') }}</pre>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <span class="script-dialog__note">
          {{ executing ? tt('脚本在外部窗口中运行，关闭弹窗不会中断它。') : '' }}
        </span>
        <VxButton variant="secondary" @click="closeExecuteDialog">{{ tt('关闭') }}</VxButton>
        <VxButton :loading="executing" @click="executeScript">
          <span class="optimize-button-content">
            <ToolIcon name="play" :size="12" />
            {{ executeResult ? tt('再次执行') : tt('开始执行') }}
          </span>
        </VxButton>
      </template>
    </VxModal>
  </div>
</template>

<style scoped lang="scss">
.optimize-button-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scripts-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.scripts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: var(--space-4);
}

.script-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  transition: border-color var(--duration-fast) var(--ease-standard);

  &:hover:not(.is-skeleton) {
    border-color: var(--color-border-strong);
  }
}

.script-card__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.script-card__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}

.script-card__title {
  display: flex;
  flex-direction: column;
  min-width: 0;

  h3 {
    margin: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.script-card__meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.script-card__desc {
  display: -webkit-box;
  min-height: 39px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.script-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: auto;
}

.skeleton-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
}

.skeleton-lines {
  display: grid;
  gap: var(--space-2);
}

.skeleton-line {
  width: 90px;
  height: 10px;

  &.is-wide {
    width: 150px;
  }

  &.is-full {
    width: 100%;
  }
}

.script-dialog__summary {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
}

// 控制台配色：深色屏幕只用于日志和脚本内容，属于这块区域的局部变量，其余部分仍用 vertex-ui token。
.script-console {
  --console-bg: #0d1117;
  --console-bar: #161b22;
  --console-border: #262d36;
  --console-text: #d7dee7;
  --console-dim: #7d8794;
  --console-gutter: #4f5966;
  --console-info: #9aa8b8;
  --console-success: #56d364;
  --console-error: #ff7b72;
  --console-accent: #62b6ff;
  --console-line: 20px;

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 180px;
  overflow: hidden;
  color: var(--console-text);
  background: var(--console-bg);
  border: 1px solid var(--console-border);
  border-radius: 10px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 10px 24px -16px rgba(15, 23, 42, 0.6);
}

.script-console__bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
  height: 38px;
  padding: 0 6px 0 var(--space-3);
  background: var(--console-bar);
  border-bottom: 1px solid var(--console-border);
}

.script-console__dots {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;

  i {
    width: 9px;
    height: 9px;
    background: #2d3540;
    border-radius: 50%;
  }

  .is-running & i:first-child {
    background: var(--console-success);
    box-shadow: 0 0 6px rgba(86, 211, 100, 0.6);
  }
}

.script-console__tabs {
  display: flex;
  align-self: stretch;
  gap: 2px;
}

.script-console__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 var(--space-3);
  color: var(--console-dim);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-medium);
  background: none;
  border: 0;
  outline: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--console-text);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--console-accent);
  }

  &.is-active {
    color: var(--console-text);
    font-weight: var(--font-weight-semibold);
    background: var(--console-bg);

    &::after {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      height: 2px;
      background: var(--console-accent);
      content: '';
    }
  }
}

.script-console__meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--console-dim);
  font-family: var(--font-family-mono);
  font-size: 11.5px;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.script-console__actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
}

.script-console__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--console-dim);
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;

  &:hover {
    color: var(--console-text);
    background: rgba(255, 255, 255, 0.07);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--console-accent);
  }
}

.script-log {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

// 屏幕内部滚动条：7px，深色轨道。
.script-console__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  scrollbar-color: #3a434e transparent;

  &::-webkit-scrollbar {
    width: 7px;
    height: 7px;
  }

  &::-webkit-scrollbar-track,
  &::-webkit-scrollbar-corner {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #3a434e;
    border-radius: 7px;

    &:hover {
      background: #4b5563;
    }
  }

  ::selection {
    background: rgba(98, 182, 255, 0.3);
  }
}

.script-log__body {
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: var(--console-line);
}

.console-line {
  margin: 0;

  &.is-comment {
    color: var(--console-dim);
    font-family: var(--font-family-base);
  }
}

.console-prompt {
  color: var(--console-success);
}

.console-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 4px;
  vertical-align: -2px;
  background: var(--console-text);
  animation: console-blink 1.1s steps(1) infinite;
}

@keyframes console-blink {
  50% {
    opacity: 0;
  }
}

.log-line {
  display: flex;
  gap: var(--space-3);

  .log-time {
    flex: 0 0 auto;
    color: var(--console-gutter);
    font-variant-numeric: tabular-nums;
  }

  .log-content {
    min-width: 0;
    color: var(--console-text);
    white-space: pre-wrap;
    word-break: break-all;
  }

  &.info .log-content {
    color: var(--console-info);
  }

  &.success .log-content {
    color: var(--console-success);
  }

  &.error .log-content {
    color: var(--console-error);
  }

  &.running .log-content {
    color: var(--console-accent);
  }
}

.script-code {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: var(--console-line);
}

// 行号和代码在同一个滚动层里，逐行对齐；横向滚动时行号固定在左侧。
.script-code__inner {
  display: flex;
  align-items: flex-start;
  width: max-content;
  min-width: 100%;
  min-height: 100%;
}

.script-code__lines {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-self: stretch;
  min-width: 44px;
  padding: var(--space-3) var(--space-3) var(--space-3) 0;
  color: var(--console-gutter);
  text-align: right;
  font-variant-numeric: tabular-nums;
  background: var(--console-bg);
  border-right: 1px solid var(--console-border);
  user-select: none;
}

// 覆盖全局 pre 重置（如 overflow: auto、外边距），否则代码会单独滚动、和行号错位。
.code-content {
  flex: 1 0 auto;
  margin: 0;
  padding: var(--space-3) var(--space-5) var(--space-3) var(--space-3);
  overflow: visible;
  color: var(--console-text);
  font: inherit;
  line-height: inherit;
  white-space: pre;
  tab-size: 4;
  background: transparent;
  border: 0;
}

.script-code__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-4);
}

.console-skeleton {
  display: block;
  width: 62%;
  height: 10px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-xs);

  &:nth-child(3n) {
    width: 40%;
  }

  &:nth-child(4n) {
    width: 78%;
  }
}

.script-dialog__note {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

@media (prefers-reduced-motion: reduce) {
  .script-card,
  .script-console__tab {
    transition: none;
  }

  .console-cursor {
    animation: none;
  }
}
</style>

<style lang="scss">
// 弹窗面板通过 Teleport 渲染，需用非 scoped 样式；用 panel-class 限定在本弹窗内。
.base-dialog-panel.script-dialog {
  box-sizing: border-box;
  height: min(640px, 85vh);
  max-height: 85vh;

  > .base-dialog-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
  }
}
</style>
