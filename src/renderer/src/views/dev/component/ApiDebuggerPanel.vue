<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()

import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useApiDebuggerStore } from '@renderer/store/apiDebuggerStore.js'
import {
  VxButton,
  VxCheckbox,
  VxConfirmModal,
  VxInput,
  VxModal,
  VxProgress,
  VxSegmented,
  VxSelect,
  VxTag
} from '@renderer/component/vertex-ui'
import DevIcon from './DevIcon.vue'
import DevTabs from './DevTabs.vue'

const props = defineProps({
  requestUrl: {
    type: String,
    default: ''
  },
  httpMethods: {
    type: Array,
    default: () => []
  },
  contentTypes: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'sendRequest',
  'startBatchTest',
  'stopBatchTest',
  'copyResponse',
  'restoreHistory'
])

const HISTORY_DISPLAY_LIMIT = 30

const apiStore = useApiDebuggerStore()
const {
  currentRequest,
  currentResponse,
  isLoading: isApiLoading,
  batchConfig,
  history,
  filteredHistory,
  batchStats,
  responseTab,
  historySearchKeyword,
  historyDetailVisible,
  selectedHistoryItem
} = storeToRefs(apiStore)

const activeTab = ref('params')
const rightPaneTab = ref('response')
const clearHistoryVisible = ref(false)

const METHOD_TONES = {
  GET: 'success',
  POST: 'accent',
  PUT: 'warning',
  PATCH: 'info',
  DELETE: 'danger',
  HEAD: 'neutral',
  OPTIONS: 'neutral'
}

const methodOptions = computed(() =>
  props.httpMethods.map((method) => ({ label: method, value: method }))
)
const contentTypeOptions = computed(() =>
  props.contentTypes.map((type) => ({ label: type, value: type }))
)
const modeOptions = [
  { get label() { return uiText('ui.single') }, value: 'single' },
  { get label() { return uiText('ui.batch') }, value: 'batch' }
]

const batchMode = computed({
  get: () => (batchConfig.value.enabled ? 'batch' : 'single'),
  set: (value) => {
    if (batchConfig.value.isRunning) return
    batchConfig.value.enabled = value === 'batch'
  }
})

const bodyTabDisabled = computed(() => ['GET', 'HEAD'].includes(currentRequest.value.method))

watch(bodyTabDisabled, (disabled) => {
  if (disabled && activeTab.value === 'body') {
    activeTab.value = 'params'
  }
})

function countEnabled(list) {
  return (list || []).filter((item) => item.enabled && String(item.key || '').trim()).length
}

const requestTabs = computed(() => [
  { value: 'params', get label() { return uiText('ui.queryParameters') }, count: countEnabled(currentRequest.value.params) },
  { value: 'headers', get label() { return uiText('ui.headers') }, count: countEnabled(currentRequest.value.headers) },
  {
    value: 'body',
    get label() { return uiText('ui.requestBody') },
    count: bodyTabDisabled.value ? 0 : countEnabled(currentRequest.value.bodyParams),
    disabled: bodyTabDisabled.value,
    disabledReason: uiText('ui.valueRequestsHaveNoBody', { value1: (currentRequest.value.method) })
  }
])

// 三个键值对标签共用同一套表格，只切换数据源与增删方法。
const activeKv = computed(() => {
  const request = currentRequest.value
  if (activeTab.value === 'headers') {
    return {
      rows: request.headers,
      add: apiStore.addHeader,
      remove: apiStore.removeHeader,
      keyLabel: 'Header 名',
      valueLabel: 'Header 值',
      addText: '添加请求头',
      get emptyText() { return uiText('ui.noCustomHeadersContentTypeAndTheClientVersionAre') }
    }
  }
  if (activeTab.value === 'body') {
    return {
      rows: request.bodyParams,
      add: apiStore.addBodyParam,
      remove: apiStore.removeBodyParam,
      keyLabel: '字段名',
      valueLabel: '字段值（支持 JSON 字面量）',
      addText: '添加字段',
      get emptyText() { return uiText('ui.noRequestBodyFields') }
    }
  }
  return {
    rows: request.params,
    add: apiStore.addParam,
    remove: apiStore.removeParam,
    keyLabel: '参数名',
    valueLabel: '参数值',
    addText: '添加参数',
    get emptyText() { return uiText('ui.noQueryParameters') }
  }
})

