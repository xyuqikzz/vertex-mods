<script setup>
import { toolText as tt } from '@renderer/i18n/tool-text.js'

import { toolServiceText as serviceText } from '@renderer/i18n/tool-service-text.js'
import { contentLocale } from '@renderer/i18n/content.js'
import { trainerGameName } from '@renderer/i18n/tool-content.js'
import { computed, onMounted, reactive, ref } from 'vue'
import { VxButton, VxConfirmModal, VxModal } from '@renderer/component/vertex-ui/index.js'
import {
  ToolCoverCard,
  ToolEmpty,
  ToolFilterPills,
  ToolIcon,
  ToolIconButton,
  ToolNotice,
  ToolSearchField,
  coverMonogram,
  coverPlaceholderTone
} from '@renderer/component/tool-page/index.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { $message } from '@renderer/common/message.js'
import { useDownloadStore } from '@renderer/store/downloadStore.js'
import { useLocalDatastore } from '@renderer/store/localDataStore.js'
import Pagination from '@renderer/component/Pagination.vue'
import {
  resolveGameNameDictBatch,
  resolveGameNameSearchNameFromDict
} from '@renderer/utils/game-name-dict.js'

const FLING_HOME_URL = 'https://flingtrainer.com'
const PAGE_SIZE = 12

const downloadStore = useDownloadStore()
const localDatastore = useLocalDatastore()

const loading = ref(false)
const detailLoading = ref(false)
const submitting = ref(false)
const keyword = ref('')
const localKeyword = ref('')
const submittedKeyword = ref('')
// 用户输入的原始搜索词，用于标题和空状态；submittedKeyword 可能已转换成英文名。
const searchedText = ref('')
const activeDataScope = ref('online')
const pageData = reactive({
  records: [],
  total: 0,
  current: 1,
  size: PAGE_SIZE,
  pages: 0,
  hasNext: false
})
const activeTrainer = ref(null)
const detailData = ref(null)
const selectedDownloadUrl = ref('')
const downloadModalOpen = ref(false)
const modalMode = ref('download')
const deletingTrainerKey = ref('')
const trainerStateMap = reactive({})
const listError = ref('')
const runningKey = ref('')
const deleteConfirmOpen = ref(false)
const failedCovers = reactive({})
let listLoadToken = 0
let searchToken = 0

const isLocalMode = computed(() => activeDataScope.value === 'local')
const localDownloadedRecords = computed(() =>
  Array.isArray(localDatastore.flingTrainerLocalRecords)
    ? localDatastore.flingTrainerLocalRecords
    : []
)
const dataScopeOptions = computed(() => [
  { label: tt('在线列表'), value: 'online' },
  { label: tt('已下载'), value: 'local', count: localDownloadedRecords.value.length }
])
const filteredLocalRecords = computed(() => {
  const text = String(localKeyword.value || '')
    .trim()
    .toLowerCase()
  const list = localDownloadedRecords.value

  if (!text) return list
  return list.filter((item) =>
    [
      item?.displayGameName,
      item?.translatedGameName,
      item?.gameName,
      item?.title,
      item?.versionName,
      item?.filePath,
      item?.downloadUrl
    ]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(text))
  )
})
const visibleTrainerRecords = computed(() =>
  isLocalMode.value ? filteredLocalRecords.value : pageData.records
)
const hasSearchMode = computed(() => !!submittedKeyword.value.trim())
const hasLocalKeyword = computed(() => !!localKeyword.value.trim())
const isInitialLoading = computed(
  () => !isLocalMode.value && loading.value && !pageData.records.length
)
const sectionTitle = computed(() => {
  if (isLocalMode.value) return tt('已下载')
  if (hasSearchMode.value) return tt('搜索“{0}”', [searchedText.value || submittedKeyword.value])
  return tt('最近更新')
})
const sectionCount = computed(() => {
  if (isLocalMode.value) {
    return hasLocalKeyword.value
      ? tt('{0} / {1} 个', [filteredLocalRecords.value.length, localDownloadedRecords.value.length])
      : tt('{0} 个', [localDownloadedRecords.value.length])
  }
  if (isInitialLoading.value) return ''
  if (hasSearchMode.value) return tt('{0} 条', [Number(pageData.total || 0)])
  return tt('第 {0} 页', [pageData.current || 1])
})
const emptyState = computed(() => {
  if (isLocalMode.value) {
    return hasLocalKeyword.value
      ? {
          icon: 'search',
          title: tt('没有找到相关修改器'),
          description: tt('换个关键词试试，可以搜索游戏名、版本或保存路径。'),
          action: 'clear-local',
          actionText: tt('清除搜索')
        }
      : {
          icon: 'download',
          title: tt('还没有下载过修改器'),
          description: tt('在在线列表里选择游戏并下载，下载完成后会显示在这里。'),
          action: 'online',
          actionText: tt('去在线列表')
        }
  }
  if (hasSearchMode.value) {
    return {
      icon: 'search',
      title: tt('没有找到“{0}”的修改器', [searchedText.value || submittedKeyword.value]),
      description: tt('已按游戏英文名“{0}”搜索。可以换个关键词，或去官网确认是否已发布。', [
        submittedKeyword.value
      ]),
      action: 'clear-online',
      actionText: tt('清除搜索')
    }
  }
  return {
    icon: 'wrench',
    title: tt('暂无风灵月影数据'),
    description: tt('刷新列表，或去官网查看。'),
    action: 'refresh',
    actionText: tt('刷新列表')
  }
})
const showEmpty = computed(
  () => !visibleTrainerRecords.value.length && !isInitialLoading.value && !listError.value
)
// 列表加载失败且没有旧数据时，只显示错误提示条，不显示空的区块标题。
const showLibrary = computed(() => visibleTrainerRecords.value.length > 0 || isInitialLoading.value)
const skeletonCount = 10
const activeTrainerName = computed(
  () => getDisplayGameName(activeTrainer.value || detailData.value || {}) || tt('风灵月影修改器')
)
const modalTitle = computed(() =>
  modalMode.value === 'switch'
    ? tt('{0} · 切换版本', [activeTrainerName.value])
    : tt('{0} · 下载修改器', [activeTrainerName.value])
)
const modalSubtitle = computed(() => {
  if (modalMode.value !== 'switch') return tt('选择要下载的版本，第一个是最新版本')
  const current = getTrainerState(activeTrainer.value || {})?.versionName
  return current
    ? tt('当前已下载 {0}', [getVersionDisplayName({ name: current })])
    : tt('选择要切换到的版本，第一个是最新版本')
})
const downloadCount = computed(() =>
  Array.isArray(detailData.value?.downloads) ? detailData.value.downloads.length : 0
)
const modalOkText = computed(() =>
  modalMode.value === 'switch' ? tt('切换并下载') : tt('加入下载队列')
)
const selectedDownload = computed(() => {
  const list = Array.isArray(detailData.value?.downloads) ? detailData.value.downloads : []
  return list.find((item) => item.downloadUrl === selectedDownloadUrl.value) || list[0] || null
})

