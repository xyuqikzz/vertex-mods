<script setup>
import { uiMessage } from '../../i18n/message.js'

import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import PageBody from '@renderer/component/page-body.vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { useAppStore } from '@renderer/store/appStore.js'
import { useApiDebuggerStore } from '@renderer/store/apiDebuggerStore.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import ApiDebuggerPanel from './component/ApiDebuggerPanel.vue'
import QuickCommandsPanel from './component/QuickCommandsPanel.vue'
import DevIcon from './component/DevIcon.vue'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { v4 as uuidv4 } from 'uuid'

const appStore = useAppStore()
const apiStore = useApiDebuggerStore()

const { currentRequest, currentResponse, batchConfig } = storeToRefs(apiStore)
const { setMenuName: setPageMenuName } = useMenuName()
const route = useRoute()
const router = useRouter()

const requestUrl = computed(() => appStore.AppData.requestUrl)
const appVersion = computed(() => appStore.AppData.version)

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const contentTypes = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'application/xml'
]

onMounted(() => {
  setPageMenuName('控制台', route.path)
})

onUnmounted(() => {
  if (batchConfig.value.isRunning) {
    apiStore.stopBatchTest()
  }
})

function buildQueryString() {
  const params = currentRequest.value.params
    .filter((p) => p.enabled && p.key.trim())
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return params ? `?${params}` : ''
}

function calculateSize(data) {
  try {
    const str = typeof data === 'object' ? JSON.stringify(data) : String(data || '')
    return new Blob([str]).size
  } catch {
    return 0
  }
}

async function sendApiRequest() {
  apiStore.isLoading = true
  apiStore.resetResponse()

  const startTime = Date.now()
  const debugConfig = currentRequest.value
  const AppData = appStore.AppData

  // 提前声明 fetchOptions 以便在 catch 中访问
  let fetchOptions = {}

  try {
    let fullUrl = debugConfig.url
    const queryString = buildQueryString()
    fullUrl += queryString

    if (debugConfig.useBaseUrl) {
      fullUrl = requestUrl.value + fullUrl
    }

    const headers = {
      'Content-Type': debugConfig.contentType,
      'vertex-version': AppData.version
    }

    debugConfig.headers
      .filter((h) => h.enabled && h.key.trim())
      .forEach((h) => {
        headers[h.key] = h.value
      })

    fetchOptions = { method: debugConfig.method, headers }

    // 处理请求体
    if (!['GET', 'HEAD'].includes(debugConfig.method)) {
      // 优先处理 bodyParams (KV对)
      if (debugConfig.bodyParams && debugConfig.bodyParams.length > 0) {
        const params = debugConfig.bodyParams.filter((p) => p.enabled && p.key)
        if (params.length > 0) {
          const bodyObj = {}
          params.forEach((p) => {
            let val = p.value
            try {
              // 尝试解析 value 为 JSON (数字, 布尔, 数组, 对象等)
              if (
                p.value === 'true' ||
                p.value === 'false' ||
                p.value === 'null' ||
                !isNaN(Number(p.value)) ||
                (p.value.startsWith('[') && p.value.endsWith(']')) ||
                (p.value.startsWith('{') && p.value.endsWith('}'))
              ) {
                val = JSON.parse(p.value)
              }
            } catch {
              // 解析失败，保留原值
            }
            bodyObj[p.key] = val
          })
          fetchOptions.body = JSON.stringify(bodyObj)
        }
      }
      // 如果没有 bodyParams，回退到原始 body (兼容旧数据或直接输入)
      else if (debugConfig.body && debugConfig.body.trim()) {
        if (debugConfig.contentType === 'application/json') {
          try {
            fetchOptions.body = JSON.stringify(JSON.parse(debugConfig.body))
          } catch {
            fetchOptions.body = debugConfig.body
          }
        } else {
          fetchOptions.body = debugConfig.body
        }
      }
    }

    const result = debugConfig.useBaseUrl
      ? await window.api.network.request(
          JSON.parse(
            JSON.stringify({
              id: crypto.randomUUID(),
              service: 'account',
              url: fullUrl,
              method: fetchOptions.method,
              headers: fetchOptions.headers,
              data: fetchOptions.body,
              auth: debugConfig.useAuth === true
            })
          )
        )
      : null
    const response = result
      ? {
          status: result.status,
          statusText: `HTTP ${result.status}`,
          headers: new Headers(result.headers),
          json: async () => result.data,
          text: async () =>
            typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
        }
      : await fetch(fullUrl, fetchOptions)
    const endTime = Date.now()
    const duration = endTime - startTime

    const responseHeaders = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    let responseData
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      responseData = await response.json()
    } else {
      responseData = await response.text()
    }

    const size = calculateSize(responseData)

    apiStore.currentResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      data: responseData,
      size,
      duration,
      error: null
    }

    // 确保历史记录中保存实际发送的 body 内容
    const historyRequestConfig = { ...debugConfig, fullUrl }
    if (typeof fetchOptions.body === 'string') {
      historyRequestConfig.body = fetchOptions.body
    }

    apiStore.addHistory(historyRequestConfig, apiStore.currentResponse, duration)

    return { success: true, duration, status: response.status }
  } catch (error) {
    const endTime = Date.now()
    const duration = endTime - startTime

    apiStore.currentResponse = {
      status: null,
      statusText: 'Error',
      headers: {},
      data: null,
      size: 0,
      duration,
      error: error.message
    }

    // 确保历史记录中保存实际发送的 body 内容
    const historyRequestConfig = { ...debugConfig, fullUrl: debugConfig.url }
    if (fetchOptions && typeof fetchOptions.body === 'string') {
      historyRequestConfig.body = fetchOptions.body
    }

    apiStore.addHistory(historyRequestConfig, apiStore.currentResponse, duration)

    return { success: false, duration, status: null }
  } finally {
    apiStore.isLoading = false
  }
}