// 请求体参数预览 - 将键值对列表转为JSON对象
const bodyParamsPreview = computed(() => {
  const params = currentRequest.value.bodyParams || []
  const enabledParams = params.filter((p) => p.enabled && p.key)
  if (enabledParams.length === 0) return ''
  const obj = {}
  enabledParams.forEach((p) => {
    // 尝试解析value为实际类型（数字、布尔、数组、对象）
    let val = p.value
    try {
      val = JSON.parse(p.value)
    } catch {
      // 保持原始字符串
    }
    obj[p.key] = val
  })
  return JSON.stringify(obj, null, 2)
})

const hasResponse = computed(() => currentResponse.value.status !== null)
// 账号服务通道的 statusText 形如 "HTTP 200"，与状态码重复时只展示状态码。
const statusLabel = computed(() => {
  const { status, statusText } = currentResponse.value
  if (!statusText || statusText === `HTTP ${status}`) return String(status)
  return `${status} ${statusText}`
})
const responseHeaderEntries = computed(() => Object.entries(currentResponse.value.headers || {}))
const responseViewOptions = computed(() => [
  { label: 'Body', value: 'body' },
  { label: `Headers ${responseHeaderEntries.value.length}`, value: 'headers' }
])

const batchPercent = computed(() => {
  const total = Number(batchConfig.value.count) || 0
  if (!total) return 0
  return Math.round((batchConfig.value.currentRound / total) * 100)
})

const visibleHistory = computed(() => filteredHistory.value.slice(0, HISTORY_DISPLAY_LIMIT))

const historyDetailVisibleModel = computed({
  get: () => historyDetailVisible.value,
  set: (value) => {
    if (value) {
      historyDetailVisible.value = true
      return
    }
    apiStore.closeHistoryDetail()
  }
})

const historyDetailTitle = computed(() => {
  const request = selectedHistoryItem.value?.request
  if (!request) return ''
  return `${request.method || 'GET'}  ${request.fullUrl || request.url || ''}`
})

function setBatchNumber(field, value, min, max) {
  if (value === '' || value === null) return
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  batchConfig.value[field] = Math.min(max, Math.max(min, Math.round(parsed)))
}

function getMethodTone(method) {
  return METHOD_TONES[method] || 'neutral'
}

function getStatusTone(status) {
  if (!status) return 'danger'
  if (status < 300) return 'success'
  if (status < 400) return 'info'
  if (status < 500) return 'warning'
  return 'danger'
}

function toDisplayText(data) {
  if (data === null || data === undefined) return ''
  if (typeof data === 'object') return JSON.stringify(data, null, 2)
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
    } catch {
      // 非 JSON 文本按原样展示
    }
    return data
  }
  return String(data)
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const JSON_TOKEN_PATTERN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

// JSON语法高亮格式化：先转义 HTML，再按 token 包裹样式；非 JSON 文本只转义不着色。
function formatJsonWithHighlight(data) {
  const text = toDisplayText(data)
  const escaped = escapeHtml(text)
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return escaped
  return escaped.replace(JSON_TOKEN_PATTERN, (match, _string, colon) => {
    let className = 'json-number'
    if (match.startsWith('"')) className = colon ? 'json-key' : 'json-string'
    else if (match === 'true' || match === 'false') className = 'json-boolean'
    else if (match === 'null') className = 'json-null'
    return `<span class="${className}">${match}</span>`
  })
}

