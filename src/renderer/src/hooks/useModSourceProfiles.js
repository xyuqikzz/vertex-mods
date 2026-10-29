import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  SOURCE_PROFILE_REGISTRY_CONSTANTS,
  SOURCE_PROFILE_REGISTRY_UPDATED_EVENT,
  migrateLegacyThunderstoreProfiles,
  normalizeSourceProfileKeySegment,
  normalizeSourceProfileName,
  readSourceProfiles,
  renameSourceProfile,
  resolveSourceProfileNameInList,
  sanitizeSourceProfileList,
  validateSourceProfileName,
  writeSourceProfiles
} from '@renderer/utils/source-profile-registry.js'

const { DEFAULT_PROFILE_NAME, PROFILE_NAME_MAX_LENGTH, PROFILE_NAME_INVALID_PATTERN } =
  SOURCE_PROFILE_REGISTRY_CONSTANTS

/**
 * 统一的"配置方案" composable。
 * 这里只维护本地 profile 元数据，物理隔离由来源页面通过 IPC 执行。
 */
export function useModSourceProfiles(options = {}) {
  const sourceKey = String(options.sourceKey || '')
    .trim()
    .toLowerCase()
  if (!sourceKey) {
    throw new Error(uiText('ui.useModSourceProfilesSourceKeyIsRequired'))
  }

  if (sourceKey === 'thunderstore') {
    migrateLegacyThunderstoreProfiles()
  }

  const identifierRef = computed(() => {
    const raw =
      typeof options.identifier === 'function' ? options.identifier() : options.identifier?.value
    return normalizeSourceProfileKeySegment(raw)
  })

  const profileList = ref(sanitizeSourceProfileList([]))
  const selectedProfileName = ref(DEFAULT_PROFILE_NAME)
  const defaultProfileName = ref(DEFAULT_PROFILE_NAME)

  const activeProfileName = computed(() => {
    return resolveSourceProfileNameInList(
      selectedProfileName.value,
      profileList.value,
      defaultProfileName.value
    )
  })

  const profileOptions = computed(() => {
    return sanitizeSourceProfileList(profileList.value, defaultProfileName.value).map((item) => {
      const isDefault = item.toLowerCase() === defaultProfileName.value.toLowerCase()
      return {
        label: isDefault ? uiText('ui.valueDefault', { value1: (item) }) : item,
        name: item,
        value: item,
        isDefault
      }
    })
  })

  function loadState() {
    const key = identifierRef.value
    if (!key) {
      profileList.value = sanitizeSourceProfileList([])
      selectedProfileName.value = DEFAULT_PROFILE_NAME
      defaultProfileName.value = DEFAULT_PROFILE_NAME
      return
    }

    const record = readSourceProfiles(sourceKey, key)
    profileList.value = record.list
    selectedProfileName.value = record.selected
    defaultProfileName.value = record.defaultProfile
  }

  function persistState() {
    const key = identifierRef.value
    if (!key) return

    const record = writeSourceProfiles(
      sourceKey,
      key,
      profileList.value,
      selectedProfileName.value,
      { defaultProfileName: defaultProfileName.value }
    )
    if (!record) return
    profileList.value = record.list
    selectedProfileName.value = record.selected
    defaultProfileName.value = record.defaultProfile
  }

  function setSelectedProfile(name) {
    const next = resolveSourceProfileNameInList(name, profileList.value, defaultProfileName.value)
    if (next === activeProfileName.value) return next
    selectedProfileName.value = next
    persistState()
    return next
  }

  function validateNewProfileName(rawName) {
    return validateSourceProfileName(rawName, profileList.value)
  }

  function addProfile(name) {
    const validation = validateNewProfileName(name)
    if (!validation.ok) {
      return validation
    }
    profileList.value = sanitizeSourceProfileList(
      [...profileList.value, validation.name],
      defaultProfileName.value
    )
    persistState()
    return { ok: true, name: validation.name }
  }

  function ensureProfile(name, options = {}) {
    const normalized = normalizeSourceProfileName(name)
    if (!normalized) return activeProfileName.value
    const nextList = sanitizeSourceProfileList(
      [...profileList.value, normalized],
      defaultProfileName.value
    )
    profileList.value = nextList
    selectedProfileName.value =
      options?.select === false
        ? resolveSourceProfileNameInList(
            selectedProfileName.value,
            nextList,
            defaultProfileName.value
          )
        : resolveSourceProfileNameInList(normalized, nextList, defaultProfileName.value)
    persistState()
    return activeProfileName.value
  }

  function removeProfile(name) {
    const target = resolveSourceProfileNameInList(name, profileList.value, defaultProfileName.value)
    if (!target || target.toLowerCase() === defaultProfileName.value.toLowerCase()) return null
    if (target.toLowerCase() === activeProfileName.value.toLowerCase()) return null
    const nextList = sanitizeSourceProfileList(
      profileList.value.filter((item) => item.toLowerCase() !== target.toLowerCase()),
      defaultProfileName.value
    )
    profileList.value = nextList
    selectedProfileName.value = resolveSourceProfileNameInList(
      selectedProfileName.value,
      nextList,
      defaultProfileName.value
    )
    persistState()
    return { removed: target, fallback: activeProfileName.value, wasActive: false }
  }

  function validateProfileRename(profileName, nextProfileName) {
    const current = resolveSourceProfileNameInList(
      profileName,
      profileList.value,
      defaultProfileName.value
    )
    return validateSourceProfileName(nextProfileName, profileList.value, {
      excludeProfileName: current
    })
  }

  function renameProfile(profileName, nextProfileName) {
    const key = identifierRef.value
    if (!key) return null
    const result = renameSourceProfile(sourceKey, key, profileName, nextProfileName)
    if (!result?.ok) return result
    profileList.value = result.list
    selectedProfileName.value = result.selected
    defaultProfileName.value = result.defaultProfile
    return result
  }

  watch(
    () => identifierRef.value,
    () => {
      loadState()
    },
    { immediate: true }
  )

  // 监听全局配置方案注册表更新事件：当离线包导入新建配置、其他视图切换配置时，
  // 同一窗口内的所有 useModSourceProfiles 实例都需要从 localStorage 拉取最新状态，
  // 否则 mod-list 的下拉菜单会显示陈旧的 list / selected。
  function handleRegistryUpdated(event) {
    const detail = event?.detail || {}
    if (detail.source && detail.source !== sourceKey) return
    const detailIdentifier = normalizeSourceProfileKeySegment(detail.identifier || '')
    if (detailIdentifier && detailIdentifier !== identifierRef.value) return
    loadState()
  }
  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener(SOURCE_PROFILE_REGISTRY_UPDATED_EVENT, handleRegistryUpdated)
  })
  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener(SOURCE_PROFILE_REGISTRY_UPDATED_EVENT, handleRegistryUpdated)
  })

  return {
    DEFAULT_PROFILE_NAME,
    PROFILE_NAME_MAX_LENGTH,
    PROFILE_NAME_INVALID_PATTERN,
    profileList,
    selectedProfileName,
    defaultProfileName,
    activeProfileName,
    profileOptions,
    loadState,
    persistState,
    setSelectedProfile,
    addProfile,
    ensureProfile,
    removeProfile,
    renameProfile,
    validateNewProfileName,
    validateProfileRename,
    resolveProfileNameInList: (name) =>
      resolveSourceProfileNameInList(name, profileList.value, defaultProfileName.value),
    sanitizeProfileList: (list) => sanitizeSourceProfileList(list, defaultProfileName.value),
    normalizeProfileName: normalizeSourceProfileName
  }
}
