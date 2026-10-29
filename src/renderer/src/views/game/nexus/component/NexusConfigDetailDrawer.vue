<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxDrawer } from '@renderer/component/vertex-ui'
import { buildInstallRuleOutline } from '@views/game/source/install-rule-outline.js'
import {
  INSTALL_CONFIG_SCOPE,
  formatInstallConfigTime,
  resolveInstallConfigOwnerLabel
} from '../nexus-config-profile-utils.js'

// 配置详情：只读右侧抽屉，底部可以直接使用或复制为我的配置。
const props = defineProps({
  open: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  profile: { type: Object, default: () => ({}) },
  active: { type: Boolean, default: false },
  using: { type: Boolean, default: false },
  useDisabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'use', 'clone'])

const { t, locale } = useI18n()

const view = ref('list')

const isPlayer = computed(
  () => String(props.profile?.configScope || '').trim() === INSTALL_CONFIG_SCOPE.PLAYER
)
const title = computed(
  () => String(props.profile?.configName || '').trim() || t('dialogs.configDetail.untitled')
)
const ruleText = computed(() => String(props.profile?.ruleJsonText || '').trim())
const outline = computed(() => buildInstallRuleOutline(ruleText.value))
const description = computed(() => String(props.profile?.configDesc || '').trim())

const metaParts = computed(() => {
  const profile = props.profile || {}
  const parts = []
  if (isPlayer.value) {
    parts.push(t('dialogs.configDetail.author', { name: resolveInstallConfigOwnerLabel(profile) }))
  }
  parts.push(
    t('dialogs.configDetail.used', {
      count: Number(profile.useCount || 0).toLocaleString(
        String(locale.value).startsWith('zh') ? 'zh-CN' : 'en-US'
      )
    })
  )
  const time = profile.updatedAt || profile.publishedAt
  if (time) parts.push(t('dialogs.configDetail.updated', { time: formatInstallConfigTime(time) }))
  if (outline.value.schemaVersion) parts.push(`schema v${outline.value.schemaVersion}`)
  return parts
})

watch(
  () => [props.open, props.profile?.id, props.profile?.profileKey],
  () => {
    view.value = 'list'
  }
)
</script>

