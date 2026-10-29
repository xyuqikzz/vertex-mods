<script setup>
const { t: uiText } = useI18n()
import { uiMessage } from '../../../i18n/message.js'

import { gamePresentation, contentLocale } from '@renderer/i18n/content.js'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { Modal } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageBody from '@renderer/component/page-body.vue'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { requestSystemConfigSettings } from '@renderer/utils/config-request.js'
import { TtlLruCache } from '../../../../../shared/utils/ttl-lru-cache.js'
import { useMenuName } from '@renderer/hooks/useMenuName.js'
import { useAiPageContextProvider } from '@renderer/composables/ai-page-context-overrides.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { useGameStore } from '@renderer/store/gameStore.js'
import {
  isAiTranslationAvailable,
  queryCachedTextBatch as queryCachedTextBatchService,
  resolveEdgeSearchKeyword,
  resolveAiTranslationConfig,
  translateTextBatch as translateTextBatchService,
  translateTextBatchByEdge
} from '@renderer/utils/ai-translation.js'
import { waitForUiRender } from '@renderer/utils/ui-render.js'
import UnifiedModHeader from '@views/game/component/unifiedModList/UnifiedModHeader.vue'
import UnifiedModSearchBar from '@views/game/component/unifiedModList/UnifiedModSearchBar.vue'
import UnifiedModListGrid from '@views/game/component/unifiedModList/UnifiedModListGrid.vue'
import { buildGameSiteDetailRoute } from '@views/game/site-detail-route.js'
import {
  buildCommunityPackagePageUrl,
  getCommunityDetailWithCover,
  getCommunityFilters,
  getCommunityModListPage,
  getCommunityPackageDetail,
  getCommunityPackageVersions,
  getPackageVersionDetail,
  getAllPackageVersionDependencies,
  getR2modmanGameMetaByCommunity
} from '@renderer/utils/community-api.js'
import {
  DEFAULT_AI_TRANSLATION_CONFIG,
  normalizeAiTranslationConfig
} from '../../../../../shared/translation/ai-translation-config.js'
import {
  createSourceInstallTaskRefreshScheduler,
  createSourceInstallTaskSubscriptions,
  shouldRefreshInstalledModsAfterSourceTask
} from '@renderer/utils/source-install-task-events.js'
import {
  CREATE_SOURCE_MODPACK,
  GET_SOURCE_MODPACK_BY_CODE
} from '@renderer/api/modules/source-modpack.js'
import {
  buildSourceModpackImportProfileName,
  buildSourceModpackCreatePayload,
  copySourceModpackTextToClipboard,
  extractSourceModpackShareCode,
  getSourceModpackDetailItems,
  getSourceModpackDetailPack
} from '@renderer/utils/source-modpack-share.js'
import { requestSourceModpackShareName } from '@renderer/utils/source-modpack-share-name.js'
import { inspectShareImport, applyShareImport } from '@renderer/utils/source-modpack-coordinator-runtime.js'
import { requestSourceModpackInspectionConfirmation } from '@renderer/utils/source-modpack-import-ui.js'
import { resolveGameNameFromDict } from '@renderer/utils/game-name-dict.js'
import { writeSourceProfiles } from '@renderer/utils/source-profile-registry.js'
import ModSourceProfileModal from '@renderer/views/game/component/profile/mod-source-profile-modal.vue'
import ModSourceCreateProfileModal from '@renderer/views/game/component/profile/mod-source-create-profile-modal.vue'
import SourceModpackUpdateModal from '@renderer/views/game/sourceModpack/component/SourceModpackUpdateModal.vue'
import { buildCsmPayload, signCsmPayload } from '@renderer/utils/cross-source-modpack-schema.js'
import {
  openOfflinePackExportDialog,
  openOfflinePackImportDialog,
  pickOfflinePackImportFile
} from '@renderer/views/game/vxpack/vxpack-service.js'
import SourceModpackShareCodeModal from '@renderer/views/game/component/source-modpack-share-code-modal.vue'
import ThunderstoreInstallProgress from './component/thunderstore-install-progress.vue'
import ThunderstoreInstallVersionModal from './component/thunderstore-install-version-modal.vue'

const DEFAULT_PROFILE_NAME = 'default'
const PROFILE_STORAGE_KEY = 'vertex_thunderstore_profile_registry_v1'
const PROFILE_NAME_MAX_LENGTH = 32
const PROFILE_NAME_INVALID_PATTERN = /[\\/:*?"<>|]/

const route = useRoute()
const pageRoutePath = route.path
let skippedInitialActivation = false
let initialPageLoad = null
const router = useRouter()
const aiPageContextProvider = useAiPageContextProvider(route)
const gameStore = useGameStore()
const { setMenuName: setPageMenuName } = useMenuName()
const downloadStore = useDownloadStore()

const loading = ref(false)
const installingMap = ref({})
const systemConfig = ref({
  aiTranslation: normalizeAiTranslationConfig(DEFAULT_AI_TRANSLATION_CONFIG)
})
const thunderstoreTranslationMap = ref({})
const thunderstoreTranslationResolvedMap = ref({})
const thunderstorePageTranslationLoading = ref(false)
const thunderstorePageTranslationProgress = ref({
  current: 0,
  total: 0
})
const thunderstoreItemTranslationLoadingMap = ref({})
let thunderstoreTranslationToken = 0

const community = ref({
  identifier: '',
  name: '',
  shortDescription: '',
  description: '',
  discordUrl: '',
  wikiUrl: '',
  datetimeCreated: '',
  backgroundImage: '',
  heroImage: '',
  coverImage: '',
  iconUrl: '',
  communityIconUrl: '',
  totalDownloadCount: 0,
  totalPackageCount: 0,
  hasModManagerSupport: false,
  isListed: false
})

async function resolveThunderstoreCommunityDisplayName() {
  const rawName = String(community.value?.name || community.value?.identifier || '').trim()
  if (!rawName) {
    return
  }

  try {
    const resolved = await resolveGameNameFromDict({
      sourcePlatform: 'thunderstore',
      rawName,
      fallbackName: community.value?.name || community.value?.identifier
    })
    const displayName = String(resolved?.displayName || '').trim()
    if (displayName) {
      community.value = {
        ...community.value,
        englishTitle: community.value.englishTitle || resolved?.rawName || rawName,
        name: displayName
      }
    }
  } catch (error) {
    console.warn('[Thunderstore] 游戏中文名字典解析失败', error)
  }
}

const gameRuntime = ref({
  source: 'r2modman',
  displayName: '',
  steamAppIds: [],
  exeNames: [],
  steamFolderName: '',
  packageLoader: '',
  installed: false,
  appId: 0
})

const { t } = useI18n()
const query = ref({
  page: 1,
  limit: 20,
  keyword: '',
  effectiveKeyword: '',
  sort: 'rating_desc',
  // Thunderstore 分类 ID，空字符串表示全部分类。
  category: ''
})
const communityCategories = ref([])
let communityCategoriesToken = 0
const categoryOptions = computed(() =>
  communityCategories.value.map((item) => ({ value: item.id, label: item.name }))
)
const thunderstoreAutoTranslationInFlightSignature = ref('')
const thunderstoreAutoTranslationCompletedSignature = ref('')
let thunderstoreSearchResolveToken = 0

function createEmptyInstallVersionModalState() {
  return {
    open: false,
    mode: 'install',
    confirmLoading: false,
    item: null,
    profileName: DEFAULT_PROFILE_NAME,
    currentVersion: '',
    versionNumber: '',
    versions: [],
    versionListLoading: false,
    versionDetailLoading: false,
    selectedVersionDetail: null,
    dependencyItems: [],
    dependencyItemsLoading: false
  }
}

const allMods = ref([])
const modTotal = ref(0)
const installedMap = ref({})
const installedThunderstoreRefreshScheduler = createSourceInstallTaskRefreshScheduler(
  () => refreshInstalledState(),
  {
    logMessage: '刷新 Thunderstore 已安装模组失败'
  }
)
const allProfileInstalledSummary = ref({
  stats: [],
  totalCount: 0,
  totalSize: 0
})
const updatingMap = ref({})
const versionDialogLoadingMap = ref({})
const updateRecords = ref([])
const updatesLoading = ref(false)

const installVersionModal = ref(createEmptyInstallVersionModalState())

const installProgress = ref({
  visible: false,
  jobId: '',
  stage: '',
  percent: 0,
  packageFullName: '',
  currentIndex: 0,
  totalCount: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  message: ''
})

const launchingModded = ref(false)
const sharingProfile = ref(false)
const importingProfile = ref(false)
const batchInstallingFromProfile = ref(false)
const installProgressHideTimer = ref(null)
const importProfileModal = ref({
  open: false,
  code: ''
})
const sourceModpackUpdateModal = ref({ open: false, snapshot: null })

const defaultProfileName = ref(DEFAULT_PROFILE_NAME)
const profileList = ref([DEFAULT_PROFILE_NAME])
const selectedProfileName = ref(DEFAULT_PROFILE_NAME)
const profileSwitching = ref(false)
const createProfileModal = ref({
  open: false,
  confirmLoading: false,
  name: ''
})
const profileConfigModal = ref({
  open: false
})
const launchConfig = ref({
  community: '',
  profileName: DEFAULT_PROFILE_NAME,
  profileRoot: '',
  appId: 0,
  gameExePath: '',
  gameInstalled: false,
  packageLoader: '',
  launchArgs: [],
  moddedLaunchArgs: [],
  vanillaLaunchArgs: [],
  env: {},
  notes: []
})

const sortOptions = [
  { get label() { return uiText('ui.highestRated') }, value: 'rating_desc' },
  { get label() { return uiText('ui.mostDownloaded') }, value: 'downloads_desc' },
  { get label() { return uiText('tools.recentlyUpdated') }, value: 'updated_desc' }
]

let thunderstoreListToken = 0
let thunderstoreListReloadTimer = null
let thunderstoreInstallModalToken = 0
const thunderstorePackageVersionsCache = new TtlLruCache({ max: 300, ttl: 10 * 60 * 1000 })
const thunderstorePackageVersionDetailCache = new TtlLruCache({ max: 800, ttl: 10 * 60 * 1000 })
const thunderstorePackageVersionDependenciesCache = new TtlLruCache({
  max: 800,
  ttl: 10 * 60 * 1000
})

const activeProfileName = computed(() => {
  return resolveProfileNameInList(selectedProfileName.value, profileList.value)
})

const profileOptions = computed(() => {
  return sanitizeProfileList(profileList.value).map((item) => {
    const isDefault = item.toLowerCase() === defaultProfileName.value.toLowerCase()
    return {
      label: isDefault ? uiText('ui.valueDefault', { value1: (item) }) : item,
      name: item,
      value: item,
      isDefault
    }
  })
})

const profileOperationLocked = computed(() => {
  if (
    profileSwitching.value ||
    launchingModded.value ||
    sharingProfile.value ||
    importingProfile.value
  ) {
    return true
  }
  if (batchInstallingFromProfile.value) {
    return true
  }
  if (Object.values(installingMap.value || {}).some(Boolean)) {
    return true
  }
  return false
})

const gameInstallStateResolving = ref(false)
const localBindingPathSelecting = ref(false)
const hasDetectedGame = computed(() => {
  const gameExePath = String(launchConfig.value.gameExePath || '').trim()
  return !!gameExePath || !!gameRuntime.value.installed
})

function normalizeIdentifier(id) {
  return String(id || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function normalizeProfileName(name) {
  return String(name || '').trim()
}

function sanitizeProfileList(input, fallbackDefaultProfile = defaultProfileName.value) {
  const source = Array.isArray(input) ? input : []
  const result = []
  const seen = new Set()

  const pushItem = (rawName) => {
    const text = normalizeProfileName(rawName)
    if (!text) {
      return
    }

    const key = text.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    result.push(text)
  }

  pushItem(fallbackDefaultProfile || DEFAULT_PROFILE_NAME)
  for (const item of source) {
    pushItem(item)
  }

  return result
}

function resolveProfileNameInList(name, list = profileList.value) {
  const target = normalizeProfileName(name)
  const safeList = sanitizeProfileList(list)
  if (!target) {
    return safeList[0] || defaultProfileName.value || DEFAULT_PROFILE_NAME
  }

  const hit = safeList.find((item) => item.toLowerCase() === target.toLowerCase())
  return hit || safeList[0] || defaultProfileName.value || DEFAULT_PROFILE_NAME
}

function readProfileStorage() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {}
    }
    return data
  } catch {
    return {}
  }
}

function loadProfileStateByCommunity(identifier) {
  const key = normalizeIdentifier(identifier)
  if (!key) {
    defaultProfileName.value = DEFAULT_PROFILE_NAME
    profileList.value = sanitizeProfileList([])
    selectedProfileName.value = DEFAULT_PROFILE_NAME
    return
  }

  const storage = readProfileStorage()
  const record = storage[key]
  const requestedDefault = normalizeProfileName(record?.defaultProfile) || DEFAULT_PROFILE_NAME
  defaultProfileName.value = requestedDefault
  const list = sanitizeProfileList(record?.list, requestedDefault)
  defaultProfileName.value = resolveProfileNameInList(requestedDefault, list)
  const selected = resolveProfileNameInList(record?.selected, list)

  profileList.value = list
  selectedProfileName.value = selected
}

function persistProfileStateByCommunity(
  identifier = community.value.identifier || route.params.id
) {
  const key = normalizeIdentifier(identifier)
  if (!key) {
    return
  }

  const list = sanitizeProfileList(profileList.value)
  const selected = resolveProfileNameInList(selectedProfileName.value, list)

  profileList.value = list
  selectedProfileName.value = selected
  writeSourceProfiles('thunderstore', key, list, selected, {
    defaultProfileName: defaultProfileName.value
  })
}

function ensureImportProfileSelected(profileName = '') {
  const normalized = normalizeProfileName(profileName)
  if (!normalized) {
    return activeProfileName.value
  }
  const nextList = sanitizeProfileList([...profileList.value, normalized])
  profileList.value = nextList
  selectedProfileName.value = resolveProfileNameInList(normalized, nextList)
  persistProfileStateByCommunity()
  return activeProfileName.value
}

function removeProfileStateByCommunity(
  profileName,
  identifier = community.value.identifier || route.params.id
) {
  const key = normalizeIdentifier(identifier)
  const targetProfileName = normalizeProfileName(profileName)
  if (!key || !targetProfileName) {
    return
  }

  const storage = readProfileStorage()
  const record = storage[key]
  if (!record || typeof record !== 'object') {
    return
  }

  const nextList = sanitizeProfileList(record?.list).filter(
    (item) => item.toLowerCase() !== targetProfileName.toLowerCase()
  )
  const recordDefault = normalizeProfileName(record?.defaultProfile) || DEFAULT_PROFILE_NAME
  const resolvedList = sanitizeProfileList(nextList, recordDefault)
  const fallbackSelected = resolveProfileNameInList(
    String(record?.selected || '').toLowerCase() === targetProfileName.toLowerCase()
      ? recordDefault
      : record?.selected,
    resolvedList
  )

  writeSourceProfiles('thunderstore', key, resolvedList, fallbackSelected, {
    defaultProfileName: recordDefault
  })

  profileList.value = resolvedList
  selectedProfileName.value = resolveProfileNameInList(selectedProfileName.value, resolvedList)
}

function toPlainStringList(input) {
  if (!Array.isArray(input)) {
    return []
  }
  return input.map((item) => String(item || '').trim()).filter(Boolean)
}

function toPlainNumberList(input) {
  if (!Array.isArray(input)) {
    return []
  }
  return input.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
}

function pickLatestVersion(item) {
  const versions = Array.isArray(item?.versions) ? item.versions : []
  return versions.find((version) => version?.is_active !== false) || versions[0] || {}
}

function normalizeThunderstoreFullName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseThunderstorePackageFullName(fullName = '') {
  const raw = String(fullName || '').trim()
  const match = raw.match(/^([^-]+)-(.+)$/)
  if (!match) {
    return {
      namespace: '',
      packageName: '',
      fullName: raw
    }
  }

  return {
    namespace: String(match[1] || '').trim(),
    packageName: String(match[2] || '').trim(),
    fullName: raw
  }
}

