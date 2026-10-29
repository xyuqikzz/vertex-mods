<script setup>
import { useI18n } from 'vue-i18n'
const { t: uiText } = useI18n()
import { uiMessage } from '../../../../i18n/message.js'

// 多来源模组"配置方案"面板
// Material Design 3 风格：tonal surfaces、rounded containers、elevation layers
// 内联新增配置（不再弹二次弹窗）
import { computed, nextTick, ref } from 'vue'
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  ImportOutlined,
  EditOutlined,
  PlusOutlined,
  ShareAltOutlined,
  SyncOutlined
} from '@ant-design/icons-vue'
import { $message } from '@renderer/common/message.js'
import { useUserStore } from '@renderer/store/userStore.js'

const userStore = useUserStore()

const props = defineProps({
  showTransferActions: { type: Boolean, default: true },
  activeProfileName: {
    type: String,
    default: ''
  },
  profileOptions: {
    type: Array,
    default: () => []
  },
  profileModCount: {
    type: Number,
    default: 0
  },
  profileSwitching: {
    type: Boolean,
    default: false
  },
  profileOperationLocked: {
    type: Boolean,
    default: false
  },
  sharingProfile: {
    type: Boolean,
    default: false
  },
  importingProfile: {
    type: Boolean,
    default: false
  },
  batchInstallingFromProfile: {
    type: Boolean,
    default: false
  },
  showNamespaceHint: {
    type: Boolean,
    default: false
  },
  extraActions: {
    type: Array,
    default: () => []
  },
  // 新增配置相关
  createProfileLoading: {
    type: Boolean,
    default: false
  },
  profileNameMaxLength: {
    type: Number,
    default: 32
  }
})

const emit = defineEmits([
  'close',
  'switch-profile',
  'rename-profile',
  'delete-profile',
  'create-profile',
  'confirm-create-profile',
  'share-profile',
  'update-profile',
  'import-profile',
  'export-file',
  'import-file',
  'extra-action'
])

const activeProfileLabel = computed(() => {
  const activeName = String(props.activeProfileName || '').trim()
  const option = props.profileOptions.find(
    (item) => String(item?.value || '').trim() === activeName
  )
  return option?.label || activeName || uiText('ui.noProfileSelected')
})

const profileCountLabel = computed(() => uiText('ui.valueProfiles', { value1: (props.profileOptions.length) }))

const isOperationDisabled = computed(() => {
  return props.profileSwitching || props.batchInstallingFromProfile
})

// ─── 内联新增配置 ───
const showCreateInput = ref(false)
const newProfileName = ref('')
const createInputRef = ref(null)
const renamingProfileValue = ref('')
const renameProfileName = ref('')
const renameInputRef = ref(null)

function openCreateInput() {
  if (props.profileOperationLocked) return
  showCreateInput.value = true
  newProfileName.value = ''
  nextTick(() => {
    createInputRef.value?.focus()
  })
}

function cancelCreate() {
  showCreateInput.value = false
  newProfileName.value = ''
}

function confirmCreate() {
  const name = newProfileName.value.trim()
  if (!name) return
  emit('confirm-create-profile', name)
}

function handleCreateKeydown(e) {
  if (e.key === 'Enter') {
    confirmCreate()
  } else if (e.key === 'Escape') {
    cancelCreate()
  }
}

function getOptionName(option = {}) {
  return String(option?.name || option?.value || option?.label || '').trim()
}

function openRenameInput(option = {}) {
  if (props.profileOperationLocked || props.profileSwitching) return
  renamingProfileValue.value = String(option?.value || '').trim()
  renameProfileName.value = getOptionName(option)
  nextTick(() => {
    const input = Array.isArray(renameInputRef.value) ? renameInputRef.value[0] : renameInputRef.value
    input?.focus()
    input?.select()
  })
}

function cancelRename() {
  renamingProfileValue.value = ''
  renameProfileName.value = ''
}

function confirmRename() {
  const profileName = renamingProfileValue.value
  const name = renameProfileName.value.trim()
  if (!profileName || !name) return
  emit('rename-profile', { profileName, name })
  cancelRename()
}

function handleRenameKeydown(event) {
  if (event.key === 'Enter') confirmRename()
  if (event.key === 'Escape') cancelRename()
}

function isActiveProfileValue(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase() ===
    String(props.activeProfileName || '')
      .trim()
      .toLowerCase()
  )
}