// 历史记录中的请求头以键值对列表保存，详情展示时只保留实际发送的启用项。
function kvListToObject(list) {
  if (!Array.isArray(list)) return list || {}
  return list
    .filter((item) => item && item.enabled && String(item.key || '').trim())
    .reduce((result, item) => ({ ...result, [item.key]: item.value }), {})
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function confirmClearHistory() {
  apiStore.clearAllHistory()
}
</script>

<template>
  <section class="api-panel" aria-labelledby="dev-api-title">
    <header class="api-panel__head">
      <div class="api-panel__heading">
        <h2 id="dev-api-title">{{ $t('ui.aPIDebugging') }}</h2>
        <p>{{ $t('ui.buildRequestsRunLoadTestsAndInspectResponses') }}</p>
      </div>
      <div class="mode-field">
        <span class="field-label" aria-hidden="true">{{ $t('ui.mode') }}</span>
        <div class="mode-field__control" role="group" :aria-label="$t('ui.requestMode')">
          <VxSegmented v-model="batchMode" :options="modeOptions" />
        </div>
      </div>
    </header>

    <!-- 请求行 -->
    <div class="request-line">
      <div class="method-select" :class="`tone-${getMethodTone(currentRequest.method)}`">
        <VxSelect v-model="currentRequest.method" :options="methodOptions" :aria-label="$t('ui.requestMethod')" />
      </div>

      <div class="url-combo" :class="{ 'has-prefix': currentRequest.useBaseUrl }">
        <span
          v-if="currentRequest.useBaseUrl"
          class="url-combo__prefix"
          :title="requestUrl || $t('ui.noBaseURLConfigured')"
        >
          {{ requestUrl || $t('ui.noBaseURLConfigured') }}
        </span>
        <VxInput
          v-model="currentRequest.url"
          class="url-combo__input"
          :placeholder="
            currentRequest.useBaseUrl
              ? $t('ui.requestPathForExampleApiUserInfo')
              : $t('ui.fullURLForExampleHttpsExampleComApi')
          "
          :aria-label="$t('ui.requestPath')"
          @keydown.enter="emit('sendRequest')"
        />
      </div>

      <VxButton
        variant="primary"
        class="send-button"
        :loading="isApiLoading"
        :disabled="batchConfig.isRunning"
        @click="emit('sendRequest')"
      >
        <span class="button-inner">
          <DevIcon name="send" :size="15" />
          {{ $t('ui.send') }}
        </span>
      </VxButton>
    </div>

    <div class="request-options">
      <VxCheckbox v-model="currentRequest.useBaseUrl" :label="$t('ui.useBaseURL')" />
      <VxCheckbox v-model="currentRequest.useAuth" :label="$t('ui.includeAuthenticationToken')" />
      <span class="request-options__spacer"></span>
      <div class="inline-field">
        <span class="field-label" aria-hidden="true">Content-Type</span>
        <div class="content-type-select">
          <VxSelect
            v-model="currentRequest.contentType"
            :options="contentTypeOptions"
            aria-label="Content-Type"
          />
        </div>
      </div>
    </div>

    <!-- 批量测试 -->
    <div v-if="batchConfig.enabled" class="batch-bar">
      <div class="batch-bar__controls">
        <div class="inline-field">
          <span class="field-label" aria-hidden="true">{{ $t('ui.requestCount') }}</span>
          <div class="number-input">
            <VxInput
              type="number"
              :model-value="batchConfig.count"
              :disabled="batchConfig.isRunning"
              :aria-label="$t('ui.requestCount11000')"
              @update:model-value="setBatchNumber('count', $event, 1, 1000)"
            />
          </div>
        </div>
        <div class="inline-field">
          <span class="field-label" aria-hidden="true">{{ $t('ui.intervalMs') }}</span>
          <div class="number-input">
            <VxInput
              type="number"
              :model-value="batchConfig.interval"
              :disabled="batchConfig.isRunning"
              :aria-label="$t('ui.requestIntervalInMilliseconds010000')"
              @update:model-value="setBatchNumber('interval', $event, 0, 10000)"
            />
          </div>
        </div>
        <VxButton
          v-if="!batchConfig.isRunning"
          variant="secondary"
          size="sm"
          @click="emit('startBatchTest')"
        >
          {{ $t('ui.startTest') }}
        </VxButton>
        <VxButton v-else variant="danger" size="sm" @click="emit('stopBatchTest')">{{ $t('ui.stop') }}</VxButton>
      </div>

      <div v-if="batchConfig.isRunning || batchStats" class="batch-bar__result">
        <div class="batch-progress">
          <VxProgress
            :value="batchPercent"
            :tone="batchStats && batchStats.fail ? 'warning' : 'primary'"
          />
          <span class="batch-progress__text"
            >{{ batchConfig.currentRound }} / {{ batchConfig.count }}</span
          >
        </div>
        <dl v-if="batchStats" class="batch-stats">
          <div class="is-success">
            <dt>{{ $t('ui.success') }}</dt>
            <dd>{{ batchStats.success }}</dd>
          </div>
          <div :class="{ 'is-danger': batchStats.fail }">
            <dt>{{ $t('ui.failed') }}</dt>
            <dd>{{ batchStats.fail }}</dd>
          </div>
          <div>
            <dt>{{ $t('ui.average') }}</dt>
            <dd>{{ batchStats.avgDuration }} ms</dd>
          </div>
          <div>
            <dt>{{ $t('ui.fastest') }}</dt>
            <dd>{{ batchStats.minDuration }} ms</dd>
          </div>
          <div>
            <dt>{{ $t('ui.slowest') }}</dt>
            <dd>{{ batchStats.maxDuration }} ms</dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- 主内容区：左请求配置 / 右响应与历史 -->
    <div class="api-split">
      <section class="pane request-pane" :aria-label="$t('ui.requestConfiguration')">
        <div class="pane__bar">
          <DevTabs v-model="activeTab" :tabs="requestTabs" :aria-label="$t('ui.requestConfiguration')" />
        </div>

        <div class="pane__body vx-ui-scrollbar">
          <div class="kv-table">
            <div class="kv-table__head" aria-hidden="true">
              <span></span>
              <span>{{ activeKv.keyLabel }}</span>
              <span>{{ activeKv.valueLabel }}</span>
              <span></span>
            </div>
            <div v-for="(row, index) in activeKv.rows" :key="index" class="kv-table__row">
              <VxCheckbox
                v-model="row.enabled"
                class="kv-check"
                :label="$t('ui.enableRowValue', { value1: (index + 1) })"
              />
              <VxInput
                v-model="row.key"
                class="kv-input"
                :placeholder="activeKv.keyLabel"
                :aria-label="$t('ui.valueRowValue', { value1: (activeKv.keyLabel), value2: (index + 1) })"
              />
              <VxInput
                v-model="row.value"
                class="kv-input"
                :placeholder="activeKv.valueLabel"
                :aria-label="$t('ui.valueRowValue', { value1: (activeKv.valueLabel), value2: (index + 1) })"
              />
              <button
                type="button"
                class="icon-button is-danger"
                :aria-label="$t('ui.deleteRowValue', { value1: (index + 1) })"
                :title="$t('modelSettings.remove')"
                @click="activeKv.remove(index)"
              >
                <DevIcon name="trash" :size="15" />
              </button>
            </div>
            <p v-if="!activeKv.rows.length" class="kv-table__empty">{{ activeKv.emptyText }}</p>
          </div>

          <button type="button" class="kv-add" @click="activeKv.add()">
            <DevIcon name="plus" :size="14" />
            {{ activeKv.addText }}
          </button>

          <div v-if="activeTab === 'body' && bodyParamsPreview" class="body-preview">
            <span class="body-preview__label">{{ $t('ui.requestBodyPreview') }}</span>
            <pre
              class="code-block body-preview__code vx-ui-scrollbar"
              v-html="formatJsonWithHighlight(bodyParamsPreview)"
            ></pre>
          </div>
        </div>
      </section>

      <section class="pane response-pane" :aria-label="$t('ui.responsesAndHistory')">
        <div class="pane__bar">
          <DevTabs
            v-model="rightPaneTab"
            :tabs="[
              { value: 'response', label: $t('ui.response') },
              { value: 'history', label: '历史记录', count: filteredHistory.length }
            ]"
            :aria-label="$t('ui.responsesAndHistory')"
          />
        </div>

        <!-- 响应 -->
        <div v-if="rightPaneTab === 'response'" class="pane__body response-body">
          <template v-if="hasResponse">
            <div class="response-meta">
              <VxTag :tone="getStatusTone(currentResponse.status)" size="sm" class="status-tag">
                {{ statusLabel }}
              </VxTag>
              <span class="response-meta__item">
                {{ $t('ui.duration') }} <strong>{{ currentResponse.duration }} ms</strong>
              </span>
              <span class="response-meta__item">
                {{ $t('tools.size') }} <strong>{{ formatSize(currentResponse.size) }}</strong>
              </span>
              <span class="response-meta__spacer"></span>
              <div class="response-view">
                <VxSegmented v-model="responseTab" :options="responseViewOptions" />
              </div>
              <VxButton variant="secondary" size="sm" @click="emit('copyResponse')">
                <span class="button-inner">
                  <DevIcon name="copy" :size="14" />
                  {{ $t('tools.copy') }}
                </span>
              </VxButton>
            </div>

            <pre
              v-if="responseTab === 'body'"
              class="code-block response-code vx-ui-scrollbar"
              tabindex="0"
              :aria-label="$t('ui.responseContent')"
              v-html="formatJsonWithHighlight(currentResponse.data)"
            ></pre>
            <dl v-else class="header-list vx-ui-scrollbar">
              <div
                v-for="[key, value] in responseHeaderEntries"
                :key="key"
                class="header-list__row"
              >
                <dt>{{ key }}</dt>
                <dd>{{ value }}</dd>
              </div>
              <p v-if="!responseHeaderEntries.length" class="header-list__empty">{{ $t('ui.noResponseHeaders') }}</p>
            </dl>
          </template>

          <div v-else-if="isApiLoading" class="state-block" role="status">
            <span class="state-block__spinner" aria-hidden="true"></span>
            <strong>{{ $t('ui.requesting') }}</strong>
          </div>

          <div v-else-if="currentResponse.error" class="state-block is-error" role="alert">
            <span class="state-block__icon"><DevIcon name="alert" :size="20" /></span>
            <strong>{{ $t('ui.requestFailed') }}</strong>
            <code class="state-block__detail">{{ currentResponse.error }}</code>
            <span class="state-block__hint">{{ $t('ui.duration') }} {{ currentResponse.duration }} ms</span>
          </div>

          <div v-else class="state-block">
            <span class="state-block__icon"><DevIcon name="send" :size="20" /></span>
            <strong>{{ $t('ui.noResponseYet') }}</strong>
            <span class="state-block__hint">{{ $t('ui.enterARequestPathThenClickSendOrPressEnter') }}</span>
          </div>
        </div>

        <!-- 历史记录 -->
        <div v-else class="pane__body history-body">
          <div class="history-tools">
            <div class="history-search">
              <VxInput
                v-model="historySearchKeyword"
                :placeholder="$t('ui.searchPathsMethodsOrStatusCodes')"
                :aria-label="$t('ui.searchHistory')"
                clearable
              />
            </div>
            <VxButton
              variant="ghost"
              size="sm"
              class="danger-ghost"
              :disabled="!history.length"
              @click="clearHistoryVisible = true"
            >
              <span class="button-inner">
                <DevIcon name="trash" :size="14" />
                {{ $t('tools.clear') }}
              </span>
            </VxButton>
          </div>

          <ul v-if="visibleHistory.length" class="history-list vx-ui-scrollbar">
            <li v-for="item in visibleHistory" :key="item.id" class="history-row">
              <button
                type="button"
                class="history-row__main"
                :title="$t('ui.restoreRequestValueValue', { value1: (item.request.method || 'GET'), value2: (item.request.url || '') })"
                @click="emit('restoreHistory', item)"
              >
                <span
                  class="method-badge"
                  :class="`tone-${getMethodTone(item.request.method || 'GET')}`"
                >
                  {{ item.request.method || 'GET' }}
                </span>
                <span class="history-row__url">{{ item.request.url || '' }}</span>
                <span class="status-code" :class="`tone-${getStatusTone(item.response.status)}`">
                  {{ item.response.status || 'ERR' }}
                </span>
                <span class="history-row__meta">
                  {{ item.duration || 0 }} ms · {{ item.displayTime || '' }}
                </span>
              </button>
              <button
                type="button"
                class="icon-button"
                :aria-label="$t('ui.viewRequestDetails')"
                :title="$t('modBrowser.details')"
                @click="apiStore.showHistoryDetail(item)"
              >
                <DevIcon name="eye" :size="15" />
              </button>
            </li>
          </ul>
          <div v-else class="state-block is-compact">
            <span class="state-block__icon"><DevIcon name="history" :size="20" /></span>
            <strong>{{ historySearchKeyword ? $t('ui.noMatchingRecords') : $t('ui.noHistoryYet') }}</strong>
            <span class="state-block__hint">
              {{ historySearchKeyword ? $t('ui.tryAnotherKeyword') : $t('ui.sentRequestsAreSavedHereAutomatically') }}
            </span>
          </div>

          <p v-if="filteredHistory.length > HISTORY_DISPLAY_LIMIT" class="history-foot">
            {{ $t('ui.showingTheLatest') }} {{ HISTORY_DISPLAY_LIMIT }} {{ $t('ui.recordsOutOf') }} {{ filteredHistory.length }} {{ $t('ui.records') }}
          </p>
        </div>
      </section>
    </div>

    <VxConfirmModal
      v-model="clearHistoryVisible"
      :title="$t('ui.clearHistory')"
      :content="$t('ui.deleteAllValueRequestHistoryRecordsThisCannotBeUndone', { value1: (history.length) })"
      :confirm-text="$t('tools.clear')"
      danger
      @confirm="confirmClearHistory"
    />

    <VxModal
      v-model="historyDetailVisibleModel"
      :title="$t('ui.requestDetails')"
      :subtitle="historyDetailTitle"
      :width="720"
      close-on-overlay
    >
      <div v-if="selectedHistoryItem" class="history-detail">
        <section class="detail-section">
          <h4>{{ $t('ui.request') }}</h4>
          <dl class="detail-grid">
            <div>
              <dt>{{ $t('ui.method') }}</dt>
              <dd>
                <span
                  class="method-badge"
                  :class="`tone-${getMethodTone(selectedHistoryItem.request.method)}`"
                >
                  {{ selectedHistoryItem.request.method }}
                </span>
              </dd>
            </div>
            <div>
              <dt>{{ $t('taskCenter.detail.logTime') }}</dt>
              <dd>{{ selectedHistoryItem.displayTime }}</dd>
            </div>
            <div class="is-wide">
              <dt>URL</dt>
              <dd class="is-mono">
                {{ selectedHistoryItem.request.fullUrl || selectedHistoryItem.request.url }}
              </dd>
            </div>
          </dl>
          <span class="detail-label">{{ $t('ui.customRequestHeaders') }}</span>
          <pre
            class="code-block detail-code vx-ui-scrollbar"
            v-html="formatJsonWithHighlight(kvListToObject(selectedHistoryItem.request.headers))"
          ></pre>
          <template v-if="selectedHistoryItem.request.body">
            <span class="detail-label">{{ $t('ui.requestBody') }}</span>
            <pre
              class="code-block detail-code vx-ui-scrollbar"
              v-html="formatJsonWithHighlight(selectedHistoryItem.request.body)"
            ></pre>
          </template>
        </section>

        <section class="detail-section">
          <h4>{{ $t('ui.response') }}</h4>
          <dl class="detail-grid">
            <div>
              <dt>{{ $t('ui.statusCode') }}</dt>
              <dd>
                <span
                  class="status-code"
                  :class="`tone-${getStatusTone(selectedHistoryItem.response.status)}`"
                >
                  {{ selectedHistoryItem.response.status || 'ERR' }}
                </span>
              </dd>
            </div>
            <div>
              <dt>{{ $t('ui.duration') }}</dt>
              <dd>{{ selectedHistoryItem.duration }} ms</dd>
            </div>
            <div v-if="selectedHistoryItem.error" class="is-wide">
              <dt>{{ $t('ui.error') }}</dt>
              <dd class="is-mono is-danger">{{ selectedHistoryItem.error }}</dd>
            </div>
          </dl>
          <span class="detail-label">{{ $t('ui.responseHeaders') }}</span>
          <pre
            class="code-block detail-code vx-ui-scrollbar"
            v-html="formatJsonWithHighlight(selectedHistoryItem.response.headers)"
          ></pre>
          <span class="detail-label">{{ $t('ui.responseData') }}</span>
          <pre
            class="code-block detail-code is-tall vx-ui-scrollbar"
            v-html="formatJsonWithHighlight(selectedHistoryItem.response.data)"
          ></pre>
        </section>
      </div>
    </VxModal>
  </section>
