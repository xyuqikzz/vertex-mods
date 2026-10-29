import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://flingtrainer.com'
const DEFAULT_PAGE_SIZE = 12
const DETAIL_ENRICH_LIMIT = 6

const http = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  }
})

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    return new URL(text, BASE_URL).href
  } catch {
    return ''
  }
}

function resolveImageUrl($, el) {
  const imageEl = $(el).find('img').first()
  return normalizeUrl(
    imageEl.attr('data-src') ||
      imageEl.attr('data-lazy-src') ||
      imageEl.attr('src') ||
      imageEl.attr('data-original') ||
      ''
  )
}

function resolveMetaImage($) {
  return normalizeUrl(
    $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      ''
  )
}

function resolveLastUpdated(text = '') {
  const normalized = normalizeText(text)
  const match = normalized.match(/Last Updated:\s*([0-9]{4}[./-][0-9]{2}[./-][0-9]{2})/i)
  return match ? match[1].replace(/\./g, '-') : ''
}

function buildTrainerItem(raw = {}) {
  const title = normalizeText(raw.title)
  const detailUrl = normalizeUrl(raw.detailUrl)
  const coverUrl = normalizeUrl(raw.coverUrl)
  const logoUrl = normalizeUrl(raw.logoUrl || coverUrl)

  return {
    id: detailUrl || title,
    title,
    gameName: title.replace(/\s+Trainer$/i, '').trim() || title,
    detailUrl,
    coverUrl,
    logoUrl,
    summary: normalizeText(raw.summary),
    latestUpdated: normalizeText(raw.latestUpdated),
    source: 'fling'
  }
}

async function fetchHtml(url) {
  const { data } = await http.get(url)
  return data
}

async function getHomeList(page = 1) {
  const safePage = Math.max(Number(page) || 1, 1)
  const url = safePage === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${safePage}/`
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const records = []

  $('article').each((_, el) => {
    const titleEl = $(el).find('h2 a').first()
    const title = normalizeText(titleEl.text())
    const detailUrl = normalizeUrl(titleEl.attr('href'))
    if (!title || !detailUrl) return

    const text = normalizeText($(el).text())
    const coverUrl = resolveImageUrl($, el)

    records.push(
      buildTrainerItem({
        title,
        detailUrl,
        coverUrl,
        logoUrl: coverUrl,
        summary: text,
        latestUpdated: resolveLastUpdated(text)
      })
    )
  })

  const hasNext = $('.pagination a, .page-numbers a')
    .toArray()
    .some((el) => normalizeText($(el).text()).toLowerCase().includes('next'))

  return {
    records,
    total: 0,
    current: safePage,
    size: records.length || DEFAULT_PAGE_SIZE,
    pages: 0,
    hasNext,
    sourceUrl: BASE_URL
  }
}

async function getAllTrainersAZ() {
  const html = await fetchHtml(`${BASE_URL}/all-trainers/`)
  const $ = cheerio.load(html)
  const map = new Map()

  $("a[href*='/trainer/']").each((_, el) => {
    const title = normalizeText($(el).text())
    const detailUrl = normalizeUrl($(el).attr('href'))
    if (!title || !detailUrl) return
    map.set(detailUrl, buildTrainerItem({ title, detailUrl }))
  })

  return [...map.values()]
}

async function enrichTrainerList(records = []) {
  const targetList = records.slice(0, DETAIL_ENRICH_LIMIT)
  const detailList = await Promise.all(
    targetList.map(async (item) => {
      try {
        return await getTrainerDetail(item.detailUrl)
      } catch (error) {
        console.log(`[风灵月影] 补全详情失败：${item.detailUrl}`, error)
        return null
      }
    })
  )
  const detailMap = new Map()
  detailList.filter(Boolean).forEach((item) => {
    detailMap.set(item.detailUrl, item)
  })

  return records.map((item) => {
    const detail = detailMap.get(item.detailUrl)
    if (!detail) return item
    return {
      ...item,
      coverUrl: detail.coverUrl || item.coverUrl,
      logoUrl: detail.logoUrl || item.logoUrl || detail.coverUrl,
      summary: item.summary || detail.summary,
      latestUpdated: detail.latestUpdated || item.latestUpdated
    }
  })
}

async function searchTrainers({ keyword = '', page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const safeKeyword = normalizeText(keyword).toLowerCase()
  const safePage = Math.max(Number(page) || 1, 1)
  const safePageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), 48)
  if (!safeKeyword) {
    return getHomeList(safePage)
  }

  const allList = await getAllTrainersAZ()
  const filteredList = allList.filter((item) => item.title.toLowerCase().includes(safeKeyword))
  const start = (safePage - 1) * safePageSize
  const records = await enrichTrainerList(filteredList.slice(start, start + safePageSize))

  return {
    records,
    total: filteredList.length,
    current: safePage,
    size: safePageSize,
    pages: Math.ceil(filteredList.length / safePageSize),
    hasNext: start + safePageSize < filteredList.length,
    sourceUrl: `${BASE_URL}/all-trainers/`
  }
}

function parseDownloadRows($) {
  const downloads = []

  $("a[href*='/downloads/']").each((_, el) => {
    const linkEl = $(el)
    const href = normalizeUrl(linkEl.attr('href'))
    if (!href) return

    const rowCells = linkEl
      .closest('tr')
      .find('td')
      .map((__, cell) => normalizeText($(cell).text()))
      .get()

    downloads.push({
      name: normalizeText(linkEl.text()) || rowCells[0] || `风灵月影下载 ${downloads.length + 1}`,
      downloadUrl: href,
      dateAdded: rowCells[1] || '',
      fileSize: rowCells[2] || '',
      downloadCount: rowCells[3] || ''
    })
  })

  return downloads
}

async function getTrainerDetail(detailUrl) {
  const safeDetailUrl = normalizeUrl(detailUrl)
  if (!safeDetailUrl) {
    throw new Error('缺少详情页地址')
  }

  const html = await fetchHtml(safeDetailUrl)
  const $ = cheerio.load(html)
  const title = normalizeText($('h1').first().text())
  const pageText = normalizeText($('body').text())
  const coverUrl = resolveMetaImage($) || resolveImageUrl($, $('article').first())
  const downloads = parseDownloadRows($)

  return {
    ...buildTrainerItem({
      title,
      detailUrl: safeDetailUrl,
      coverUrl,
      logoUrl: coverUrl,
      summary: pageText.slice(0, 280),
      latestUpdated: resolveLastUpdated(pageText)
    }),
    downloads,
    sourceUrl: safeDetailUrl
  }
}

export async function getFlingTrainerList(payload = {}) {
  return searchTrainers(payload)
}

export async function getFlingTrainerDetail(payload = {}) {
  return getTrainerDetail(payload?.detailUrl)
}

export function getFlingTrainerDownloadHeaders(downloadUrl = '') {
  try {
    const url = new URL(downloadUrl)
    if (url.origin === BASE_URL || url.origin === 'https://www.flingtrainer.com') {
      // 官网下载会重定向到文件服务，文件服务要求保留官网来源页。
      return { Referer: `${BASE_URL}/` }
    }
  } catch {
    // 非官网或无效地址不附加来源信息，交由下载引擎处理。
  }
  return {}
}