function handleDeleteProfile(value) {
  if (isActiveProfileValue(value)) return
  emit('delete-profile', value)
}

function handleShareProfile() {
  if (!userStore.isLogin) {
    $message.warning(uiMessage('ui.signInToShare'))
    return
  }
  emit('share-profile')
}

function handleUpdateProfile() {
  if (!userStore.isLogin) {
    $message.warning(uiMessage('ui.signInToUpdateAShare'))
    return
  }
  emit('update-profile')
}
</script>

<template>
  <div class="mp">
    <header class="mp-header">
      <div class="mp-header__text">
        <h2 class="mp-header__title">{{ $t('modBrowser.profiles') }}</h2>
        <p class="mp-header__desc">{{ $t('ui.switchBetweenDifferentModCombinations') }}</p>
      </div>
      <button
        type="button"
        class="mp-header__close"
        :aria-label="$t('ui.closeProfiles')"
        @click="emit('close')"
      >
        <close-outlined />
      </button>
    </header>

    <section class="mp-current" :aria-label="$t('ui.currentProfileVariant2')">
      <span class="mp-current__label">{{ $t('ui.currentProfileVariant2') }}</span>
      <span class="mp-current__indicator" aria-hidden="true">
        <span class="mp-current__dot"></span>
      </span>
      <strong class="mp-current__name">{{ activeProfileLabel }}</strong>
    </section>

    <div v-if="showNamespaceHint" class="mp-banner">
      <span class="mp-banner__text"
        >{{ $t('ui.switchingProfilesOnlyChangesWhereNewInstallationsBelongExistingMods') }}</span
      >
    </div>

    <div class="mp-list">
      <div class="mp-list__head">
        <div class="mp-list__title-group">
          <span class="mp-list__label">{{ $t('ui.allProfiles') }}</span>
          <span class="mp-list__count">{{ profileCountLabel }}</span>
        </div>
        <button
          v-if="!showCreateInput"
          type="button"
          class="mp-list__add"
          :disabled="profileOperationLocked"
          @click="openCreateInput"
        >
          <plus-outlined />
          <span>{{ $t('ui.newProfile') }}</span>
        </button>
      </div>

      <Transition name="mp-slide">
        <div v-if="showCreateInput" class="mp-create">
          <input
            ref="createInputRef"
            v-model="newProfileName"
            class="mp-create__input"
            type="text"
            :maxlength="profileNameMaxLength"
            :placeholder="$t('ui.enterANewProfileNameAndPressEnter')"
            :disabled="createProfileLoading"
            @keydown="handleCreateKeydown"
          />
          <button
            type="button"
            class="mp-create__confirm"
            :disabled="!newProfileName.trim() || createProfileLoading"
            @click="confirmCreate"
          >
            {{ createProfileLoading ? $t('ui.creating') : $t('ui.create') }}
          </button>
          <button
            type="button"
            class="mp-create__cancel"
            :disabled="createProfileLoading"
            @click="cancelCreate"
          >
            {{ $t('ui.cancel') }}
          </button>
        </div>
      </Transition>

      <div class="mp-list__items" role="list">
        <div
          v-for="option in profileOptions"
          :key="option.value"
          class="mp-item"
          :class="{ 'is-active': isActiveProfileValue(option.value) }"
          role="listitem"
        >
          <span class="mp-item__indicator">
            <span class="mp-item__dot"></span>
          </span>
          <div v-if="renamingProfileValue === option.value" class="mp-item__rename">
            <input
              ref="renameInputRef"
              v-model="renameProfileName"
              class="mp-item__rename-input"
              type="text"
              :maxlength="profileNameMaxLength"
              :disabled="profileOperationLocked || profileSwitching"
              :aria-label="$t('ui.renameProfileValue', { value1: (getOptionName(option)) })"
              @keydown="handleRenameKeydown"
            />
            <button
              type="button"
              class="mp-item__rename-action"
              :disabled="!renameProfileName.trim() || profileOperationLocked || profileSwitching"
              :aria-label="$t('ui.confirmRename')"
              @click="confirmRename"
            >
              <check-outlined />
            </button>
            <button
              type="button"
              class="mp-item__rename-action"
              :disabled="profileOperationLocked || profileSwitching"
              :aria-label="$t('ui.cancelRename')"
              @click="cancelRename"
            >
              <close-outlined />
            </button>
          </div>
          <span v-else class="mp-item__name">{{ option.label }}</span>
          <div class="mp-item__actions">
            <button
              v-if="!isActiveProfileValue(option.value)"
              type="button"
              class="mp-item__switch"
              :disabled="profileOperationLocked || profileSwitching"
              @click="emit('switch-profile', option.value)"
            >
              {{ $t('ui.switch') }}
            </button>
            <span v-else class="mp-item__current">{{ $t('tools.current') }}</span>
            <button
              v-if="renamingProfileValue !== option.value"
              type="button"
              class="mp-item__edit"
              :disabled="profileOperationLocked || profileSwitching"
              :aria-label="$t('ui.renameProfileValue', { value1: (getOptionName(option)) })"
              @click.stop="openRenameInput(option)"
            >
              <edit-outlined />
            </button>
            <button
              v-if="!option.isDefault && !isActiveProfileValue(option.value)"
              type="button"
              class="mp-item__delete"
              :disabled="profileOperationLocked"
              :aria-label="$t('ui.deleteProfileValue', { value1: (option.label) })"
              @click.stop="handleDeleteProfile(option.value)"
            >
              <delete-outlined />
            </button>
          </div>
        </div>
        <div v-if="!profileOptions.length" class="mp-list__empty">{{ $t('ui.noProfiles') }}</div>
      </div>

      <div v-if="profileSwitching" class="mp-list__status">
        <span class="mp-spinner"></span>
        <span>{{ $t('ui.switching') }}</span>
      </div>
    </div>

    <div v-if="extraActions && extraActions.length" class="mp-extras">
      <button
        v-for="item in extraActions"
        :key="item.key"
        type="button"
        class="mp-extras__btn"
        :disabled="item.disabled === true"
        @click="emit('extra-action', item.key)"
      >
        <span v-if="item.loading" class="mp-spinner mp-spinner--sm"></span>
        <span>{{ item.label }}</span>
      </button>
    </div>

    <footer v-if="showTransferActions" class="mp-footer">
      <div class="mp-ops">
        <button
          type="button"
          class="mp-op"
          :class="{ 'is-loading': sharingProfile }"
          :disabled="isOperationDisabled"
          @click="handleShareProfile"
        >
          <span class="mp-op__icon"><share-alt-outlined /></span>
          <span class="mp-op__label">{{ $t('ui.shareCurrentProfile') }}</span>
        </button>
        <button
          v-if="profileModCount > 0"
          type="button"
          class="mp-op"
          :class="{ 'is-loading': sharingProfile }"
          :disabled="isOperationDisabled"
          @click="handleUpdateProfile"
        >
          <span class="mp-op__icon"><sync-outlined /></span>
          <span class="mp-op__label">{{ $t('ui.updateExistingShare') }}</span>
        </button>
        <button
          type="button"
          class="mp-op"
          :class="{ 'is-loading': importingProfile }"
          :disabled="isOperationDisabled"
          @click="emit('import-profile')"
        >
          <span class="mp-op__icon"><import-outlined /></span>
          <span class="mp-op__label">{{ $t('ui.importShare') }}</span>
        </button>
      </div>

      <div class="mp-ops">
        <button
          type="button"
          class="mp-op"
          :disabled="isOperationDisabled"
          @click="emit('export-file')"
        >
          <span class="mp-op__icon"><export-outlined /></span>
          <span class="mp-op__label">{{ $t('ui.exportFile') }}</span>
        </button>
        <button
          type="button"
          class="mp-op"
          :disabled="isOperationDisabled"
          @click="emit('import-file')"
        >
          <span class="mp-op__icon"><download-outlined /></span>
          <span class="mp-op__label">{{ $t('ui.importFromFile') }}</span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.mp {
  --mp-primary: var(--themecolor, var(--color-accent, #0a96ff));
  --mp-on-primary: #ffffff;
  --mp-surface: var(--color-surface, #ffffff);
  --mp-surface-soft: var(--color-surface-soft, var(--right-view-bottom-bc, #f5f7fa));
  --mp-surface-hover: var(--color-surface-hover, #eef3f8);
  --mp-on-surface: var(--color-text, var(--primary-text-color, #1f2937));
  --mp-on-surface-variant: var(--color-text-muted, var(--desc-color, #667085));
  --mp-outline: var(--color-border, #d9e1ea);
  --mp-outline-strong: var(--color-border-strong, #c7d1dd);
  --mp-error: var(--color-danger, #d93025);
  --mp-radius: var(--secondary-border-radius, 8px);

  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(920px, calc(100vw - 48px));
  height: min(560px, calc(100vh - 64px));
  min-height: 0;
  overflow: hidden;
  padding: 24px 28px 20px;
  border: 1px solid var(--mp-outline);
  border-radius: var(--mp-radius);
  background: var(--mp-surface);
  box-shadow:
    0 18px 44px rgba(15, 23, 42, 0.18),
    0 2px 8px rgba(15, 23, 42, 0.08);
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  color: var(--mp-on-surface);
  -webkit-font-smoothing: antialiased;
}

.mp,
.mp * {
  box-sizing: border-box;
}

.mp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mp-header__text {
  min-width: 0;
  flex: 1;
}

.mp-header__title {
  margin: 0;
  color: var(--mp-on-surface);
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
}

.mp-header__desc {
  margin: 3px 0 0;
  font-size: 14px;
  color: var(--mp-on-surface-variant);
  line-height: 22px;
}

.mp-header__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border: 1px solid var(--mp-outline);
  border-radius: 6px;
  background: var(--mp-surface);
  color: var(--mp-on-surface-variant);
  font-size: 14px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    color: var(--mp-on-surface);
    background: var(--mp-surface-hover);
    border-color: var(--mp-outline-strong);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--mp-primary) 32%, transparent);
    outline-offset: 2px;
  }
}

.mp-current {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  padding: 0 20px;
  border: 1px solid var(--mp-outline);
  border-radius: var(--mp-radius);
  background: color-mix(in srgb, var(--mp-primary) 4%, var(--mp-surface));
}

.mp-current__label {
  min-width: 76px;
  color: var(--mp-on-surface-variant);
  font-size: 14px;
  line-height: 20px;
}

.mp-current__indicator,
.mp-item__indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border: 2px solid var(--mp-outline-strong);
  border-radius: 50%;
}

.mp-current__indicator {
  border-color: var(--mp-primary);
  background: var(--mp-primary);
}

.mp-current__dot,
.mp-item__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
}

.mp-current__dot,
.is-active .mp-item__dot {
  background: var(--mp-on-primary);
}

.mp-current__name {
  min-width: 0;
  overflow: hidden;
  color: var(--mp-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-banner {
  border: 1px solid #fdd663;
  border-radius: var(--mp-radius);
  padding: 10px 14px;
  background: #fff9e8;
}

.mp-banner__text {
  font-size: 12px;
  line-height: 18px;
  color: #3c3000;
}

.mp-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  border: 1px solid var(--mp-outline);
  border-radius: var(--mp-radius);
  overflow: hidden;
}

.mp-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  gap: 16px;
  padding: 10px 16px 10px 20px;
  border-bottom: 1px solid var(--mp-outline);
  background: var(--mp-surface);
}

.mp-list__title-group {
  display: flex;
  align-items: baseline;
  min-width: 0;
  gap: 16px;
}

.mp-list__label {
  color: var(--mp-on-surface);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.mp-list__count {
  color: var(--mp-on-surface-variant);
  font-size: 13px;
  line-height: 20px;
}

.mp-list__add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--mp-primary);
  border-radius: 6px;
  background: var(--mp-primary);
  color: var(--mp-on-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    filter 0.15s ease,
    box-shadow 0.15s ease;

  &:hover:not(:disabled) {
    box-shadow: 0 3px 8px color-mix(in srgb, var(--mp-primary) 22%, transparent);
    filter: brightness(1.05);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--mp-primary) 30%, transparent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
    box-shadow: none;
  }
}

.mp-create {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 16px 8px 20px;
  border-bottom: 1px solid var(--mp-outline);
  background: var(--mp-surface-soft);
}

.mp-create__input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--mp-outline);
  background: var(--mp-surface);
  color: var(--mp-on-surface);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &::placeholder {
    color: var(--mp-on-surface-variant);
    opacity: 0.6;
  }

  &:focus {
    border-color: var(--mp-primary);
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.15);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.mp-create__confirm {
  padding: 0 16px;
  height: 34px;
  border-radius: 6px;
  border: none;
  background: var(--mp-primary);
  color: var(--mp-on-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.mp-create__cancel {
  padding: 0 12px;
  height: 34px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--mp-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mp-primary) 8%, transparent);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.mp-list__items {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;

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

.mp-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 9px 16px 9px 20px;
  transition: background 0.15s ease;

  &:not(:last-child) {
    border-bottom: 1px solid var(--mp-outline);
  }

  &:hover {
    background: var(--mp-surface-soft);
  }

  &.is-active {
    background: color-mix(in srgb, var(--mp-primary) 5%, var(--mp-surface));
  }
}

.mp-item__indicator {
  transition: all 0.2s ease;

  .is-active & {
    border-color: var(--mp-primary);
    background: var(--mp-primary);
  }
}

.mp-item__name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 400;
  color: var(--mp-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 20px;

  .is-active & {
    font-weight: 500;
    color: var(--mp-primary);
  }
}

.mp-item__rename {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 6px;
}

.mp-item__rename-input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--mp-primary);
  border-radius: 6px;
  background: var(--mp-surface);
  color: var(--mp-on-surface);
  font: inherit;
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mp-primary) 14%, transparent);
}

.mp-item__rename-action,
.mp-item__edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mp-on-surface-variant);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--mp-surface-hover);
    color: var(--mp-primary);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.mp-item__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mp-item__switch {
  min-width: 64px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--mp-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mp-primary) 7%, transparent);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.mp-item__current {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--mp-primary) 16%, var(--mp-outline));
  border-radius: 6px;
  background: color-mix(in srgb, var(--mp-primary) 7%, var(--mp-surface));
  color: var(--mp-primary);
  font-size: 13px;
  font-weight: 600;
}

