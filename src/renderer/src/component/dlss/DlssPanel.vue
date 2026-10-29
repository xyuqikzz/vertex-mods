<script setup>
import { toolText as tt, toolMessage as tm } from '@renderer/i18n/tool-text.js'

import { toolServiceText as serviceText } from '@renderer/i18n/tool-service-text.js'
import { gamePresentation } from '@renderer/i18n/content.js'
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  canChooseReShadeProxy,
  effectiveReShadeProxy
} from '../../../../shared/dlss-swapper/reshade-proxy.js'
import { CheckCircleFilled, ClockCircleOutlined, InfoCircleFilled } from '@ant-design/icons-vue'
import { VxButton, VxSelect, VxModal, VxConfirmModal } from '@renderer/component/vertex-ui'
import { swapperApi, t } from './swapper-api.js'
import { dlssApi } from './api.js'
import renderingApi from '../../../../shared/dlss-swapper/rendering-api.js'
import installRoutes from '../../../../shared/dlss-swapper/install-routes.js'
import {
  consumerVersions,
  resolveConsumer
} from '../../../../shared/dlss-swapper/consumer-versions.js'
import { sizeLabel, installationAction, fileName } from './presentation.js'
import DlssInstallProgress from './DlssInstallProgress.vue'
import { watchProgress } from './watch-progress.js'

const apiText = (api) => tt(renderingApi.label(api))
const errorText = (value) => value?.code && t(value.code) !== value.code ? t(value.code) : serviceText(value?.message || value)