</template>

<style scoped lang="scss">
.api-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

// ---------- 头部 ----------
.api-panel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5) 0;
}

.api-panel__heading {
  min-width: 0;

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-tight);
  }

  p {
    margin: 4px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    line-height: var(--line-height-base);
  }
}

.field-label {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.mode-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mode-field__control {
  width: 128px;
}

.button-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

// ---------- 请求行 ----------
.request-line {
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5) 0;
}

.method-select {
  flex: 0 0 116px;

  :deep(.vx-select__value) {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
  }

  &.tone-success :deep(.vx-select__value) {
    color: var(--color-success-strong);
  }
  &.tone-accent :deep(.vx-select__value) {
    color: var(--color-accent-active);
  }
  &.tone-warning :deep(.vx-select__value) {
    color: var(--color-warning-strong);
  }
  &.tone-info :deep(.vx-select__value) {
    color: var(--color-info);
  }
  &.tone-danger :deep(.vx-select__value) {
    color: var(--color-danger);
  }
  &.tone-neutral :deep(.vx-select__value) {
    color: var(--color-text-secondary);
  }
}

.url-combo {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;

  &.has-prefix .url-combo__input :deep(.vx-input) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.url-combo__prefix {
  flex: 0 1 auto;
  max-width: 38%;
  min-width: 0;
  padding: 0 10px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: calc(var(--control-height-md) - 2px);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
}

.url-combo__input {
  flex: 1 1 auto;

  :deep(.vx-input) {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
  }
}

.send-button {
  flex: none;
  min-width: 88px;
}

// ---------- 选项行 ----------
.request-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-5);
  padding: var(--space-1) var(--space-5) 0;
}