async function startBatchTest() {
  if (batchConfig.value.isRunning) return

  apiStore.resetBatchTest()
  apiStore.batchConfig.isRunning = true

  const count = batchConfig.value.count
  const interval = batchConfig.value.interval

  for (let i = 0; i < count; i++) {
    if (apiStore.batchConfig.shouldStop) break

    apiStore.batchConfig.currentRound = i + 1
    const result = await sendApiRequest()
    apiStore.batchConfig.results.push(result)

    if (i < count - 1 && !apiStore.batchConfig.shouldStop) {
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }

  apiStore.batchConfig.isRunning = false
  $message.success(uiMessage('ui.batchTestCompleteValueValue', { value1: (apiStore.batchConfig.results.length), value2: (count) }))
}

function stopBatchTest() {
  apiStore.stopBatchTest()
  $message.info(uiMessage('ui.batchTestStopped'))
}

function copyResponse() {
  if (!currentResponse.value.data) return
  const text =
    typeof currentResponse.value.data === 'object'
      ? JSON.stringify(currentResponse.value.data, null, 2)
      : currentResponse.value.data
  navigator.clipboard.writeText(text)
  $message.success(uiMessage('ui.responseCopiedToClipboard'))
}

function restoreFromHistory(item) {
  apiStore.restoreFromHistory(item)
  $message.success(uiMessage('ui.requestConfigurationRestored'))
}

function generateUuid() {
  const uuid = uuidv4()
  navigator.clipboard.writeText(uuid).catch((e) => console.error(e))
  $message.success(uiMessage('ui.uUIDCopiedToClipboard'))
}

function openDirectory(type) {
  ipcRenderer.send('open-app-directory', type)
}

function openDevTools() {
  ipcRenderer.send('openDevTools')
}

function openUiComponents() {
  router.push({ name: 'DevUiComponents' })
}

defineOptions({ name: 'DevConsole' })
</script>

<template>
  <div class="dev-console">
    <page-body>
      <div class="dev-console__stack">
        <section class="console-card console-overview" aria-labelledby="dev-console-title">
          <header class="console-overview__head">
            <div class="console-overview__heading">
              <h1 id="dev-console-title">{{ $t('nav.console') }}</h1>
              <p>{{ $t('ui.debuggingToolsConnectionStatusAndInternalClientFeatures') }}</p>
            </div>

            <div class="console-overview__aside">
              <dl class="console-meta">
                <div class="console-meta__item">
                  <dt>
                    <DevIcon name="server" :size="14" />
                    <span>{{ $t('ui.serviceURL') }}</span>
                  </dt>
                  <dd class="is-mono" :title="requestUrl || $t('dialogs.vamCookie.notSet')">
                    {{ requestUrl || $t('dialogs.vamCookie.notSet') }}
                  </dd>
                </div>
                <div v-if="appVersion" class="console-meta__item">
                  <dt>{{ $t('ui.client') }}</dt>
                  <dd class="is-mono">v{{ appVersion }}</dd>
                </div>
              </dl>
              <VxButton variant="secondary" size="sm" @click="openUiComponents">
                <span class="button-inner">
                  <DevIcon name="grid" :size="14" />
                  {{ $t('ui.sharedComponents') }}
                </span>
              </VxButton>
            </div>
          </header>

          <QuickCommandsPanel
            @generate-uuid="generateUuid"
            @open-directory="openDirectory"
            @open-dev-tools="openDevTools"
          />
        </section>

        <ApiDebuggerPanel
          :request-url="requestUrl"
          :http-methods="httpMethods"
          :content-types="contentTypes"
          @send-request="sendApiRequest"
          @start-batch-test="startBatchTest"
          @stop-batch-test="stopBatchTest"
          @copy-response="copyResponse"
          @restore-history="restoreFromHistory"
        />
      </div>
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.dev-console {
  width: 100%;
  height: 100%;
  color: var(--color-text);
  font-family: var(--font-family-base);
}

.dev-console__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.console-card {
  min-width: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.console-overview {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.console-overview__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-surface-strong);
}

.console-overview__heading {
  min-width: 0;

  h1 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-tight);
  }

  p {
    margin: 6px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-base);
  }
}

.console-overview__aside {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.console-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.console-meta__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 360px;
  height: 28px;
  padding: 0 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  dt {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.is-mono {
  font-family: var(--font-family-mono);
}

.button-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 720px) {
  .console-overview {
    padding: var(--space-4);
  }
}
</style>