function getTrainerKey(item = {}) {
  return String(item?.key || item?.detailUrl || item?.id || item?.title || '').trim()
}

function getTrainerState(item = {}) {
  const key = getTrainerKey(item)
  if (!key) return null
  const state = trainerStateMap[key]
  if (state) return state

  const localRecord = localDownloadedRecords.value.find((record) => getTrainerKey(record) === key)
  if (!localRecord?.filePath) return null
  return {
    status: 'downloaded',
    filePath: localRecord.filePath,
    versionName: localRecord.versionName,
    dateAdded: localRecord.dateAdded,
    downloadUrl: localRecord.downloadUrl
  }
}

function getDisplayGameName(item = {}) {
  return trainerGameName(item, contentLocale.value)
}

function setTrainerState(item = {}, state = null) {
  const key = getTrainerKey(item)
  if (!key) return
  if (!state) {
    delete trainerStateMap[key]
    return
  }
  trainerStateMap[key] = state
}

function syncTrainerStateFromLocalRecords() {
  localDownloadedRecords.value.forEach((record) => {
    const key = getTrainerKey(record)
    if (!key || !record?.filePath) return
    trainerStateMap[key] = {
      status: 'downloaded',
      filePath: record.filePath,
      versionName: record.versionName,
      dateAdded: record.dateAdded,
      downloadUrl: record.downloadUrl
    }
  })
}

async function localizeTrainerRecords(records = []) {
  const list = Array.isArray(records) ? records : []
  if (!list.length) return []

  try {
    const resolvedList = await resolveGameNameDictBatch(
      list.map((item) => ({
        sourcePlatform: 'global',
        rawName: String(item?.gameName || item?.title || '').trim(),
        name: String(item?.gameName || item?.title || '').trim()
      }))
    )

    return list.map((item, index) => {
      const resolved = resolvedList[index]
      const rawGameName = String(item?.gameName || item?.title || '').trim()
      if (!resolved?.matched || !resolved?.displayName) {
        return {
          ...item,
          rawGameName,
          displayGameName: rawGameName
        }
      }

      return {
        ...item,
        rawGameName,
        displayGameName: String(resolved.displayName || rawGameName).trim(),
        translatedGameName: String(resolved.displayName || '').trim(),
        gameNameDictMatched: true,
        gameNameDictMatchType: resolved.matchType || ''
      }
    })
  } catch (error) {
    console.warn('[风灵月影] 游戏名称词库匹配失败，使用官网原名', error)
    return list.map((item) => ({
      ...item,
      rawGameName: String(item?.gameName || item?.title || '').trim(),
      displayGameName: String(item?.gameName || item?.title || '').trim()
    }))
  }
}