.request-options__spacer {
  flex: 1 1 0;
}

.inline-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.content-type-select {
  width: 248px;

  :deep(.vx-select) {
    min-height: var(--control-height-sm);
    font-size: var(--font-size-sm);
  }
}

// ---------- 批量测试 ----------
.batch-bar {
  display: grid;
  gap: 10px;
  margin: var(--space-2) var(--space-5) 0;
  padding: 10px var(--space-3);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.batch-bar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

.number-input {
  width: 96px;

  :deep(.vx-input) {
    min-height: var(--control-height-sm);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
  }
}

.batch-bar__result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-5);
}

.batch-progress {
  display: flex;
  flex: 1 1 220px;
  align-items: center;
  gap: 10px;
  min-width: 180px;

  .vx-progress {
    flex: 1 1 auto;
  }
}

.batch-progress__text {
  flex: none;
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}

.batch-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;

  > div {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  dd {
    margin: 0;
    color: var(--color-text);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
  }

  .is-success dd {
    color: var(--color-success-strong);
  }

  .is-danger dd {
    color: var(--color-danger);
  }
}

// ---------- 分栏 ----------
.api-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  height: clamp(420px, calc(100vh - 420px), 760px);
  margin-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

  & + & {
    border-left: 1px solid var(--color-border);
  }
}