const props = defineProps({
  modelValue: Boolean,
  bindingId: { type: String, default: '' },
  allowDirectorySelection: { type: Boolean, default: true },
  context: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue', 'changed'])
const installProgress = ref(null)
let stopProgress = () => {}
const details = ref(null),
  savedIdentity = ref(null),
  runtimeStatus = ref(null),
  art = ref(null),
  busy = ref(''),
  error = ref('')
const exe = ref(''),
  launchProfile = ref('auto'),
  api = ref('auto'),
  route = ref(''),
  build = ref(''),
  consumerChoice = ref('auto'),
  reshadeProxy = ref('dxgi'),
  notesOpen = ref(false),
  inspectorView = ref('components'),
  restoreConfirm = ref(false),
  detectConfirm = ref(false),
  detectionResult = ref(null)
const liveDetection = ref(null)
let detectionRun = null
let confirmationTarget = null
let generation = 0
let pendingAnalysis = ''
let loadedTarget = ''
const target = computed(() =>
  props.bindingId
    ? `id:${props.bindingId}`
    : `path:${String(props.context.gameRoot || props.context.exePath || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase()}`
)
const record = computed(() => details.value?.record)
// 扫描没有找到可选的游戏程序时，按扫描给出的原因说明下一步怎么做。
const emptyExeMessage = computed(() => {
  const reason = details.value?.reason
  if (reason === 'xbox-protected')
    return tt('这是受保护的 Xbox 游戏包，请把游戏移动或重新安装到 XboxGames 文件夹后再试。')
  if (reason === 'installer')
    return tt('这个文件夹看起来是安装包，请先完成游戏安装，再选择安装后的游戏文件夹。')
  if (reason === 'no-graphics-exe' || reason === 'renderer-in-dll')
    return tt('没有找到可安装 DLSS5 的 3D 游戏程序，请选择游戏实际安装的文件夹。')
  return tt('这个文件夹里没有找到游戏程序，游戏可能已卸载或移动。')
})
const identity = computed(() => ({ ...props.context, ...savedIdentity.value, ...record.value }))
const artwork = computed(() => art.value || identity.value.artwork)
const gameName = computed(
  () =>
    gamePresentation(identity.value).title ||
    artwork.value?.name ||
    fileName(identity.value.gameRoot) ||
    tt('正在读取游戏信息')
)
const hasTarget = computed(
  () => !!(props.bindingId || props.context.gameRoot || props.context.exePath)
)
const selected = computed(() => details.value?.exes.find((item) => item.path === exe.value))
const effective = computed(() =>
  renderingApi.effective(
    selected.value && { ...selected.value, manualSelection: true },
    api.value === 'auto' ? launchProfile.value : api.value
  )
)
const detection = computed(() => selected.value?.rendering)
const consumerPlan = computed(() =>
  resolveConsumer(effective.value, route.value, consumerChoice.value)
)
const consumerOptions = computed(() => [
  {
    value: 'auto',
    label: tt("自动推荐{0}", [consumerPlan.value ? ' (' + resolveConsumer(effective.value, route.value).version + ')' : ''])
  },
  ...consumerVersions.map((c) => ({ value: c.version, label: tt("RenoDX {0}（锁定版本）", [c.version]) }))
])
const currentApiText = computed(() => {
  const value = detection.value
  if (busy.value === 'detect' && !liveDetection.value?.updates) return tt('正在检测…')
  if (value?.recommendedApi && value.recommendationSource === 'gpu-client')
    return tt("{0}（系统推荐）", [apiText(value.recommendedApi)])
  if (value?.current)
    return `${apiText(value.current.api)} (${value.current.state === 'observed' ? tt('本次运行') : tt('本次初始化')})`
  if (value?.recommendedApi) {
    const fromArgs = value.requested?.evidence?.some((e) => e.source === 'process-arguments')
    return `${apiText(value.recommendedApi)} (${fromArgs ? tt('启动参数推荐') : value.requested ? tt('配置推荐') : tt('静态推测')})`
  }
  if (value?.lastDetection)
    return `${apiText(value.lastDetection.api)} (${value.lastDetection.confidence === 'recommended' ? tt('上次推荐') : tt('上次确认')})`
  if (value?.lastObserved)
    return `${apiText(value.lastObserved.api)} (${value.lastObserved.state === 'initialized' ? tt('历史初始化') : tt('上次使用')})`
  return tt('待确认')
})
const profileOptions = computed(() => [
  { value: 'auto', label: tt('默认（跟随检测）') },
  ...(detection.value?.profiles || []).map((item) => ({ value: item.id, label: tt(item.label) }))
])
const detectionLimitations = computed(() =>
  (detection.value?.reasons || [])
    .map(
      (reason) =>
        ({
          log_partial: tt('日志较大，仅保留可核对的历史片段，未确认当前运行。'),
          configuration_unresolved: tt('配置中的渲染选项尚无法解析，请选择计划使用的模式。'),
          log_stale: tt('已有日志过期或早于程序更新，未用于本次判断。'),
          log_identity_unconfirmed: tt('日志无法明确对应当前游戏程序，未作为运行证据。'),
          process_unavailable: tt('当前进程信息暂不可读，文件与配置检查仍可用。'),
          multiple_processes: tt('同一程序存在多个运行实例，暂无法确定当前会话。'),
          gpu_client_ambiguous: tt('系统返回多种或转译图形接口，暂不能确定游戏画面使用哪一种。'),
          gpu_client_uncorroborated: tt('系统图形信息与进程模块不一致，未用于自动推荐。'),
          runtime_hint_conflict: tt('系统图形信息与其他依据不同，请手动选择 API 或重新检测。'),
          historical_disagreement: tt('文件推测与日志记录不同，请选择计划使用的模式。')
        })[reason]
    )
    .filter(Boolean)
)
const available = computed(() => installRoutes.routesFor(effective.value))
const exeOptions = computed(() =>
  (details.value?.exes || []).map((item) => ({
    value: item.path,
    label: `${item.recommended ? tt('推荐 · ') : ''}${item.rel} — ${item.architecture || item.bitness + '-bit'} — ${sizeLabel(item.size)}`
  }))
)
const backend = computed({
  get: () => (route.value === 'optiscaler' ? 'optiscaler' : 'reshade'),
  set: (value) => {
    route.value =
      value === 'optiscaler' ? value : available.value.filter((item) => item !== 'optiscaler')[0]
  }
})
const apiOptions = computed(() => [
  {
    value: 'auto',
    label: tt("自动（{0}）", [launchProfile.value === 'auto' ? apiText(detection.value?.recommendedApi || detection.value?.installationPlan?.api) : tt('跟随所选模式')])
  },
  ...renderingApi.choices.map((item) => ({ value: item.value, label: tt(item.label) }))
])
const detectionHint = computed(() => {
  if (busy.value === 'detect' || detectionResult.value) return ''
  if (detection.value) {
    if (detection.value.state === 'conflict')
      return tt('识别依据存在冲突，暂不能自动规划安装。请确认游戏启动模式后重新检测。')
    if (api.value !== 'auto' || launchProfile.value !== 'auto')
      return tt('按你选择的模式准备安装；请在游戏或启动器中使用相同的渲染模式。当前运行与历史检测结果独立保留。')
    if (detection.value.reasons.includes('runtime_fallback'))
      return tt('本次初始化与启动参数不同，游戏可能回退到了其他 API；自动安装目标跟随本次初始化结果。')
    if (detection.value.recommendationSource === 'gpu-client' && detection.value.recommendedApi)
      return tt('依据当前进程的系统图形信息推荐，可手动切换；实际画面与 DLSS 效果仍需检查。')
    if (detection.value.current)
      return detection.value.current.state === 'observed'
        ? tt('依据本次游戏会话的运行记录；安装后仍需检查 DLSS 效果。')
        : tt('游戏日志已确认本次初始化的 API，实际画面与 DLSS 效果仍需检查。')
    if (detection.value.requested)
      return tt('依据启动参数或游戏配置推荐安装模式；实际渲染 API 尚未确认。')
    if (['history', 'last-detection'].includes(detection.value.installationPlan?.source)) return ''
    if (!detection.value.recommendedApi) {
      if (selected.value?.processState === 'running')
        return tt('已检测到所选程序正在运行，但尚未获得可靠的渲染 API 证据。进入游戏画面后可重新检测，也可手动选择。')
      if (selected.value?.processState === 'multiple')
        return tt('检测到所选程序有多个运行实例，暂无法确定当前渲染 API。请保留一个实例后重新检测，或手动选择。')
      if (selected.value?.processState === 'unavailable')
        return tt('暂时无法读取所选程序的运行状态，渲染 API 待确认。可重新检测，或手动选择。')
      if (selected.value?.processState === 'not-running')
        return tt('未检测到所选程序运行。请启动游戏并进入画面后再检测，也可手动选择渲染 API。')
      return detection.value.staticCandidates.length > 1
        ? tt('程序中发现多种可能的图形接口，尚未确认当前使用哪一种。可重新检测，或手动选择渲染 API。')
        : tt('尚未获得足够的渲染 API 识别依据。可重新检测，或手动选择渲染 API。')
    }
    return tt('依据程序文件推测 API；切换游戏渲染模式后请重新检测。')
  }
  return tt('请选择游戏程序后检测渲染 API。')
})
const routeOptions = computed(() =>
  available.value
    .filter((item) => item !== 'optiscaler')
    .map((value) => ({
      value,
      label: t(
        value === 'native' ? 'routeNative' : value === 'feeder' ? 'routeFeeder' : 'routeRenodx'
      )
    }))
)
const installAction = computed(() =>
  installationAction(
    { ...details.value, runtimeStatus: runtimeStatus.value },
    effective.value,
    route.value,
    build.value,
    consumerPlan.value,
    effectiveReShadeProxy(effective.value, route.value, reshadeProxy.value)
  )
)
const canInstall = computed(
  () =>
    !!selected.value &&
    !selected.value.installIssue &&
    !consumerPlan.value?.blocked &&
    available.value.includes(route.value) &&
    installAction.value.kind !== 'installed' &&
    !busy.value &&
    !details.value?.legacyActive
)
const notes = computed(() =>
  [
    t('apiOverrideHint'),
    t(route.value === 'optiscaler' ? 'optiHint' : 'backendHint'),
    route.value === 'native'
      ? t('nativeEffectsHint')
      : route.value === 'renodx'
        ? t('routeRenodxHint')
        : '',
    effective.value?.api === 'vulkan'
      ? t(route.value === 'optiscaler' ? 'optiVulkanHint' : 'apiVulkanHint')
      : '',
    selected.value?.installIssue ? t(selected.value.installIssue) : '',
    selected.value?.architecture && !['x64', 'x86'].includes(selected.value.architecture)
      ? tt("当前程序架构为 {0}，现有组件仅支持 x86 和 x64。", [selected.value.architecture])
      : '',
    effective.value?.renderApi === 'd3d12' && selected.value?.hasNativeDlss === false
      ? tt('尚未确认所选程序的原生 DLSS 能力，因此不推荐原生路线；可根据游戏条件选择 Feeder。')
      : '',
    selected.value?.antiCheatWarning ? t('antiCheatWarning') : '',
    selected.value?.emulator ? serviceText(selected.value.emulator.hint) : ''
  ].filter(Boolean)
)
function adopt(value) {
  details.value = value
  runtimeStatus.value = value.runtimeStatus
  exe.value = value.chosen?.path || ''
  launchProfile.value = selected.value?.launchProfile || 'auto'
  api.value = value.exes.find((item) => item.path === exe.value)?.apiOverride || 'auto'
  consumerChoice.value = selected.value?.consumerPreference || 'auto'
  reshadeProxy.value = selected.value?.reshadeProxy || 'dxgi'
  const wanted = selected.value?.profileRoute || value.installedRoute || value.recommendedRoute
  route.value = available.value.includes(wanted) ? wanted : available.value[0] || ''
  build.value =
    value.record.swapperOptions?.optiscalerVersion ||
    value.optiscaler?.version ||
    value.builds[0]?.value ||
    ''
}
async function analyze(action, input) {
  const requestId = input.requestId || crypto.randomUUID()
  pendingAnalysis = requestId
  try {
    return await swapperApi(action, { ...input, requestId })
  } finally {
    if (pendingAnalysis === requestId) pendingAnalysis = ''
  }
}
function cancelAnalysis() {
  if (detectionRun) {
    detectionRun.cancelled = true
    detectionRun.stop?.()
  }
  if (pendingAnalysis) swapperApi('cancelAnalysis', { requestId: pendingAnalysis }).catch(() => {})
  pendingAnalysis = ''
}
function askAutoDetect() {
  if (busy.value === 'detect') {
    const closing = liveDetection.value?.code === 'closing'
    cancelAnalysis()
    detectionResult.value = {
      code: 'cancelled',
      message: closing ? tm('已停止等待；已发送的关闭请求可能仍会生效。') : tm('检测已停止。')
    }
    liveDetection.value = detectionResult.value
    return
  }
  if (busy.value || !selected.value) return
  confirmationTarget = {
    id: record.value.id,
    exePath: selected.value.path,
    fingerprint: selected.value.fingerprint
  }
  detectConfirm.value = true
}
async function autoDetect() {
  const input = confirmationTarget
  confirmationTarget = null
  detectConfirm.value = false
  if (!input || input.id !== record.value?.id || input.exePath !== exe.value) return
  const token = generation
  detectionResult.value = null
  liveDetection.value = { code: 'scanning', message: tm('正在检查所选程序与游戏进程…') }
  const run = { requestId: crypto.randomUUID(), cancelled: false }
  detectionRun = run
  const current = () => !run.cancelled && token === generation && props.modelValue
  const update = (value) => {
    if (value.requestId !== run.requestId || value.kind !== 'detect') return
    liveDetection.value = value
    for (const observation of value.updates || []) {
      const target = details.value?.exes.find((item) => item.path === observation.path)
      if (target)
        Object.assign(target, {
          rendering: observation.rendering,
          processState: observation.processState
        })
    }
  }
  await task('detect', async () => {
    const watcher = watchProgress(
      () => swapperApi('progress', { id: input.id, requestId: run.requestId }),
      update,
      current
    )
    run.stop = watcher.stop
    try {
      const result = await analyze('autoDetect', {
        ...input,
        requestId: run.requestId,
        confirmed: true
      })
      if (!current()) return
      watcher.stop()
      update(result)
      detectionResult.value = result
      const fresh = await analyze('details', { id: input.id })
      if (!current()) return
      adopt(fresh)
      if (
        selected.value?.processState === 'not-running' &&
        ['detected', 'recommended'].includes(result.code)
      ) {
        detectionResult.value = {
          ...result,
          message: tm("{0} {1}，游戏已关闭，可继续安装。", [result.code === 'detected' ? tm('已确认') : tm('已推荐'), apiText(result.api)])
        }
      }
      emit('changed')
    } catch (error) {
      if (!run.cancelled) throw error
    } finally {
      watcher.stop()
      if (detectionRun === run) detectionRun = null
    }
  })
}
async function checkEffect() {
  const token = generation
  await task('check', async () => {
    const result = await analyze('checkRuntime', { id: record.value.id, exePath: exe.value })
    if (token === generation) runtimeStatus.value = result
  })
}
async function task(name, action) {
  if (busy.value) return { success: false, message: tt('已有操作正在执行，请稍后重试') }
  const token = generation
  busy.value = name
  error.value = ''
  try {
    await action()
    return { success: true }
  } catch (e) {
    if (generation === token && e.code !== 'analysis_cancelled')
      error.value = { code: e.code, message: e.message }
    return { success: false, message: e.code && t(e.code) !== e.code ? t(e.code) : e.message }
  } finally {
    if (generation === token) busy.value = ''
  }
}
async function load() {
  const token = ++generation
  stopProgress()
  installProgress.value = null
  cancelAnalysis()
  liveDetection.value = null
  detectConfirm.value = false
  confirmationTarget = null
  detectionResult.value = null
  // Refresh the same game in place; never carry another game's results into this scan.
  if (loadedTarget !== target.value) {
    loadedTarget = target.value
    notesOpen.value = false
    inspectorView.value = 'components'
    details.value = null
    savedIdentity.value = null
    runtimeStatus.value = null
    art.value = null
    restoreConfirm.value = false
  }
  error.value = ''
  busy.value = 'scan'
  if (props.bindingId && !identity.value.name) {
    swapperApi('state', { id: props.bindingId })
      .then((value) => {
        if (token === generation) savedIdentity.value = value
      })
      .catch(() => {})
  }
  try {
    const value = await analyze(
      'details',
      props.bindingId ? { id: props.bindingId } : props.context
    )
    if (token !== generation) return
    adopt(value)
    emit('changed')
    if (value.chosen)
      swapperApi('artwork', { id: value.record.id })
        .then((result) => {
          if (token === generation) {
            if (result) art.value = result
            emit('changed')
          }
        })
        .catch(() => {})
  } catch (e) {
    if (token === generation) error.value = { code: e.code, message: e.message }
  } finally {
    if (token === generation) busy.value = ''
  }
}
async function save() {
  const token = generation
  if (!available.value.includes(route.value)) route.value = available.value[0] || ''
  const result = await swapperApi('saveOptions', {
    id: record.value.id,
    exePath: exe.value,
    api: api.value,
    launchProfile: launchProfile.value,
    fingerprint: selected.value?.fingerprint,
    route: route.value,
    optiscalerVersion: build.value,
    consumerVersion: consumerChoice.value,
    reshadeProxy: effectiveReShadeProxy(effective.value, route.value, reshadeProxy.value)
  })
  if (token === generation) {
    adopt(result)
    emit('changed')
  }
}
async function changedOptions() {
  detectionResult.value = null
  await task('save', save)
}
async function changedExecutable() {
  detectionResult.value = null
  const previous = details.value
  const token = generation
  api.value = selected.value?.apiOverride || 'auto'
  consumerChoice.value = selected.value?.consumerPreference || 'auto'
  reshadeProxy.value = selected.value?.reshadeProxy || 'dxgi'
  launchProfile.value = selected.value?.launchProfile || 'auto'
  await task('save', async () => {
    try {
      await save()
    } catch (e) {
      if (token === generation) adopt(previous)
      throw e
    }
  })
}
async function changedProfile() {
  detectionResult.value = null
  const saved = selected.value?.profilePreferences?.[launchProfile.value]
  api.value = saved?.api || 'auto'
  consumerChoice.value = saved?.consumerVersion || 'auto'
  reshadeProxy.value = saved?.reshadeProxy || 'dxgi'
  route.value = saved?.route || available.value[0] || ''
  await task('save', save)
}
async function pick() {
  const token = generation
  await task('scan', async () => {
    const result = await dlssApi('pick', { kind: 'directory' })
    if (!result.canceled && token === generation) {
      const value = await analyze('details', { gameRoot: result.path })
      if (token === generation) adopt(value)
    }
  })
}
async function install() {
  if (!canInstall.value) return
  const token = generation,
    id = record.value.id
  await task('install', async () => {
    let installError
    try {
      await save()
      if (token !== generation) return
      await runMutation('install', id, token)
    } catch (error) {
      installError = error
    }
    try {
      const fresh = await swapperApi('details', { id })
      if (token === generation) {
        adopt(fresh)
        detectionResult.value = null
        liveDetection.value = null
      }
    } catch (error) {
      installError ||= error
    }
    emit('changed')
    if (installError) throw installError
  })
}
async function runMutation(kind, id, token) {
  stopProgress()
  const requestId = crypto.randomUUID()
  installProgress.value = {
    requestId,
    kind,
    name: 'DLSS5',
    phase: kind === 'restore' ? 'restoring' : 'preparing',
    cached: [],
    downloaded: [],
    warnings: []
  }
  let stopped = false
  const isCurrent = () => !stopped && token === generation && props.modelValue
  const watcher = watchProgress(
    () => swapperApi('progress', { id, requestId }),
    (progress) => {
      if (progress.requestId === requestId) installProgress.value = progress
    },
    isCurrent
  )
  stopProgress = () => {
    stopped = true
    watcher.stop()
  }
  try {
    const result = await swapperApi(kind, { id, requestId })
    if (isCurrent())
      installProgress.value = result.progress || {
        ...installProgress.value,
        phase: result.cancelled ? 'cancelled' : 'complete'
      }
    return result
  } catch (error) {
    await watcher.refresh()
    if (isCurrent()) installProgress.value = { ...installProgress.value, phase: 'failed' }
    throw error
  } finally {
    stopped = true
    watcher.stop()
  }
}
async function useCompatibleConsumer() {
  consumerChoice.value = '4.60'
  await changedOptions()
}
async function restore() {
  const token = generation,
    id = record.value.id
  return task('restore', async () => {
    await runMutation('restore', id, token)
    const fresh = await swapperApi('details', { id })
    if (token === generation) {
      adopt(fresh)
      detectionResult.value = null
      liveDetection.value = null
    }
    emit('changed')
  })
}
watch(
  () => [selected.value?.antiCheatWarning, selected.value?.installIssue],
  ([antiCheat, issue]) => {
    if (antiCheat || issue) notesOpen.value = true
  }
)
watch(
  () => [props.modelValue, props.bindingId, props.context.gameRoot, props.context.exePath],
  ([open]) => {
    if (open) load()
    else {
      generation++
      stopProgress()
      cancelAnalysis()
      detectConfirm.value = false
      confirmationTarget = null
    }
  },
  { immediate: true }
)
function invalidateAnalysis() {
  generation++
  stopProgress()
  cancelAnalysis()
  detectConfirm.value = false
  confirmationTarget = null
}
onBeforeUnmount(invalidateAnalysis)
onDeactivated(() => {
  invalidateAnalysis()
  emit('update:modelValue', false)
})
</script>

<template>
  <VxModal
    :model-value="modelValue"
    :title="tt('DLSS5 安装 | ') + gameName"
    :aria-label="gameName + ' · DLSS5'"
    :width="1240"
    panel-class="dlss-swapper-dialog"
    :show-close="!['install', 'restore'].includes(busy)"
    :close-on-esc="!['install', 'restore'].includes(busy)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="swapper-sheet" :aria-busy="!!busy">
      <div class="status-strip" role="status">
        <span
          ><InfoCircleFilled aria-hidden="true" />
          {{
            busy === 'scan' ? tt('正在读取安装配置…') : serviceText(runtimeStatus?.title) || tt('本次运行待检测')
          }}</span
        >
        <span>{{ tt("安装目标 API：") }}{{ serviceText(effective?.apiLabel) || tt('待选择') }}</span>
      </div>
      <div class="sheet-body">
        <section class="configuration vx-ui-scrollbar" :aria-label="tt('安装配置')">
          <div v-if="busy === 'scan'" class="scan-status" role="status">
            <span class="scan-spinner" aria-hidden="true"></span>
            <div>
              <strong>{{ details ? tt('正在刷新安装配置…') : tt('正在读取安装配置…') }}</strong>
              <p>
                {{
                  details ? tt('已保留当前配置，请稍候。') : tt('正在识别可执行文件、渲染 API 和组件状态。')
                }}
              </p>
            </div>
          </div>
          <p v-if="error" class="error" role="alert">{{ errorText(error) }}</p>
          <VxButton
            v-if="!details && !busy"
            @click="hasTarget || !allowDirectorySelection ? load() : pick()"
          >
            {{ hasTarget || !allowDirectorySelection ? tt('重新扫描') : tt('选择游戏文件夹') }}
          </VxButton>
          <div v-if="!details && busy === 'scan'" class="configuration-skeleton" aria-hidden="true">
            <div v-for="label in ['可执行文件', '渲染 API']" :key="label" class="skeleton-field">
              <span>{{ label }}</span>
              <div class="skeleton skeleton-control"></div>
            </div>
            <div class="route-fields">
              <div v-for="label in ['渲染后端', '安装方式']" :key="label" class="skeleton-field">
                <span>{{ label }}</span>
                <div class="skeleton skeleton-control"></div>
              </div>
            </div>
            <div class="skeleton skeleton-notes"></div>
            <h4 class="section-title">{{ tt("文件明细") }}</h4>
            <div v-for="row in 3" :key="row" class="skeleton-row">
              <span class="skeleton skeleton-line"></span
              ><span class="skeleton skeleton-value"></span>
            </div>
          </div>
          <template v-if="details">
            <VxSelect
              v-if="details.exes.length"
              v-model="exe"
              class="exe-picker"
              :label="t('fExe')"
              :options="exeOptions"
              :title="selected?.rel"
              :disabled="!!busy || !!details.legacyActive"
              @change="changedExecutable"
            />
            <template v-if="selected">
              <VxSelect
                v-if="
                  profileOptions.length > 2 ||
                  detection?.lastObserved ||
                  detection?.logHint ||
                  launchProfile !== 'auto'
                "
                v-model="launchProfile"
                class="profile-field"
                :label="tt('启动模式（计划）')"
                :options="profileOptions"
                :disabled="!!busy"
                @change="changedProfile"
              />
              <div class="api-row">
                <VxSelect
                  v-model="api"
                  class="api-field"
                  :label="t('fApi')"
                  :options="apiOptions"
                  :disabled="!!busy"
                  @change="changedOptions"
                />
                <VxButton
                  class="detect-action"
                  variant="secondary"
                  size="lg"
                  :disabled="(!!busy && busy !== 'detect') || !selected"
                  @click="askAutoDetect"
                  >{{ busy === 'detect' ? tt('停止检测') : tt('自动检测') }}</VxButton
                >
              </div>
              <div class="api-evidence">
                <p
                  v-if="busy === 'detect' || detectionResult"
                  class="detection-status"
                  role="status"
                >
                  {{
                    busy === 'detect'
                      ? serviceText(liveDetection?.message) || tt('正在检查游戏运行状态…')
                      : serviceText(detectionResult.message)
                  }}
                </p>
                <p v-if="detectionHint" class="detection-hint">{{ detectionHint }}</p>
                <p v-if="detection?.lastObserved" class="last-observed">
                  {{ tt("历史记录：") }}{{ apiText(detection.lastObserved.api) }} ·
                  {{ new Date(detection.lastObserved.observedAt).toLocaleString() }}
                </p>
                <p v-if="detection?.lastDetection" class="last-observed">
                  {{ tt("上次检测：") }}{{ apiText(detection.lastDetection.api) }}（{{
                    detection.lastDetection.confidence === 'recommended'
                      ? tt('推荐模式，实际 API 未确认')
                      : tt('会话已确认')
                  }}） ·
                  {{ new Date(detection.lastDetection.observedAt).toLocaleString() }}
                </p>
                <p v-if="detection?.logHint" class="last-observed">
                  {{ tt("游戏日志线索：") }}{{
                    apiText(detection.logHint.api)
                  }}{{ tt("（启动时间未记录，当前运行待确认）") }}
                </p>
                <p
                  v-for="limitation in detectionLimitations"
                  :key="limitation"
                  class="last-observed"
                >
                  {{ limitation }}
                </p>
                <details
                  v-if="detection?.evidence.length || detection?.staticCandidates.length"
                  class="evidence-details"
                >
                  <summary>{{ tt("查看识别依据") }}</summary>
                  <ul>
                    <li v-if="detection.staticCandidates.length">
                      {{ tt("文件中的图形接口：") }}{{
                        detection.staticCandidates.map(renderingApi.label).join('、')
                      }}{{ tt("（不代表当前使用）") }}
                    </li>
                    <li v-for="(item, index) in detection.evidence" :key="index">
                      {{ apiText(item.api) }} ·
                      {{
                        item.source === 'engine-config'
                          ? tt('游戏配置')
                          : item.source === 'process-arguments'
                            ? tt('本次启动参数')
                            : item.source === 'gpu-client'
                              ? tt('本次系统图形信息（推荐依据）')
                              : item.scope === 'historical'
                                ? tt('历史运行日志')
                                : tt('本次运行日志')
                      }}<span v-if="item.file"> · {{ item.file }}</span>
                    </li>
                  </ul>
                </details>
              </div>
              <div class="route-fields">
                <VxSelect
                  v-model="backend"
                  :label="t('fBackend')"
                  :options="[
                    { value: 'reshade', label: t('backendReShade') },
                    {
                      value: 'optiscaler',
                      label: 'OptiScaler DLSS-NR',
                      disabled: !available.includes('optiscaler')
                    }
                  ]"
                  :disabled="!!busy"
                  @change="changedOptions"
                />
                <VxSelect
                  v-if="backend === 'reshade'"
                  v-model="route"
                  :label="t('fRoute')"
                  :title="routeOptions.find((item) => item.value === route)?.label"
                  :options="routeOptions"
                  :disabled="!!busy"
                  @change="changedOptions"
                />
                <VxSelect
                  v-else
                  v-model="build"
                  :label="tt('OptiScaler 版本')"
                  :options="details.builds"
                  :disabled="!!busy"
                  @change="changedOptions"
                />
              </div>
              <div
                v-if="route === 'native'"
                class="native-dlss-guidance"
                role="status"
                aria-live="polite"
              >
                <strong>{{ t('nativeDlssRequiredTitle') }}</strong>
                <p>{{ t('nativeDlssRequiredBody') }}</p>
                <p>{{ t('nativeDlssNextSteps') }}</p>
              </div>
              <div v-if="canChooseReShadeProxy(effective, route)" class="consumer-settings">
                <VxSelect
                  v-model="reshadeProxy"
                  :label="tt('ReShade 加载文件')"
                  :disabled="!!busy"
                  :options="[
                    { value: 'dxgi', label: tt('dxgi.dll（默认）') },
                    { value: 'd3d11', label: tt('d3d11.dll（兼容模式）') }
                  ]"
                  @change="changedOptions"
                />
                <p class="detection-hint">{{ tt("游戏中未出现 ReShade 时，可尝试兼容模式。") }}</p>
              </div>
              <div v-if="consumerPlan" class="consumer-settings">
                <VxSelect
                  v-model="consumerChoice"
                  class="consumer-version"
                  :label="tt('神经渲染插件版本')"
                  :options="consumerOptions"
                  :disabled="!!busy"
                  @change="changedOptions"
                />
                <p v-if="consumerPlan.warning" class="consumer-warning">
                  {{ tt("此版本在部分 OpenGL 游戏中出现过输出回退，推荐 4.60 兼容方案；仍可按你的选择安装。") }}
                </p>
                <p v-if="consumerPlan.blocked" class="error">
                  {{ tt("当前插件版本未识别。请选择要安装的版本后再继续。") }}
                </p>
              </div>
              <details
                class="sheet-notes"
                :class="{ warning: selected.antiCheatWarning || selected.installIssue }"
                :open="notesOpen"
                @toggle="notesOpen = $event.target.open"
              >
                <summary>
                  {{ selected.antiCheatWarning ? tt('安装前请阅读') : tt('安装须知')
                  }}<span>{{ notes.length }}</span>
                </summary>
                <p v-for="note in notes" :key="note">{{ note }}</p>
              </details>
            </template>
            <p v-else :class="details.exes.length ? 'selection-hint' : 'error'">
              {{
                details.exes.length
                  ? tt('发现多个入口，请先选择实际游戏程序。')
                  : emptyExeMessage
              }}<VxButton variant="ghost" @click="allowDirectorySelection ? pick() : load()">
                {{ allowDirectorySelection ? tt('选择其他文件夹') : tt('重新扫描') }}
              </VxButton>
            </p>
            <p v-if="details.legacyActive" class="error">
              {{ tt("请先还原旧版 Vertex 安装，再使用此安装流程。原备份和恢复记录仍然保留。") }}
            </p>

            <details class="files-section">
              <summary>
                {{ tt("文件明细") }}<span>{{ details.files.length }}</span>
              </summary>
              <div
                v-if="details.files.length"
                class="filelist vx-ui-scrollbar"
                role="table"
                :aria-label="tt('DLSS 与 Streamline 文件')"
              >
                <div class="filelist-heading" role="row">
                  <span role="columnheader">{{ tt("文件路径") }}</span><span role="columnheader">{{ tt("版本") }}</span>
                </div>
                <div v-for="file in details.files" :key="file.rel" role="row">
                  <span role="cell" :title="file.rel">{{ file.rel }}</span
                  ><span role="cell">{{ file.version || '—' }}</span>
                </div>
              </div>
              <p v-else class="empty-files">{{ tt("尚未发现 DLSS 或 Streamline 文件。") }}</p>
            </details>
          </template>
        </section>
        <aside class="inspector vx-ui-scrollbar" :aria-label="tt('组件信息与生效状态')">
          <div class="inspector-tabs" role="group" :aria-label="tt('详情视图')">
            <VxButton
              variant="ghost"
              :aria-pressed="inspectorView === 'components'"
              @click="inspectorView = 'components'"
              >{{ tt("组件信息") }}</VxButton
            >
            <VxButton
              variant="ghost"
              :aria-pressed="inspectorView === 'runtime'"
              @click="inspectorView = 'runtime'"
              >{{ tt("生效状态") }}</VxButton
            >
          </div>
          <template v-if="!details">
            <section
              v-show="inspectorView === 'components'"
              class="component-info"
              :aria-label="tt('组件信息')"
            >
              <div v-if="busy === 'scan'" class="inspector-skeleton" aria-hidden="true">
                <div
                  v-for="label in [
                    '架构',
                    '检测 API',
                    '已安装的后端',
                    'DLSS',
                    'DLSS 5 插件',
                    'ReShade'
                  ]"
                  :key="label"
                  class="skeleton-row"
                >
                  <span>{{ label }}</span
                  ><span class="skeleton skeleton-value"></span>
                </div>
              </div>
            </section>
            <section
              v-show="inspectorView === 'runtime'"
              class="runtime-check"
              :aria-label="tt('生效状态')"
            >
              <p class="loading-hint">
                {{
                  busy === 'scan' ? tt('读取完成后显示检查结果。') : tt('配置读取完成后可查看生效状态。')
                }}
              </p>
              <div v-if="busy === 'scan'" class="inspector-skeleton" aria-hidden="true">
                <div v-for="row in 4" :key="row" class="skeleton-row">
                  <span class="skeleton skeleton-line"></span
                  ><span class="skeleton skeleton-value"></span>
                </div>
                <div class="skeleton skeleton-control"></div>
              </div>
            </section>
          </template>
          <template v-else>
            <section
              v-show="inspectorView === 'components'"
              class="component-info"
              :aria-label="tt('组件信息')"
            >
              <dl class="specs">
                <div v-if="consumerPlan || details.installedConsumer">
                  <dt>{{ tt("RenoDX 插件") }}</dt>
                  <dd>
                    {{ details.installedConsumer?.version || tt('未安装/未知')
                    }}<template
                      v-if="
                        consumerPlan && consumerPlan.version !== details.installedConsumer?.version
                      "
                    >
                      → {{ consumerPlan.version }}</template
                    >
                  </dd>
                </div>
                <div>
                  <dt>{{ t('fArchitecture') }}</dt>
                  <dd>{{ selected?.bitness || '—' }}-bit</dd>
                </div>
                <div>
                  <dt>{{ tt("检测 API") }}</dt>
                  <dd class="on">{{ currentApiText }}</dd>
                </div>
                <div>
                  <dt>{{ tt("安装目标 API") }}</dt>
                  <dd>{{ serviceText(effective?.apiLabel) || tt('待选择') }}</dd>
                </div>
                <div>
                  <dt>{{ t('installedBackend') }}</dt>
                  <dd :class="{ on: details.installedRoute }">
                    {{
                      details.installedRoute === 'optiscaler'
                        ? 'OptiScaler DLSS-NR'
                        : details.installedRoute
                          ? 'ReShade'
                          : t('none')
                    }}
                  </dd>
                </div>
                <div>
                  <dt>DLSS</dt>
                  <dd>
                    <span>{{ details.currentDlss?.version || t('none') }}</span
                    ><template
                      v-if="
                        route !== 'optiscaler' && details.currentDlss?.version !== details.newDlss
                      "
                      ><span class="arrow">→</span
                      ><span class="on">{{ details.newDlss }}</span></template
                    >
                  </dd>
                </div>
                <div v-if="details.optiscaler">
                  <dt>OptiScaler</dt>
                  <dd>{{ details.optiscaler.version }}</dd>
                </div>
                <div>
                  <dt>{{ t('fAddon') }}</dt>
                  <dd :class="{ on: details.addon }">
                    {{ t(details.addon ? 'installed' : 'notPresent') }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('fReShade') }}</dt>
                  <dd :class="{ on: details.reshade.installed }">
                    {{
                      details.reshade.installed
                        ? details.reshade.version + (details.reshade.addonSupport ? tt(' + 插件') : '')
                        : t('notInstalled')
                    }}
                  </dd>
                </div>
              </dl>
              <details v-if="details.installedComponents?.consumer" class="component-provenance">
                <summary>{{ tt("版本与来源记录") }}</summary>
                <p>{{ tt("已安装 RenoDX") }} {{ details.installedComponents.consumer.version }} {{ tt("· RHI 发布源") }}</p>
                <p class="component-hash">
                  SHA-256：{{ details.installedComponents.consumer.sha256 }}
                </p>
                <p v-for="item in details.installedComponents.dependencies || []" :key="item.id">
                  {{ item.id === 'nr-legacy' ? tt('DLSS NR（保留已验证的 Swapper 构建）') : item.id }} ·
                  {{ item.version }}
                </p>
              </details>
            </section>
            <section
              v-if="runtimeStatus && selected"
              v-show="inspectorView === 'runtime'"
              class="runtime-check"
              :aria-label="tt('生效状态')"
              aria-live="polite"
            >
              <p v-if="details.installedRoute === 'native'" class="native-next-steps">
                {{ t('nativeDlssNextSteps') }}
              </p>
              <div class="runtime-summary">
                <component
                  :is="runtimeStatus.code === 'evaluating' ? CheckCircleFilled : InfoCircleFilled"
                  class="runtime-icon"
                  aria-hidden="true"
                />
                <div>
                  <strong>{{ serviceText(runtimeStatus.title) }}</strong>
                  <p>{{ serviceText(runtimeStatus.message) }}</p>
                </div>
              </div>
              <ol class="runtime-stages" :aria-label="tt('生效检查阶段')">
                <li
                  v-for="stage in runtimeStatus.stages"
                  :key="stage.label"
                  :class="{ verified: stage.state === 'verified' }"
                >
                  <component
                    :is="
                      stage.state === 'verified'
                        ? CheckCircleFilled
                        : stage.state === 'recorded'
                          ? InfoCircleFilled
                          : ClockCircleOutlined
                    "
                    aria-hidden="true"
                  />
                  <span>{{ serviceText(stage.label) }}</span>
                  <span class="stage-state">{{
                    stage.state === 'verified'
                      ? tt('已确认')
                      : stage.state === 'recorded'
                        ? tt('已记录')
                        : tt('待确认')
                  }}</span>
                </li>
              </ol>
              <p v-if="details.lastRuntimeCheck" class="loading-hint">
                {{ tt("上次检查：") }}{{ serviceText(details.lastRuntimeCheck.title) }}{{ tt("。此记录不代表本次运行状态。") }}
              </p>
              <VxButton
                v-if="
                  effective?.api === 'opengl' &&
                  route === 'feeder' &&
                  consumerPlan?.version !== '4.60' &&
                  (runtimeStatus.code === 'resource_pool_exhausted' ||
                    details.lastRuntimeCheck?.code === 'resource_pool_exhausted')
                "
                class="check-action"
                variant="secondary"
                block
                :disabled="!!busy"
                @click="useCompatibleConsumer"
                >{{ tt("选择 4.60 兼容方案") }}</VxButton
              >
              <VxButton
                class="check-action"
                variant="secondary"
                block
                :disabled="!!busy"
                :loading="busy === 'check'"
                @click="checkEffect"
              >
                {{ busy === 'check' ? tt('正在检查…') : tt('检查生效') }}
              </VxButton>
            </section>
            <p
              v-if="inspectorView === 'runtime' && !(runtimeStatus && selected)"
              class="loading-hint"
            >
              {{ tt("请选择游戏程序后查看生效状态。") }}
            </p>
          </template>
        </aside>
      </div>
    </div>
    <template #footer>
      <DlssInstallProgress v-if="installProgress" :progress="installProgress" />
      <div class="actions">
        <VxButton
          class="restore-action"
          variant="danger"
          size="lg"
          :disabled="!details?.hasBackup || !!busy"
          :loading="busy === 'restore'"
          @click="restoreConfirm = true"
          >{{ t('restore') }}</VxButton
        >
        <VxButton
          class="install-action"
          size="lg"
          :disabled="!canInstall"
          :loading="busy === 'install'"
          @click="install"
          >{{
            busy === 'install'
              ? tt('正在处理…')
              : !details && busy === 'scan'
                ? tt('正在读取…')
                : installAction.label
          }}</VxButton
        >
      </div>
    </template>
  </VxModal>
  <VxConfirmModal
    v-model="detectConfirm"
    :title="tt('自动检测渲染 API')"
    :description="tt('将尝试启动所选程序（Steam 游戏通过 Steam 启动）。检测完成后关闭对应游戏，请先保存进度。若未打开，请按平时的方式手动启动游戏。')"
    :confirm-text="tt('开始检测')"
    @confirm="autoDetect"
    @cancel="confirmationTarget = null"
  />
  <VxConfirmModal
    v-model="restoreConfirm"
    :title="t('restore')"
    :description="tt('将使用安装记录恢复原文件。请先退出游戏。')"
    :confirm-text="tt('还原原文件')"
    danger
    :confirm-action="restore"
  />
