import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { createMainHttp } from './main-network.js'
const axios = createMainHttp('ficsit')

const FICSIT_GRAPHQL_ENDPOINT = 'https://api.ficsit.app/v2/query'
const REQUEST_TIMEOUT = 60000

const FICSIT_SORT_MAP = Object.freeze({
  popularity_desc: { orderBy: 'popularity', order: 'desc' },
  downloads_desc: { orderBy: 'downloads', order: 'desc' },
  updated_desc: { orderBy: 'updated_at', order: 'desc' },
  name_asc: { orderBy: 'name', order: 'asc' }
})

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function resolveSortConfig(sort) {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return FICSIT_SORT_MAP[key] || FICSIT_SORT_MAP.popularity_desc
}

function resolveGraphQLErrorMessage(data = {}, fallbackText = 'Ficsit 接口请求失败') {
  const errors = Array.isArray(data?.errors) ? data.errors : []
  const firstMessage = String(errors?.[0]?.message || '').trim()
  return firstMessage || fallbackText
}

export async function getFicsitModList(params = {}) {
  const page = Math.max(toSafeNumber(params.page, 1), 1)
  const limit = Math.max(toSafeNumber(params.limit, 20), 1)
  const offset = (page - 1) * limit
  const keyword = String(params.keyword || '').trim()
  const { orderBy, order } = resolveSortConfig(params.sort)

  const payload = {
    operationName: 'GetFicsitMods',
    query:
      'query GetFicsitMods($limit: Int!, $offset: Int!, $search: String, $orderBy: ModFields, $order: Order) { getMods(filter: { limit: $limit, offset: $offset, search: $search, order_by: $orderBy, order: $order }) { count mods { id mod_reference name short_description full_description logo logo_thumbhash downloads views popularity updated_at created_at latestVersions { release { version link created_at } beta { version link created_at } alpha { version link created_at } } } } }',
    variables: {
      limit,
      offset,
      search: keyword || null,
      orderBy,
      order
    }
  }

  const response = await axios.post(FICSIT_GRAPHQL_ENDPOINT, payload, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.ficsitAPIRequestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  const data = response?.data && typeof response.data === 'object' ? response.data : {}
  if (Array.isArray(data?.errors) && data.errors.length) {
    throw new Error(resolveGraphQLErrorMessage(data))
  }

  const result =
    data?.data?.getMods && typeof data.data.getMods === 'object' ? data.data.getMods : {}
  const records = Array.isArray(result?.mods) ? result.mods : []
  const total = Math.max(toSafeNumber(result?.count, records.length), 0)
  const pages = Math.max(Math.ceil(total / limit), 1)

  return {
    records,
    total,
    pages,
    current: page,
    limit
  }
}

export async function getFicsitModByReference(modReference = '') {
  const safeReference = String(modReference || '').trim()
  if (!safeReference) {
    throw new Error(uiText('ui.ficsitModIdentifierIsEmpty'))
  }

  const payload = {
    operationName: 'GetFicsitModByReference',
    query:
      'query GetFicsitModByReference($modReference: ModReference!) { getModByReference(modReference: $modReference) { id mod_reference name short_description full_description logo latestVersions { release { version link created_at } beta { version link created_at } alpha { version link created_at } } } }',
    variables: {
      modReference: safeReference
    }
  }

  const response = await axios.post(FICSIT_GRAPHQL_ENDPOINT, payload, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.ficsitAPIRequestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  const data = response?.data && typeof response.data === 'object' ? response.data : {}
  if (Array.isArray(data?.errors) && data.errors.length) {
    throw new Error(resolveGraphQLErrorMessage(data))
  }

  return data?.data?.getModByReference || null
}

export async function getFicsitModVersions(modReference = '') {
  const safeReference = String(modReference || '').trim()
  if (!safeReference) {
    throw new Error(uiText('ui.ficsitModIdentifierIsEmpty'))
  }

  const payload = {
    operationName: 'GetFicsitModVersions',
    query:
      'query GetFicsitModVersions($modReference: ModReference!) { getModByReference(modReference: $modReference) { id mod_reference name short_description full_description logo versions(filter: { limit: 100, offset: 0, order_by: created_at, order: desc }) { id version link stability downloads size created_at updated_at dependencies { mod_reference condition optional } } } }',
    variables: {
      modReference: safeReference
    }
  }

  const response = await axios.post(FICSIT_GRAPHQL_ENDPOINT, payload, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (Number(response?.status) !== 200) {
    throw new Error(uiText('ui.ficsitAPIRequestFailedWithHTTPStatusValue', { value1: (response?.status) }))
  }

  const data = response?.data && typeof response.data === 'object' ? response.data : {}
  if (Array.isArray(data?.errors) && data.errors.length) {
    throw new Error(resolveGraphQLErrorMessage(data))
  }

  return data?.data?.getModByReference || null
}