.pane__bar {
  display: flex;
  flex: none;
  align-items: stretch;
  height: 42px;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--color-surface-strong);
}

.pane__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: var(--space-3) var(--space-5) var(--space-4);
  overflow-y: auto;
}

// ---------- 键值对表格 ----------
.kv-table {
  display: grid;
  gap: 6px;
}

.kv-table__head,
.kv-table__row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1.4fr) 32px;
  align-items: center;
  gap: var(--space-2);
}

.kv-table__head {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 20px;
}

.kv-check {
  min-height: var(--control-height-sm);
  padding-block: 0;
  align-items: center;

  :deep(i) {
    margin-top: 0;
  }

  // 文本只供读屏使用，保持表格列对齐。
  :deep(> span) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

.kv-input :deep(.vx-input) {
  min-height: var(--control-height-sm);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.kv-table__empty {
  margin: 0;
  padding: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: center;
  background: var(--color-surface-soft);
  border-radius: var(--radius-sm);
}

.icon-button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &.is-danger:hover {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.kv-add {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: var(--control-height-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-sm);
  background: transparent;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent-active);
    background: var(--color-surface-hover);
    border-color: var(--color-accent);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.body-preview {
  display: grid;
  gap: 6px;
}

.body-preview__label,
.detail-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.body-preview__code {
  max-height: 220px;
}

// ---------- 代码块 ----------
.code-block {
  margin: 0;
  padding: 10px var(--space-3);
  overflow: auto;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;

  &:focus-visible {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
  }

  :deep(.json-key) {
    color: var(--color-accent-strong);
  }

  :deep(.json-string) {
    color: var(--color-success-strong);
  }

  :deep(.json-number) {
    color: var(--color-accent-active);
  }

  :deep(.json-boolean) {
    color: var(--color-warning-strong);
  }

  :deep(.json-null) {
    color: var(--color-text-muted);
  }
}

// ---------- 响应 ----------
.response-body {
  overflow: hidden;
}

.response-meta {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.status-tag {
  font-family: var(--font-family-mono);
  font-weight: var(--font-weight-semibold);
}

.response-meta__item {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);

  strong {
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono);
    font-weight: var(--font-weight-semibold);
  }
}

.response-meta__spacer {
  flex: 1 1 0;
}

.response-view {
  width: 168px;

  :deep(.vx-segmented) {
    height: 30px;
  }

  :deep(.vx-segmented button) {
    height: 24px;
    font-size: var(--font-size-xs);
  }
}

.response-code {
  flex: 1 1 auto;
  min-height: 0;
}

.header-list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.header-list__row {
  display: grid;
  grid-template-columns: minmax(120px, 34%) minmax(0, 1fr);
  gap: var(--space-3);
  padding: 7px var(--space-3);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  dt {
    color: var(--color-accent-strong);
    font-family: var(--font-family-mono);
    font-weight: var(--font-weight-medium);
    overflow-wrap: anywhere;
  }

  dd {
    margin: 0;
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono);
    overflow-wrap: anywhere;
  }
}

.header-list__empty {
  margin: 0;
  padding: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: center;
}

// ---------- 空 / 加载 / 错误 ----------
.state-block {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 200px;
  padding: var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);

  strong {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  &.is-compact {
    min-height: 160px;
  }

  &.is-error {
    background: color-mix(in srgb, var(--color-danger-soft) 45%, var(--color-surface));
    border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border));

    .state-block__icon {
      color: var(--color-danger);
      background: var(--color-danger-soft);
    }
  }
}