function getTrainerCountText(item = {}) {
  const text = String(item.summary || '').trim()
  const trainerMatch = text.match(/Trainer\s+(\d+)/i)
  const optionMatch = text.match(/(\d+)\s*(?:个)?(?:options?|选项|项)/i)
  const count = trainerMatch?.[1] || optionMatch?.[1] || ''
  return count ? tt('Trainer {0} 项', [count]) : tt('Trainer 信息待解析')
}

function getTrainerUpdatedText(item = {}) {
  return String(item.latestUpdated || '').trim() || tt('更新时间未知')
}

function getGameVersionText(item = {}) {
  const text = String(item.summary || '').trim()
  const versionMatch = text.match(/v\d+(?:\.\d+)*(?:\s*(?:-|~|–|—|to)\s*v?\d+(?:\.\d+)*)?/i)
  if (!versionMatch?.[0]) return tt('适配版本待解析')
  return versionMatch[0]
    .replace(/\s*(?:~|–|—|to)\s*/i, ' - ')
    .replace(/\s*-\s*/g, ' - ')
    .trim()
}

function getLocalVersionText(item = {}) {
  return String(item?.versionName || item?.dateAdded || tt('本地版本待解析')).trim()
}

function getLocalFilePathText(item = {}) {
  return String(item?.filePath || tt('本地文件路径缺失')).trim()
}

