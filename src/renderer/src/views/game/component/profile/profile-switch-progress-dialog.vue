<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import VxButton from '@renderer/component/vertex-ui/VxButton.vue'
import VxProgress from '@renderer/component/vertex-ui/VxProgress.vue'
import ToolIcon from '@renderer/component/tool-page/ToolIcon.vue'

// 切换配置方案时的进度弹窗；Nexus / Mod.io / Ficsit / VaM-Hub 共用。
// progress 由页面根据 sourceProfile:switchProgress 事件更新。
const props = defineProps({
  progress: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['close'])

const { t, locale } = useI18n()

const disableTotal = ref(0)
const enableTotal = ref(0)
const totalSteps = ref(0)

const open = computed(() => !!props.progress?.open)
const stage = computed(() => String(props.progress?.stage || 'start'))
const isDone = computed(() => stage.value === 'done')
const current = computed(() => Number(props.progress?.current || 0))
const stageTotal = computed(() => Number(props.progress?.total || 0))
const targetName = computed(() => String(props.progress?.targetProfile || '').trim())
const fromName = computed(() => String(props.progress?.fromProfile || '').trim())

// 每个阶段的总数只在阶段进行中出现，切到下一阶段后保留下来用于步骤列表。
watch(
  () => [open.value, stage.value, stageTotal.value],
  ([isOpen, nextStage, total], previous = []) => {
    if (isOpen && !previous[0]) {
      disableTotal.value = 0
      enableTotal.value = 0
      totalSteps.value = 0
    }
    if (nextStage === 'start' && total > 0) totalSteps.value = total
    if (nextStage === 'disabling') disableTotal.value = total
    if (nextStage === 'enabling') enableTotal.value = total
  },
  { immediate: true }
)

const disabledCount = computed(() =>
  isDone.value ? Number(props.progress?.disabledCount || 0) : disableTotal.value
)
const enabledCount = computed(() =>
  isDone.value ? Number(props.progress?.enabledCount || 0) : enableTotal.value
)

const percent = computed(() => {
  if (isDone.value) return 100
  const finishedBefore = stage.value === 'enabling' ? disableTotal.value : 0
  const all =
    totalSteps.value ||
    (stage.value === 'enabling' ? disableTotal.value + stageTotal.value : stageTotal.value)
  if (all <= 0) return 0
  return Math.max(0, Math.min(99, Math.round(((finishedBefore + current.value) / all) * 100)))
})

function formatCount(value) {
  return Number(value || 0).toLocaleString(
    String(locale.value).startsWith('zh') ? 'zh-CN' : 'en-US'
  )
}

const steps = computed(() => {
  const disableState =
    stage.value === 'disabling' ? 'active' : stage.value === 'start' ? 'wait' : 'done'
  const enableState = isDone.value ? 'done' : stage.value === 'enabling' ? 'active' : 'wait'
  const countText = (state, total) => {
    if (state === 'active' && total > 0) {
      return `${formatCount(current.value)} / ${formatCount(total)}`
    }
    if (state === 'done') return t('dialogs.profileSwitch.count', { count: formatCount(total) })
    return ''
  }
  return [
    {
      key: 'disable',
      state: disableState,
      label: t('dialogs.profileSwitch.stepDisable'),
      count: countText(disableState, disabledCount.value)
    },
    {
      key: 'enable',
      state: enableState,
      label: targetName.value
        ? t('dialogs.profileSwitch.stepEnable', { name: targetName.value })
        : t('dialogs.profileSwitch.stepEnableFallback'),
      count: countText(enableState, enabledCount.value)
    }
  ]
})

const title = computed(() => {
  if (!isDone.value) return t('dialogs.profileSwitch.title')
  return targetName.value
    ? t('dialogs.profileSwitch.doneTitle', { name: targetName.value })
    : t('dialogs.profileSwitch.doneTitleFallback')
})

const subtitle = computed(() =>
  fromName.value && targetName.value ? `${fromName.value} → ${targetName.value}` : ''
)

const statusText = computed(() => {
  if (isDone.value) {
    return t('dialogs.profileSwitch.doneStatus', {
      disabled: formatCount(disabledCount.value),
      enabled: formatCount(enabledCount.value)
    })
  }
  const modName = String(props.progress?.modName || '').trim()
  if (modName && stage.value !== 'start') return modName
  return t('dialogs.profileSwitch.preparing')
})

const statusIsModName = computed(
  () => !isDone.value && stage.value !== 'start' && !!String(props.progress?.modName || '').trim()
)

function handleClose() {
  if (!isDone.value) return
  emit('close')
}
</script>

<template>
  <VxModal
    :model-value="open"
    :title="title"
    :subtitle="subtitle"
    :width="400"
    :show-close="isDone"
    :close-on-esc="isDone"
    :close-on-overlay="false"
    @update:model-value="(value) => !value && handleClose()"
  >
    <div class="profile-switch">
      <ol class="profile-switch__steps">
        <li
          v-for="step in steps"
          :key="step.key"
          class="profile-switch__step"
          :class="`is-${step.state}`"
        >
          <span class="profile-switch__dot" aria-hidden="true">
            <ToolIcon v-if="step.state === 'done'" name="check" :size="12" />
          </span>
          <span class="profile-switch__label">{{ step.label }}</span>
          <span class="profile-switch__count">{{ step.count }}</span>
        </li>
      </ol>

      <div class="profile-switch__progress">
        <VxProgress
          :value="percent"
          :tone="isDone ? 'success' : 'primary'"
          :aria-label="t('dialogs.profileSwitch.progressLabel')"
        />
        <p class="profile-switch__status" role="status">
          <span :class="{ 'is-mono': statusIsModName }">{{ statusText }}</span>
          <span class="profile-switch__percent">{{ percent }}%</span>
        </p>
      </div>

      <p v-if="!isDone" class="profile-switch__hint">{{ t('dialogs.profileSwitch.hint') }}</p>
    </div>

    <template v-if="isDone" #footer>
      <VxButton variant="secondary" @click="handleClose">{{ t('common.close') }}</VxButton>
    </template>
  </VxModal>
</template>

<style scoped>
.profile-switch {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-switch__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.profile-switch__step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--color-text, #151922);
}

.profile-switch__dot {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--color-border-strong, #c4ceda);
  border-radius: 50%;
}

.profile-switch__step.is-active .profile-switch__dot {
  border: 2px solid var(--color-accent, #0a96ff);
  border-right-color: transparent;
  animation: profile-switch-spin 0.8s linear infinite;
}

.profile-switch__step.is-done .profile-switch__dot {
  border: 0;
  background: var(--color-success-soft, #dcfce7);
  color: var(--color-success-strong, #15803d);
}

.profile-switch__step.is-wait .profile-switch__label {
  color: var(--color-text-muted, #667085);
}

.profile-switch__step.is-active .profile-switch__label {
  font-weight: 600;
}

.profile-switch__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-switch__count,
.profile-switch__percent {
  flex: 0 0 auto;
  color: var(--color-text-tertiary, #5d6779);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.profile-switch__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-switch__progress :deep(.vx-progress) {
  width: 100%;
  height: 6px;
}

.profile-switch__status {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  color: var(--color-text-tertiary, #5d6779);
  font-size: 12.5px;
}

.profile-switch__status > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-switch__status .is-mono {
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
}

.profile-switch__hint {
  margin: 0;
  color: var(--color-text-muted, #667085);
  font-size: 12px;
}

@keyframes profile-switch-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .profile-switch__step.is-active .profile-switch__dot {
    animation-duration: 2.4s;
  }
}
</style>