.state-block__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border-radius: var(--radius-pill);
}

.state-block__detail {
  max-width: 100%;
  color: var(--color-danger);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.state-block__hint {
  color: var(--color-text-muted);
}

.state-block__spinner {
  width: 22px;
  height: 22px;
  margin-bottom: var(--space-1);
  border: 2px solid var(--color-surface-strong);
  border-top-color: var(--color-accent);
  border-radius: var(--radius-pill);
  animation: dev-spin 800ms linear infinite;
}

@keyframes dev-spin {
  to {
    transform: rotate(360deg);
  }
}

// ---------- 历史 ----------
.history-body {
  overflow: hidden;
}

.history-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}

.history-search {
  flex: 1 1 auto;
  max-width: 320px;

  :deep(.vx-input) {
    min-height: var(--control-height-sm);
    font-size: var(--font-size-sm);
  }
}

.danger-ghost {
  margin-left: auto;

  &:hover:not(:disabled) {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }
}

.history-list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.history-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-right: var(--space-1);
  transition: background var(--duration-fast) var(--ease-standard);

  & + & {
    border-top: 1px solid var(--color-surface-strong);
  }

  &:hover {
    background: var(--color-surface-hover);
  }
}

.history-row__main {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr) 36px 184px;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 42px;
  padding: 0 var(--space-2) 0 10px;
  color: inherit;
  font-family: var(--font-family-base);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }
}