function getVersionDisplayName(version = {}) {
  const rawName = String(version.name || '').trim()
  if (!rawName) return tt('版本信息待解析')

  const compactText = rawName.replace(/\.(zip|rar|7z|exe)$/i, '').replace(/[_]+/g, ' ')
  const versionMatch = compactText.match(
    /v\d+(?:\.\d+)*(?:\s*(?:-|~|–|—|to)\s*v?\d+(?:\.\d+)*)?(?:[.\s-]*Plus[.\s-]*\d+)?/i
  )

  if (versionMatch?.[0]) {
    return versionMatch[0]
      .replace(/[.\s-]*Plus[.\s-]*/i, ' Plus ')
      .replace(/\s*(?:~|–|—|to)\s*/i, ' - ')
      .replace(/\s*-\s*/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const gameName = String(
    detailData.value?.gameName || getDisplayGameName(activeTrainer.value || {})
  ).trim()
  const cleanText = gameName
    ? compactText.replace(new RegExp(gameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
    : compactText

  const fallbackText = cleanText
    .replace(/\bTrainer\b/gi, '')
    .replace(/\bFLiNG\b/gi, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return fallbackText || rawName
}

function openOfficialSite(url = FLING_HOME_URL) {
  const safeUrl = String(url || FLING_HOME_URL).trim()
  ipcRenderer.send('openBrowse', { url: safeUrl })
}

async function loadList(page = 1) {
  const currentToken = ++listLoadToken
  loading.value = true
  listError.value = ''
  try {
    const result = await ipcRenderer.invoke('flingTrainer:list', {
      keyword: submittedKeyword.value.trim(),
      page,
      pageSize: PAGE_SIZE
    })
    const records = await localizeTrainerRecords(result?.records)
    if (currentToken !== listLoadToken) return

    pageData.records = records
    pageData.total = Number(result?.total || 0)
    pageData.current = Number(result?.current || page || 1)
    pageData.size = Number(result?.size || PAGE_SIZE)
    pageData.pages = Number(result?.pages || 0)
    pageData.hasNext = !!result?.hasNext
  } catch (error) {
    if (currentToken !== listLoadToken) return
    console.error('获取风灵月影列表失败', error)
    // 失败原因在列表上方的错误提示条里显示，并提供重试。
    listError.value = String(error?.message || tt('未知错误'))
    pageData.records = []
    pageData.total = 0
    pageData.hasNext = false
  } finally {
    if (currentToken === listLoadToken) {
      loading.value = false
    }
  }
}

async function resolveSearchKeyword(input = '') {
  const text = String(input || '').trim()
  if (!text) return ''

  try {
    const resolved = await resolveGameNameSearchNameFromDict({ keyword: text })
    return String(resolved?.searchName || text).trim()
  } catch (error) {
    console.warn('[风灵月影] 中文搜索词转换失败，使用原关键词', error)
    return text
  }
}

async function search() {
  const currentToken = ++searchToken
  const nextKeyword = await resolveSearchKeyword(keyword.value)
  if (currentToken !== searchToken) return

  submittedKeyword.value = nextKeyword
  searchedText.value = String(keyword.value || '').trim()
  loadList(1)
}

function resetSearch() {
  searchToken += 1
  keyword.value = ''
  submittedKeyword.value = ''
  searchedText.value = ''
  loadList(1)
}

function refreshCurrentScope() {
  if (isLocalMode.value) {
    syncTrainerStateFromLocalRecords()
    return
  }
  loadList(pageData.current)
}

function changePage(page) {
  loadList(page)
}

async function openVersionModal(item = {}, mode = 'download') {
  const detailUrl = String(item?.detailUrl || '').trim()
  if (!detailUrl) {
    $message.warning(tt('该条目缺少详情页地址，无法获取下载版本'))
    return
  }

  modalMode.value = mode
  activeTrainer.value = item
  detailData.value = null
  selectedDownloadUrl.value = ''
  downloadModalOpen.value = true
  detailLoading.value = true

  try {
    const result = await ipcRenderer.invoke('flingTrainer:detail', { detailUrl })
    const downloads = Array.isArray(result?.downloads) ? result.downloads : []
    detailData.value = {
      ...result,
      downloads
    }
    selectedDownloadUrl.value = downloads[0]?.downloadUrl || ''
  } catch (error) {
    console.error('获取风灵月影下载详情失败', error)
    $message.error(tt('获取下载版本失败：{0}', [String(error?.message || tt('未知错误'))]))
  } finally {
    detailLoading.value = false
  }
}

function getFileType(downloadUrl = '') {
  const pathname = String(downloadUrl || '').split('?')[0]
  const match = pathname.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : 'exe'
}

function buildDownloadTask(trainer = {}, version = {}) {
  const taskName = String(
    version.name || trainer.title || activeTrainer.value?.title || '风灵月影修改器'
  )
  const sourceId = String(trainer.detailUrl || activeTrainer.value?.detailUrl || taskName)
  const sourceFileId = String(version.downloadUrl || taskName)

  return {
    task_name: taskName,
    module: '风灵月影',
    file_type: getFileType(version.downloadUrl),
    preferredFileName: taskName,
    download_url: String(version.downloadUrl || '').trim(),
    file_size: 0,
    saveType: 1,
    sourcePlatform: 'fling',
    sourceModId: sourceId,
    sourceFileId,
    dedupeKey: `fling:${sourceId}:${sourceFileId}`,
    showOpenInDownloadList: true,
    fun: {
      type: 0
    }
  }
}

function buildLocalTrainerRecord(targetTrainer = {}, trainer = {}, version = {}, filePath = '') {
  const key = getTrainerKey(targetTrainer) || getTrainerKey(trainer)
  const displayGameName = String(
    targetTrainer?.displayGameName || trainer?.displayGameName || trainer?.gameName || ''
  ).trim()

  return {
    key,
    id: key,
    title: String(targetTrainer?.title || trainer?.title || displayGameName || '').trim(),
    gameName: String(trainer?.gameName || targetTrainer?.gameName || displayGameName || '').trim(),
    displayGameName,
    translatedGameName: String(
      targetTrainer?.translatedGameName || trainer?.translatedGameName || ''
    ).trim(),
    detailUrl: String(targetTrainer?.detailUrl || trainer?.detailUrl || '').trim(),
    coverUrl: String(targetTrainer?.coverUrl || trainer?.coverUrl || '').trim(),
    logoUrl: String(
      targetTrainer?.logoUrl || trainer?.logoUrl || targetTrainer?.coverUrl || ''
    ).trim(),
    summary: String(targetTrainer?.summary || trainer?.summary || '').trim(),
    latestUpdated: String(trainer?.latestUpdated || targetTrainer?.latestUpdated || '').trim(),
    versionName: String(version?.name || '').trim(),
    dateAdded: String(version?.dateAdded || '').trim(),
    fileSize: String(version?.fileSize || '').trim(),
    downloadCount: String(version?.downloadCount || '').trim(),
    downloadUrl: String(version?.downloadUrl || '').trim(),
    fileType: getFileType(version?.downloadUrl),
    filePath: String(filePath || '').trim()
  }
}

async function checkCurrentVersionBeforeSwitch(trainer = {}) {
  if (modalMode.value !== 'switch') return true

  const state = getTrainerState(trainer)
  const filePath = String(state?.filePath || '').trim()
  if (!filePath) return true

  const result = await ipcRenderer.invoke('flingTrainer:check-file-unlocked', { filePath })
  if (!result?.success) {
    $message.warning(
      String(serviceText(result) || tt('当前版本文件正在运行或被占用，无法切换版本'))
    )
    return false
  }

  return true
}

async function confirmDownload() {
  const trainer = detailData.value || activeTrainer.value || {}
  const version = selectedDownload.value
  if (!version?.downloadUrl) {
    $message.warning(tt('请先选择要下载的版本'))
    return
  }

  submitting.value = true
  try {
    const targetTrainer = activeTrainer.value || trainer
    const previousState = getTrainerState(targetTrainer)
    const isSwitchMode = modalMode.value === 'switch'
    const canSwitch = await checkCurrentVersionBeforeSwitch(targetTrainer)
    if (!canSwitch) return

    const task = buildDownloadTask(trainer, version)
    const created = downloadStore.addDownloadItem(JSON.parse(JSON.stringify(task)), {
      onSuccess: async ({ filePath = '' }) => {
        const previousFilePath = String(previousState?.filePath || '').trim()
        if (isSwitchMode && previousFilePath) {
          const removeResult = await ipcRenderer.invoke('flingTrainer:remove-file-if-unlocked', {
            filePath: previousFilePath
          })
          if (!removeResult?.success) {
            $message.warning(
              String(
                serviceText(removeResult) ||
                  tt('新版本已下载，但旧版本文件正在运行或被占用')
              )
            )
          }
        }
        setTrainerState(targetTrainer, {
          status: 'downloaded',
          filePath,
          versionName: version.name,
          dateAdded: version.dateAdded,
          downloadUrl: version.downloadUrl
        })
        localDatastore.upsertFlingTrainerLocalRecord(
          buildLocalTrainerRecord(targetTrainer, trainer, version, filePath)
        )
        $message.success(tt('下载完成，可直接运行'))
      },
      onError: async ({ message = '' }) => {
        setTrainerState(targetTrainer, null)
        $message.error(String(serviceText(message) || tt('风灵月影下载失败')))
      }
    })

    if (!created) {
      $message.warning(tt('该下载任务已存在'))
      return
    }

    setTrainerState(targetTrainer, {
      status: 'downloading',
      versionName: version.name,
      downloadUrl: version.downloadUrl
    })
    $message.success(tt('已加入下载队列，可在下载中心查看进度'))
    downloadModalOpen.value = false
  } finally {
    submitting.value = false
  }
}

async function runTrainer(item = {}) {
  const key = getTrainerKey(item)
  if (runningKey.value) return
  runningKey.value = key
  try {
    await runTrainerFile(item)
  } finally {
    // 运行请求结束前保持按钮忙碌，避免重复启动同一个修改器。
    if (runningKey.value === key) runningKey.value = ''
  }
}

async function runTrainerFile(item = {}) {
  const state = getTrainerState(item)
  const filePath = String(state?.filePath || '').trim()
  if (!filePath) {
    $message.warning(tt('未找到已下载文件，请重新下载'))
    setTrainerState(item, null)
    localDatastore.removeFlingTrainerLocalRecord(item)
    return
  }

  const result = await ipcRenderer.invoke('flingTrainer:run-file', { filePath })
  const resolvedFilePath = String(result?.filePath || '').trim()
  if (resolvedFilePath && resolvedFilePath !== filePath) {
    const nextState = {
      ...state,
      status: 'downloaded',
      filePath: resolvedFilePath
    }
    setTrainerState(item, nextState)
    localDatastore.upsertFlingTrainerLocalRecord({
      ...item,
      ...nextState,
      fileType: 'exe'
    })
  }
  if (!result?.success) {
    const message = String(serviceText(result) || tt('运行失败，请检查文件是否存在'))
    $message.warning(serviceText(message))
    if (message.includes('文件不存在')) {
      setTrainerState(item, null)
      localDatastore.removeFlingTrainerLocalRecord(item)
    }
  }
}

async function deleteTrainerFile(item = {}) {
  const state = getTrainerState(item)
  const filePath = String(state?.filePath || '').trim()
  if (!filePath) {
    $message.warning(tt('未找到已下载文件，已清除本地状态'))
    setTrainerState(item, null)
    localDatastore.removeFlingTrainerLocalRecord(item)
    return
  }

  const key = getTrainerKey(item)
  if (deletingTrainerKey.value) return

  deletingTrainerKey.value = key
  try {
    const checkResult = await ipcRenderer.invoke('flingTrainer:check-file-unlocked', { filePath })
    if (!checkResult?.success) {
      $message.warning(
        String(serviceText(checkResult) || tt('当前修改器正在运行或被占用，无法删除'))
      )
      return
    }

    const removeResult = await ipcRenderer.invoke('flingTrainer:remove-file-if-unlocked', {
      filePath
    })
    if (!removeResult?.success) {
      $message.warning(
        String(serviceText(removeResult) || tt('当前修改器正在运行或被占用，无法删除'))
      )
      return
    }

    setTrainerState(item, null)
    localDatastore.removeFlingTrainerLocalRecord(item)
    $message.success(
      removeResult?.removed === false ? tt('文件不存在，已清除本地状态') : tt('已删除修改器文件')
    )
  } finally {
    if (deletingTrainerKey.value === key) {
      deletingTrainerKey.value = ''
    }
  }
}

function getTrainerStatus(item = {}) {
  return getTrainerState(item)?.status || ''
}

function getCoverImage(item = {}) {
  const url = String(item?.coverUrl || item?.logoUrl || '').trim()
  return url && !failedCovers[url] ? url : ''
}

function markCoverFailed(item = {}) {
  const url = String(item?.coverUrl || item?.logoUrl || '').trim()
  if (url) failedCovers[url] = true
}

function getLocalMetaVersion(item = {}) {
  return item?.versionName
    ? getVersionDisplayName({ name: item.versionName })
    : getLocalVersionText(item)
}

// 卡片只展示数据，所有操作仍走原来的下载、切换、运行、删除流程。
function getCardView(item = {}) {
  const status = getTrainerStatus(item)
  const name = getDisplayGameName(item) || item.title || ''
  const updated = String(item.latestUpdated || '').trim()
  const meta = isLocalMode.value
    ? [getLocalMetaVersion(item), getLocalFilePathText(item)]
    : [
        [getTrainerCountText(item), getGameVersionText(item)].join(' · '),
        updated ? tt('更新于 {0}', [updated]) : getTrainerUpdatedText(item)
      ]
  const flag =
    status === 'downloaded'
      ? { tone: 'success', label: tt('已下载') }
      : status === 'downloading'
        ? { tone: 'progress', label: tt('下载中') }
        : null
  const quick =
    status === 'downloaded'
      ? {
          label: tt('运行'),
          ariaLabel: tt('运行 {0} 修改器', [name]),
          icon: 'play',
          busy: runningKey.value === getTrainerKey(item)
        }
      : status === 'downloading'
        ? null
        : { label: tt('下载'), ariaLabel: tt('下载 {0} 修改器', [name]), icon: 'download' }
  return {
    title: name,
    meta,
    flag,
    quick,
    image: getCoverImage(item),
    tone: coverPlaceholderTone(getTrainerKey(item) || name),
    monogram: coverMonogram(item.rawGameName || item.gameName || name),
    coverLabel:
      status === 'downloaded'
        ? tt('{0}，已下载，切换版本', [name])
        : status === 'downloading'
          ? tt('{0}，下载中', [name])
          : tt('{0}，选择版本下载', [name]),
    coverDisabled: status === 'downloading'
  }
}

const trainerCards = computed(() =>
  visibleTrainerRecords.value.map((item) => ({
    key: getTrainerKey(item),
    item,
    view: getCardView(item)
  }))
)

function openCard(item = {}) {
  const status = getTrainerStatus(item)
  if (status === 'downloading') return
  openVersionModal(item, status === 'downloaded' ? 'switch' : 'download')
}

function handleQuick(item = {}) {
  if (getTrainerStatus(item) === 'downloaded') {
    runTrainer(item)
    return
  }
  openVersionModal(item, 'download')
}

function handleEmptyAction(action) {
  if (action === 'clear-local') localKeyword.value = ''
  else if (action === 'clear-online') resetSearch()
  else if (action === 'online') activeDataScope.value = 'online'
  else loadList(1)
}

function isCurrentVersion(version = {}) {
  if (modalMode.value !== 'switch') return false
  const current = getTrainerState(activeTrainer.value || {})
  return (
    !!current &&
    (current.downloadUrl === version.downloadUrl || current.versionName === version.name)
  )
}

function requestDelete() {
  if (!activeTrainer.value || deletingTrainerKey.value) return
  deleteConfirmOpen.value = true
}

async function confirmDelete() {
  const item = activeTrainer.value
  if (!item) return
  await deleteTrainerFile(item)
  if (!getTrainerState(item)) downloadModalOpen.value = false
}

onMounted(() => {
  syncTrainerStateFromLocalRecords()
  loadList(1)
})
</script>

<template>
  <div class="fling-tool tool-section">
    <header class="tool-toolbar">
      <ToolFilterPills
        v-model="activeDataScope"
        :options="dataScopeOptions"
        :label="tt('数据范围')"
      />
      <div class="tool-toolbar__tools">
        <ToolSearchField
          v-if="!isLocalMode"
          v-model="keyword"
          wide
          :placeholder="tt('搜索游戏，支持中文或英文名')"
          :label="tt('搜索修改器')"
          @submit="search"
          @clear="hasSearchMode && resetSearch()"
        />
        <ToolSearchField
          v-else
          v-model="localKeyword"
          wide
          :placeholder="tt('搜索已下载的游戏、版本或路径')"
          :label="tt('搜索已下载的修改器')"
        />
        <ToolIconButton
          icon="refresh"
          :label="isLocalMode ? tt('刷新状态') : tt('刷新列表')"
          :busy="!isLocalMode && loading"
          @click="refreshCurrentScope"
        />
        <VxButton variant="secondary" class="official-button" @click="openOfficialSite()">
          <span class="fling-button-content">
            <ToolIcon name="external" :size="14" />
            {{ tt('官网') }}
          </span>
        </VxButton>
      </div>
    </header>

    <ToolNotice v-if="listError && !isLocalMode" tone="danger" :title="tt('获取风灵月影列表失败')">
      {{ serviceText(listError) }}
      <template #actions>
        <VxButton variant="secondary" size="sm" @click="loadList(pageData.current || 1)">
          {{ tt('重试') }}
        </VxButton>
      </template>
    </ToolNotice>

    <section
      v-if="showLibrary"
      class="fling-library"
      :aria-busy="loading"
      :aria-label="sectionTitle"
    >
      <div class="tool-section-head">
        <h2 class="tool-section-title">
          {{ sectionTitle }}<small v-if="sectionCount">{{ sectionCount }}</small>
        </h2>
        <p v-if="!isLocalMode && loading" class="tool-section-hint" role="status">
          <span class="tool-inline-spinner" aria-hidden="true"></span>
          {{ tt('正在更新列表') }}
        </p>
      </div>

      <div v-if="isInitialLoading" class="tool-cover-grid" aria-hidden="true">
        <div v-for="index in skeletonCount" :key="index" class="tool-skeleton-card">
          <span class="tool-skeleton is-cover"></span>
          <span class="tool-skeleton is-line"></span>
          <span class="tool-skeleton is-short"></span>
        </div>
      </div>

      <div v-else class="tool-cover-grid">
        <ToolCoverCard
          v-for="card in trainerCards"
          :key="card.key"
          v-bind="card.view"
          class="trainer-card"
          @select="openCard(card.item)"
          @quick="handleQuick(card.item)"
          @image-error="markCoverFailed(card.item)"
        />
      </div>

      <pagination
        v-if="!isLocalMode && !isInitialLoading"
        class="fling-pagination"
        :current="pageData.current"
        :pages="pageData.pages"
        :total="hasSearchMode ? pageData.total : 0"
        :size="pageData.size"
        :current-count="pageData.hasNext ? pageData.size : pageData.records.length"
        :show-total="hasSearchMode"
        @change="changePage"
      />
    </section>

    <ToolEmpty
      v-else-if="showEmpty"
      :icon="emptyState.icon"
      :title="emptyState.title"
      :description="emptyState.description"
    >
      <VxButton variant="secondary" @click="handleEmptyAction(emptyState.action)">
        {{ emptyState.actionText }}
      </VxButton>
    </ToolEmpty>

    <VxModal
      v-model="downloadModalOpen"
      :title="modalTitle"
      :subtitle="modalSubtitle"
      :width="560"
      panel-class="fling-download-modal"
      :close-on-esc="!submitting"
      :show-close="!submitting"
    >
      <div class="download-confirm" :aria-busy="detailLoading">
        <div class="download-game">
          <span
            class="download-cover"
            :style="{ '--cover-tone': coverPlaceholderTone(getTrainerKey(activeTrainer || {})) }"
            aria-hidden="true"
          >
            <img
              v-if="getCoverImage(activeTrainer || {})"
              :src="getCoverImage(activeTrainer || {})"
              alt=""
              referrerpolicy="no-referrer"
            />
            <span v-else>{{
              coverMonogram(
                activeTrainer?.rawGameName || activeTrainer?.gameName || activeTrainerName
              )
            }}</span>
          </span>
          <span class="download-game__name">{{ activeTrainerName }}</span>
        </div>

        <ToolNotice v-if="modalMode === 'switch'" tone="warning">
          {{
            tt('新版本下载完成后会删除当前版本。如果修改器正在运行，请先关闭它，否则会停止切换。')
          }}
        </ToolNotice>

        <div class="tool-section-head">
          <h4 class="tool-section-title version-heading">
            {{ tt('可下载版本')
            }}<small v-if="downloadCount">{{ tt('{0} 个', [downloadCount]) }}</small>
          </h4>
          <button
            v-if="activeTrainer?.detailUrl"
            type="button"
            class="fling-link"
            @click="openOfficialSite(activeTrainer.detailUrl)"
          >
            {{ tt('在官网查看') }}
            <ToolIcon name="external" :size="12" />
          </button>
        </div>

        <div v-if="detailLoading" class="version-list" aria-hidden="true">
          <span v-for="index in 3" :key="index" class="tool-skeleton version-skeleton"></span>
        </div>

        <div
          v-else-if="detailData?.downloads?.length"
          class="version-list vx-ui-scrollbar"
          role="radiogroup"
          :aria-label="tt('选择版本')"
        >
          <label
            v-for="(version, index) in detailData.downloads"
            :key="version.downloadUrl"
            class="version-item"
            :class="{ active: selectedDownloadUrl === version.downloadUrl }"
          >
            <input
              v-model="selectedDownloadUrl"
              type="radio"
              name="fling-version"
              :value="version.downloadUrl"
            />
            <span class="version-content">
              <span class="version-title-row">
                <strong :title="version.name">{{ getVersionDisplayName(version) }}</strong>
                <span v-if="index === 0" class="tool-tag is-accent">{{ tt('最新') }}</span>
                <span v-if="isCurrentVersion(version)" class="tool-tag">{{ tt('当前') }}</span>
              </span>
              <span class="version-meta-row">
                <span>{{ version.dateAdded || tt('日期未知') }}</span>
                <span v-if="version.fileSize">{{ version.fileSize }}</span>
                <span v-if="version.downloadCount">
                  {{ tt('{0} 次下载', [version.downloadCount]) }}
                </span>
              </span>
            </span>
          </label>
        </div>

        <ToolEmpty
          v-else
          compact
          icon="file"
          :title="tt('未解析到可下载版本')"
          :description="tt('可以去官网查看是否有可下载的文件。')"
        />
      </div>

      <template #footer>
        <VxButton
          v-if="modalMode === 'switch'"
          variant="ghost"
          size="sm"
          class="fling-delete-button"
          :loading="deletingTrainerKey === getTrainerKey(activeTrainer || {})"
          :disabled="submitting || !!deletingTrainerKey"
          @click="requestDelete"
        >
          <span class="fling-button-content">
            <ToolIcon name="trash" :size="14" />
            {{ tt('删除已下载文件') }}
          </span>
        </VxButton>
        <span class="selected-version">
          <template v-if="selectedDownload && modalMode !== 'switch'">
            {{ tt('已选') }}
            <strong>{{ getVersionDisplayName(selectedDownload) }}</strong>
            <span v-if="selectedDownload.fileSize"> · {{ selectedDownload.fileSize }}</span>
          </template>
        </span>
        <VxButton variant="secondary" :disabled="submitting" @click="downloadModalOpen = false">
          {{ tt('取消') }}
        </VxButton>
        <VxButton
          :loading="submitting"
          :disabled="detailLoading || !selectedDownloadUrl"
          @click="confirmDownload"
        >
          {{ modalOkText }}
        </VxButton>
      </template>
    </VxModal>

    <VxConfirmModal
      v-model="deleteConfirmOpen"
      :title="tt('删除修改器文件？')"
      :description="
        tt('将删除 {0} 已下载的修改器文件。如果修改器正在运行，会停止删除。', [activeTrainerName])
      "
      :confirm-text="tt('删除')"
      :cancel-text="tt('取消')"
      danger
      :confirm-action="confirmDelete"
    />
  </div>
</template>

<style scoped lang="scss">
.fling-library {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.fling-button-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.fling-pagination {
  margin-top: var(--space-2);
}

.download-confirm {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.download-game {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.download-cover {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 56px;
  height: 32px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  background: var(--cover-tone, var(--color-surface-strong));
  border-radius: var(--radius-sm);

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.download-game__name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.version-heading {
  font-size: var(--font-size-sm);
}

.fling-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: var(--color-accent-active);
  font: inherit;
  font-size: 12.5px;
  font-weight: var(--font-weight-medium);
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  outline: none;
  cursor: pointer;

  &:hover {
    color: var(--color-accent-strong);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 320px;
  margin-right: -6px;
  padding: 2px 6px 2px 2px;
  overflow-y: auto;
}

.version-skeleton {
  height: 60px;
  border-radius: var(--radius-md);
}

.version-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  box-sizing: border-box;
  padding: var(--space-3) 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    box-shadow: var(--focus-ring);
  }

  &.active {
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
    border-color: var(--color-accent);
  }

  input {
    flex: 0 0 auto;
    width: var(--choice-size);
    height: var(--choice-size);
    margin: 0;
    accent-color: var(--color-accent-active);
  }
}

.version-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.version-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.version-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.vx-button.fling-delete-button {
  margin-left: calc(-1 * var(--space-2));
  color: var(--color-danger-strong);
}

.selected-version {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;

  strong {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
  }
}

@media (prefers-reduced-motion: reduce) {
  .version-item {
    transition: none;
  }
}
</style>