.mp-item__delete {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--mp-on-surface-variant);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;

  .mp-item:hover & {
    opacity: 1;
  }

  &:hover:not(:disabled) {
    background: rgba(217, 48, 37, 0.08);
    color: var(--mp-error);
  }

  &:disabled {
    cursor: default;
  }
}

.mp-list__status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--mp-outline);
  color: var(--mp-on-surface-variant);
  font-size: 13px;
}

.mp-list__empty {
  display: grid;
  min-height: 112px;
  place-items: center;
  color: var(--mp-on-surface-variant);
  font-size: 13px;
}

.mp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--mp-outline);
}

.mp-ops {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mp-op {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--mp-outline);
  border-radius: 6px;
  background: var(--mp-surface);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--mp-surface-hover);
    border-color: var(--mp-outline-strong);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--mp-primary) 24%, transparent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }

  &.is-loading {
    opacity: 0.5;
    pointer-events: none;
  }
}

.mp-op__icon {
  width: 18px;
  height: 18px;
  border-radius: 0;
  background: transparent;
  color: var(--mp-primary);
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
}

.mp-op__label {
  font-size: 13px;
  font-weight: 400;
  color: var(--mp-on-surface-variant);
  white-space: nowrap;
}

.mp-extras {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}

.mp-extras__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--mp-outline);
  background: var(--mp-surface);
  color: var(--mp-on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--mp-surface-soft);
    color: var(--mp-on-surface);
  }

  &:disabled {
    opacity: 0.38;
    cursor: default;
  }
}

.mp-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--mp-outline);
  border-top-color: var(--mp-primary);
  animation: mp-spin 0.8s linear infinite;

  &--sm {
    width: 11px;
    height: 11px;
    border-width: 1.5px;
  }
}

@keyframes mp-spin {
  to {
    transform: rotate(360deg);
  }
}

.mp-slide-enter-active,
.mp-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.mp-slide-enter-from,
.mp-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.mp-slide-enter-to,
.mp-slide-leave-from {
  max-height: 60px;
}

@media (max-width: 760px) {
  .mp {
    width: calc(100vw - 32px);
    height: calc(100vh - 32px);
    padding: 20px;
  }

  .mp-current {
    padding-inline: 16px;
  }

  .mp-footer {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .mp-footer .mp-ops {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mp-op {
    justify-content: center;
  }
}

@media (max-height: 620px) {
  .mp {
    gap: 12px;
    height: calc(100vh - 32px);
    padding-block: 18px 16px;
  }

  .mp-current {
    min-height: 54px;
  }

  .mp-footer {
    padding-top: 12px;
  }
}
</style>
