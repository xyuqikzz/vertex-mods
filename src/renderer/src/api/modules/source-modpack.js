import { Request } from '../index.js'

const http = new Request()

function toPlainJson(data, fallback) {
  try {
    return JSON.parse(JSON.stringify(data))
  } catch {
    return fallback
  }
}

export function CREATE_SOURCE_MODPACK(data) {
  return http.post('/source-modpack/create', toPlainJson(data || {}, {}))
}

export function GET_SOURCE_MODPACK_LIST(params = {}) {
  return http.get('/source-modpack/list', {
    params: toPlainJson(params || {}, {}),
    hideLoading: true
  })
}

export function GET_MY_SOURCE_MODPACK_LIST(params = {}) {
  return http.get('/source-modpack/me', {
    params: toPlainJson(params || {}, {}),
    hideLoading: true
  })
}

export function GET_MY_SOURCE_MODPACK_FAVORITES(params = {}) {
  return http.get('/source-modpack/my-favorites', {
    params: toPlainJson(params || {}, {}),
    hideLoading: true
  })
}

export function GET_MY_SOURCE_MODPACK_SUBSCRIPTIONS(params = {}) {
  return http.get('/source-modpack/my-subscriptions', {
    params: toPlainJson(params || {}, {}),
    hideLoading: true
  })
}

export function GET_SOURCE_MODPACK_SUBSCRIPTION_UPDATES() {
  return http.get('/source-modpack/subscription/updates', {
    hideLoading: true,
    silentBusinessError: true
  })
}

export function GET_SOURCE_MODPACK_BY_CODE(code) {
  return http.get(`/source-modpack/code/${encodeURIComponent(String(code || '').trim())}`, {
    hideLoading: true
  })
}

export function GET_SOURCE_MODPACK_INFO(id) {
  return http.get(`/source-modpack/info/${encodeURIComponent(String(id || '').trim())}`, {
    hideLoading: true
  })
}

export function MARK_SOURCE_MODPACK_SUBSCRIPTION_SEEN(packUid, revision) {
  return http.post(
    `/source-modpack/${encodeURIComponent(String(packUid || '').trim())}/subscription/seen`,
    {},
    { params: revision == null ? {} : { revision }, hideLoading: true }
  )
}

export function UPDATE_SOURCE_MODPACK(id, data) {
  return http.put(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}`,
    toPlainJson(data || {}, {}),
    {
      hideLoading: true
    }
  )
}

export function UPDATE_SOURCE_MODPACK_PUBLISH(id, publish = true) {
  return http.put(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}/publish`,
    {},
    {
      params: {
        publish: publish === true
      },
      hideLoading: true
    }
  )
}

export function DELETE_SOURCE_MODPACK(id) {
  return http.post(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}/delete`,
    {},
    {
      hideLoading: true
    }
  )
}

export function TOGGLE_SOURCE_MODPACK_LIKE(id) {
  return http.post(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}/like`,
    {},
    {
      hideLoading: true
    }
  )
}

export function TOGGLE_SOURCE_MODPACK_FAVORITE(id) {
  return http.post(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}/favorite`,
    {},
    {
      hideLoading: true
    }
  )
}

export function TOGGLE_SOURCE_MODPACK_SUBSCRIBE(id) {
  return http.post(
    `/source-modpack/${encodeURIComponent(String(id || '').trim())}/subscribe`,
    {},
    {
      hideLoading: true
    }
  )
}