<template>
  <VxDrawer
    :model-value="open"
    :width="600"
    :close-label="t('dialogs.configDetail.close')"
    @update:model-value="(value) => emit('update:open', value)"
  >
    <template #header>
      <div class="cfg-detail__head">
        <div class="cfg-detail__title-line">
          <h2 class="cfg-detail__title">
            {{ loading ? t('dialogs.configDetail.loading') : title }}
          </h2>
          <span v-if="!loading" class="cfg-detail__scope" :class="{ 'is-player': isPlayer }">{{
            isPlayer ? t('dialogs.configDetail.player') : t('dialogs.configDetail.official')
          }}</span>
          <span v-if="!loading && active" class="cfg-detail__active">
            <span aria-hidden="true"></span>{{ t('dialogs.configDetail.inUse') }}
          </span>
        </div>
        <p v-if="!loading" class="cfg-detail__meta">
          <template v-for="(part, index) in metaParts" :key="index">
            <span v-if="index" aria-hidden="true">·</span>
            <span>{{ part }}</span>
          </template>
        </p>
      </div>
    </template>

    <div v-if="loading" class="cfg-detail__skeleton" role="status">
      <span class="tool-visually-hidden">{{ t('dialogs.configDetail.loading') }}</span>
      <span v-for="index in 6" :key="index" class="tool-skeleton is-line" aria-hidden="true"></span>
    </div>

    <div v-else class="cfg-detail">
      <p class="cfg-detail__desc" :class="{ 'is-empty': !description }">
        {{ description || t('dialogs.configDetail.noDesc') }}
      </p>

      <section class="cfg-detail__section" aria-labelledby="cfg-detail-rules">
        <div class="cfg-detail__section-head">
          <h3 id="cfg-detail-rules" class="cfg-detail__section-title">
            {{ t('dialogs.configDetail.rules') }} <small>{{ outline.ruleCount }}</small>
          </h3>
          <div class="cfg-detail__tabs" role="tablist" :aria-label="t('dialogs.configDetail.view')">
            <button
              type="button"
              role="tab"
              :aria-selected="view === 'list'"
              :class="{ 'is-active': view === 'list' }"
              @click="view = 'list'"
            >
              {{ t('dialogs.configDetail.listView') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="view === 'json'"
              :class="{ 'is-active': view === 'json' }"
              @click="view = 'json'"
            >
              JSON
            </button>
          </div>
        </div>

        <div
          v-if="view === 'list'"
          class="cfg-detail__table"
          role="table"
          :aria-label="t('dialogs.configDetail.rules')"
        >
          <div class="cfg-detail__tr is-head" role="row">
            <span role="columnheader">{{ t('dialogs.configDetail.ruleId') }}</span>
            <span role="columnheader">{{ t('dialogs.configDetail.ruleDesc') }}</span>
            <span role="columnheader">{{ t('dialogs.configDetail.ruleTarget') }}</span>
          </div>
          <div v-for="rule in outline.rules" :key="rule.key" class="cfg-detail__tr" role="row">
            <span role="cell" class="cfg-detail__id" :title="rule.id">{{ rule.id }}</span>
            <span role="cell" class="cfg-detail__rule-desc">{{ rule.description || '—' }}</span>
            <span role="cell" class="cfg-detail__target">{{ rule.target || '—' }}</span>
          </div>
          <p v-if="!outline.rules.length" class="cfg-detail__empty">
            {{ t('dialogs.configDetail.noRules') }}
          </p>
        </div>
        <pre v-else class="cfg-detail__json vx-ui-scrollbar" tabindex="0">{{
          ruleText || '{}'
        }}</pre>
      </section>
    </div>

    <template v-if="!loading" #footer>
      <span class="cfg-detail__foot">{{
        active ? t('dialogs.configDetail.activeHint') : t('dialogs.configDetail.useHint')
      }}</span>
      <VxButton variant="secondary" @click="emit('clone', profile)">
        {{ t('dialogs.configDetail.clone') }}
      </VxButton>
      <span v-if="active" class="cfg-detail__active is-large">
        <span aria-hidden="true"></span>{{ t('dialogs.configDetail.inUse') }}
      </span>
      <VxButton v-else :loading="using" :disabled="useDisabled" @click="emit('use', profile)">
        {{ t('dialogs.configDetail.use') }}
      </VxButton>
    </template>
  </VxDrawer>
</template>

<style scoped>
.cfg-detail__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.cfg-detail__title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.cfg-detail__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.cfg-detail__scope {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.cfg-detail__scope.is-player {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.cfg-detail__active {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--color-success-soft);
  color: var(--color-success-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.cfg-detail__active > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.cfg-detail__active.is-large {
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13.5px;
}

.cfg-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.cfg-detail__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cfg-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.cfg-detail__desc {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cfg-detail__desc.is-empty {
  color: var(--color-text-muted);
}

.cfg-detail__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cfg-detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cfg-detail__section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.cfg-detail__section-title small {
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 500;
}

.cfg-detail__tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--color-surface-strong);
}

.cfg-detail__tabs button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.cfg-detail__tabs button.is-active {
  border-color: var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
}

.cfg-detail__tabs button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.cfg-detail__table {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.cfg-detail__tr {
  display: grid;
  grid-template-columns: minmax(0, 150px) minmax(0, 1fr) minmax(0, 120px);
  gap: 12px;
  padding: 9px 14px;
  font-size: 13px;
}

.cfg-detail__tr + .cfg-detail__tr {
  border-top: 1px solid var(--color-bg);
}

.cfg-detail__tr.is-head {
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.cfg-detail__id {
  overflow: hidden;
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cfg-detail__rule-desc {
  color: var(--color-text-secondary);
}

.cfg-detail__target {
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.cfg-detail__empty {
  margin: 0;
  padding: 12px 14px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.cfg-detail__json {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-soft);
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}

.cfg-detail__json:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.cfg-detail__foot {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 12.5px;
}
</style>
