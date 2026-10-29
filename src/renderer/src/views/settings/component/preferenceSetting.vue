<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxSegmented, VxSwitch } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import LanguageSetting from './LanguageSetting.vue'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import {
  AI_MASCOT_DEFAULT_CONFIG,
  AI_MASCOT_SPRITESHEET_LAYOUT,
  getAllAiMascotPets,
  normalizeAiMascotConfig
} from '@renderer/component/ai-mascot-pets.js'

const { t } = useI18n()
const mascotImporting = ref(false)
const customMascotPets = ref([])
const PETDEX_URL = 'https://petdex.dev/zh'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      autoStartOnBoot: 0,
      closeWindowType: 'exitApp',
      cachePath: '',
      downloadSpeed: { type: 'noLimit', speed: 1 },
      downloadPath: '',
      isAdult: 'adult'
    })
  },
  // general：语言、启动与关闭；pet：桌宠
  section: { type: String, default: 'general' }
})

const emit = defineEmits(['update:modelValue'])

const config = computed({
  get: () => props.modelValue,
  set: (newValue) => {
    emit('update:modelValue', newValue)
  }
})

const autoStartEnabled = computed({
  get: () => config.value.autoStartOnBoot === 'auto_startup',
  set: (value) => {
    config.value.autoStartOnBoot = value ? 'auto_startup' : ''
  }
})

const closeWindowOptions = computed(() => [
  { value: 'toTray', label: t('settings.general.minimizeTray') },
  { value: 'exitApp', label: t('settings.general.exit') }
])

const availableMascotPets = computed(() => getAllAiMascotPets(customMascotPets.value))
const mascotConfig = computed(() =>
  normalizeAiMascotConfig(config.value.aiMascot, availableMascotPets.value)
)

const mascotEnabled = computed({
  get: () => mascotConfig.value.enabled,
  set: (enabled) => {
    config.value.aiMascot = enabled
      ? {
          enabled: true,
          selectedPetId: mascotConfig.value.selectedPetId || AI_MASCOT_DEFAULT_CONFIG.selectedPetId,
          version: AI_MASCOT_DEFAULT_CONFIG.version
        }
      : { ...mascotConfig.value, enabled: false }
  }
})

const mascotOptions = computed(() =>
  availableMascotPets.value.map((pet) => ({
    ...pet,
    displayName: pet.displayName || pet.id,
    sourceText: pet.source === 'custom' ? t('settings.pet.custom') : t('settings.pet.builtIn')
  }))
)

function selectMascot(option) {
  config.value.aiMascot = {
    enabled: true,
    selectedPetId: String(option.id || '').trim(),
    version: AI_MASCOT_DEFAULT_CONFIG.version
  }
}

function getMascotPreviewStyle(option) {
  if (!option.spritesheetUrl) return {}

  return {
    '--mascot-preview-image': `url("${option.spritesheetUrl}")`,
    '--mascot-preview-frame-width': `${AI_MASCOT_SPRITESHEET_LAYOUT.frameWidth / 3}px`,
    '--mascot-preview-frame-height': `${AI_MASCOT_SPRITESHEET_LAYOUT.frameHeight / 3}px`,
    '--mascot-preview-columns': AI_MASCOT_SPRITESHEET_LAYOUT.columns,
    '--mascot-preview-rows': AI_MASCOT_SPRITESHEET_LAYOUT.rows,
    '--mascot-preview-row': Number.isFinite(option.row) ? option.row : 0
  }
}

function emitMascotPetsChange() {
  window.dispatchEvent(
    new CustomEvent('vertex-ai-mascot-pets-change', {
      detail: customMascotPets.value
    })
  )
}

async function refreshCustomMascotPets() {
  try {
    const pets = await ipcRenderer.invoke('aiMascot:listCustomPets')
    customMascotPets.value = Array.isArray(pets) ? pets : []
    emitMascotPetsChange()
  } catch (error) {
    console.error('读取自定义桌宠失败:', error)
  }
}

async function importMascotZip() {
  if (mascotImporting.value) return

  mascotImporting.value = true
  try {
    const result = await ipcRenderer.invoke('aiMascot:importPetZip')
    if (result?.canceled) return

    customMascotPets.value = Array.isArray(result?.pets) ? result.pets : []
    emitMascotPetsChange()

    if (result?.pet?.id) {
      selectMascot(result.pet)
    }

    $message.success(
      t('settings.pet.added', { name: result?.pet?.displayName || t('settings.pet.custom') }),
      3
    )
  } catch (error) {
    $message.error(String(error?.message || t('settings.pet.importFailed')), 4)
  } finally {
    mascotImporting.value = false
  }
}