</template>

<style scoped lang="scss">
:global(.dlss-swapper-dialog) {
  font-family: var(--font-family-base);
  padding: 0;
  gap: 0;
  height: min(620px, calc(100dvh - 48px));
  max-height: calc(100dvh - 48px);
  max-width: calc(100vw - 48px);
  overflow: hidden;
  border-radius: var(--radius-lg);
}
:global(.dlss-swapper-dialog .base-dialog-header) {
  flex: none;
  padding: var(--space-3) var(--space-6) var(--space-1);
}
:global(.dlss-swapper-dialog .base-dialog-body) {
  --vx-dialog-scroll-offset: 0px;

  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  scrollbar-gutter: auto;
}
:global(.dlss-swapper-dialog .base-dialog-footer) {
  margin: 0;
  padding: var(--space-4) var(--space-6);
}
.swapper-sheet {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-md);
}
:global(.dlss-swapper-dialog .base-dialog-heading) {
  min-width: 0;
}
:global(.dlss-swapper-dialog .base-dialog-heading h3) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-lg);
}
.status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  flex: none;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-6);
  background: var(--color-accent-soft);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  border-block: 1px solid var(--color-border);
}
.status-strip .anticon {
  margin-right: var(--space-2);
  color: var(--color-accent);
}
.inspector-tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-3);
}
.inspector-tabs :deep(button) {
  min-height: var(--control-height-lg);
  border-radius: 0;
  border-bottom: 2px solid transparent;
}
.inspector-tabs :deep(button[aria-pressed='true']) {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}
.sheet-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 32%);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.configuration,
.inspector {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-4) var(--space-6);
}
.inspector {
  background: color-mix(in srgb, var(--color-accent-soft) 22%, var(--color-surface));
  border-left: 1px solid var(--color-border);
}
.section-title {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}
.exe-picker,
.profile-field,
.api-field {
  margin-bottom: var(--space-3);
}
:deep(.vx-select-field) {
  min-width: 0;
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  align-items: center;
  column-gap: var(--space-3);
}
:deep(.vx-select-field__label) {
  margin: 0;
}
.api-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.api-row .api-field {
  flex: 1;
  margin: 0;
}
.detect-action {
  flex: none;
}
.route-fields :deep(.vx-select-field:last-child) {
  grid-template-columns: 72px minmax(0, 1fr);
}
.api-evidence {
  padding-left: calc(112px + var(--space-3));
}
:deep(.vx-select) {
  min-width: 0;
  max-width: 100%;
  background: var(--color-surface-soft);
  min-height: var(--control-height-lg);
  border-radius: var(--radius-md);
}
:deep(.vx-select > span:first-child) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.api-evidence {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}
.api-evidence p {
  margin: 0;
}
.selection-hint,
.native-next-steps {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  margin: 0 0 var(--space-3);
}
.native-dlss-guidance {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--color-accent);
  background: var(--color-surface-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}
