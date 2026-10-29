// 只有实际消费的公开配置可以进入桌面产物；禁止按 VITE_ 前缀整体暴露环境。
const publicKeys = Object.freeze([
  'VITE_APP_ID', 'VITE_APP_NAME', 'VITE_APP_VERSION',
  'VITE_LOCAL_ID', 'VITE_LOCAL_NAME', 'VITE_REQUEST_API',
  'VITE_NEXUS_API_BASE_URL', 'VITE_THUNDERSTORE_BASE_URL'
])

export function publicBuildEnvironment(env) {
  return {
    envPrefix: [],
    define: Object.fromEntries(publicKeys.filter((key) => env[key] !== undefined).map((key) =>
      [`import.meta.env.${key}`, JSON.stringify(env[key])]
    ))
  }
}