function isValidSiteDetailUrl(url = '') {
  return /^https?:\/\/[^\s"']+$/i.test(String(url || '').trim())
}

function getCurrentCommunityIdentifier() {
  return normalizeIdentifier(community.value.identifier || route.params.id)
}

function resolveThunderstoreOrdering(sort = query.value.sort) {
  switch (String(sort || '').trim()) {
    case 'downloads_desc':
      return 'most-downloaded'
    case 'updated_desc':
      return 'last-updated'
    case 'rating_desc':
    default:
      return 'top-rated'
  }
}

function toThunderstoreContextNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeThunderstoreContextVersion(version = {}, fallback = {}) {
  const versionNumber = String(
    version?.version_number ||
      version?.versionNumber ||
      version?.version ||
      fallback?.versionNumber ||
      ''
  ).trim()
  const downloadUrl = String(
    version?.download_url || version?.downloadUrl || version?.install_url || ''
  ).trim()
  const dependencies = Array.isArray(version?.dependencies) ? version.dependencies : []
  const dependencyCount = Math.max(
    dependencies.length,
    toThunderstoreContextNumber(version?.dependencyCount || version?.dependency_count, 0)
  )

  return {
    version: versionNumber,
    versionNumber,
    fileId: String(version?.uuid || version?.id || versionNumber || '').trim(),
    fileName: String(
      version?.name ||
        fallback?.fileName ||
        (versionNumber ? `${fallback?.fullName || ''}@${versionNumber}` : fallback?.fullName || '')
    ).trim(),
    fileSize: toThunderstoreContextNumber(version?.file_size || version?.fileSize, 0),
    downloadAvailable: Boolean(downloadUrl),
    downloadUrl,
    dependencyCount
  }
}

function buildThunderstoreAiContextMod() {
  const modal = installVersionModal.value || {}
  const item = modal.item || null
  if (!item) return {}

  const fullName = String(item?.full_name || item?.fullName || '').trim()
  if (!fullName) return {}

  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  const versionNumber = String(modal.versionNumber || '').trim()
  const selectedVersionFromList =
    (Array.isArray(modal.versions) ? modal.versions : []).find(
      (version) => String(version?.version_number || '').trim() === versionNumber
    ) || null
  const selectedVersion = normalizeThunderstoreContextVersion(
    {
      ...(selectedVersionFromList || {}),
      ...(modal.selectedVersionDetail || {}),
      version_number:
        versionNumber ||
        selectedVersionFromList?.version_number ||
        modal.selectedVersionDetail?.version_number
    },
    {
      fullName,
      versionNumber,
      fileName: versionNumber ? `${fullName}@${versionNumber}` : fullName
    }
  )
  const dependencyCount = Math.max(
    selectedVersion.dependencyCount,
    Array.isArray(modal.dependencyItems) ? modal.dependencyItems.length : 0
  )
  const selectedFileName = String(
    selectedVersion.fileName || (versionNumber ? `${fullName}@${versionNumber}` : fullName)
  ).trim()
  const selectedFile = {
    fileId: String(selectedVersion.fileId || versionNumber || fullName).trim(),
    fileName: selectedFileName,
    version: String(selectedVersion.version || versionNumber).trim(),
    fileSize: selectedVersion.fileSize,
    downloadAvailable: selectedVersion.downloadAvailable,
    downloadUrl: selectedVersion.downloadUrl
  }
  const versions = (Array.isArray(modal.versions) ? modal.versions : [])
    .slice(0, 20)
    .map((version) =>
      normalizeThunderstoreContextVersion(version, {
        fullName
      })
    )

  return {
    source: 'thunderstore',
    modId: fullName,
    id: fullName,
    name: String(item?.name || item?.displayName || packageName || fullName).trim(),
    title: String(item?.name || item?.displayName || packageName || fullName).trim(),
    author: String(item?.owner || item?.namespace || namespace || '').trim(),
    packageName: packageName || fullName,
    version: String(selectedFile.version || item?.version || item?.currentVersion || '').trim(),
    selectedVersion,
    fileId: selectedFile.fileId,
    fileName: selectedFile.fileName,
    selectedFileId: selectedFile.fileId,
    selectedFileName: selectedFile.fileName,
    fileSize: selectedFile.fileSize,
    downloadAvailable: selectedFile.downloadAvailable,
    downloadUrl: selectedFile.downloadUrl,
    dependencyCount,
    versions,
    selectedFile
  }
}

function publishThunderstoreAiPageContext() {
  const communityIdentifier = getCurrentCommunityIdentifier()
  if (!communityIdentifier) {
    aiPageContextProvider.clear()
    return false
  }

  const gameName = String(community.value.name || communityIdentifier).trim()
  const packageLoader = String(
    gameRuntime.value.packageLoader || route.query?.packageLoader || ''
  ).trim()
  const appId = Number(
    gameRuntime.value.appId || route.query?.appId || route.query?.steamAppId || 0
  )
  const gameExePath = String(launchConfig.value.gameExePath || '').trim()
  const profileName = activeProfileName.value
  const gameContext = {
    source: 'thunderstore',
    name: gameName,
    sourceGameId: communityIdentifier,
    sourceSlug: communityIdentifier,
    community: communityIdentifier,
    profileName
  }

  if (packageLoader) {
    gameContext.packageLoader = packageLoader
  }
  if (Number.isFinite(appId) && appId > 0) {
    gameContext.appId = String(appId)
  }
  if (gameExePath) {
    gameContext.executableFile = gameExePath
    gameContext.clientExePath = gameExePath
  }

  return aiPageContextProvider.update({
    game: gameContext,
    search: {
      keyword: String(query.value.keyword || '').trim(),
      sort: resolveThunderstoreOrdering(query.value.sort),
      filters: {
        community: communityIdentifier,
        profile: profileName
      }
    },
    mod: buildThunderstoreAiContextMod(),
    install: {
      bindingConfigured: Boolean(gameRuntime.value.installed && gameExePath),
      ruleConfigured: true,
      canCreateInstallPlan: true,
      installRoot: gameExePath,
      profileName
    },
    thunderstore: {
      community: communityIdentifier,
      gameName,
      profileName,
      gameExePath,
      totalPackageCount: Number(community.value.totalPackageCount || 0),
      totalDownloadCount: Number(community.value.totalDownloadCount || 0),
      hasModManagerSupport: Boolean(community.value.hasModManagerSupport),
      installed: Boolean(gameRuntime.value.installed)
    }
  })
}

function sortThunderstoreVersions(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    return getDateTimestamp(b?.date_created) - getDateTimestamp(a?.date_created)
  })
}

function updateThunderstorePageItem(fullName, updater) {
  const normalized = normalizeThunderstoreFullName(fullName)
  if (!normalized || typeof updater !== 'function') {
    return null
  }

  const nextList = [...allMods.value]
  const targetIndex = nextList.findIndex(
    (item) => normalizeThunderstoreFullName(item?.full_name) === normalized
  )
  if (targetIndex < 0) {
    return null
  }

  const currentItem = nextList[targetIndex]
  const nextItem = updater(currentItem)
  if (!nextItem || nextItem === currentItem) {
    return currentItem
  }

  nextList[targetIndex] = nextItem
  allMods.value = nextList
  return nextItem
}

function getThunderstorePageItemByFullName(fullName) {
  const normalized = normalizeThunderstoreFullName(fullName)
  if (!normalized) {
    return null
  }

  return (
    allMods.value.find(
      (item) => normalizeThunderstoreFullName(item?.full_name || item?.fullName) === normalized
    ) || null
  )
}

function buildThunderstorePreviewVersions(item = {}) {
  const existingVersions = Array.isArray(item?.versions) ? item.versions.filter(Boolean) : []
  if (existingVersions.length) {
    return existingVersions
  }

  const versionNumber = String(
    item?.currentVersion || item?.version || item?.installInfo?.version || ''
  ).trim()
  const description = String(item?.description || '').trim()
  const icon = String(item?.iconUrl || item?.icon || '').trim()
  const dateCreated = String(item?.updatedAt || item?.installedAt || '').trim()
  if (!versionNumber && !description && !icon) {
    return []
  }

  return [
    {
      name: String(item?.name || item?.displayName || item?.packageName || '').trim(),
      version_number: versionNumber,
      description,
      icon,
      downloads: 0,
      dependencies: [],
      download_url: '',
      file_size: 0,
      date_created: dateCreated,
      install_url: '',
      website_url: '',
      is_active: true
    }
  ]
}

function mergeThunderstoreVersionsWithPreview(rawVersions = [], previewVersions = []) {
  const versions = Array.isArray(rawVersions) ? rawVersions.filter(Boolean) : []
  const previews = Array.isArray(previewVersions) ? previewVersions.filter(Boolean) : []
  const previewVersion = pickLatestVersion({
    versions: previews
  })

  if (!versions.length) {
    return sortThunderstoreVersions(previews)
  }

  return sortThunderstoreVersions(
    versions.map((item) => ({
      ...item,
      name: String(item?.name || previewVersion?.name || '').trim(),
      description: String(item?.description || previewVersion?.description || '').trim(),
      icon: String(item?.icon || previewVersion?.icon || '').trim(),
      downloads: Number.isFinite(Number(item?.downloads))
        ? Number(item.downloads)
        : Number(previewVersion?.downloads || 0),
      file_size: Number.isFinite(Number(item?.file_size))
        ? Number(item.file_size)
        : Number(previewVersion?.file_size || 0),
      date_created: String(item?.date_created || previewVersion?.date_created || '').trim(),
      install_url: String(item?.install_url || previewVersion?.install_url || '').trim(),
      website_url: String(item?.website_url || previewVersion?.website_url || '').trim(),
      dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
      is_active: item?.is_active !== false
    }))
  )
}

function normalizeThunderstoreVersionModalItem(source = {}) {
  const fullName = String(source?.full_name || source?.fullName || '').trim()
  const communityIdentifier = getCurrentCommunityIdentifier()
  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  const previewVersions = buildThunderstorePreviewVersions(source)
  const installedInfo = getInstallInfoByFullName(fullName)

  return {
    ...source,
    full_name: fullName,
    name: String(source?.name || source?.displayName || source?.packageName || packageName).trim(),
    namespace: String(source?.namespace || namespace).trim(),
    owner: String(source?.owner || source?.ownerName || namespace).trim(),
    package_url: String(
      source?.package_url ||
        source?.packageUrl ||
        buildCommunityPackagePageUrl(communityIdentifier, namespace, packageName)
    ).trim(),
    versions: previewVersions,
    currentVersion: String(
      source?.currentVersion || source?.version || installedInfo?.version || ''
    ).trim()
  }
}

function resolveThunderstoreModalDefaultVersion(mode, versions = [], currentVersion = '') {
  const safeVersions = Array.isArray(versions) ? versions : []
  const installedVersion = String(currentVersion || '').trim()
  if (mode === 'switch' && installedVersion) {
    const matched = safeVersions.find(
      (item) => String(item?.version_number || '').trim() === installedVersion
    )
    if (matched?.version_number) {
      return String(matched.version_number).trim()
    }
  }

  return String(safeVersions[0]?.version_number || '').trim()
}

function buildThunderstoreVersionCacheKey(fullName = '', versionNumber = '') {
  return `${normalizeThunderstoreFullName(fullName)}@${String(versionNumber || '')
    .trim()
    .toLowerCase()}`
}

function parseThunderstoreDependency(depString = '') {
  const raw = String(depString || '').trim()
  if (!raw) {
    return {
      fullName: '',
      requiredVersion: ''
    }
  }

  const match = raw.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
  if (match) {
    return {
      fullName: String(match[1] || '').trim(),
      requiredVersion: String(match[2] || '').trim()
    }
  }

  return {
    fullName: raw,
    requiredVersion: ''
  }
}

function toThunderstoreDependencyReference(item) {
  if (typeof item === 'string') {
    return item.trim()
  }

  if (!item || typeof item !== 'object') {
    return ''
  }

  const fullName = String(item?.full_name || item?.fullName || '').trim()
  const requiredVersion = String(item?.version_number || item?.version || '').trim()
  if (fullName && requiredVersion) {
    return `${fullName}-${requiredVersion}`
  }
  return fullName
}

function buildThunderstoreDependencyPreviewItems(input = []) {
  const source = Array.isArray(input) ? input : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const raw = toThunderstoreDependencyReference(item)
    const { fullName, requiredVersion } = parseThunderstoreDependency(raw)
    if (!fullName) {
      continue
    }

    const normalizedKey = `${normalizeThunderstoreFullName(fullName)}@${String(
      requiredVersion || ''
    )
      .trim()
      .toLowerCase()}`
    if (seen.has(normalizedKey)) {
      continue
    }
    seen.add(normalizedKey)

    const parsed = parseThunderstorePackageFullName(fullName)
    result.push({
      key: normalizedKey,
      fullName,
      namespace: parsed.namespace,
      packageName: parsed.packageName || fullName,
      requiredVersion
    })
  }

  return result
}