.native-dlss-guidance strong {
  color: var(--color-text);
}
.native-dlss-guidance p {
  margin: var(--space-2) 0 0;
}
.evidence-details {
  margin: var(--space-2) 0;
  overflow-wrap: anywhere;
}
.evidence-details summary {
  cursor: pointer;
  color: var(--color-text-secondary);
}
.evidence-details summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.evidence-details ul {
  padding-left: var(--space-5);
}
.api-evidence .last-observed {
  margin-top: var(--space-2);
}
.route-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.consumer-settings {
  margin-bottom: var(--space-4);
}
.consumer-settings :deep(.vx-select-field) {
  margin-bottom: var(--space-2);
}
.consumer-warning {
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-warning);
  background: var(--color-warning-soft);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}
.component-provenance {
  margin-top: var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}
.component-provenance summary {
  cursor: pointer;
}
.component-hash {
  overflow-wrap: anywhere;
}
.runtime-check .check-action + .check-action {
  margin-top: var(--space-2);
}
.sheet-notes,
.files-section {
  border-top: 1px solid var(--color-border);
  padding: var(--space-2) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}
.files-section summary {
  cursor: pointer;
  font-weight: var(--font-weight-semibold);
}
.files-section summary span {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
}
.files-section[open] summary {
  margin-bottom: var(--space-3);
}
.files-section summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}
.sheet-notes summary {
  cursor: pointer;
  font-weight: var(--font-weight-semibold);
}
.sheet-notes summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
  border-radius: var(--radius-xs);
}
.sheet-notes summary span {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-weight: var(--font-weight-regular);
}
.sheet-notes p {
  margin: var(--space-2) 0 0;
}
.sheet-notes.warning {
  background: var(--color-warning-soft);
  border-color: var(--color-warning);
  padding: var(--space-3);
}
.files-section .section-title {
  margin-bottom: var(--space-3);
}
.filelist {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}
.filelist > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px;
  border-bottom: 1px solid var(--color-border);
}
.filelist > div:last-child {
  border-bottom: 0;
}
.filelist span {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  line-height: var(--line-height-base);
}
.filelist [role='cell']:first-child {
  font-family: var(--font-family-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filelist span:last-child {
  border-left: 1px solid var(--color-border);
  white-space: nowrap;
}
.filelist-heading {
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}
.empty-files {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.runtime-summary {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}
.runtime-icon {
  color: var(--color-accent);
  font-size: 32px;
  flex: none;
  margin-top: var(--space-1);
}
.runtime-summary strong {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}
.runtime-summary p {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
  color: var(--color-text-muted);
}
.runtime-stages {
  list-style: none;
  margin: var(--space-4) 0;
  padding: 0;
}
.runtime-stages li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-height-lg);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
}
.runtime-stages li:last-child {
  border-bottom: 0;
}
.runtime-stages .anticon {
  font-size: var(--font-size-xl);
  color: var(--color-text-muted);
}
.stage-state {
  margin-left: auto;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.runtime-stages .verified .anticon,
.runtime-stages .verified .stage-state {
  color: var(--color-accent-active);
}
.check-action:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent-active);
  background: transparent;
}
.check-action:not(:disabled):hover {
  background: var(--color-accent-soft);
}
.component-info .section-title {
  margin-bottom: var(--space-2);
}
.specs {
  margin: 0;
  font-size: var(--font-size-sm);
}
.specs > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
}
.specs > div:last-child {
  border-bottom: 0;
}
.specs dt {
  flex: none;
  color: var(--color-text-muted);
}
.specs dd {
  margin: 0;
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.specs .arrow {
  margin: 0 var(--space-1);
  color: var(--color-text-muted);
}
.actions {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
}
.install-action {
  min-width: 180px;
}
.restore-action {
  min-width: 144px;
}
.restore-action:not(:disabled) {
  background: transparent;
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.restore-action:not(:disabled):hover {
  background: var(--color-danger-soft);
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.actions button:disabled {
  color: var(--color-text-muted);
}
.scan-status {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  padding: var(--space-3) var(--space-4);
  background: var(--color-accent-soft);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
}
.scan-status strong {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
}
.scan-status p,
.loading-hint {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}
.scan-spinner {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: var(--space-1);
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: scan-spin 1s linear infinite;
}
@keyframes scan-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .scan-spinner {
    animation: none;
  }
}
.skeleton {
  display: block;
  background: var(--color-surface-strong);
  border-radius: var(--radius-sm);
}
.skeleton-field {
  margin-bottom: var(--space-4);
  min-width: 0;
}
.skeleton-field > span {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
.skeleton-control {
  height: var(--control-height-lg);
}
.skeleton-notes {
  height: 76px;
  margin-bottom: var(--space-5);
}
.skeleton-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: var(--control-height-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.skeleton-line {
  width: 54%;
  height: 12px;
}
.skeleton-value {
  width: 64px;
  height: 12px;
}
.inspector-skeleton {
  margin-top: var(--space-3);
}
.error {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  line-height: var(--line-height-base);
}
.configuration::-webkit-scrollbar,
.inspector::-webkit-scrollbar,
.filelist::-webkit-scrollbar,
.swapper-sheet::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}
.configuration::-webkit-scrollbar-track,
.inspector::-webkit-scrollbar-track,
.filelist::-webkit-scrollbar-track,
.swapper-sheet::-webkit-scrollbar-track {
  background: var(--scrollbar-track-color);
}
.configuration::-webkit-scrollbar-thumb,
.inspector::-webkit-scrollbar-thumb,
.filelist::-webkit-scrollbar-thumb,
.swapper-sheet::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb-color);
  border-radius: var(--radius-xs);
  min-height: 40px;
}
.configuration::-webkit-scrollbar-thumb:hover,
.inspector::-webkit-scrollbar-thumb:hover,
.filelist::-webkit-scrollbar-thumb:hover,
.swapper-sheet::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
@media (max-width: 1100px) {
  .sheet-body {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
  .configuration,
  .inspector {
    padding: var(--space-4);
  }
  :deep(.vx-select-field) {
    grid-template-columns: 112px minmax(0, 1fr);
  }
  .api-evidence {
    padding-left: calc(112px + var(--space-3));
  }
}
@media (max-width: 860px) {
  :global(.dlss-swapper-dialog) {
    max-width: calc(100vw - 24px);
    height: calc(100dvh - 24px);
    max-height: calc(100dvh - 24px);
  }
  .swapper-sheet {
    overflow-y: auto;
  }
  .sheet-body {
    display: block;
    overflow: visible;
    flex: none;
  }
  .configuration,
  .inspector {
    overflow: visible;
  }
  .inspector {
    border-left: 0;
    border-top: 1px solid var(--color-border);
  }
}
@media (max-width: 600px) {
  :deep(.vx-select-field) {
    grid-template-columns: minmax(0, 1fr);
  }
  .api-row {
    align-items: flex-end;
  }
  .api-evidence {
    padding-left: 0;
  }
  .route-fields :deep(.vx-select-field),
  .route-fields :deep(.vx-select-field:last-child) {
    grid-template-columns: minmax(0, 1fr);
  }
  .route-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .install-action,
  .restore-action {
    min-width: 0;
    flex: 1;
  }
}
</style>
