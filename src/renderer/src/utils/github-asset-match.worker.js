// Only asset names enter this worker; tokens and download URLs stay in the request layer.
export function matchAssetNames(pattern, names) {
  const matcher = new RegExp(pattern, 'i')
  return names.map((name) => matcher.test(name))
}

if (typeof globalThis.document === 'undefined' && typeof globalThis.postMessage === 'function') {
  globalThis.onmessage = ({ data }) => {
    try {
      globalThis.postMessage({ matches: matchAssetNames(data.pattern, data.names) })
    } catch {
      globalThis.postMessage({ error: 'GitHub Release asset_name_regex 不是有效的正则表达式' })
    }
  }
}
