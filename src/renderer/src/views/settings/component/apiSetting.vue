<script setup>
import { VxButton, VxInput } from '@renderer/component/vertex-ui'
import SettingGroup from './SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import NexusAccountPanel from './NexusAccountPanel.vue'
import SteamAccountPanel from './SteamAccountPanel.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const isShowNexusApiKey = ref(false)
const isShowModioApiKey = ref(false)
const DEFAULT_MODIO_API_BASE_URL = 'https://api.mod.io/v1'

function createDefaultNexusApiConfig() {
  return {
    apiKey: '',
    apiKeySource: ''
  }
}

function normalizeModioBaseUrl(value = '') {
  const text = String(value || '').trim()
  return text || DEFAULT_MODIO_API_BASE_URL
}

function createDefaultModioApiConfig() {
  return {
    baseUrl: DEFAULT_MODIO_API_BASE_URL,
    apiKey: ''
  }
}

function normalizeModioApiConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {}
  return {
    baseUrl: normalizeModioBaseUrl(source.baseUrl || source.url || source.apiPath),
    apiKey: String(source.apiKey || source.key || '').trim()
  }
}

const defaultNexusApiConfig = createDefaultNexusApiConfig()
const defaultModioApiConfig = createDefaultModioApiConfig()

const props = defineProps({
  // nexus / steam / modio
  section: { type: String, default: 'nexus' },
  modelValue: {
    type: Object,
    default: () => ({
      nexusApi: {
        apiKey: '',
        apiKeySource: ''
      },
      modioApi: {
        baseUrl: 'https://api.mod.io/v1',
        apiKey: ''
      }
    })
  }
})

const emit = defineEmits(['update:modelValue'])
const isSyncingFromModel = ref(false)
const nexusApiConfig = ref({
  ...defaultNexusApiConfig
})
const modioApiConfig = ref({
  ...defaultModioApiConfig
})
const nexusKeyFilled = computed(() => Boolean(String(nexusApiConfig.value.apiKey || '').trim()))
const modioKeyFilled = computed(() => Boolean(String(modioApiConfig.value.apiKey || '').trim()))

watch(
  () => props.modelValue,
  (newValue) => {
    const currentConfig = newValue && typeof newValue === 'object' ? newValue : {}
    const sourceConfig =
      currentConfig.nexusApi && typeof currentConfig.nexusApi === 'object'
        ? currentConfig.nexusApi
        : {}
    const sourceModioConfig =
      currentConfig.modioApi && typeof currentConfig.modioApi === 'object'
        ? currentConfig.modioApi
        : {}

    isSyncingFromModel.value = true
    nexusApiConfig.value = {
      ...defaultNexusApiConfig,
      ...sourceConfig,
      apiKeySource: String(sourceConfig.apiKey || '').trim() ? 'local' : ''
    }
    modioApiConfig.value = normalizeModioApiConfig({
      ...defaultModioApiConfig,
      ...sourceModioConfig
    })
    nextTick(() => {
      isSyncingFromModel.value = false
    })
  },
  { immediate: true, deep: true }
)

watch(
  () => nexusApiConfig.value,
  (newValue) => {
    if (isSyncingFromModel.value) return
    const currentConfig =
      props.modelValue && typeof props.modelValue === 'object' ? props.modelValue : {}
    emit('update:modelValue', {
      ...currentConfig,
      nexusApi: {
        ...defaultNexusApiConfig,
        ...newValue,
        apiKeySource: String(newValue.apiKey || '').trim() ? 'local' : ''
      }
    })
  },
  { deep: true }
)

watch(
  () => modioApiConfig.value,
  (newValue) => {
    if (isSyncingFromModel.value) return
    const currentConfig =
      props.modelValue && typeof props.modelValue === 'object' ? props.modelValue : {}
    emit('update:modelValue', {
      ...currentConfig,
      modioApi: normalizeModioApiConfig({
        ...defaultModioApiConfig,
        ...newValue
      })
    })
  },
  { deep: true }
)
</script>

