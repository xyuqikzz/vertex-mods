// DLSS5-Swapper v2.2.7, Copyright (c) 2026 Rakan Alkhaldi, MIT.
import fs from 'node:fs'
import path from 'node:path'
// Cover art, banners and game details from Steam's public store endpoints.
//
// No account, no key, no registration - which is the whole point. The previous
// source was IGDB, which sits behind Twitch credentials that cannot ship with
// the app, so artwork only ever appeared on the one machine that had them.
// Everyone who downloaded the build saw initials.
//
// Store search also resolves games bought on other launchers. Newer Steam
// artwork uses per-asset revision directories, supplied by StoreBrowse.

// library_hero is 1920x620, near enough to the 3.35:1 banner that almost
// nothing is cropped. header is the fallback for the handful of older apps
// that never got a hero image.
const asset = (id, file) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/${file}`
const ARTWORK_VERSION = 2

function artworkIsFresh(art, now = Date.now()) {
  const age = now - art?.fetchedAt
  // Retry incomplete metadata soon; never keep a guessed legacy URL forever.
  return (
    art?.version === ARTWORK_VERSION &&
    age >= 0 &&
    age < (art.assetsResolved ? 7 * 86400000 : 5 * 60000)
  )
}

let lastCall = 0

// Steam's store API is rate limited; this keeps a comfortable distance.
async function throttle() {
  const wait = 320 - (Date.now() - lastCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

// Folder names carry edition suffixes and scene tags that no store matches.
function cleanName(name) {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(repack|fitgirl|dodi|elamigos|codex|rune|empress|plaza|skidrow|multi\d*)\b/gi, ' ')
    .replace(/[_\-–—:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// A search for "Control" happily returns "Star Control", so the closest title
// wins rather than the first row.
function pick(rows, query) {
  const q = norm(query)
  const qWords = new Set(q.split(' '))
  let best = null
  let bestScore = -1

  for (const row of rows) {
    if (row.type && row.type !== 'app') continue
    const n = norm(row.name || '')
    const words = n.split(' ')
    const shared = words.filter((w) => qWords.has(w)).length

    let score = 0
    if (n === q) score += 120
    else if (n.startsWith(q) || q.startsWith(n)) score += 70
    score += (shared / Math.max(qWords.size, 1)) * 40
    // Extra words mean a different, longer title.
    score -= Math.max(0, words.length - qWords.size) * 6

    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }
  return bestScore > 10 ? best : null
}

async function getJson(url) {
  await throttle()
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`Steam replied ${res.status}`)
  return res.json()
}

async function findAppId(name) {
  const query = cleanName(name)
  if (!query) return null
  const j = await getJson(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=us&l=en`
  )
  const hit = pick(j.items || [], query)
  return hit ? { id: hit.id, name: hit.name } : null
}

// Details are a bonus: the art is what matters, so a failure here is not one.
async function detailsFor(appid) {
  try {
    const j = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`
    )
    const row = j && j[String(appid)]
    if (!row || !row.success || !row.data) return null
    const d = row.data
    return {
      name: d.name || null,
      header: d.header_image || null,
      summary: d.short_description || null,
      released:
        d.release_date && /\d{4}/.test(d.release_date.date || '')
          ? Number((d.release_date.date.match(/\d{4}/) || [])[0])
          : null,
      rating: (d.metacritic && d.metacritic.score) || null,
      genres: (d.genres || []).map((g) => g.description).slice(0, 3)
    }
  } catch {
    return null
  }
}

async function assetsFor(appid) {
  try {
    const input = {
      ids: [{ appid: Number(appid) }],
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true }
    }
    const result = await getJson(
      'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=' +
        encodeURIComponent(JSON.stringify(input))
    )
    const item = result.response?.store_items?.find(
      (row) => row.id === Number(appid) && row.success === 1
    )
    return item?.assets || null
  } catch {
    return null
  }
}

function manifestAsset(assets, key, appid) {
  const file = assets?.[key]
  const format = assets?.asset_url_format
  if (
    typeof file !== 'string' ||
    !/^[\w./-]+$/.test(file) ||
    file.includes('..') ||
    typeof format !== 'string' ||
    !format.startsWith(`steam/apps/${appid}/`) ||
    !format.includes('${FILENAME}') ||
    format.includes('..')
  )
    return null
  return (
    'https://shared.cloudflare.steamstatic.com/store_item_assets/' +
    format.replace('${FILENAME}', file)
  )
}

// `appid` is passed straight through for Steam games, where the launcher
// already knows it - no search, so no chance of matching the wrong game.
async function look(name, appid) {
  let id = appid || null
  let searchName = null
  if (!id) {
    const found = await findAppId(name)
    if (!found) return null
    id = found.id
    searchName = found.name
  }

  const [info, assets] = await Promise.all([detailsFor(id), assetsFor(id)])
  const cover = manifestAsset(assets, 'library_capsule', id)
  const hero = manifestAsset(assets, 'library_hero', id)
  const header = manifestAsset(assets, 'header', id) || info?.header || asset(id, 'header.jpg')
  const coverUrl = cover || asset(id, 'library_600x900.jpg')
  return {
    version: ARTWORK_VERSION,
    fetchedAt: Date.now(),
    assetsResolved: !!cover,
    appid: id,
    name: (info && info.name) || searchName || name,
    summary: (info && info.summary) || null,
    released: (info && info.released) || null,
    rating: (info && info.rating) || null,
    genres: (info && info.genres) || [],
    coverUrl,
    coverFallbackUrls: [
      ...new Set([
        asset(id, 'library_600x900.jpg'),
        asset(id, 'library_600x900.png'),
        header,
        info?.header
      ])
    ].filter((url) => url && url !== coverUrl),
    heroUrl: hero || asset(id, 'library_hero.jpg'),
    heroFallbackUrl: header
  }
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  // A missing asset can come back as a tiny placeholder rather than a 404.
  if (buf.length < 2000) throw new Error('asset too small to be artwork')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  return dest
}

// Nothing to configure, so it is always on.
const available = () => true

export { available, look, download, cleanName, artworkIsFresh }