function openPetDex() {
  ipcRenderer.send('openBrowse', {
    url: PETDEX_URL
  })
}

onMounted(() => {
  refreshCustomMascotPets()
})
</script>

<template>
  <div class="card-preference">
    <template v-if="section === 'general'">
      <SettingGroup :title="t('settings.general.languageGroup')">
        <LanguageSetting />
      </SettingGroup>
      <SettingGroup :title="t('settings.general.startupGroup')">
        <SettingRow
          :label="t('settings.general.autoStart')"
          :description="t('settings.general.autoStartHint')"
        >
          <VxSwitch
            v-model="autoStartEnabled"
            class="setting-switch"
            :label="t('settings.general.autoStart')"
          />
        </SettingRow>
        <SettingRow
          :label="t('settings.general.closeWindow')"
          :description="t('settings.general.closeWindowHint')"
        >
          <VxSegmented
            v-model="config.closeWindowType"
            role="group"
            :aria-label="t('settings.general.closeWindow')"
            :options="closeWindowOptions"
          />
        </SettingRow>
      </SettingGroup>
    </template>

    <template v-else>
      <SettingGroup>
        <SettingRow :label="t('settings.pet.show')" :description="t('settings.pet.showHint')">
          <VxSwitch
            v-model="mascotEnabled"
            class="setting-switch"
            :label="t('settings.pet.show')"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup v-if="mascotEnabled" :title="t('settings.pet.choose')">
        <template #actions>
          <button type="button" class="setting-link-button" @click="openPetDex">
            {{ t('settings.pet.petDex') }}
            <ToolIcon name="external" :size="12" />
          </button>
        </template>
        <div class="mascot-grid" role="radiogroup" :aria-label="t('settings.pet.choose')">
          <button
            v-for="option in mascotOptions"
            :key="option.id"
            type="button"
            role="radio"
            class="mascot-option"
            :class="{ 'is-selected': mascotConfig.selectedPetId === option.id }"
            :aria-checked="mascotConfig.selectedPetId === option.id"
            @click="selectMascot(option)"
          >
            <span class="mascot-option__preview" :style="getMascotPreviewStyle(option)">
              <span v-if="option.spritesheetUrl" class="mascot-option__sprite"></span>
              <ToolIcon v-else name="paw" :size="28" />
            </span>
            <span class="mascot-option__title" :title="option.displayName">{{
              option.displayName
            }}</span>
            <span class="mascot-option__source">{{ option.sourceText }}</span>
          </button>
          <button
            type="button"
            class="mascot-option is-add"
            :disabled="mascotImporting"
            :aria-busy="mascotImporting"
            @click="importMascotZip"
          >
            <span class="mascot-option__preview is-add">
              <span v-if="mascotImporting" class="tool-inline-spinner" aria-hidden="true"></span>
              <ToolIcon v-else name="upload" :size="22" />
            </span>
            <span class="mascot-option__title">{{
              mascotImporting ? t('settings.pet.importing') : t('settings.pet.import')
            }}</span>
            <span class="mascot-option__source">{{ t('settings.pet.importHint') }}</span>
          </button>
        </div>
      </SettingGroup>
    </template>
  </div>
</template>

<style scoped lang="scss">
.mascot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
}

.mascot-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 14px var(--space-3) var(--space-3);
  color: var(--color-text);
  font: inherit;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover:not(:disabled) {
    background: var(--color-surface-soft);
    border-color: var(--color-border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  &.is-selected {
    background: color-mix(in srgb, var(--color-accent-soft) 40%, var(--color-white));
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }

  &.is-add {
    color: var(--color-text-secondary);
    border-style: dashed;
  }

  &:disabled {
    cursor: progress;
  }
}

.mascot-option__preview {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 2px;
  overflow: hidden;
  color: var(--color-text-tertiary);
  background: var(--color-surface-hover);
  border-radius: 10px;

  &.is-add {
    background: transparent;
  }
}

.mascot-option__sprite {
  width: var(--mascot-preview-frame-width);
  height: var(--mascot-preview-frame-height);
  background-image: var(--mascot-preview-image);
  background-repeat: no-repeat;
  background-size: calc(var(--mascot-preview-frame-width) * var(--mascot-preview-columns))
    calc(var(--mascot-preview-frame-height) * var(--mascot-preview-rows));
  background-position: 0 calc(var(--mascot-preview-frame-height) * var(--mascot-preview-row) * -1);
}

.mascot-option__title {
  max-width: 100%;
  overflow: hidden;
  font-size: 13.5px;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mascot-option__source {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