.history-row__url {
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-row__meta {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-foot {
  flex: none;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  text-align: right;
}

// ---------- 方法 / 状态徽标 ----------
.method-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  font-family: var(--font-family-mono);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.02em;
  border-radius: var(--radius-xs);
}

.status-code {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-align: right;
}

.method-badge.tone-success {
  color: var(--color-success-strong);
  background: var(--color-success-soft);
}
.method-badge.tone-accent {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
}
.method-badge.tone-warning {
  color: var(--color-warning-strong);
  background: var(--color-warning-soft);
}
.method-badge.tone-info {
  color: var(--color-info);
  background: var(--color-info-soft);
}
.method-badge.tone-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}
.method-badge.tone-neutral {
  color: var(--color-text-secondary);
  background: var(--color-surface-strong);
}

.status-code.tone-success {
  color: var(--color-success-strong);
}
.status-code.tone-info {
  color: var(--color-info);
}
.status-code.tone-warning {
  color: var(--color-warning-strong);
}
.status-code.tone-danger {
  color: var(--color-danger);
}

// ---------- 历史详情弹窗 ----------
.history-detail {
  display: grid;
  gap: var(--space-5);
}

.detail-section {
  display: grid;
  gap: var(--space-2);

  h4 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-6);
  margin: 0 0 var(--space-1);

  > div {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    min-height: 34px;
    border-bottom: 1px solid var(--color-surface-strong);
  }

  .is-wide {
    grid-column: 1 / -1;
  }

  dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }

  .is-mono {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
  }

  .is-danger {
    color: var(--color-danger);
  }
}

.detail-code {
  max-height: 180px;

  &.is-tall {
    max-height: 320px;
  }
}

// ---------- 响应式 ----------
@media (max-width: 960px) {
  .api-split {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }

  .pane {
    height: 440px;

    & + & {
      border-top: 1px solid var(--color-border);
      border-left: 0;
    }
  }
}

@media (max-width: 720px) {
  .request-line {
    flex-wrap: wrap;
  }

  .url-combo {
    flex-basis: 100%;
    order: 3;
  }

  .content-type-select {
    width: 200px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-block__spinner {
    animation-duration: 2400ms;
  }
}
</style>