<template>
  <div class="api-setting">
    <NexusAccountPanel v-if="section === 'nexus'">
      <template #api-key>
        <SettingGroup title="Personal API Key">
          <template #actions>
            <span class="tool-status" :class="nexusKeyFilled ? 'is-success' : 'is-warning'">{{
              nexusKeyFilled ? $t('ui.provided') : $t('ui.notProvided')
            }}</span>
          </template>
          <SettingRow stack>
            <div class="api-key-row">
              <VxInput
                v-model="nexusApiConfig.apiKey"
                class="setting-field"
                label="Nexus API Key"
                :type="isShowNexusApiKey ? 'text' : 'password'"
                :placeholder="$t('ui.pasteYourNexusPersonalAPIKey')"
                spellcheck="false"
              />
              <VxButton
                variant="secondary"
                type="button"
                :aria-pressed="isShowNexusApiKey"
                :aria-label="`${isShowNexusApiKey ? $t('modelSettings.hide') : $t('modelSettings.show')} Nexus API Key`"
                @click="isShowNexusApiKey = !isShowNexusApiKey"
              >
                {{ isShowNexusApiKey ? $t('modelSettings.hide') : $t('modelSettings.show') }}
              </VxButton>
            </div>
          </SettingRow>
          <SettingRow :label="$t('ui.howToObtainIt')" stack>
            <ol class="setting-steps">
              <li>
                <span
                  >{{ $t('auth.login.submit') }}
                  <a href="https://www.nexusmods.com" target="_blank" rel="noreferrer"
                    >nexusmods.com</a
                  >。</span
                >
              </li>
              <li>
                <span
                  >{{ $t('ui.open') }}
                  <a
                    href="https://www.nexusmods.com/settings/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    >nexusmods.com/settings/api-keys</a
                  >{{ $t('ui.ifYouDoNotSee') }} <strong>Personal API Key</strong> {{ $t('ui.scrollToTheBottomOfThePage') }}</span
                >
              </li>
              <li>
                <span
                  >{{ $t('ui.at') }} <strong>Personal API Key</strong> {{ $t('ui.click') }}
                  <strong>Request Api Key</strong>{{ $t('ui.thenCopyAndPasteItAbove') }}</span
                >
              </li>
            </ol>
          </SettingRow>
        </SettingGroup>
      </template>
    </NexusAccountPanel>

    <SteamAccountPanel v-else-if="section === 'steam'" />

    <template v-else>
      <SettingGroup title="API Key">
        <template #actions>
          <span class="tool-status" :class="modioKeyFilled ? 'is-success' : 'is-warning'">{{
            modioKeyFilled ? $t('ui.provided') : $t('dialogs.vamCookie.notSet')
          }}</span>
        </template>
        <SettingRow stack>
          <div class="api-key-row">
            <VxInput
              v-model="modioApiConfig.apiKey"
              class="setting-field"
              label="Mod.io API Key"
              :type="isShowModioApiKey ? 'text' : 'password'"
              :placeholder="$t('ui.pasteYourModIoApikey')"
              spellcheck="false"
            />
            <VxButton
              variant="secondary"
              type="button"
              :aria-pressed="isShowModioApiKey"
              :aria-label="`${isShowModioApiKey ? $t('modelSettings.hide') : $t('modelSettings.show')} Mod.io API Key`"
              @click="isShowModioApiKey = !isShowModioApiKey"
            >
              {{ isShowModioApiKey ? $t('modelSettings.hide') : $t('modelSettings.show') }}
            </VxButton>
          </div>
        </SettingRow>
        <SettingRow :label="$t('ui.howToObtainIt')" stack>
          <ol class="setting-steps">
            <li>
              <span
                >{{ $t('auth.login.submit') }} <a href="https://mod.io" target="_blank" rel="noreferrer">mod.io</a>。</span
              >
            </li>
            <li>
              <span
                >{{ $t('ui.open') }}
                <a href="https://mod.io/me/access" target="_blank" rel="noreferrer"
                  >mod.io/me/access</a
                >{{ $t('ui.thenFindAPIAccess') }}</span
              >
            </li>
            <li>
              <span
                >{{ $t('tools.copy') }} <strong>apikey</strong> {{ $t('ui.aboveIf') }}<strong>API path</strong>
                {{ $t('ui.differsFromTheDefaultEnterItInAPIURLBelow') }}</span
              >
            </li>
          </ol>
        </SettingRow>
      </SettingGroup>

      <SettingGroup :title="$t('ui.advanced')">
        <SettingRow stack>
          <div class="api-key-row">
            <VxInput
              v-model="modioApiConfig.baseUrl"
              class="setting-field"
              :label="t('settings.modio.apiAddress')"
              type="text"
              placeholder="https://api.mod.io/v1"
              spellcheck="false"
            />
          </div>
        </SettingRow>
      </SettingGroup>
    </template>
  </div>
</template>

<style scoped lang="scss">
.api-setting > * + * {
  margin-top: 28px;
}

.api-key-row {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;

  > .vx-button {
    // 与带标签的输入框对齐到输入行：标签行高 + 字段间距
    margin-top: calc(var(--font-size-sm) * var(--line-height-base) + var(--space-1));
  }
}

:deep(.api-key-row .vx-input) {
  font-family: var(--font-family-mono);
}
</style>
