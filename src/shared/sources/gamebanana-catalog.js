const BASE_URL = 'https://gamebanana.com/apiv11'

export function requireGamebananaId(value) {
  const id = String(value ?? '').trim()
  if (!/^[1-9]\d{0,15}$/.test(id)) throw new Error('Banana标识无效')
  return id
}

export const GAMEBANANA_DEFAULT_PER_PAGE = 20
// Banana 列表接口单页上限；调用方按界面需要传入，超出时截断。
export const GAMEBANANA_MAX_PER_PAGE = 50

export function normalizeGamebananaPerPage(value) {
  const size = Math.floor(Number(value) || GAMEBANANA_DEFAULT_PER_PAGE)
  return Math.min(Math.max(size, 1), GAMEBANANA_MAX_PER_PAGE)
}

export function buildGamebananaListRequest({ gameId = '', keyword = '', page = 1, perPage } = {}) {
  const model = gameId ? 'Mod' : 'Game'
  if (gameId) requireGamebananaId(gameId)
  const search = String(keyword || '')
    .trim()
    .slice(0, 200)
  const params = { _nPage: Math.max(1, Math.floor(Number(page) || 1)) }
  const _nPerpage = normalizeGamebananaPerPage(perPage)
  if (!gameId) {
    return {
      url: `${BASE_URL}/Game/Index`,
      params: {
        ...params,
        _nPerpage,
        // Banana 的官方数量排序统计全部投稿，不能将其伪称为纯 Mods 数量。
        _sSort: 'Game_MostSubmissions',
        ...(search ? { '_aFilters[Generic_Name]': `contains,${search}` } : {})
      }
    }
  }
  if (search) {
    return {
      url: `${BASE_URL}/Util/Search/Results`,
      params: {
        ...params,
        _sSearchString: search,
        _sModelName: model,
        ...(gameId ? { _idGameRow: gameId } : {})
      }
    }
  }
  return {
    url: `${BASE_URL}/${model}/Index`,
    params: { ...params, _nPerpage, ...(gameId ? { '_aFilters[Generic_Game]': gameId } : {}) }
  }
}

function imageUrl(raw = {}) {
  const images = Array.isArray(raw._aPreviewMedia?._aImages) ? raw._aPreviewMedia._aImages : []
  const image = images.find((item) => item._sType === 'banner') || images[0]
  const url =
    image?._sUrl ||
    (image?._sBaseUrl && `${image._sBaseUrl}/${image._sFile530 || image._sFile}`) ||
    ''
  return /^https:\/\//i.test(url) ? url : ''
}

export function normalizeGamebananaRecord(raw = {}) {
  const id = requireGamebananaId(raw._idRow)
  return {
    id,
    name: String(raw._sName || '未命名'),
    image: imageUrl(raw),
    author: String(raw._aSubmitter?._sName || ''),
    description: String(raw._sDescription || raw._sSummary || ''),
    gameId: String(raw._aGame?._idRow || ''),
    gameName: String(raw._aGame?._sName || ''),
    version: String(raw._sVersion || ''),
    category: String(raw._aRootCategory?._sName || ''),
    url: `https://gamebanana.com/${raw._sModelName === 'Game' ? 'games' : 'mods'}/${id}`
  }
}

// requestedSize：请求时的每页数量，响应缺少 _nPerpage 时用它计算页数，避免与请求不一致。
export function normalizeGamebananaPage(
  data,
  page = 1,
  requestedSize = GAMEBANANA_DEFAULT_PER_PAGE
) {
  if (!Array.isArray(data?._aRecords)) throw new Error('Banana返回的数据格式异常，请稍后重试')
  const total = Math.max(0, Number(data._aMetadata?._nRecordCount) || 0)
  const size = Math.max(1, Number(data._aMetadata?._nPerpage) || Number(requestedSize) || 20)
  return {
    records: data._aRecords.map(normalizeGamebananaRecord),
    total,
    size,
    current: Math.max(1, Number(page) || 1),
    pages: Math.max(1, Math.ceil(total / size))
  }
}

export function normalizeGamebananaDetail(raw) {
  const record = normalizeGamebananaRecord(raw)
  // Render as text; remote HTML is never injected into the privileged renderer.
  const description = String(raw._sText || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  const files = (Array.isArray(raw._aFiles) ? raw._aFiles : []).map((file) => {
    const id = requireGamebananaId(file._idRow)
    const blocked =
      ['infected', 'malicious'].includes(String(file._sAvResult).toLowerCase()) ||
      ['bad', 'malicious'].includes(String(file._sAnalysisResult).toLowerCase())
    return {
      id,
      name: String(file._sFile || `gamebanana-${id}.zip`),
      size: Math.max(0, Number(file._nFilesize) || 0),
      version: String(file._sVersion || record.version),
      url: `https://gamebanana.com/dl/${id}`,
      archived: file._bIsArchived === true,
      blocked
    }
  })
  return { ...record, description, files }
}

export function buildGamebananaDownloadTask(mod, fileId) {
  const id = requireGamebananaId(mod.id)
  const gameId = requireGamebananaId(mod.gameId)
  const file = mod.files?.find((entry) => entry.id === String(fileId))
  if (!file || file.blocked) throw new Error('该文件不可下载，请查看作者页面')
  requireGamebananaId(file.id)
  const fileName = [...file.name]
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
  return {
    source: 'gamebanana',
    sourceAdapter: 'gamebanana',
    sourceGameId: gameId,
    gameKey: `gamebanana:${gameId}`,
    gameName: mod.gameName,
    title: `Banana下载：${mod.name}`,
    items: [
      {
        item: {
          task_name: `Banana下载：${mod.name} - ${fileName}`,
          module: 'Mod',
          fileName,
          file_name: fileName,
          file_type: fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '',
          download_url: `https://gamebanana.com/dl/${file.id}`,
          file_size: file.size,
          speed: 0,
          percentage: 0,
          saveType: 2,
          downloadPurpose: 'download_only',
          showOpenInDownloadList: true,
          sourcePlatform: 'gamebanana',
          sourceType: 'gamebanana',
          sourceGameId: gameId,
          sourceModId: id,
          sourceFileId: file.id,
          sourceModKey: `gamebanana:${id}:${file.id}`,
          version: file.version
        },
        meta: { displayName: `${mod.name} - ${fileName}`, version: file.version }
      }
    ]
  }
}

export const GAMEBANANA_DETAIL_PROPERTIES =
  '_idRow,_sName,_sText,_aGame,_aFiles,_aPreviewMedia,_aSubmitter,_sVersion,_aRootCategory'