function createThunderstoreDownloadBatchId(fullName = '') {
  const seed = String(fullName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  const safeSeed = seed || 'package'
  return `thunderstore_${safeSeed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function toPlainInstallPayload(payload, fallback) {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch (error) {
    console.error('Thunderstore 安装参数序列化失败', error)
    return fallback
  }
}

function isSourceInstallTaskEnabled() {
  return true
}

function buildThunderstoreSourceInstallPayload(planItem = {}, gameExePath = '', options = {}) {
  const fullName = String(planItem?.fullName || planItem?.packageFullName || '').trim()
  const version = String(planItem?.version || '').trim()
  const profileName =
    normalizeProfileName(options?.profileName || activeProfileName.value) || DEFAULT_PROFILE_NAME
  return toPlainInstallPayload(
    {
      source: 'thunderstore',
      sourceType: 'thunderstore',
      sourcePlatform: 'thunderstore',
      sourceAdapter: 'thunderstore',
      sourceGameId: String(community.value.identifier || '').trim(),
      community: String(community.value.identifier || '').trim(),
      appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0,
      gameId: gameRuntime.value.installed ? gameRuntime.value.appId : 0,
      gameExePath,
      packageLoader: gameRuntime.value.packageLoader || '',
      profileName,
      fullName,
      packageFullName: fullName,
      packageOwner: String(planItem?.packageOwner || '').trim(),
      packageName: String(planItem?.packageName || '').trim(),
      displayName: String(planItem?.displayName || planItem?.packageName || fullName).trim(),
      modName: String(planItem?.displayName || planItem?.packageName || fullName).trim(),
      name: String(planItem?.displayName || planItem?.packageName || fullName).trim(),
      version,
      downloadUrl: String(planItem?.downloadUrl || '').trim(),
      fileSize: Number(planItem?.fileSize || 0),
      icon: String(planItem?.icon || '').trim(),
      cover: String(planItem?.icon || '').trim(),
      description: String(planItem?.description || '').trim(),
      packageUrl: String(planItem?.packageUrl || '').trim(),
      dependencies: Array.isArray(planItem?.dependencies) ? planItem.dependencies : [],
      sourceModKey: ['thunderstore', String(community.value.identifier || '').trim(), fullName]
        .filter(Boolean)
        .join(':'),
      cleanupSourceArchiveAfterInstall: false,
      metadata: {
        category: 'thunderstore',
        source: 'thunderstore',
        community: String(community.value.identifier || '').trim(),
        profileName
      }
    },
    {}
  )
}

function buildThunderstoreSourceInstallTaskEntry(
  planItem = {},
  index = 0,
  gameExePath = '',
  options = {}
) {
  const fullName = String(planItem?.fullName || planItem?.packageFullName || '').trim()
  const version = String(planItem?.version || '').trim()
  const sortIndex = Number.isFinite(Number(planItem?.sortIndex))
    ? Number(planItem.sortIndex)
    : index
  const installPayload = buildThunderstoreSourceInstallPayload(planItem, gameExePath, options)
  const downloadOnly = options?.downloadOnly === true
  const preferredFileName = `${fullName}${version ? `-${version}` : ''}.zip`
  return {
    item: {
      task_name: uiText('ui.thunderstoreModDownloadValueValue', { value1: (String(planItem?.displayName || fullName || '未知包').trim()), value2: (version ? `@${version}` : '') }),
      module: '游戏',
      file_type: 'zip',
      download_url: String(planItem?.downloadUrl || '').trim(),
      file_size: Number(planItem?.fileSize || 0),
      saveType: 2,
      sourcePlatform: 'thunderstore',
      sourceType: 'thunderstore',
      sourceGameId: String(community.value.identifier || '').trim(),
      sourceModId: fullName,
      sourceFileId: version,
      sourceModKey: installPayload.sourceModKey,
      packageFullName: fullName,
      version,
      preferredFileName,
      dedupeKey: [
        'thunderstore',
        String(community.value.identifier || '').trim(),
        fullName,
        version
      ]
        .filter(Boolean)
        .join(':'),
      gameExePath,
      ...(downloadOnly ? { downloadPurpose: 'download_only' } : {}),
      fun: {
        type: 0
      }
    },
    meta: {
      ...toPlainInstallPayload(planItem, {}),
      sortIndex,
      sourcePlatform: 'thunderstore',
      sourceType: 'thunderstore',
      displayName: String(planItem?.displayName || fullName || '未知包').trim(),
      version,
      installPayload
    }
  }
}

async function submitThunderstoreSourceInstallTask(payload = {}) {
  return await ipcRenderer.invoke('source-install-task:create', toPlainInstallPayload(payload, {}))
}

function formatNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'
}

function normalizeSystemConfig(data) {
  const target = data && typeof data === 'object' ? data : {}
  return {
    ...target,
    aiTranslation: normalizeAiTranslationConfig(target.aiTranslation)
  }
}

function requestSystemConfig() {
  return requestSystemConfigSettings({})
}

async function loadAiSystemConfig() {
  systemConfig.value = normalizeSystemConfig(await requestSystemConfig())
}

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value)
  }

  const text = String(value || '').trim()
  if (!text) {
    return null
  }

  if (/^\d+$/.test(text)) {
    const timestamp = Number(text)
    if (Number.isFinite(timestamp)) {
      return new Date(text.length === 10 ? timestamp * 1000 : timestamp)
    }
  }

  const directDate = new Date(text)
  if (!Number.isNaN(directDate.getTime())) {
    return directDate
  }

  const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) {
    return null
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

function getDateTimestamp(value) {
  const date = parseDateValue(value)
  return date ? date.getTime() : 0
}

const communityHeroImage = computed(() => {
  return String(
    community.value.heroImage || community.value.coverImage || community.value.backgroundImage || ''
  ).trim()
})

function resolveThunderstorePackagePageUrl(item = {}) {
  const packageUrl = String(item?.package_url || item?.packageUrl || '').trim()
  if (packageUrl) {
    return packageUrl
  }

  const fullName = String(item?.full_name || item?.fullName || '').trim()
  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  return String(
    buildCommunityPackagePageUrl(getCurrentCommunityIdentifier(), namespace, packageName) || ''
  ).trim()
}

function openPackagePage(item) {
  const packageUrl = resolveThunderstorePackagePageUrl(item)
  if (!packageUrl) {
    $message.warning(uiMessage('ui.thisModHasNoDetailsLink'))
    return
  }
  if (!isValidSiteDetailUrl(packageUrl)) {
    $message.warning(uiMessage('ui.thisModSDetailsLinkIsInvalid'))
    return
  }

  const latestVersion = pickLatestVersion(item)
  router.push(
    buildGameSiteDetailRoute({
      url: packageUrl,
      title: String(item?.name || item?.full_name || uiText('ui.modDetails')).trim(),
      subtitle: String(item?.full_name || latestVersion?.version_number || '').trim(),
      source: 'Thunderstore',
      sourceKey: 'thunderstore',
      cover: String(latestVersion?.icon || item?.icon || '').trim(),
      backPath: route.fullPath,
      gameId: String(Number(gameRuntime.value.appId || 0) || '').trim(),
      gameName: String(community.value.name || community.value.identifier || '').trim(),
      sourceGameId: String(community.value.identifier || '').trim(),
      sourceSlug: String(community.value.identifier || '').trim(),
      community: String(community.value.identifier || '').trim(),
      appId: String(Number(gameRuntime.value.appId || 0) || '').trim(),
      modId: String(item?.full_name || '').trim(),
      modName: String(item?.name || item?.full_name || '模组详情').trim(),
      author: String(item?.owner || item?.namespace || '').trim(),
      version: String(latestVersion?.version_number || '').trim()
    })
  )
}

function handleOpenModDetail(card) {
  openPackagePage(card?.raw || card)
}

function handleInstallFromList(card) {
  openInstallVersionModal(card?.raw || card).catch((error) => {
    console.error('打开 Thunderstore 安装版本弹窗失败', error)
  })
}

function handleSecondaryAction(card) {
  const raw = card?.raw || card
  const fullName = String(raw?.full_name || raw?.fullName || '').trim()
  if (!fullName) {
    return
  }
  openInstallVersionModal(raw, {
    mode: 'switch',
    profileName: activeProfileName.value
  }).catch((error) => {
    console.error('打开 Thunderstore 切换版本弹窗失败', error)
  })
}

async function handleSearch() {
  const currentToken = ++thunderstoreSearchResolveToken
  const keyword = String(query.value.keyword || '').trim()
  const resolvedKeyword = await resolveEdgeSearchKeyword({
    keyword,
    source: 'thunderstore',
    scene: 'mod_search_keyword',
    systemConfig: systemConfig.value,
    context: 'Thunderstore 模组搜索'
  })
  if (
    currentToken !== thunderstoreSearchResolveToken ||
    String(query.value.keyword || '').trim() !== keyword
  ) {
    return
  }
  query.value.keyword = keyword
  query.value.effectiveKeyword = resolvedKeyword.effectiveKeyword
  resetPage({ reload: true, immediate: true })
}

function setVersionDialogLoading(fullName = '', loading = false) {
  const key = normalizeThunderstoreFullName(fullName)
  if (!key) {
    return
  }

  const next = { ...versionDialogLoadingMap.value }
  if (loading) {
    next[key] = true
  } else {
    delete next[key]
  }
  versionDialogLoadingMap.value = next
}

function getInstallInfoByFullName(fullName) {
  const direct = installedMap.value[fullName]
  if (direct) {
    return direct
  }
  const key = Object.keys(installedMap.value).find(
    (item) => String(item || '').toLowerCase() === String(fullName || '').toLowerCase()
  )
  return key ? installedMap.value[key] : null
}

function buildSourceMeta() {
  return {
    source: 'thunderstore',
    sourceId: String(community.value.identifier || '').trim(),
    name: String(community.value.name || community.value.identifier || '').trim(),
    backgroundImage: String(
      community.value.backgroundImage ||
        community.value.heroImage ||
        community.value.coverImage ||
        ''
    ).trim()
  }
}

async function getThunderstorePackageVersionsByFullName(fullName, sourceItem = null, options = {}) {
  const normalized = normalizeThunderstoreFullName(fullName)
  if (!normalized) {
    return []
  }
  const syncPageItem = options?.syncPageItem !== false
  const pageItem = getThunderstorePageItemByFullName(fullName)
  const previewVersions = buildThunderstorePreviewVersions(sourceItem || pageItem)
  if (thunderstorePackageVersionsCache.has(normalized)) {
    const cachedVersions = mergeThunderstoreVersionsWithPreview(
      thunderstorePackageVersionsCache.get(normalized) || [],
      previewVersions
    )
    if (syncPageItem) {
      updateThunderstorePageItem(fullName, (currentItem) => ({
        ...currentItem,
        versions: cachedVersions
      }))
    }
    return cachedVersions
  }

  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  if (!namespace || !packageName) {
    throw new Error(uiText('ui.invalidPackageNameValue', { value1: (fullName) }))
  }

  const versions = sortThunderstoreVersions(
    await getCommunityPackageVersions(namespace, packageName)
  )
  thunderstorePackageVersionsCache.set(normalized, versions)
  const mergedVersions = mergeThunderstoreVersionsWithPreview(versions, previewVersions)
  if (syncPageItem) {
    updateThunderstorePageItem(fullName, (currentItem) => ({
      ...currentItem,
      versions: mergedVersions,
      namespace: currentItem?.namespace || namespace,
      name: currentItem?.name || packageName
    }))
  }
  return mergedVersions
}

async function getThunderstoreLatestPackageDetail(fullName, options = {}) {
  const normalized = normalizeThunderstoreFullName(fullName)
  const latestCacheKey = buildThunderstoreVersionCacheKey(fullName, 'latest')
  if (thunderstorePackageVersionDetailCache.has(latestCacheKey)) {
    return thunderstorePackageVersionDetailCache.get(latestCacheKey) || null
  }
  const syncPageItem = options?.syncPageItem !== false

  const communityIdentifier = getCurrentCommunityIdentifier()
  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  if (!communityIdentifier || !namespace || !packageName) {
    throw new Error(uiText('ui.missingPackageDetailsContextValue', { value1: (fullName) }))
  }

  const detail = await getCommunityPackageDetail(communityIdentifier, namespace, packageName)
  const latestVersion = pickLatestVersion(detail)
  const result = {
    fullName: String(detail?.full_name || fullName).trim(),
    namespace,
    packageName: String(detail?.name || packageName).trim(),
    packageOwner: String(detail?.owner || namespace).trim(),
    displayName: String(detail?.name || packageName || fullName).trim(),
    version: String(latestVersion?.version_number || detail?.latest_version_number || '').trim(),
    downloadUrl: String(latestVersion?.download_url || '').trim(),
    fileSize: Number(latestVersion?.file_size || 0),
    icon: String(latestVersion?.icon || '').trim(),
    description: String(latestVersion?.description || '').trim(),
    packageUrl: String(
      detail?.package_url ||
        buildCommunityPackagePageUrl(communityIdentifier, namespace, packageName)
    ).trim()
  }

  thunderstorePackageVersionDetailCache.set(latestCacheKey, result)
  if (result.version) {
    thunderstorePackageVersionDetailCache.set(
      buildThunderstoreVersionCacheKey(fullName, result.version),
      result
    )
  }

  if (syncPageItem) {
    updateThunderstorePageItem(fullName, (currentItem) => {
      const currentVersions = Array.isArray(currentItem?.versions) ? currentItem.versions : []
      const hasRealVersions = currentVersions.some((item) =>
        String(item?.version_number || '').trim()
      )
      return {
        ...currentItem,
        owner: currentItem?.owner || result.packageOwner,
        package_url: currentItem?.package_url || result.packageUrl,
        versions: hasRealVersions ? currentVersions : detail?.versions || currentVersions
      }
    })
  }
  if (normalized && result.version) {
    const cachedVersions = thunderstorePackageVersionsCache.get(normalized) || []
    if (!cachedVersions.length) {
      thunderstorePackageVersionsCache.set(
        normalized,
        sortThunderstoreVersions(detail?.versions || [])
      )
    }
  }

  return result
}

async function getThunderstorePackageVersionDetailByFullName(
  fullName,
  versionNumber,
  options = {}
) {
  const safeVersion = String(versionNumber || '').trim()
  if (!safeVersion) {
    return getThunderstoreLatestPackageDetail(fullName, options)
  }

  const normalized = normalizeThunderstoreFullName(fullName)
  const cacheKey = buildThunderstoreVersionCacheKey(fullName, safeVersion)
  if (thunderstorePackageVersionDetailCache.has(cacheKey)) {
    return thunderstorePackageVersionDetailCache.get(cacheKey) || null
  }
  const syncPageItem = options?.syncPageItem !== false

  const communityIdentifier = getCurrentCommunityIdentifier()
  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  if (!namespace || !packageName) {
    throw new Error(uiText('ui.invalidPackageNameValue', { value1: (fullName) }))
  }

  const detail = await getPackageVersionDetail(namespace, packageName, safeVersion)
  const result = {
    fullName: String(detail?.full_name || fullName).trim(),
    namespace,
    packageName: String(detail?.name || packageName).trim(),
    packageOwner: String(detail?.owner || namespace).trim(),
    displayName: String(detail?.name || packageName || fullName).trim(),
    version: String(detail?.version_number || safeVersion).trim(),
    downloadUrl: String(detail?.download_url || '').trim(),
    fileSize: Number(detail?.file_size || 0),
    icon: String(detail?.icon || '').trim(),
    description: String(detail?.description || '').trim(),
    packageUrl: String(
      buildCommunityPackagePageUrl(communityIdentifier, namespace, packageName) || ''
    ).trim(),
    dependencyCount: Number(detail?.dependency_count || 0),
    dependencies: Array.isArray(detail?.dependencies) ? detail.dependencies : []
  }

  thunderstorePackageVersionDetailCache.set(cacheKey, result)
  if (normalized) {
    const cachedVersions = Array.isArray(thunderstorePackageVersionsCache.get(normalized))
      ? thunderstorePackageVersionsCache.get(normalized)
      : []
    const versionDetail = {
      name: result.displayName,
      version_number: result.version,
      description: result.description,
      icon: result.icon,
      downloads: Number(detail?.downloads || 0),
      download_url: result.downloadUrl,
      file_size: result.fileSize,
      date_created: String(detail?.date_created || '').trim(),
      install_url: String(detail?.install_url || '').trim(),
      website_url: String(detail?.website_url || '').trim(),
      dependencies: Array.isArray(detail?.dependencies) ? detail.dependencies : [],
      is_active: true
    }
    const nextCachedVersions = cachedVersions.length
      ? cachedVersions.map((item) =>
          String(item?.version_number || '').trim() === result.version
            ? {
                ...item,
                ...versionDetail
              }
            : item
        )
      : [versionDetail]
    thunderstorePackageVersionsCache.set(normalized, sortThunderstoreVersions(nextCachedVersions))
  }
  if (syncPageItem) {
    updateThunderstorePageItem(fullName, (currentItem) => ({
      ...currentItem,
      owner: currentItem?.owner || result.packageOwner,
      package_url: currentItem?.package_url || result.packageUrl,
      versions: mergeThunderstoreVersionsWithPreview(
        Array.isArray(thunderstorePackageVersionsCache.get(normalized))
          ? thunderstorePackageVersionsCache.get(normalized)
          : buildThunderstorePreviewVersions(currentItem),
        buildThunderstorePreviewVersions(currentItem)
      )
    }))
  }
  return result
}

async function getThunderstoreVersionDependenciesByFullName(fullName, versionNumber) {
  const safeVersion = String(versionNumber || '').trim()
  if (!safeVersion) {
    return []
  }

  const cacheKey = buildThunderstoreVersionCacheKey(fullName, safeVersion)
  if (thunderstorePackageVersionDependenciesCache.has(cacheKey)) {
    return thunderstorePackageVersionDependenciesCache.get(cacheKey) || []
  }

  const { namespace, packageName } = parseThunderstorePackageFullName(fullName)
  if (!namespace || !packageName) {
    throw new Error(uiText('ui.invalidPackageNameValue', { value1: (fullName) }))
  }

  const dependencies = await getAllPackageVersionDependencies(namespace, packageName, safeVersion)
  const dependencyStrings = dependencies
    .map((item) => {
      if (!item?.full_name || !item?.version_number) {
        return ''
      }
      return `${item.full_name}-${item.version_number}`
    })
    .filter(Boolean)

  thunderstorePackageVersionDependenciesCache.set(cacheKey, dependencyStrings)
  return dependencyStrings
}

async function buildThunderstoreDownloadPlan(rootItem, rootVersionNumber = '') {
  const targetFullName = String(rootItem?.full_name || '').trim()
  if (!targetFullName) {
    throw new Error(uiText('ui.packageIdentifierMissingCannotCreateInstallationPlan'))
  }

  const result = await ipcRenderer.invoke(
    'thunderstoreBuildSourceInstallTaskPlan',
    toPlainInstallPayload(
      {
        community: community.value.identifier,
        packageFullName: targetFullName,
        versionNumber: String(rootVersionNumber || '').trim(),
        profileName: activeProfileName.value,
        packageLoader: gameRuntime.value.packageLoader || '',
        appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0
      },
      {}
    )
  )
  const plan = Array.isArray(result?.installPlan) ? result.installPlan : []

  if (!plan.length) {
    throw new Error(uiText('ui.thisVersionAndItsDependenciesAreAlreadyInstalledNoDownload'))
  }

  return plan
}

function isInstalled(item) {
  return !!getInstallInfoByFullName(item?.full_name)
}

const enrichedMods = computed(() => {
  return allMods.value.map((item) => {
    const latestVersion = pickLatestVersion(item)
    return {
      ...item,
      latestVersion,
      dependencyCount: Array.isArray(latestVersion?.dependencies)
        ? latestVersion.dependencies.length
        : 0,
      installed: isInstalled(item),
      installInfo: getInstallInfoByFullName(item?.full_name)
    }
  })
})

const filteredMods = computed(() => enrichedMods.value)

const total = computed(() => Math.max(Number(modTotal.value || 0), 0))
const pages = computed(() => Math.max(Math.ceil(total.value / query.value.limit), 1))
const pageMods = computed(() => filteredMods.value)
const aiTranslationConfig = computed(() => resolveAiTranslationConfig(systemConfig.value))
const canUseThunderstoreAiTranslation = computed(() =>
  isAiTranslationAvailable(systemConfig.value, 'thunderstore')
)
function countUntranslatedThunderstoreMods(list = pageMods.value) {
  return (Array.isArray(list) ? list : []).filter(
    (item) => !isThunderstoreCardTranslationResolved(item)
  ).length
}

const untranslatedThunderstoreModCount = computed(() => {
  return countUntranslatedThunderstoreMods(pageMods.value)
})
const thunderstoreFloatingActions = computed(() => {
  if (!canUseThunderstoreAiTranslation.value || !pageMods.value.length) {
    return []
  }

  return [
    {
      key: 'translate-current-page',
      label: untranslatedThunderstoreModCount.value > 0 ? uiText('ui.translateCurrentPage') : uiText('ui.currentPageTranslated'),
      loading: thunderstorePageTranslationLoading.value,
      get loadingText() { return uiText('ui.translateCurrentPage') },
      progressCurrent: thunderstorePageTranslationProgress.value.current,
      progressTotal: thunderstorePageTranslationProgress.value.total,
      disabled:
        thunderstorePageTranslationLoading.value || untranslatedThunderstoreModCount.value <= 0,
      visible: true
    }
  ]
})

const headerTags = computed(() => {
  const tags = ['Thunderstore']
  const communityIdentifier = String(community.value.identifier || '').trim()
  if (communityIdentifier) {
    tags.push(uiText('ui.communityValue', { value1: (communityIdentifier) }))
  }
  if (community.value.hasModManagerSupport) {
    tags.push('支持管理器')
  }
  return tags
})

const headerStats = computed(() => {
  const stats = [
    {
      get label() { return uiText('modBrowser.count') },
      value: formatNumber(total.value),
      accent: true
    }
  ]
  const totalDownloadCount = Number(community.value.totalDownloadCount || 0)
  if (Number.isFinite(totalDownloadCount) && totalDownloadCount > 0) {
    stats.push({
      get label() { return uiText('ui.totalDownloads') },
      value: formatNumber(totalDownloadCount)
    })
  }
  if (community.value.identifier) {
    const updateCount = Array.isArray(updateRecords.value) ? updateRecords.value.length : 0
    stats.push({
      label: t('modBrowser.installedCount'),
      value: formatNumber(activeProfileInstalledCount.value),
      hint: updateCount > 0 ? t('modBrowser.updatesAvailableCount', { count: updateCount }) : '',
      hintTone: 'warning'
    })
  }
  return stats
})

const headerStatusType = computed(() => (hasDetectedGame.value ? 'success' : 'danger'))
const headerStatusText = computed(() => (hasDetectedGame.value ? '已找到游戏' : '未找到游戏'))
const headerStatusSubText = computed(() => '')

function buildThunderstoreTitleTranslationKey(item = {}) {
  return `mod:${normalizeThunderstoreFullName(item?.full_name || item?.uuid4 || item?.name)}:title`
}

function buildThunderstoreSummaryTranslationKey(item = {}) {
  return `mod:${normalizeThunderstoreFullName(item?.full_name || item?.uuid4 || item?.name)}:summary`
}

function getThunderstoreDisplayTitle(item = {}) {
  return String(item?.name || item?.full_name || '').trim()
}

function getThunderstoreTranslatableTitleText(item = {}) {
  return getThunderstoreDisplayTitle(item)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeThunderstoreTranslatedTitleComparableText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function mergeThunderstoreTranslationResultMap(resultMap = new Map()) {
  if (!(resultMap instanceof Map) || resultMap.size <= 0) {
    return 0
  }

  const nextTextState = {
    ...thunderstoreTranslationMap.value
  }
  const nextResolvedState = {
    ...thunderstoreTranslationResolvedMap.value
  }
  let updatedCount = 0

  resultMap.forEach((text, key) => {
    const safeKey = String(key || '').trim()
    if (!safeKey) {
      return
    }

    nextTextState[safeKey] = String(text || '')
    nextResolvedState[safeKey] = true
    updatedCount += 1
  })

  thunderstoreTranslationMap.value = nextTextState
  thunderstoreTranslationResolvedMap.value = nextResolvedState
  return updatedCount
}

function getThunderstoreTranslatedTitle(item = {}) {
  if (!canUseThunderstoreAiTranslation.value) {
    return ''
  }

  const original = getThunderstoreDisplayTitle(item)
  const translated = String(
    thunderstoreTranslationMap.value[buildThunderstoreTitleTranslationKey(item)] || ''
  ).trim()
  return translated &&
    normalizeThunderstoreTranslatedTitleComparableText(translated) !==
      normalizeThunderstoreTranslatedTitleComparableText(original)
    ? translated
    : ''
}

function getThunderstoreTranslatedDescription(item = {}) {
  if (!canUseThunderstoreAiTranslation.value) {
    return ''
  }

  const original = String(item?.latestVersion?.description || '').trim()
  const translated = String(
    thunderstoreTranslationMap.value[buildThunderstoreSummaryTranslationKey(item)] || ''
  ).trim()
  return translated && translated !== original ? translated : ''
}

function isThunderstoreTranslationKeyResolved(translationKey = '') {
  return !!thunderstoreTranslationResolvedMap.value[String(translationKey || '').trim()]
}

function isThunderstoreCardTranslationResolved(item = {}) {
  const requiredKeys = []
  if (String(item?.name || item?.full_name || '').trim()) {
    requiredKeys.push(buildThunderstoreTitleTranslationKey(item))
  }
  if (String(item?.latestVersion?.description || '').trim()) {
    requiredKeys.push(buildThunderstoreSummaryTranslationKey(item))
  }

  return (
    requiredKeys.length <= 0 ||
    requiredKeys.every((translationKey) => isThunderstoreTranslationKeyResolved(translationKey))
  )
}

function buildThunderstoreTranslationRequestItems(list = pageMods.value, options = {}) {
  const safeList = Array.isArray(list) ? list : []
  const unresolvedOnly = !!options?.unresolvedOnly

  return safeList.flatMap((item) => {
    const displayName = getThunderstoreDisplayTitle(item)
    const translatableTitle = getThunderstoreTranslatableTitleText(item) || displayName
    const description = String(item?.latestVersion?.description || '').trim()
    const requestItems = []

    if (translatableTitle) {
      const titleKey = buildThunderstoreTitleTranslationKey(item)
      if (!unresolvedOnly || !isThunderstoreTranslationKeyResolved(titleKey)) {
        requestItems.push({
          id: titleKey,
          text: translatableTitle,
          kind: 'mod_name',
          context: uiText('ui.communityValueOriginalTitleValue', { value1: (community.value.name || community.value.identifier || 'Thunderstore'), value2: (displayName || '--') })
        })
      }
    }

    if (description) {
      const summaryKey = buildThunderstoreSummaryTranslationKey(item)
      if (!unresolvedOnly || !isThunderstoreTranslationKeyResolved(summaryKey)) {
        requestItems.push({
          id: summaryKey,
          text: description,
          kind: 'mod_summary',
          context: uiText('ui.communityValueModValue', { value1: (community.value.name || community.value.identifier || 'Thunderstore'), value2: (displayName || '--') })
        })
      }
    }

    return requestItems
  })
}

async function hydrateThunderstoreModTranslations(list = pageMods.value) {
  const safeList = Array.isArray(list) ? list : []
  thunderstoreTranslationToken += 1
  const currentToken = thunderstoreTranslationToken

  if (!canUseThunderstoreAiTranslation.value || !safeList.length) {
    return
  }

  const requestItems = buildThunderstoreTranslationRequestItems(safeList)
  if (!requestItems.length) {
    return
  }

  try {
    const translatedMap = await queryCachedTextBatchService({
      systemConfig: systemConfig.value,
      source: 'thunderstore',
      scene: 'mod_list_card',
      items: requestItems
    })

    if (currentToken !== thunderstoreTranslationToken || !translatedMap.size) {
      return
    }

    mergeThunderstoreTranslationResultMap(translatedMap)
  } catch (error) {
    console.warn('[THUNDERSTORE] 模组翻译缓存读取失败', error)
  }
}

async function translateThunderstoreMods(list = pageMods.value, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const edgeOnly = options?.edgeOnly === true
  const shouldApplyResult =
    typeof options?.shouldApplyResult === 'function' ? options.shouldApplyResult : () => true
  const requestItems = buildThunderstoreTranslationRequestItems(list, {
    unresolvedOnly: true
  })

  if ((!edgeOnly && !canUseThunderstoreAiTranslation.value) || !requestItems.length) {
    return 0
  }

  const translateService = edgeOnly ? translateTextBatchByEdge : translateTextBatchService
  const translatedMap = await translateService({
    systemConfig: systemConfig.value,
    source: 'thunderstore',
    scene: 'mod_list_card',
    items: requestItems,
    onChunkSettled: onProgress
      ? ({ chunkResultMap }) => {
          if (!shouldApplyResult()) {
            return
          }
          mergeThunderstoreTranslationResultMap(chunkResultMap)
          onProgress()
        }
      : null
  })

  if (onProgress) {
    return 0
  }

  if (!shouldApplyResult()) {
    return 0
  }

  return mergeThunderstoreTranslationResultMap(translatedMap)
}

function buildThunderstoreAutoTranslationSignature(list = pageMods.value) {
  return [
    'thunderstore',
    query.value.page,
    query.value.effectiveKeyword || query.value.keyword,
    query.value.sort,
    (Array.isArray(list) ? list : []).map((item) => item?.full_name || item?.uuid4 || '').join(','),
    aiTranslationConfig.value.targetLanguage
  ].join('|')
}

async function autoTranslateThunderstoreMods(list = pageMods.value) {
  const signature = buildThunderstoreAutoTranslationSignature(list)
  if (
    !signature ||
    thunderstoreAutoTranslationCompletedSignature.value === signature ||
    thunderstoreAutoTranslationInFlightSignature.value === signature
  ) {
    return
  }

  const requestItems = buildThunderstoreTranslationRequestItems(list, {
    unresolvedOnly: true
  })
  if (!requestItems.length) {
    thunderstoreAutoTranslationCompletedSignature.value = signature
    return
  }

  thunderstoreAutoTranslationInFlightSignature.value = signature
  try {
    const translatedCount = await translateThunderstoreMods(list, {
      edgeOnly: true,
      shouldApplyResult: () => thunderstoreAutoTranslationInFlightSignature.value === signature
    })
    if (translatedCount > 0 && thunderstoreAutoTranslationInFlightSignature.value === signature) {
      thunderstoreAutoTranslationCompletedSignature.value = signature
    }
  } catch (error) {
    console.warn('[THUNDERSTORE] 模组自动翻译失败', error)
  } finally {
    if (thunderstoreAutoTranslationInFlightSignature.value === signature) {
      thunderstoreAutoTranslationInFlightSignature.value = ''
    }
  }
}

function resetThunderstorePageTranslationProgress() {
  thunderstorePageTranslationProgress.value = {
    current: 0,
    total: 0
  }
}

function updateThunderstorePageTranslationProgress(total = 0) {
  thunderstorePageTranslationProgress.value = {
    current: Math.max(total - countUntranslatedThunderstoreMods(pageMods.value), 0),
    total: Math.max(Number(total || 0), 0)
  }
}

const listItems = computed(() => {
  return pageMods.value.map((item) => {
    const updateInfo = getUpdateRecordByFullName(item.full_name)
    const translatedTitle = getThunderstoreTranslatedTitle(item)
    const translatedDescription = getThunderstoreTranslatedDescription(item)
    const translationResolved = isThunderstoreCardTranslationResolved(item)
    const itemKey = String(item?.full_name || item?.uuid4 || item?.name || '').trim()
    const versionDialogLoading =
      !!versionDialogLoadingMap.value[normalizeThunderstoreFullName(item?.full_name)]

    return {
      id: item.uuid4 || item.full_name,
      cover: item.latestVersion?.icon || '',
      title: getThunderstoreDisplayTitle(item) || item.full_name,
      translatedTitle,
      subtitle: item.owner ? uiText('ui.authorValueVariant2', { value1: (item.owner) }) : '',
      description: item.latestVersion?.description || uiText('tools.noDescription'),
      translatedDescription,      author: item.owner ? `${item.owner}` : '--',
      tags: [Number(item.dependencyCount) > 0 ? uiText('ui.dependsOnValueMods', { value1: (item.dependencyCount) }) : ''].filter(
        Boolean
      ),
      detailText: '详情',
      installText: hasDetectedGame.value ? '安装' : '下载',
      installable: hasDetectedGame.value ? !item.installed : true,
      installing: !!installingMap.value[item.full_name] || versionDialogLoading,
      installingText: versionDialogLoading
        ? '加载版本...'
        : hasDetectedGame.value
          ? '安装中...'
          : '下载中...',
      secondaryText:
        item.installed && hasDetectedGame.value
          ? versionDialogLoading
            ? '读取版本中...'
            : '切换版本'
          : '',
      secondaryDisabled:
        !hasDetectedGame.value || !!updatingMap.value[item.full_name] || versionDialogLoading,
      translateActionText: thunderstoreItemTranslationLoadingMap.value[itemKey]
        ? '翻译中...'
        : '翻译',
      translateHidden: !canUseThunderstoreAiTranslation.value || translationResolved,
      translateDisabled: !!thunderstoreItemTranslationLoadingMap.value[itemKey],
      installedText: item.installed
        ? updateInfo
          ? uiText('ui.installedValueUpdateAvailable', { value1: (item.installInfo?.version || '') })
          : uiText('ui.installedValue', { value1: (item.installInfo?.version || '') })
        : '',
      downloadCount: item.latestVersion?.downloads,
      raw: item
    }
  })
})

function getInstalledSizeBytes(sourceMap = {}) {
  return Object.values(sourceMap || {}).reduce((total, item) => {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const size = Number(metadata?.fileSize || 0)
    if (!Number.isFinite(size) || size <= 0) {
      return total
    }
    return total + size
  }, 0)
}

const activeProfileInstalledCount = computed(() => Object.keys(installedMap.value || {}).length)
const allProfilesInstalledTotalCount = computed(() =>
  Number(allProfileInstalledSummary.value?.totalCount || 0)
)
const thunderstoreLaunchButtonText = computed(() =>
  activeProfileInstalledCount.value > 0 ? '注入模组' : '启动游戏'
)
const headerActions = computed(() => [
  {
    key: 'profile-scheme',
    get label() { return uiText('modBrowser.profiles') },
    disabled: profileOperationLocked.value
  },
  {
    key: 'manage',
    get label() { return uiText('modBrowser.manage') },
    tone: 'strong',
    disabled: !community.value.identifier || allProfilesInstalledTotalCount.value <= 0
  },
  {
    key: 'manage-local-mod',
    get label() { return uiText('localMod.title') },
    placement: 'more',
    loading: gameInstallStateResolving.value || localBindingPathSelecting.value,
    disabled:
      !community.value.identifier ||
      gameInstallStateResolving.value ||
      localBindingPathSelecting.value
  },
  {
    key: 'launch',
    label: thunderstoreLaunchButtonText.value,
    type: 'primary',
    loading: launchingModded.value,
    disabled:
      !community.value.identifier ||
      !hasDetectedGame.value ||
      profileSwitching.value ||
      batchInstallingFromProfile.value
  },
  {
    key: 'launch-vanilla',
    label: t('modBrowser.launchVanilla'),
    placement: 'primary-menu',
    // 没有已安装模组时主按钮本身就是原版启动，不再重复提供。
    visible: activeProfileInstalledCount.value > 0,
    disabled:
      launchingModded.value ||
      !community.value.identifier ||
      !hasDetectedGame.value ||
      profileSwitching.value ||
      batchInstallingFromProfile.value
  },
  {
    key: 'open-root',
    get label() { return uiText('modBrowser.openRoot') },
    placement: 'more',
    disabled: !launchConfig.value.gameExePath
  },
  {
    key: 'scan',
    get label() { return uiText('ui.scanNow') },
    placement: 'more',
    loading: gameInstallStateResolving.value,
    disabled: !community.value.identifier || gameInstallStateResolving.value
  },
  {
    key: 'manual-bind',
    get label() { return uiText('ui.addManually') },
    placement: 'more',
    loading: localBindingPathSelecting.value,
    disabled: !community.value.identifier || localBindingPathSelecting.value
  },
  {
    key: 'config-file',
    get label() { return uiText('ui.configurationFile') },
    placement: 'more',
    disabled: !community.value.identifier
  }
])
const installProgressStatus = computed(() => {
  if (installProgress.value.stage === 'error') {
    return 'exception'
  }
  if (installProgress.value.stage === 'done') {
    return 'success'
  }
  return 'active'
})

function resetPage(options = {}) {
  const immediate = options.immediate === true
  const reload = options.reload === true
  query.value.page = 1
  if (reload) {
    scheduleThunderstoreListReload({
      resetPage: false,
      immediate
    })
  }
}

async function handleTranslateThunderstoreCurrentPage() {
  if (thunderstorePageTranslationLoading.value) {
    return
  }

  const requestItems = buildThunderstoreTranslationRequestItems(pageMods.value, {
    unresolvedOnly: true
  })

  if (!requestItems.length) {
    $message.info(uiMessage('ui.modsOnThisPageTranslated'))
    return
  }

  const totalCount = countUntranslatedThunderstoreMods(pageMods.value)
  updateThunderstorePageTranslationProgress(totalCount)
  thunderstorePageTranslationLoading.value = true
  try {
    // 先把悬浮按钮的加载态和进度文案渲染出来，再进入模型加载/翻译流程。
    await waitForUiRender()
    await translateThunderstoreMods(pageMods.value, {
      onProgress: () => {
        updateThunderstorePageTranslationProgress(totalCount)
      }
    })
    const completedCount = Math.max(
      totalCount - countUntranslatedThunderstoreMods(pageMods.value),
      0
    )
    if (completedCount > 0) {
      $message.success(uiMessage('ui.translatedValueValueModsOnThisPage', { value1: (completedCount), value2: (totalCount) }))
      return
    }
    $message.info(uiMessage('ui.noNewTranslationsForThisPage'))
  } catch (error) {
    console.error('[THUNDERSTORE] 当前页模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateThisPageValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    thunderstorePageTranslationLoading.value = false
    resetThunderstorePageTranslationProgress()
  }
}

async function handleTranslateThunderstoreSingleMod(card = {}) {
  const rawItem = card?.raw || card
  const itemKey = String(rawItem?.full_name || rawItem?.uuid4 || rawItem?.name || '').trim()
  if (!itemKey) {
    return
  }

  const requestItems = buildThunderstoreTranslationRequestItems([rawItem], {
    unresolvedOnly: true
  })

  if (!requestItems.length) {
    return
  }

  thunderstoreItemTranslationLoadingMap.value = {
    ...thunderstoreItemTranslationLoadingMap.value,
    [itemKey]: true
  }

  try {
    const translatedMap = await translateTextBatchService({
      systemConfig: systemConfig.value,
      source: 'thunderstore',
      scene: 'mod_list_card',
      items: requestItems
    })

    const translatedCount = mergeThunderstoreTranslationResultMap(translatedMap)
    if (translatedCount > 0) {
      $message.success(uiMessage('ui.modTranslationComplete'))
    } else {
      $message.info(uiMessage('ui.noNewTranslationsForThisMod'))
    }
  } catch (error) {
    console.error('[THUNDERSTORE] 单模组翻译失败', error)
    $message.error(uiMessage('ui.couldNotTranslateModValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    thunderstoreItemTranslationLoadingMap.value = {
      ...thunderstoreItemTranslationLoadingMap.value,
      [itemKey]: false
    }
  }
}

function handleThunderstoreFloatingAction(action = {}) {
  const actionKey = String(action?.key || '').trim()
  if (actionKey === 'translate-current-page') {
    handleTranslateThunderstoreCurrentPage().then()
  }
}

function changePage(page) {
  if (Number(page || 1) === Number(query.value.page || 1)) {
    return
  }
  query.value.page = page
  scheduleThunderstoreListReload({ immediate: true })
}

function setInstalling(fullName, value) {
  installingMap.value = {
    ...installingMap.value,
    [fullName]: value
  }
}

function setUpdating(fullName, value) {
  updatingMap.value = {
    ...updatingMap.value,
    [fullName]: value
  }
}

function getProgressText() {
  const text = installProgress.value.message
  if (text) {
    return text
  }
  const stage = installProgress.value.stage
  if (stage === 'queue') {
    return uiText('ui.addedToDownloadQueue')
  }
  if (stage === 'download') {
    return uiText('ui.downloadingModPackage')
  }
  if (stage === 'extract') {
    return uiText('ui.extractingModFiles')
  }
  if (stage === 'done') {
    return uiText('ui.installationComplete')
  }
  if (stage === 'error') {
    return uiText('ui.installationFailed')
  }
  return uiText('ui.processingVariant2')
}

function resetInstallProgress() {
  if (installProgressHideTimer.value) {
    clearTimeout(installProgressHideTimer.value)
    installProgressHideTimer.value = null
  }
  installProgress.value = {
    visible: false,
    jobId: '',
    stage: '',
    percent: 0,
    packageFullName: '',
    currentIndex: 0,
    totalCount: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: ''
  }
}

function scheduleCloseInstallProgress(delay = 1500) {
  if (installProgressHideTimer.value) {
    clearTimeout(installProgressHideTimer.value)
  }
  installProgressHideTimer.value = setTimeout(() => {
    resetInstallProgress()
  }, delay)
}

function handleThunderstoreInstallProgress(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    return
  }

  installProgress.value = {
    ...installProgress.value,
    visible: true,
    jobId: payload.jobId || installProgress.value.jobId,
    stage: String(payload.stage || installProgress.value.stage || ''),
    percent: Number(payload.percent ?? installProgress.value.percent ?? 0),
    packageFullName: String(payload.packageFullName || installProgress.value.packageFullName || ''),
    currentIndex: Number(payload.currentIndex ?? installProgress.value.currentIndex ?? 0),
    totalCount: Number(payload.totalCount ?? installProgress.value.totalCount ?? 0),
    downloadedBytes: Number(payload.downloadedBytes ?? installProgress.value.downloadedBytes ?? 0),
    totalBytes: Number(payload.totalBytes ?? installProgress.value.totalBytes ?? 0),
    message: String(payload.message || '')
  }

  const stage = String(payload.stage || '').toLowerCase()
  if (!batchInstallingFromProfile.value && (stage === 'done' || stage === 'error')) {
    scheduleCloseInstallProgress(stage === 'done' ? 1500 : 2500)
  }
}

async function loadAllProfileInstalledSummary() {
  if (!community.value.identifier) {
    allProfileInstalledSummary.value = {
      stats: [],
      totalCount: 0,
      totalSize: 0
    }
    return
  }

  const profiles = sanitizeProfileList(profileList.value)
  const stats = await Promise.all(
    profiles.map(async (profileName) => {
      try {
        const data = await ipcRenderer.invoke('thunderstoreGetInstallState', {
          community: community.value.identifier,
          profileName
        })
        const installed = data?.installed || {}
        return {
          profileName: resolveProfileNameInList(profileName, profiles),
          count: Object.keys(installed).length,
          sizeBytes: getInstalledSizeBytes(installed)
        }
      } catch (error) {
        console.error(`读取配置安装汇总失败：${profileName}`, error)
        return {
          profileName: resolveProfileNameInList(profileName, profiles),
          count: 0,
          sizeBytes: 0
        }
      }
    })
  )

  allProfileInstalledSummary.value = {
    stats,
    totalCount: stats.reduce((sum, item) => sum + Number(item?.count || 0), 0),
    totalSize: stats.reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0)
  }
}

async function refreshInstalledState(options = {}) {
  const data = await ipcRenderer.invoke('thunderstoreGetInstallState', {
    community: community.value.identifier,
    profileName: activeProfileName.value
  })
  installedMap.value = data?.installed || {}

  if (options.refreshSummary !== false) {
    await loadAllProfileInstalledSummary()
  }
}

function buildThunderstoreInstallTaskGameKeys() {
  const identifier = getCurrentCommunityIdentifier()
  return [identifier ? `thunderstore:${identifier}` : '']
}

async function handleSourceInstallTaskUpdated(_event, data = {}) {
  if (
    !shouldRefreshInstalledModsAfterSourceTask(
      data,
      'thunderstore',
      buildThunderstoreInstallTaskGameKeys(),
      {
        allowSourceOnly: true
      }
    )
  ) {
    return
  }
  installedThunderstoreRefreshScheduler.schedule()
}

async function refreshUpdateState(profileName = activeProfileName.value) {
  if (!community.value.identifier) {
    updateRecords.value = []
    return
  }

  updatesLoading.value = true
  try {
    const result = await ipcRenderer.invoke('thunderstoreGetUpdates', {
      community: community.value.identifier,
      profileName
    })
    updateRecords.value = Array.isArray(result?.updates) ? result.updates : []
  } catch (error) {
    console.error('读取可更新列表失败', error)
    updateRecords.value = []
  } finally {
    updatesLoading.value = false
  }
}

function getUpdateRecordByFullName(fullName) {
  return (updateRecords.value || []).find(
    (item) => String(item?.fullName || '').toLowerCase() === String(fullName || '').toLowerCase()
  )
}

async function refreshThunderstoreProfileState(profileName = activeProfileName.value) {
  const targetProfileName = resolveProfileNameInList(profileName, profileList.value)
  const isActiveProfile =
    String(targetProfileName || '').toLowerCase() ===
    String(activeProfileName.value || '').toLowerCase()

  if (isActiveProfile) {
    await Promise.all([
      refreshInstalledState({ refreshSummary: false }),
      refreshUpdateState(targetProfileName)
    ])
  }

  await loadAllProfileInstalledSummary()
}

async function openInstalledManager(options = {}) {
  goToModManagement(options)
}

function resolveThunderstoreManageAppId() {
  const detectedAppId = Number(gameRuntime.value.appId || 0)
  if (Number.isFinite(detectedAppId) && detectedAppId > 0) {
    return detectedAppId
  }

  const steamAppIdList = Array.isArray(gameRuntime.value.steamAppIds)
    ? gameRuntime.value.steamAppIds
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    : []
  return steamAppIdList[0] || 0
}

function goToModManagement(options = {}) {
  const communityIdentifier = String(community.value.identifier || '')
    .trim()
    .toLowerCase()
  if (!communityIdentifier) {
    $message.warning(uiMessage('ui.thisGameHasNoThunderstoreCommunityIdentifierForManagement'))
    return
  }

  const steamAppId = resolveThunderstoreManageAppId()
  const sourceGameId = steamAppId || 0

  gameStore.setCurrentManagedGame({
    sourceId: communityIdentifier,
    steamAppId,
    chineseTitle: String(community.value.name || communityIdentifier).trim(),
    is_server_installed: 0,
    server_install_mod_type: 0,
    gId: sourceGameId,
    sourceType: 'thunderstore',
    sourceCommunity: communityIdentifier,
    sourceProfile: activeProfileName.value,
    sourceGameId: sourceGameId
  })

  const query = Object.fromEntries(
    Object.entries({
      source: 'thunderstore',
      sourceId: communityIdentifier,
      gameId: String(sourceGameId || ''),
      community: communityIdentifier,
      profile: activeProfileName.value,
      appId: String(steamAppId || ''),
      name: String(community.value.name || communityIdentifier).trim(),
      action: options.action
    }).filter(([, value]) => String(value || '').trim() !== '')
  )

  router.push({
    name: 'GameModManagement',
    params: {
      source: 'thunderstore',
      id: communityIdentifier
    },
    query
  })
}

async function switchProfile(nextProfileName, options = {}) {
  if (profileSwitching.value) {
    return false
  }

  const targetProfile = resolveProfileNameInList(nextProfileName, profileList.value)
  const currentProfile = activeProfileName.value
  const forceRefresh = !!options.forceRefresh

  if (!targetProfile) {
    return false
  }
  if (!forceRefresh && targetProfile === currentProfile) {
    return true
  }

  profileSwitching.value = true
  selectedProfileName.value = targetProfile
  launchConfig.value = {
    ...launchConfig.value,
    profileName: targetProfile
  }
  persistProfileStateByCommunity()
  resetInstallProgress()

  try {
    if (community.value.identifier) {
      await Promise.all([
        refreshInstalledState(),
        refreshLaunchConfig(),
        refreshUpdateState(targetProfile)
      ])
    } else {
      installedMap.value = {}
      updateRecords.value = []
    }

    if (!options.silent) {
      $message.success(uiMessage('ui.switchedToProfileValue', { value1: (targetProfile) }))
    }
    return true
  } catch (error) {
    console.error('切换配置失败', error)
    selectedProfileName.value = currentProfile
    launchConfig.value = {
      ...launchConfig.value,
      profileName: currentProfile
    }
    persistProfileStateByCommunity()

    if (community.value.identifier) {
      try {
        await Promise.all([
          refreshInstalledState(),
          refreshLaunchConfig(),
          refreshUpdateState(currentProfile)
        ])
      } catch (refreshError) {
        console.error('恢复配置状态失败', refreshError)
      }
    }

    if (!options.silent) {
      $message.error(uiMessage('ui.couldNotSwitchProfileValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
    }
    return false
  } finally {
    profileSwitching.value = false
  }
}

function openCreateProfileModal() {
  if (profileOperationLocked.value) {
    return
  }
  createProfileModal.value = {
    open: true,
    confirmLoading: false,
    name: ''
  }
}

function closeCreateProfileModal() {
  if (createProfileModal.value.confirmLoading) {
    return
  }
  createProfileModal.value = {
    open: false,
    confirmLoading: false,
    name: ''
  }
}

async function confirmCreateProfileModal() {
  const rawName = normalizeProfileName(createProfileModal.value.name)
  if (!rawName) {
    $message.warning(uiMessage('ui.enterAConfigurationName'))
    return
  }
  if (rawName.length > PROFILE_NAME_MAX_LENGTH) {
    $message.warning(uiMessage('ui.profileNamesCannotExceedValueCharacters', { value1: (PROFILE_NAME_MAX_LENGTH) }))
    return
  }
  if (PROFILE_NAME_INVALID_PATTERN.test(rawName)) {
    $message.warning(uiMessage('ui.profileNamesCannotContain'))
    return
  }

  const existed = profileList.value.some((item) => item.toLowerCase() === rawName.toLowerCase())
  if (existed) {
    $message.warning(uiMessage('ui.thisProfileNameAlreadyExistsChooseAnotherName'))
    return
  }

  createProfileModal.value = {
    ...createProfileModal.value,
    confirmLoading: true
  }

  profileList.value = sanitizeProfileList([...profileList.value, rawName])
  persistProfileStateByCommunity()

  try {
    $message.success(uiMessage('ui.profileCreatedValue', { value1: (rawName) }))
    createProfileModal.value = {
      open: false,
      confirmLoading: false,
      name: ''
    }
  } catch (error) {
    console.error('新增配置失败', error)
    createProfileModal.value = {
      ...createProfileModal.value,
      confirmLoading: false
    }
    $message.error(uiMessage('ui.couldNotCreateProfileValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  }
}

async function handleInlineCreateProfile(name = '') {
  createProfileModal.value = { ...createProfileModal.value, name, confirmLoading: false }
  await confirmCreateProfileModal()
}

async function handleProfileRename(payload = {}) {
  if (profileOperationLocked.value) return
  const currentName = resolveProfileNameInList(payload?.profileName, profileList.value)
  const nextName = normalizeProfileName(payload?.name)
  if (!nextName) {
    $message.warning(uiMessage('ui.enterAConfigurationName'))
    return
  }
  if (nextName.length > PROFILE_NAME_MAX_LENGTH) {
    $message.warning(uiMessage('ui.profileNamesCannotExceedValueCharacters', { value1: (PROFILE_NAME_MAX_LENGTH) }))
    return
  }
  if (PROFILE_NAME_INVALID_PATTERN.test(nextName)) {
    $message.warning(uiMessage('ui.profileNamesCannotContain'))
    return
  }
  if (
    profileList.value.some(
      (item) =>
        item.toLowerCase() !== currentName.toLowerCase() &&
        item.toLowerCase() === nextName.toLowerCase()
    )
  ) {
    $message.warning(uiMessage('ui.thisProfileNameAlreadyExistsChooseAnotherName'))
    return
  }

  try {
    const result = await ipcRenderer.invoke('sourceProfile:rename', {
      appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0,
      source: 'thunderstore',
      sourceId: community.value.identifier,
      community: community.value.identifier,
      previousProfile: currentName,
      nextProfile: nextName,
      endpointType: 0
    })
    if (!result?.success) throw new Error(result?.message || uiText('ui.couldNotRenameProfile'))

    profileList.value = profileList.value.map((item) =>
      item.toLowerCase() === currentName.toLowerCase() ? nextName : item
    )
    if (selectedProfileName.value.toLowerCase() === currentName.toLowerCase()) {
      selectedProfileName.value = nextName
    }
    if (defaultProfileName.value.toLowerCase() === currentName.toLowerCase()) {
      defaultProfileName.value = nextName
    }
    launchConfig.value = {
      ...launchConfig.value,
      profileName:
        String(launchConfig.value.profileName || '').toLowerCase() === currentName.toLowerCase()
          ? nextName
          : launchConfig.value.profileName
    }
    persistProfileStateByCommunity()
    await refreshThunderstoreProfileState(activeProfileName.value)
    $message.success(result.message || uiText('ui.renamedToValue', { value1: (nextName) }))
  } catch (error) {
    console.error('重命名 Thunderstore 配置失败', error)
    $message.error(uiMessage('ui.couldNotRenameValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

function getInstalledCountByProfile(profileName = '') {
  const targetProfile = String(profileName || '')
    .trim()
    .toLowerCase()
  if (!targetProfile) {
    return 0
  }
  const stats = Array.isArray(allProfileInstalledSummary.value?.stats)
    ? allProfileInstalledSummary.value.stats
    : []
  const matched = stats.find(
    (item) =>
      String(item?.profileName || '')
        .trim()
        .toLowerCase() === targetProfile
  )
  return Number(matched?.count || 0)
}

async function deleteProfile(profileName = '') {
  const targetProfile = resolveProfileNameInList(profileName, profileList.value)
  if (
    !community.value.identifier ||
    !targetProfile ||
    targetProfile.toLowerCase() === defaultProfileName.value.toLowerCase()
  ) {
    return
  }
  if (profileOperationLocked.value) {
    return
  }
  if (
    String(targetProfile || '').toLowerCase() ===
    String(activeProfileName.value || '').toLowerCase()
  ) {
    $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
    return
  }

  const installedCount = getInstalledCountByProfile(targetProfile)
  const title = installedCount > 0 ? '删除配置并删除模组？' : '确认删除这个配置？'
  const content =
    installedCount > 0
      ? uiText('ui.profileValueContainsValueModsDeletingItAlsoDeletesThese', { value1: (targetProfile), value2: (installedCount) })
      : uiText('ui.deletingProfileValueRemovesItsConfigurationFileRecordsThisCannot', { value1: (targetProfile) })

  Modal.confirm({
    title,
    content,
    okText: installedCount > 0 ? uiText('ui.deleteProfileAndMods') : uiText('ui.deleteProfile'),
    get cancelText() { return uiText('ui.cancel') },
    okButtonProps: {
      danger: true
    },
    async onOk() {
      if (
        String(targetProfile || '').toLowerCase() ===
        String(activeProfileName.value || '').toLowerCase()
      ) {
        $message.warning(uiMessage('ui.theCurrentProfileIsInUseAndCannotBeDeleted'))
        return
      }
      const result = await ipcRenderer.invoke('thunderstoreDeleteProfile', {
        community: community.value.identifier,
        profileName: targetProfile,
        isDefault: targetProfile.toLowerCase() === defaultProfileName.value.toLowerCase(),
        removeMods: true,
        appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0
      })

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotDeleteProfile')))
      }

      removeProfileStateByCommunity(targetProfile)
      await refreshThunderstoreProfileState(activeProfileName.value)

      $message.success(
        installedCount > 0
          ? uiText('ui.deletedProfileValueAndRemovedValueMods', { value1: (targetProfile), value2: (installedCount) })
          : uiText('ui.profileDeletedValue', { value1: (targetProfile) })
      )
    }
  })
}

async function copyTextToClipboard(text) {
  return await copySourceModpackTextToClipboard(text)
}

function buildThunderstoreProfileShareItems() {
  return Object.entries(installedMap.value || {})
    .filter(([, item]) => Number(item?.isActive ?? 1) !== 0)
    .map(([fullName, item], index) => {
      const normalizedFullName = String(item?.fullName || fullName || '').trim()
      const version = String(item?.version || '').trim()
      const { namespace, packageName } = parseThunderstorePackageFullName(normalizedFullName)
      if (!normalizedFullName || !version) {
        return null
      }
      const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
      const installRulePlan =
        metadata.installRulePlan && typeof metadata.installRulePlan === 'object'
          ? metadata.installRulePlan
          : {}
      const archivePath = String(
        item?.archivePath ||
          item?.archive_path ||
          metadata.archivePath ||
          metadata.archive_path ||
          item?.archivedSourcePath ||
          item?.archived_source_path ||
          metadata.archivedSourcePath ||
          metadata.archived_source_path ||
          ''
      ).trim()
      const stagingPath = String(
        item?.stagingPath ||
          item?.staging_path ||
          metadata.stagingPath ||
          metadata.staging_path ||
          installRulePlan.sourceRoot ||
          installRulePlan.source_root ||
          installRulePlan.lifecycleStagingRoot ||
          installRulePlan.lifecycle_staging_root ||
          ''
      ).trim()
      const sourcePath = String(
        archivePath ||
          stagingPath ||
          item?.sourcePath ||
          item?.source_path ||
          item?.filePath ||
          item?.file_path ||
          metadata.sourcePath ||
          metadata.source_path ||
          metadata.sourceRoot ||
          metadata.source_root ||
          metadata.filePath ||
          metadata.file_path ||
          (Array.isArray(item?.files) && item.files.length === 1 ? item.files[0] : '') ||
          ''
      ).trim()
      const installRule = item?.installRule ||
        metadata.installRule ||
        metadata.sourceInstallRule || {
          sourcePlatform: 'thunderstore',
          sourceAdapter: 'thunderstore',
          nativeInstaller: true,
          install_rules: []
        }

      return {
        sourcePlatform: 'thunderstore',
        sourceModId: normalizedFullName,
        sourceFileId: version,
        sourceModKey: normalizedFullName,
        name: String(
          item?.packageName || item?.displayName || packageName || normalizedFullName
        ).trim(),
        displayName: String(
          item?.displayName || item?.packageName || packageName || normalizedFullName
        ).trim(),
        version,
        cover: String(
          item?.cover || item?.icon || metadata.icon || metadata.coverImage || ''
        ).trim(),
        summary: String(item?.summary || item?.description || metadata.description || '').trim(),
        author: String(
          item?.author || item?.packageOwner || namespace || metadata.author || ''
        ).trim(),
        isDefaultDependency:
          item?.isDefaultDependency === true ||
          String(item?.dependencyRole || metadata?.category || '').trim() ===
            'default_dependency' ||
          String(normalizedFullName || '').startsWith('dependency:'),
        dependentCount: Number(item?.dependentCount || 0) || 0,
        dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
        sortIndex: index,
        sourcePath,
        archivePath,
        stagingPath,
        filePath: sourcePath,
        installRoot: String(launchConfig.value.profileRoot || metadata.installRoot || '').trim(),
        installRule,
        sourceInstallRule: installRule,
        installPayload: item?.installPayload || metadata.installPayload || null,
        metadata: {
          ...metadata,
          sourcePath,
          sourceRoot: sourcePath,
          archivePath,
          stagingPath,
          filePath: sourcePath,
          packageOwner: String(item?.packageOwner || namespace || '').trim(),
          packageName: String(item?.packageName || packageName || '').trim(),
          profileName: activeProfileName.value,
          sortIndex: index,
          dependencies: Array.isArray(item?.dependencies) ? item.dependencies : [],
          icon: String(item?.metadata?.icon || item?.metadata?.coverImage || '').trim()
        }
      }
    })
    .filter(Boolean)
}

function buildThunderstoreSourceModpackSnapshot(items = [], name = '') {
  return buildSourceModpackCreatePayload({
    sourceType: 'thunderstore',
    sourceGameId: community.value.identifier,
    sourceGameSlug: community.value.identifier,
    sourceGameName: community.value.name || community.value.identifier,
    name,
    cover:
      community.value.backgroundImage ||
      community.value.heroImage ||
      community.value.coverImage ||
      '',
    description: `Thunderstore Profile：${activeProfileName.value}`,
    items
  })
}

async function prepareThunderstoreSourceModpackSnapshot(name = '') {
  if (!community.value.identifier) throw new Error(uiText('ui.invalidThunderstoreCommunityIdentifier'))
  await refreshThunderstoreProfileState(activeProfileName.value, { resetPage: false })
  const items = buildThunderstoreProfileShareItems()
  if (!items.length) {
    throw new Error(uiText('ui.profileValueHasNoInstalledModsToShare', { value1: (activeProfileName.value) }))
  }
  return buildThunderstoreSourceModpackSnapshot(items, name)
}

async function shareProfileCode() {
  if (!community.value.identifier || sharingProfile.value) return

  sharingProfile.value = true
  try {
    const snapshot = await prepareThunderstoreSourceModpackSnapshot()
    const shareName = await requestSourceModpackShareName(
      `${community.value.name || community.value.identifier} - ${activeProfileName.value}`
    )
    if (!shareName) {
      return
    }
    const result = await CREATE_SOURCE_MODPACK({ ...snapshot, name: shareName })

    const shareCode = extractSourceModpackShareCode(result)
    if (!shareCode) {
      throw new Error(uiText('ui.noShareCodeWasReturned'))
    }

    const copied = await copyTextToClipboard(shareCode)
    if (copied) {
      $message.success(uiMessage('ui.shareCodeCopied'))
    } else {
      $message.warning(uiMessage('ui.shareCodeCreatedButCopyingFailedCheckClipboardPermissionsAnd'))
    }
  } catch (error) {
    console.error('生成分享码失败', error)
    $message.error(uiMessage('ui.couldNotCreateShareCodeValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  } finally {
    sharingProfile.value = false
  }
}

async function updateThunderstoreSourceModpack() {
  if (sharingProfile.value) return
  sharingProfile.value = true
  try {
    const snapshot = await prepareThunderstoreSourceModpackSnapshot()
    sourceModpackUpdateModal.value = { open: true, snapshot }
  } catch (error) {
    console.error('准备 Thunderstore 分享更新失败', error)
    $message.error(uiMessage('ui.couldNotUpdateShareValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
  } finally {
    sharingProfile.value = false
  }
}

async function handleExportToFile() {
  try {
    const items = buildThunderstoreProfileShareItems()
    if (!items.length) {
      $message.warning(uiMessage('ui.profileValueHasNoInstalledModsToExport', { value1: (activeProfileName.value) }))
      return
    }
    const csm = buildCsmPayload({
      name: `${community.value.name || community.value.identifier} - ${activeProfileName.value}`,
      description: `Thunderstore Profile：${activeProfileName.value}`,
      cover:
        community.value.backgroundImage ||
        community.value.heroImage ||
        community.value.coverImage ||
        '',
      primaryGame: {
        gameKey: `thunderstore:${community.value.identifier}`,
        sourceType: 'thunderstore',
        sourceGameId: community.value.identifier || '',
        sourceGameSlug: community.value.identifier || '',
        sourceGameName: community.value.name || community.value.identifier || ''
      },
      items
    })
    csm.checksum = await signCsmPayload(csm)
    openOfflinePackExportDialog({
      profilePayload: csm,
      exportItems: items,
      gameName: community.value.name || community.value.identifier,
      sourcePlatform: 'thunderstore',
      sourceGameId: community.value.identifier || '',
      sourceGameSlug: community.value.identifier || '',
      profileName: activeProfileName.value
    })
  } catch (error) {
    console.error('导出离线安装包失败', error)
    $message.error(uiMessage('ui.exportFailedValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

async function handleImportFromFile() {
  try {
    const result = await pickOfflinePackImportFile()
    if (result?.canceled) return
    if (!result?.success) {
      $message.error(result?.message || '导入失败')
      return
    }
    if (result.kind !== 'offline-pack') {
      $message.error(uiMessage('ui.chooseAV2OfflinePackageVxpack'))
      return
    }
    openOfflinePackImportDialog(result.packagePath || result.filePath)
  } catch (error) {
    console.error('导入离线安装包失败', error)
    $message.error(uiMessage('ui.importFailedValue', { value1: (error?.message || uiText('tools.unknownError')) }))
  }
}

function openImportProfileModal() {
  if (importingProfile.value || batchInstallingFromProfile.value) {
    return
  }
  importProfileModal.value = {
    open: true,
    code: ''
  }
}

function closeImportProfileModal() {
  if (importingProfile.value || batchInstallingFromProfile.value) {
    return
  }
  importProfileModal.value = {
    open: false,
    code: ''
  }
}

function normalizeProfileMods(mods) {
  if (!Array.isArray(mods)) {
    return []
  }

  const map = new Map()
  for (const item of mods) {
    const fullName = String(item?.fullName || '').trim()
    const version = String(item?.version || '').trim()
    if (!fullName || !version) {
      continue
    }

    const key = fullName.toLowerCase()
    if (!map.has(key)) {
      map.set(key, {
        fullName,
        version,
        enabled: item?.enabled !== false
      })
    }
  }
  return Array.from(map.values())
}

function normalizeThunderstoreShareItems(detail = {}) {
  return getSourceModpackDetailItems(detail, 'thunderstore')
    .map((item, index) => {
      const fullName = String(item?.sourceModKey || item?.sourceModId || '').trim()
      const version = String(item?.sourceFileId || item?.version || '').trim()
      if (!fullName || !version) {
        return null
      }
      return {
        fullName,
        version,
        sortIndex: Number.isFinite(Number(item?.sortIndex)) ? Number(item.sortIndex) : index,
        enabled: true
      }
    })
    .filter(Boolean)
}

function setInstallProgressForProfileBatch(payload = {}) {
  installProgress.value = {
    ...installProgress.value,
    visible: true,
    stage: String(payload.stage || installProgress.value.stage || ''),
    percent: Number(payload.percent ?? installProgress.value.percent ?? 0),
    packageFullName: String(payload.packageFullName || installProgress.value.packageFullName || ''),
    currentIndex: Number(payload.currentIndex ?? installProgress.value.currentIndex ?? 0),
    totalCount: Number(payload.totalCount ?? installProgress.value.totalCount ?? 0),
    message: String(payload.message || installProgress.value.message || '')
  }
}

async function installModsFromProfileShare(mods, shareDetail = {}) {
  if (!community.value.identifier) {
    throw new Error(uiText('ui.theCurrentCommunityIsInvalidInstallationIsUnavailable'))
  }

  batchInstallingFromProfile.value = true
  try {
    const pack = getSourceModpackDetailPack(shareDetail)
    const inspection = await inspectShareImport({
      shareCode: String(pack.shareCode || pack.share_code || '').trim(),
      entryPoint: 'thunderstore',
      targetContext: {
        sourcePlatform: 'thunderstore',
        sourceGameId: String(community.value.identifier || '').trim(),
        sourceGameSlug: String(community.value.identifier || '').trim(),
        appId: Number(gameRuntime.value.appId || 0),
        gameName: community.value.name,
        gameRoot: String(launchConfig.value.gameExePath || '').trim(),
        endpointType: 0,
        profileName: activeProfileName.value,
        packageLoader: gameRuntime.value.packageLoader || '',
        installRule: {}
      }
    })
    if (inspection.mode === 'latest') {
      $message.success(uiText('ui.thisModpackIsAlreadyOnTheLatestVersionValue', { value1: (inspection.remote?.versionName || '') }).trim())
      return
    }
    if (!(await requestSourceModpackInspectionConfirmation(Modal, inspection))) return
    const targetProfileName = ensureImportProfileSelected(
      inspection.profileTargets?.[0]?.profileName || buildSourceModpackImportProfileName(shareDetail, 'thunderstore')
    )
    const switched = await switchProfile(targetProfileName, { silent: true, forceRefresh: true })
    if (!switched) throw new Error(uiText('ui.couldNotSwitchToTheImportedProfileValue', { value1: (targetProfileName) }))
    const result = await applyShareImport({ planToken: inspection.planToken, expectedPlanHash: inspection.planHash })
    $message.success(result.message || '已加入安装任务')
  } finally {
    batchInstallingFromProfile.value = false
  }
}

async function confirmImportProfileCode() {
  const code = String(importProfileModal.value.code || '').trim()
  if (!code) {
    $message.warning(uiMessage('ui.enterAShareCode'))
    return
  }
  if (!community.value.identifier) {
    $message.warning(uiMessage('ui.theCurrentCommunityIsInvalidTheShareCodeCannotBe'))
    return
  }
  if (importingProfile.value || batchInstallingFromProfile.value) {
    return
  }

  importingProfile.value = true
  try {
    const result = await GET_SOURCE_MODPACK_BY_CODE(code)
    const mods = normalizeProfileMods(normalizeThunderstoreShareItems(result))
    if (!mods.length) {
      throw new Error(uiText('ui.noInstallableModsWereFoundInTheShareCode'))
    }

    // 点击开始安装后立即关闭弹窗。
    importProfileModal.value = {
      open: false,
      code: ''
    }
    await installModsFromProfileShare(mods, result)
  } catch (error) {
    console.error('读取分享码失败', error)
    $message.error(uiMessage('ui.couldNotReadShareCodeValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  } finally {
    importingProfile.value = false
  }
}

async function updatePackage(
  item,
  profileName = activeProfileName.value,
  versionNumber = '',
  options = {}
) {
  const fullName = String(item?.fullName || item?.full_name || '').trim()
  const targetProfileName = resolveProfileNameInList(profileName, profileList.value)
  if (!community.value.identifier || !fullName || updatingMap.value[fullName]) {
    return
  }

  const updateInfo = getUpdateRecordByFullName(fullName)
  const targetVersion = String(
    versionNumber || updateInfo?.latestVersion || item?.latestVersion || ''
  ).trim()
  if (!targetVersion) {
    $message.warning(uiMessage('ui.thisModIsAlreadyUpToDate'))
    return
  }

  const currentVersion = String(
    item?.currentVersion || item?.version || getInstallInfoByFullName(fullName)?.version || ''
  ).trim()
  if (currentVersion && currentVersion === targetVersion) {
    $message.info(uiMessage('ui.valueIsAlreadyInstalledNoSwitchIsNeeded', { value1: (targetVersion) }))
    return
  }

  setUpdating(fullName, true)
  try {
    await ipcRenderer.invoke('thunderstoreUpdatePackage', {
      community: community.value.identifier,
      profileName: targetProfileName,
      packageFullName: fullName,
      versionNumber: targetVersion,
      appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0,
      packageLoader: gameRuntime.value.packageLoader || '',
      allowDowngrade: options?.allowDowngrade === true
    })
    await refreshThunderstoreProfileState(targetProfileName, { resetPage: false })
    $message.success(uiMessage('ui.updatedValueValue', { value1: (fullName), value2: (targetVersion) }))
  } catch (error) {
    console.error('更新 Thunderstore 模组失败', error)
    $message.error(uiMessage('ui.updateFailedValue', { value1: (error?.message || fullName) }))
  } finally {
    setUpdating(fullName, false)
  }
}

function buildConfigFilterKeyword(item = {}) {
  const packageName = String(item?.packageName || item?.displayName || '').trim()
  return packageName
}

async function openConfigEditor(options = {}) {
  if (!community.value.identifier) {
    return
  }

  const profileName = resolveProfileNameInList(
    options?.profileName || activeProfileName.value,
    profileList.value
  )

  const preferredPackageName = buildConfigFilterKeyword(options?.item || {})
  router.push({
    name: 'GameThunderStoreConfigEditor',
    params: {
      id: community.value.identifier
    },
    query: {
      profile: profileName,
      package: preferredPackageName || undefined
    }
  })
}

function openProfileConfigModal() {
  if (profileOperationLocked.value) {
    return
  }
  profileConfigModal.value.open = true
}

function closeProfileConfigModal() {
  profileConfigModal.value.open = false
}

async function rescanThunderstoreGame() {
  const identifier = getCurrentCommunityIdentifier()
  if (!identifier) {
    $message.warning(uiMessage('ui.thunderstoreCommunityIdentifierIsMissing'))
    return
  }

  await resolveGameInstallState(identifier)
  await refreshLaunchConfig()
  $message.success(uiMessage('ui.scanComplete'))
}

async function selectThunderstoreGameExecutable() {
  const identifier = getCurrentCommunityIdentifier()
  if (!identifier) {
    $message.warning(uiMessage('ui.thunderstoreCommunityIdentifierIsMissing'))
    return false
  }

  try {
    const selectResult = await ipcRenderer.invoke('thunderstoreSelectGameExecutable', {
      community: identifier,
      profileName: activeProfileName.value,
      packageLoader: gameRuntime.value.packageLoader || '',
      appId: Number(gameRuntime.value.appId || 0),
      preferPath: String(launchConfig.value.gameExePath || '')
    })

    if (selectResult?.canceled) {
      return false
    }

    const gameExePath = String(selectResult?.gameExePath || '').trim()
    if (!gameExePath) {
      $message.warning(uiMessage('ui.noExecutableSelected'))
      return false
    }

    launchConfig.value = {
      ...launchConfig.value,
      ...(selectResult || {}),
      gameExePath
    }
    gameRuntime.value = {
      ...gameRuntime.value,
      installed: true,
      appId: Number(selectResult?.appId || gameRuntime.value.appId || 0)
    }
    await refreshLaunchConfig()
    $message.success(uiMessage('ui.addedManually'))
    return true
  } catch (error) {
    console.error('手动添加 Thunderstore 游戏路径失败', error)
    $message.error(uiMessage('ui.couldNotAddManuallyValue', { value1: (String(error?.message || uiText('tools.unknownError'))) }))
    return false
  }
}

function openLocalBindingWithGameRootCheck() {
  if (gameInstallStateResolving.value || localBindingPathSelecting.value) {
    return
  }

  if (hasDetectedGame.value) {
    openInstalledManager({ action: 'manage-local-mod' })
    return
  }

  Modal.confirm({
    get title() { return uiText('ui.noGameDetected') },
    content: '当前还未识别游戏目录，是否先绑定游戏根目录？绑定完成后才能管理本地模组。',
    get okText() { return uiText('ui.chooseFolder') },
    get cancelText() { return uiText('ui.cancel') },
    async onOk() {
      localBindingPathSelecting.value = true
      try {
        const success = await selectThunderstoreGameExecutable()
        if (success && hasDetectedGame.value) {
          openInstalledManager({ action: 'manage-local-mod' })
        }
      } finally {
        localBindingPathSelecting.value = false
      }
    }
  })
}

function handleHeaderAction(actionKey = '') {
  const key = String(actionKey || '').trim()
  if (key === 'profile-scheme') {
    openProfileConfigModal()
    return
  }
  if (key === 'manage') {
    openInstalledManager()
    return
  }
  if (key === 'manage-local-mod') {
    openLocalBindingWithGameRootCheck()
    return
  }
  if (key === 'launch') {
    launchGame()
    return
  }
  if (key === 'launch-vanilla') {
    launchGame('vanilla')
    return
  }
  if (key === 'open-root') {
    openGameFolder()
    return
  }
  if (key === 'scan') {
    rescanThunderstoreGame().then()
    return
  }
  if (key === 'manual-bind') {
    if (localBindingPathSelecting.value) {
      return
    }
    localBindingPathSelecting.value = true
    selectThunderstoreGameExecutable().finally(() => {
      localBindingPathSelecting.value = false
    })
    return
  }
  if (key === 'config-file') {
    openConfigEditor()
  }
}

async function refreshLaunchConfig() {
  if (!community.value.identifier) {
    return
  }

  try {
    const data = await ipcRenderer.invoke('thunderstoreBuildLaunchArgs', {
      community: community.value.identifier,
      profileName: activeProfileName.value,
      appId: gameRuntime.value.installed ? Number(gameRuntime.value.appId || 0) : 0,
      packageLoader: gameRuntime.value.packageLoader || ''
    })

    launchConfig.value = {
      ...launchConfig.value,
      ...(data || {})
    }
  } catch (error) {
    console.error('获取启动参数失败', error)
    $message.error(uiMessage('ui.couldNotGetLaunchArguments'))
  }
}

async function launchGame(forcedMode = '') {
  if (!community.value.identifier) {
    return
  }

  if (launchingModded.value) {
    return
  }

  launchingModded.value = true

  try {
    let gameExePath = String(launchConfig.value.gameExePath || '').trim()
    if (!gameExePath) {
      const selectResult = await ipcRenderer.invoke('thunderstoreSelectGameExecutable', {
        community: community.value.identifier,
        profileName: activeProfileName.value,
        packageLoader: gameRuntime.value.packageLoader || '',
        appId: Number(gameRuntime.value.appId || 0),
        preferPath: ''
      })

      if (selectResult?.canceled) {
        return
      }

      gameExePath = String(selectResult?.gameExePath || '').trim()
      if (!gameExePath) {
        throw new Error(uiText('ui.noExecutableSelected'))
      }
    }

    const launchMode =
      forcedMode === 'vanilla' || activeProfileInstalledCount.value <= 0 ? 'vanilla' : 'modded'
    const result = await ipcRenderer.invoke('thunderstoreLaunchGame', {
      community: community.value.identifier,
      profileName: activeProfileName.value,
      appId: Number(gameRuntime.value.appId || 0),
      packageLoader: gameRuntime.value.packageLoader || '',
      launchMode,
      gameExePath,
      exeNames: toPlainStringList(gameRuntime.value.exeNames),
      steamFolderName: gameRuntime.value.steamFolderName || ''
    })

    launchConfig.value = {
      ...launchConfig.value,
      gameExePath: String(result?.gameExePath || gameExePath || '')
    }

    $message.success(
      forcedMode === 'vanilla' ? t('modBrowser.launchVanillaStarted') : '已注入模组正在启动游戏'
    )

    await refreshLaunchConfig()
  } catch (error) {
    console.error('启动游戏失败', error)
    $message.error(uiMessage('ui.launchFailedValue', { value1: (error?.message || uiText('ui.checkTheGamePathAndLaunchArguments')) }))
  } finally {
    launchingModded.value = false
  }
}

function openGameFolder() {
  const gameExePath = String(launchConfig.value.gameExePath || '').trim()
  if (!gameExePath) {
    $message.warning(uiMessage('ui.gameFolderNotFound'))
    return
  }

  const splitIndex = Math.max(gameExePath.lastIndexOf('\\'), gameExePath.lastIndexOf('/'))
  const gameFolderPath = splitIndex >= 0 ? gameExePath.slice(0, splitIndex) : ''
  const openPath = gameFolderPath || gameExePath
  if (!openPath) {
    $message.warning(uiMessage('ui.gameFolderNotFound'))
    return
  }

  ipcRenderer.send('openSpecifyPath', openPath)
}

async function resolveGameInstallState(identifier) {
  gameInstallStateResolving.value = true
  try {
    const r2GameMeta = await getR2modmanGameMetaByCommunity(identifier)
    if (!r2GameMeta) {
      gameRuntime.value = {
        source: 'r2modman',
        displayName: '',
        steamAppIds: [],
        exeNames: [],
        steamFolderName: '',
        packageLoader: '',
        installed: false,
        appId: 0
      }
      return
    }

    const detectResult = await ipcRenderer.invoke('thunderstoreDetectInstalledGame', {
      community: identifier,
      profileName: activeProfileName.value,
      steamAppIds: toPlainNumberList(r2GameMeta.steamAppIds),
      exeNames: toPlainStringList(r2GameMeta.exeNames),
      steamFolderName: r2GameMeta.steamFolderName,
      packageLoader: r2GameMeta.packageLoader,
      displayName: community.value.name || r2GameMeta.displayName || '',
      sourceMeta: buildSourceMeta()
    })

    gameRuntime.value = {
      source: 'r2modman',
      displayName: r2GameMeta.displayName || '',
      steamAppIds: r2GameMeta.steamAppIds || [],
      exeNames: r2GameMeta.exeNames || [],
      steamFolderName: r2GameMeta.steamFolderName || '',
      packageLoader: r2GameMeta.packageLoader || '',
      installed: !!detectResult?.installed,
      appId: Number(detectResult?.appId || 0)
    }
  } finally {
    gameInstallStateResolving.value = false
  }
}

async function loadCommunityInfo(identifier) {
  try {
    const hit = await getCommunityDetailWithCover(identifier)

    community.value = {
      identifier: String(hit?.identifier || identifier),
      name: String(hit?.name || hit?.identifier || identifier),
      shortDescription: String(hit?.short_description || ''),
      description: String(hit?.description || ''),
      discordUrl: String(hit?.discord_url || ''),
      wikiUrl: String(hit?.wiki_url || ''),
      datetimeCreated: String(hit?.datetime_created || ''),
      backgroundImage: String(hit?.background_image_url || ''),
      heroImage: String(hit?.hero_image_url || ''),
      coverImage: String(
        hit?.cover_image_url || hit?.hero_image_url || hit?.background_image_url || ''
      ),
      iconUrl: String(hit?.icon_url || ''),
      communityIconUrl: String(hit?.community_icon_url || ''),
      totalDownloadCount: Number(hit?.total_download_count || 0),
      totalPackageCount: Number(hit?.total_package_count || 0),
      hasModManagerSupport: Boolean(hit?.has_mod_manager_support),
      isListed: Boolean(hit?.is_listed)
    }
    await resolveThunderstoreCommunityDisplayName()
    setPageMenuName(() => `[Mod]-${gamePresentation(community.value).title}`, route.path)
    publishThunderstoreAiPageContext()
  } catch {
    community.value = {
      identifier,
      name: identifier,
      shortDescription: '',
      description: '',
      discordUrl: '',
      wikiUrl: '',
      datetimeCreated: '',
      backgroundImage: '',
      heroImage: '',
      coverImage: '',
      iconUrl: '',
      communityIconUrl: '',
      totalDownloadCount: 0,
      totalPackageCount: 0,
      hasModManagerSupport: false,
      isListed: false
    }
    await resolveThunderstoreCommunityDisplayName()
    setPageMenuName(() => `[Mod]-${gamePresentation(community.value).title}`, route.path)
    publishThunderstoreAiPageContext()
  }
}

// 分类只用于筛选，读取失败时隐藏分类栏，不影响列表本身。
async function loadCommunityCategories(identifier) {
  const token = ++communityCategoriesToken
  try {
    const { categories } = await getCommunityFilters(identifier)
    if (token === communityCategoriesToken) communityCategories.value = categories
  } catch (error) {
    if (token === communityCategoriesToken) communityCategories.value = []
    console.warn('[Thunderstore] 读取社区分类失败', error?.message || error)
  }
}

async function loadCommunityModList(identifier) {
  const communityIdentifier = normalizeIdentifier(identifier)
  if (!communityIdentifier) {
    allMods.value = []
    modTotal.value = 0
    return
  }

  const currentToken = ++thunderstoreListToken
  loading.value = true

  try {
    const result = await getCommunityModListPage(communityIdentifier, {
      page: query.value.page,
      q: String(query.value.effectiveKeyword || query.value.keyword || '').trim(),
      ordering: resolveThunderstoreOrdering(query.value.sort),
      included_categories: query.value.category ? [query.value.category] : []
    })

    if (currentToken !== thunderstoreListToken) {
      return
    }

    allMods.value = Array.isArray(result?.results) ? result.results : []
    modTotal.value = Number(result?.count || 0)

    const maxPage = Math.max(Math.ceil(Math.max(modTotal.value, 0) / query.value.limit), 1)
    if (query.value.page > maxPage) {
      query.value.page = maxPage
      await loadCommunityModList(communityIdentifier)
    }
  } catch (error) {
    if (currentToken !== thunderstoreListToken) {
      return
    }
    allMods.value = []
    modTotal.value = 0
    $message.error(uiMessage('ui.couldNotGetCommunityModsValue', { value1: (communityIdentifier) }))
    console.error('加载社区模组失败', error)
  } finally {
    if (currentToken === thunderstoreListToken) {
      loading.value = false
    }
  }
}

function clearThunderstoreListReloadTimer() {
  if (thunderstoreListReloadTimer) {
    clearTimeout(thunderstoreListReloadTimer)
    thunderstoreListReloadTimer = null
  }
}

function scheduleThunderstoreListReload(options = {}) {
  const immediate = options.immediate === true
  const resetPage = options.resetPage === true
  if (resetPage) {
    query.value.page = 1
  }

  const identifier = getCurrentCommunityIdentifier()
  if (!identifier) {
    return
  }

  const run = () => {
    clearThunderstoreListReloadTimer()
    loadCommunityModList(identifier).catch((error) => {
      console.error('刷新 Thunderstore 模组分页失败', error)
    })
  }

  if (immediate) {
    run()
    return
  }

  clearThunderstoreListReloadTimer()
  thunderstoreListReloadTimer = setTimeout(run, 320)
}

async function loadInstallVersionDetail(
  item,
  versionNumber,
  token = thunderstoreInstallModalToken
) {
  const targetFullName = String(item?.full_name || '').trim()
  const targetVersion = String(versionNumber || '').trim()
  if (!targetFullName || !targetVersion) {
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        selectedVersionDetail: null,
        versionDetailLoading: false,
        dependencyItems: [],
        dependencyItemsLoading: false
      }
    }
    return null
  }

  if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
    installVersionModal.value = {
      ...installVersionModal.value,
      selectedVersionDetail: null,
      versionDetailLoading: true,
      dependencyItems: [],
      dependencyItemsLoading: false
    }
  }

  try {
    const detail = await getThunderstorePackageVersionDetailByFullName(
      targetFullName,
      targetVersion,
      {
        syncPageItem: false
      }
    )
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        selectedVersionDetail: detail
      }
    }
    loadInstallVersionDependencyPreview(item, targetVersion, detail, [], token).catch((error) => {
      console.error('读取 Thunderstore 依赖预览失败', error)
    })
    return detail
  } finally {
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        versionDetailLoading: false
      }
    }
  }
}

async function loadInstallVersionDependencyPreview(
  item,
  versionNumber,
  detail = null,
  fallbackDependencies = [],
  token = thunderstoreInstallModalToken
) {
  const targetFullName = String(item?.full_name || '').trim()
  const targetVersion = String(versionNumber || '').trim()
  if (!targetFullName || !targetVersion) {
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        dependencyItems: [],
        dependencyItemsLoading: false
      }
    }
    return []
  }

  const seededItems = buildThunderstoreDependencyPreviewItems(
    Array.isArray(detail?.dependencies) && detail.dependencies.length
      ? detail.dependencies
      : fallbackDependencies
  )
  const detailCount = Number(detail?.dependencyCount || 0)
  const resolvedCount = detailCount > 0 ? detailCount : seededItems.length

  if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
    installVersionModal.value = {
      ...installVersionModal.value,
      dependencyItems: seededItems,
      dependencyItemsLoading: false
    }
  }

  if (resolvedCount <= 0 || seededItems.length > 0) {
    return seededItems
  }

  if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
    installVersionModal.value = {
      ...installVersionModal.value,
      dependencyItemsLoading: true
    }
  }

  try {
    const dependencyStrings = await getThunderstoreVersionDependenciesByFullName(
      targetFullName,
      targetVersion
    )
    const dependencyItems = buildThunderstoreDependencyPreviewItems(dependencyStrings)
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        dependencyItems,
        dependencyItemsLoading: false
      }
    }
    return dependencyItems
  } catch (error) {
    if (token === thunderstoreInstallModalToken && installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        dependencyItemsLoading: false
      }
    }
    throw error
  }
}

async function openInstallVersionModal(item, options = {}) {
  const mode =
    options?.mode === 'switch' ? 'switch' : hasDetectedGame.value ? 'install' : 'download'
  const normalizedItem = normalizeThunderstoreVersionModalItem(item)
  const targetFullName = String(normalizedItem?.full_name || '').trim()
  if (!targetFullName) {
    return
  }
  if (mode === 'install' && item?.installed) {
    return
  }

  const currentToken = ++thunderstoreInstallModalToken
  installVersionModal.value = createEmptyInstallVersionModalState()
  setVersionDialogLoading(targetFullName, true)

  try {
    const versions = await getThunderstorePackageVersionsByFullName(
      targetFullName,
      normalizedItem,
      {
        syncPageItem: false
      }
    )
    if (currentToken !== thunderstoreInstallModalToken) {
      return
    }

    const targetVersion = resolveThunderstoreModalDefaultVersion(
      mode,
      versions,
      options?.currentVersion || normalizedItem?.currentVersion
    )
    if (!targetVersion) {
      throw new Error(mode === 'switch' ? uiText('ui.noVersionsAvailableToSwitchTo') : uiText('ui.noInstallableVersionsFound'))
    }

    const detail = await getThunderstorePackageVersionDetailByFullName(
      targetFullName,
      targetVersion,
      {
        syncPageItem: false
      }
    )
    if (currentToken !== thunderstoreInstallModalToken) {
      return
    }

    const pageItem = getThunderstorePageItemByFullName(targetFullName)
    const selectedVersion =
      versions.find((version) => String(version?.version_number || '').trim() === targetVersion) ||
      null
    const initialDependencyItems = buildThunderstoreDependencyPreviewItems(
      Array.isArray(detail?.dependencies) && detail.dependencies.length
        ? detail.dependencies
        : selectedVersion?.dependencies
    )
    installVersionModal.value = {
      open: true,
      mode,
      confirmLoading: false,
      item: {
        ...(pageItem || normalizedItem),
        full_name: targetFullName,
        currentVersion: String(
          options?.currentVersion || normalizedItem?.currentVersion || ''
        ).trim()
      },
      profileName: resolveProfileNameInList(
        options?.profileName || activeProfileName.value,
        profileList.value
      ),
      currentVersion: String(
        options?.currentVersion || normalizedItem?.currentVersion || ''
      ).trim(),
      versionNumber: targetVersion,
      versions,
      versionListLoading: false,
      versionDetailLoading: false,
      selectedVersionDetail: detail,
      dependencyItems: initialDependencyItems,
      dependencyItemsLoading: false
    }
    loadInstallVersionDependencyPreview(
      {
        ...(pageItem || normalizedItem),
        full_name: targetFullName
      },
      targetVersion,
      detail,
      selectedVersion?.dependencies || [],
      currentToken
    ).catch((error) => {
      console.error('读取 Thunderstore 依赖预览失败', error)
    })
  } catch (error) {
    if (currentToken !== thunderstoreInstallModalToken) {
      return
    }
    console.error('加载 Thunderstore 版本列表失败', error)
    $message.error(uiMessage('ui.couldNotLoadVersionListValue', { value1: (error?.message || targetFullName) }))
    installVersionModal.value = createEmptyInstallVersionModalState()
  } finally {
    setVersionDialogLoading(targetFullName, false)
  }
}

function closeInstallVersionModal(force = false) {
  if (installVersionModal.value.confirmLoading && !force) {
    return
  }
  installVersionModal.value = createEmptyInstallVersionModalState()
}

function handleInstallVersionChange(value) {
  installVersionModal.value = {
    ...installVersionModal.value,
    versionNumber: String(value || '').trim()
  }

  if (!installVersionModal.value.open || !installVersionModal.value.item?.full_name) {
    return
  }

  loadInstallVersionDetail(
    installVersionModal.value.item,
    installVersionModal.value.versionNumber,
    thunderstoreInstallModalToken
  ).catch((error) => {
    console.error('读取 Thunderstore 版本详情失败', error)
    $message.error(uiMessage('ui.couldNotLoadVersionDetailsValue', { value1: (error?.message || uiText('ui.tryAgainLater')) }))
  })
}

async function confirmInstallVersion(action = 'install') {
  const item = installVersionModal.value.item
  if (!item?.full_name || !community.value.identifier) {
    return
  }
  if (
    installVersionModal.value.versionListLoading ||
    installVersionModal.value.versionDetailLoading
  ) {
    $message.info(uiMessage('ui.loadingVersionInformationPleaseWait'))
    return
  }
  if (!installVersionModal.value.versionNumber) {
    $message.warning(uiMessage('ui.chooseAVersion'))
    return
  }
  if (installingMap.value[item.full_name]) {
    return
  }

  const targetFullName = String(item.full_name || '').trim()
  const targetVersion = String(installVersionModal.value.versionNumber || '').trim()
  const currentVersion = String(installVersionModal.value.currentVersion || '').trim()

  if (installVersionModal.value.mode === 'switch') {
    if (currentVersion && currentVersion === targetVersion) {
      $message.info(uiMessage('ui.valueIsInstalledNoVersionSwitchIsNeeded', { value1: (targetVersion) }))
      return
    }

    const profileNameForSwitch = installVersionModal.value.profileName || activeProfileName.value
    closeInstallVersionModal(true)
    await updatePackage(
      {
        fullName: targetFullName,
        currentVersion
      },
      profileNameForSwitch,
      targetVersion,
      { allowDowngrade: true }
    )
    return
  }

  installVersionModal.value = {
    ...installVersionModal.value,
    confirmLoading: true
  }

  const downloadOnlyAction = action === 'download'
  const useSourceInstallTask =
    isSourceInstallTaskEnabled() && hasDetectedGame.value && !downloadOnlyAction
  setInstalling(targetFullName, true)
  if (!useSourceInstallTask) {
    resetInstallProgress()
    setInstallProgressForProfileBatch({
      stage: 'prepare',
      percent: 0,
      packageFullName: targetFullName,
      message: uiText('ui.creatingDownloadTasks')
    })
  }

  try {
    const installPlan = await buildThunderstoreDownloadPlan(item, targetVersion)
    closeInstallVersionModal(true)
    const gameExePath = String(launchConfig.value.gameExePath || '').trim()
    const downloadOnly = downloadOnlyAction || !hasDetectedGame.value
    const batchEntries = installPlan.map((planItem, index) =>
      buildThunderstoreSourceInstallTaskEntry(planItem, index, gameExePath, { downloadOnly })
    )

    if (!downloadOnly && useSourceInstallTask) {
      const result = await submitThunderstoreSourceInstallTask({
        source: 'thunderstore',
        sourceAdapter: 'thunderstore',
        sourceGameId: String(community.value.identifier || '').trim(),
        gameKey: `thunderstore:${String(community.value.identifier || '').trim()}`,
        gameRoot: gameExePath,
        title: targetFullName,
        items: batchEntries,
        sourceMeta: {
          source: 'thunderstore',
          community: String(community.value.identifier || '').trim(),
          profileName: activeProfileName.value,
          packageLoader: gameRuntime.value.packageLoader || ''
        },
        options: {
          autoStart: true,
          includeDependencies: true
        }
      })

      if (!result?.success) {
        throw new Error(String(result?.message || uiText('ui.couldNotAddInstallationTask')))
      }

      setInstalling(targetFullName, false)
      $message.success(result?.message || '已加入安装任务')
      return
    }

    const batchResult = downloadStore.addDownloadBatch(batchEntries, {
      batchId: createThunderstoreDownloadBatchId(targetFullName),
      onComplete: async (results) => {
        if (downloadOnly) {
          $message.success(uiMessage('ui.downloadCompleteValue', { value1: (targetFullName) }))
          setInstallProgressForProfileBatch({
            stage: 'done',
            percent: 100,
            totalCount: installPlan.length,
            currentIndex: installPlan.length,
            packageFullName: targetFullName,
            message: uiText('taskCenter.states.downloaded')
          })
          scheduleCloseInstallProgress(1500)
          setInstalling(targetFullName, false)
          return
        }

        setInstallProgressForProfileBatch({
          stage: 'prepare',
          percent: 0,
          totalCount: installPlan.length,
          currentIndex: 0,
          packageFullName: targetFullName,
          message: uiText('ui.downloadCompleteInstallingMods')
        })

        try {
          const installItems = toPlainInstallPayload(
            results.map((entry) => ({
              ...(entry?.meta || {}),
              filePath: String(entry?.filePath || '').trim()
            })),
            []
          )

          await ipcRenderer.invoke('thunderstoreInstallDownloadedPackages', {
            community: community.value.identifier,
            appId: gameRuntime.value.installed ? gameRuntime.value.appId : 0,
            packageLoader: gameRuntime.value.packageLoader || '',
            profileName: activeProfileName.value,
            items: installItems
          })

          $message.success(uiMessage('ui.installationCompleteValue', { value1: (targetFullName) }))
          await refreshThunderstoreProfileState(activeProfileName.value, { resetPage: false })
          setInstallProgressForProfileBatch({
            stage: 'done',
            percent: 100,
            totalCount: installPlan.length,
            currentIndex: installPlan.length,
            packageFullName: targetFullName,
            message: uiText('ui.installationComplete')
          })
          scheduleCloseInstallProgress(1500)
        } catch (error) {
          const detail = String(error?.message || '').trim()
          console.error('安装已下载的 Thunderstore 模组失败', error)
          $message.error(uiMessage('ui.installationFailedValue', { value1: (detail || targetFullName) }))
          setInstallProgressForProfileBatch({
            stage: 'error',
            packageFullName: targetFullName,
            message: detail || uiText('ui.installationFailed')
          })
          scheduleCloseInstallProgress(2500)
        } finally {
          setInstalling(targetFullName, false)
        }
      },
      onError: async ({ message = '' }) => {
        setInstallProgressForProfileBatch({
          stage: 'error',
          packageFullName: targetFullName,
          message: uiText('ui.downloadFailedValue', { value1: (String(message || uiText('tools.unknownError'))) })
        })
        scheduleCloseInstallProgress(2500)
        setInstalling(targetFullName, false)
      }
    })

    if (!batchResult?.success) {
      throw new Error(batchResult?.message || uiText('ui.couldNotAddToTheDownloadQueue'))
    }

    setInstallProgressForProfileBatch({
      stage: 'queue',
      percent: 0,
      totalCount: installPlan.length,
      currentIndex: 0,
      packageFullName: targetFullName,
      message: uiText('ui.addedValueTasksToTheDownloadQueue', { value1: (installPlan.length) })
    })
  } catch (error) {
    const detail = String(error?.message || '').trim()
    const actionLabel = hasDetectedGame.value ? '安装' : '下载'
    $message.error(uiMessage('ui.valueFailedValue', { value1: (actionLabel), value2: (detail || targetFullName) }))
    console.error(`Thunderstore ${actionLabel}失败`, error)
    if (!useSourceInstallTask) {
      setInstallProgressForProfileBatch({
        stage: 'error',
        message: detail || uiText('ui.valueFailed', { value1: (actionLabel) })
      })
      scheduleCloseInstallProgress(2500)
    }
    setInstalling(targetFullName, false)
  } finally {
    if (installVersionModal.value.open) {
      installVersionModal.value = {
        ...installVersionModal.value,
        confirmLoading: false
      }
    }
  }
}

async function loadByRouteId(routeId) {
  const identifier = normalizeIdentifier(routeId)
  clearThunderstoreListReloadTimer()
  versionDialogLoadingMap.value = {}
  installVersionModal.value = createEmptyInstallVersionModalState()
  query.value.page = 1
  query.value.category = ''
  communityCategories.value = []
  if (!identifier) {
    loadProfileStateByCommunity('')
    allMods.value = []
    modTotal.value = 0
    community.value = {
      identifier: '',
      name: '',
      shortDescription: '',
      description: '',
      discordUrl: '',
      wikiUrl: '',
      datetimeCreated: '',
      backgroundImage: '',
      heroImage: '',
      coverImage: '',
      iconUrl: '',
      communityIconUrl: '',
      totalDownloadCount: 0,
      totalPackageCount: 0,
      hasModManagerSupport: false,
      isListed: false
    }
    installedMap.value = {}
    allProfileInstalledSummary.value = {
      stats: [],
      totalCount: 0,
      totalSize: 0
    }
    updatingMap.value = {}
    updateRecords.value = []
    launchConfig.value = {
      community: '',
      profileName: DEFAULT_PROFILE_NAME,
      profileRoot: '',
      appId: 0,
      gameExePath: '',
      gameInstalled: false,
      packageLoader: '',
      launchArgs: [],
      moddedLaunchArgs: [],
      vanillaLaunchArgs: [],
      env: {},
      notes: []
    }
    resetInstallProgress()
    aiPageContextProvider.clear()
    return
  }

  loadProfileStateByCommunity(identifier)
  loadCommunityCategories(identifier)
  await Promise.all([loadCommunityInfo(identifier), loadCommunityModList(identifier)])
  await resolveGameInstallState(identifier)
  await Promise.all([refreshInstalledState(), refreshLaunchConfig(), refreshUpdateState()])
  publishThunderstoreAiPageContext()
}

watch(
  () => query.value.keyword,
  () => {
    query.value.effectiveKeyword = ''
  },
  { flush: 'sync' }
)

watch(
  () => query.value.sort,
  () => {
    resetPage({ reload: true, immediate: true })
  }
)

watch(
  () => query.value.category,
  () => {
    // 切换分类后回到第一页重新加载；列表请求带令牌，切换游戏时的重复请求只保留最后一次结果。
    if (!getCurrentCommunityIdentifier()) return
    resetPage({ reload: true, immediate: true })
  }
)

watch(
  () => pages.value,
  (value) => {
    if (query.value.page > value) {
      query.value.page = value
    }
  }
)

watch(
  () =>
    [
      route.params?.id,
      community.value.identifier,
      community.value.name,
      query.value.keyword,
      query.value.sort,
      activeProfileName.value,
      launchConfig.value.gameExePath,
      gameRuntime.value.packageLoader,
      gameRuntime.value.appId,
      gameRuntime.value.installed
    ].join('|'),
  () => {
    publishThunderstoreAiPageContext()
  },
  { immediate: true }
)

watch(
  () =>
    [
      installVersionModal.value.open,
      installVersionModal.value.item?.full_name || '',
      installVersionModal.value.versionNumber || '',
      installVersionModal.value.selectedVersionDetail?.version_number || '',
      installVersionModal.value.selectedVersionDetail?.download_url || '',
      installVersionModal.value.selectedVersionDetail?.file_size || '',
      Array.isArray(installVersionModal.value.dependencyItems)
        ? installVersionModal.value.dependencyItems.length
        : 0,
      (Array.isArray(installVersionModal.value.versions) ? installVersionModal.value.versions : [])
        .map((version) => {
          return [
            version?.version_number || '',
            version?.download_url ? 'download' : '',
            version?.file_size || ''
          ].join(':')
        })
        .join('|')
    ].join('::'),
  () => {
    publishThunderstoreAiPageContext()
  }
)

watch(
  () =>
    [
      pageMods.value
        .map((item) => {
          return `${item?.full_name || item?.uuid4 || item?.name || ''}:${item?.name || ''}:${item?.latestVersion?.description || ''}`
        })
        .join('|'),
      JSON.stringify([aiTranslationConfig.value, contentLocale.value])
    ].join('::'),
  async () => {
    thunderstoreTranslationMap.value = {}
    thunderstoreTranslationResolvedMap.value = {}
    thunderstoreItemTranslationLoadingMap.value = {}
    await hydrateThunderstoreModTranslations(pageMods.value)
    await autoTranslateThunderstoreMods(pageMods.value)
  },
  { immediate: true }
)

async function handleThunderstoreSystemConfigUpdated() {
  await loadAiSystemConfig()
}

async function syncThunderstoreRoute() {
  // KeepAlive 不会暂停 watch；其他平台或游戏的路由不能改写此页面的列表。
  if (route.path !== pageRoutePath) return
  await initialPageLoad
  if (route.path !== pageRoutePath) return
  const routeId = normalizeIdentifier(route.params?.id)
  if (!routeId) {
    return
  }

  const currentIdentifier = getCurrentCommunityIdentifier()
  if (!currentIdentifier || currentIdentifier !== routeId) {
    await loadByRouteId(routeId)
  }
}

watch(
  () => route.params?.id,
  async () => {
    await syncThunderstoreRoute()
  }
)

const { activate: activateSourceTaskListeners, deactivate: deactivateSourceTaskListeners } =
  createSourceInstallTaskSubscriptions(ipcRenderer, {
    onTaskUpdated: handleSourceInstallTaskUpdated,
    refreshScheduler: installedThunderstoreRefreshScheduler,
    listeners: [['thunderstoreInstallProgress', handleThunderstoreInstallProgress], ['update-system-config', handleThunderstoreSystemConfigUpdated]]
  })

onMounted(async () => {
  activateSourceTaskListeners()
  loadAiSystemConfig().then()
  initialPageLoad = loadByRouteId(route.params.id)
  await initialPageLoad
})

onActivated(async () => {
  activateSourceTaskListeners()
  if (!skippedInitialActivation) {
    skippedInitialActivation = true
    return
  }
  await initialPageLoad
  if (route.path !== pageRoutePath) return
  const routeId = normalizeIdentifier(route.params?.id)
  if (!routeId) {
    return
  }

  const identifier = getCurrentCommunityIdentifier()
  if (!identifier) {
    await loadByRouteId(routeId)
    return
  }
  if (identifier !== routeId) {
    await loadByRouteId(routeId)
    return
  }

  await refreshThunderstoreProfileState(activeProfileName.value, { resetPage: false })
})

onDeactivated(() => {
  deactivateSourceTaskListeners()
})

onUnmounted(() => {
  clearThunderstoreListReloadTimer()
  versionDialogLoadingMap.value = {}
  installVersionModal.value = createEmptyInstallVersionModalState()
  if (installProgressHideTimer.value) {
    clearTimeout(installProgressHideTimer.value)
    installProgressHideTimer.value = null
  }
  deactivateSourceTaskListeners()
})

defineOptions({
  name: 'GameThunderStoreModList'
})
</script>

<template>
  <div class="thunderstore-mod-list">
    <page-body>
      <div class="max_width">
        <unified-mod-header
          :rule-ai-context="{ sourcePlatform: 'thunderstore', gameName: community.name || community.identifier, sourceGameId: community.identifier, appId: gameRuntime.appId }"
          :dlss-context="{ name: community.name, gameId: community.identifier, steamAppId: gameRuntime.appId, sourcePlatform: 'thunderstore', exePath: gameRuntime.installed ? launchConfig.gameExePath : '', args: launchConfig.vanillaLaunchArgs || [] }"
          :cover-image="communityHeroImage"
          :title="gamePresentation(community).title || community.identifier || 'Thunderstore'"
          :subtitle="community.identifier || '--'"
          :tags="headerTags"
          :stats="headerStats"
          :status-text="headerStatusText"
          :status-type="headerStatusType"
          :status-sub-text="headerStatusSubText"
          :actions="headerActions"
          @action="handleHeaderAction"
        />

        <mod-source-profile-modal
          :open="profileConfigModal.open"
          :active-profile-name="activeProfileName"
          :profile-options="profileOptions"
          :profile-mod-count="activeProfileInstalledCount"
          :profile-switching="profileSwitching"
          :profile-operation-locked="profileOperationLocked"
          :sharing-profile="sharingProfile"
          :importing-profile="importingProfile"
          :batch-installing-from-profile="batchInstallingFromProfile"
          :create-profile-loading="createProfileModal.confirmLoading"
          :profile-name-max-length="PROFILE_NAME_MAX_LENGTH"
          @close="closeProfileConfigModal"
          @switch-profile="switchProfile"
          @rename-profile="handleProfileRename"
          @delete-profile="deleteProfile"
          @create-profile="openCreateProfileModal"
          @confirm-create-profile="handleInlineCreateProfile"
          @share-profile="shareProfileCode"
          @update-profile="updateThunderstoreSourceModpack"
          @import-profile="openImportProfileModal"
          @export-file="handleExportToFile"
          @import-file="handleImportFromFile"
        />

        <unified-mod-search-bar
          :keyword="query.keyword"
          :sort="query.sort"
          :sort-options="sortOptions"
          :loading="loading"
          :keyword-placeholder="$t('ui.searchModNames')"
          :category="query.category"
          :category-options="categoryOptions"
          @update:keyword="(value) => (query.keyword = value)"
          @update:sort="(value) => (query.sort = value)"
          @update:category="(value) => (query.category = value)"
          @search="handleSearch"
        />

        <thunderstore-install-progress
          v-if="installProgress.visible"
          :progress="installProgress"
          :status="installProgressStatus"
          :progress-text="getProgressText()"
        />

        <unified-mod-list-grid
          :loading="loading"
          :loading-text="$t('modBrowser.loading')"
          :empty-text="$t('ui.noModsMatchTheCurrentFilters')"
          :items="listItems"
          :floating-actions="thunderstoreFloatingActions"
          :current="query.page"
          :pages="pages"
          :total="total"
          :size="query.limit"
          :current-count="pageMods.length"
          :show-pagination="total > 0"
          @open-detail="handleOpenModDetail"
          @secondary-action="handleSecondaryAction"
          @translate-item="handleTranslateThunderstoreSingleMod"
          @floating-action="handleThunderstoreFloatingAction"
          @install="handleInstallFromList"
          @page-change="changePage"
        />
      </div>

      <thunderstore-install-version-modal
        :system-config="systemConfig"
        :open="installVersionModal.open"
        :modal-state="installVersionModal"
        :active-profile-name="activeProfileName"
        :game-name="gamePresentation(community).title || community.identifier || ''"
        @close="closeInstallVersionModal"
        @confirm="confirmInstallVersion"
        @version-change="handleInstallVersionChange"
      />

      <source-modpack-share-code-modal
        :open="importProfileModal.open"
        :code="importProfileModal.code"
        :loading="importingProfile || batchInstallingFromProfile"
        :title="$t('ui.importAThunderstoreShareCode')"
        :confirm-text="$t('ui.readAndInstall')"
        :hint="$t('ui.createInstallationTasksForTheThunderstoreModsInThisShare', { value1: (activeProfileName) })"
        @update:code="(value) => (importProfileModal.code = value)"
        @confirm="confirmImportProfileCode"
        @cancel="closeImportProfileModal"
      />

      <SourceModpackUpdateModal
        v-model="sourceModpackUpdateModal.open"
        :snapshot="sourceModpackUpdateModal.snapshot"
      />

      <mod-source-create-profile-modal
        :open="createProfileModal.open"
        :confirm-loading="createProfileModal.confirmLoading"
        :name="createProfileModal.name"
        :max-length="PROFILE_NAME_MAX_LENGTH"
        @close="closeCreateProfileModal"
        @confirm="confirmCreateProfileModal"
        @update:name="(value) => (createProfileModal.name = value)"
      />
    </page-body>
  </div>
</template>

<style scoped lang="scss">
.thunderstore-mod-list {
  width: 100%;
  height: 100%;
  background: #f8fafc;

  .max_width {
    min-width: 0;
    width: 100%;
    margin: 0;
  }
}
</style>
