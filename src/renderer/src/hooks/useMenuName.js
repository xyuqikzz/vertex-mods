import { onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { useAppStore } from '@renderer/store/appStore.js'

export function useMenuName() {
  const route = useRoute()
  const appStore = useAppStore()
  let isDisposed = false
  let isActive = true
  const boundFullPath = ref('')
  const boundPath = ref('')
  const latestTitle = shallowRef(null)
  const readTitle = () => typeof latestTitle.value === 'function' ? latestTitle.value() : latestTitle.value

  function normalizePath(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    return raw.split('#')[0].split('?')[0] || ''
  }

  function normalizeFullPath(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    return raw.split('#')[0] || ''
  }

  function bindRouteIfNeed(fullPath) {
    const normalizedFullPath = normalizeFullPath(fullPath)
    const normalizedPath = normalizePath(normalizedFullPath)

    if (!boundFullPath.value && normalizedFullPath) {
      boundFullPath.value = normalizedFullPath
    }
    if (!boundPath.value && normalizedPath) {
      boundPath.value = normalizedPath
    }

    return {
      fullPath: normalizedFullPath,
      path: normalizedPath
    }
  }

  // 初始化绑定当前组件实例对应的路径
  bindRouteIfNeed(route.fullPath)

  onBeforeRouteLeave((_to, _from, next) => {
    // 离开当前页面前先标记失活，避免后续路由变更污染绑定路径
    isActive = false
    next()
  })

  onBeforeRouteUpdate((to, _from, next) => {
    // 同一组件实例内发生路由更新时，刷新绑定路径
    if (isActive) {
      boundFullPath.value = normalizeFullPath(to.fullPath)
      boundPath.value = normalizePath(to.fullPath)
    }
    next()
  })

  onActivated(() => {
    isActive = true
    bindRouteIfNeed(route.fullPath)
    if (latestTitle.value !== null) publishTitle(readTitle())
  })

  onDeactivated(() => {
    isActive = false
  })

  onScopeDispose(() => {
    isDisposed = true
  })

  // Reactive title getters keep cached pages in sync without recreating a closed tab.
  watch(readTitle, name => {
    if (name !== null && appStore.menuList.some(item => item.fullPath === boundFullPath.value)) {
      publishTitle(name)
    }
  })

  function setMenuName(name, pathOrOptions) {
    latestTitle.value = name
    publishTitle(readTitle(), pathOrOptions)
  }

  function publishTitle(name, pathOrOptions) {
    // 组件已卸载时直接忽略，避免写入无效页面
    if (isDisposed) {
      return
    }

    let path = ''
    let fullPath = ''

    // 标准调用：setMenuName(name, path)
    if (typeof pathOrOptions === 'string') {
      path = normalizePath(pathOrOptions)
      fullPath = normalizeFullPath(pathOrOptions)
    } else if (pathOrOptions && typeof pathOrOptions === 'object') {
      // 兼容对象调用：setMenuName(name, { path, fullPath })
      fullPath = normalizeFullPath(pathOrOptions.fullPath || pathOrOptions.path)
      path = normalizePath(pathOrOptions.path || fullPath)
    }

    // 以组件实例绑定路径为准，保证每个页面实例只改自己的标题
    const targetFullPath = boundFullPath.value || fullPath || normalizeFullPath(route.fullPath)
    const targetPath = boundPath.value || path || normalizePath(targetFullPath)
    if (!targetPath || !targetFullPath) {
      console.warn('[useMenuName] 未获取到可用 path，已忽略本次标题更新')
      return
    }

    const payload = {
      path: targetPath,
      fullPath: targetFullPath,
      name
    }

    appStore.setMenuName(payload)
  }

  return {
    setMenuName
  }
}
