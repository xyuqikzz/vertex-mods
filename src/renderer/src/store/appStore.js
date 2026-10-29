// 引入依赖
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import router from '../router/index.js'
import {
  getMenuRouteKey,
  normalizeMenuFullPath,
  normalizeMenuPath
} from '@renderer/utils/menu-route-key.js'

export const useAppStore = defineStore('appStore', () => {
  // ==================== 状态声明 ====================
  const menuAllList = ref([
    {
      name: '首页',
      svgName: 'homeSvg',
      path: '/app/home',
      isShow: 1
    },
    {
      type: 1,
      name: '模块',
      svgName: 'moduleSvg',
      isShow: 1
    },
    {
      name: '个人',
      svgName: 'userSvg',
      path: '/app/user',
      isShow: 0
    },
    {
      type: 2,
      name: '下载',
      svgName: 'downloadSvg',
      path: '/app/download',
      isShow: 1
    },
    {
      name: '设置',
      svgName: 'settingsSvg',
      path: '/app/settings',
      isShow: 1
    }
  ])
  // 应用状态
  const cachedViews = ref([])

  function addCachedView(name) {
    if (!name || cachedViews.value.includes(name)) return
    cachedViews.value.push(name)
  }

  function clearCachedViews() {
    cachedViews.value = []
  }

  function removeCachedView(name) {
    const index = cachedViews.value.indexOf(name)
    if (index !== -1) {
      cachedViews.value.splice(index, 1)
    }
  }

  // 菜单状态
  const menuList = ref([])
  const isShowMenu = ref(false)
  const lastRoute = ref('')

  const AppData = ref({
    version: '',
    requestUrl: ''
  })

  // ==================== 监听器 ====================
  watch(
    () => AppData.value.requestUrl,
    () => {
      clearCachedViews()
    }
  )

  function normalizeMenuEntry(data = {}) {
    const fullPath = normalizeMenuFullPath(data.fullPath || data.path)
    const path = normalizeMenuPath(data.path || fullPath)

    return {
      ...data,
      path,
      fullPath
    }
  }

  function getMenuEntryKey(item = {}) {
    return getMenuRouteKey(item.fullPath || item.path)
  }

  // ==================== 方法定义 ====================
  /**
   * 设置菜单项
   * @param {Object} data - 菜单数据
   * @param {string} data.path - 路由路径
   * @param {Object} [data.fatherRoute] - 父路由信息
   */
  function setMenu(data) {
    const currentMenuList = menuList.value
    const normalizedData = normalizeMenuEntry(data)
    const { path, fullPath, fatherRoute = {} } = normalizedData

    // 添加父路由（如果存在且未添加）
    if (fatherRoute.path) {
      const normalizedFatherRoute = normalizeMenuEntry(fatherRoute)
      const hasFatherRoute = currentMenuList.some(
        (item) => getMenuEntryKey(item) === getMenuEntryKey(normalizedFatherRoute)
      )
      if (!hasFatherRoute) {
        menuList.value.push({
          ...normalizedFatherRoute,
          content: fatherRoute.content
        })
      }
    }

    // 添加当前路由（如果未存在）
    const currentKey = getMenuEntryKey(normalizedData)
    const exists = currentMenuList.some((item) => getMenuEntryKey(item) === currentKey)
    if (!exists && path && fullPath) {
      menuList.value.push(normalizedData)
    }
  }

  function setMenuName(data) {
    const normalizedData = normalizeMenuEntry(data)
    const { path, fullPath, name = '' } = normalizedData || {}
    if (!path || !fullPath) return

    const currentKey = getMenuEntryKey(normalizedData)
    const index = menuList.value.findIndex((item) => getMenuEntryKey(item) === currentKey)
    if (index === -1) {
      menuList.value.push({
        path,
        fullPath,
        content: name
      })
    } else {
      menuList.value[index].path = path
      menuList.value[index].fullPath = fullPath
      menuList.value[index].content = name
    }

    isShowMenu.value = true
    const currentFullPath = normalizeMenuFullPath(router.currentRoute.value?.fullPath)
    if (getMenuRouteKey(currentFullPath) === currentKey) {
      lastRoute.value = fullPath
    }
  }

  function removeCachedPage(url) {
    const normalizedUrl = normalizeMenuPath(url)
    if (!normalizedUrl) return

    // Let Vue Router resolve constrained params and aliases, including community sources.
    const matchedRoute = router.resolve(normalizedUrl).matched.at(-1)

    if (matchedRoute && matchedRoute.name) {
      removeCachedView(matchedRoute.name)
    }
  }

  // ==================== 导出 ====================
  return {
    // 状态
    cachedViews,
    menuList,
    menuAllList,
    isShowMenu,
    lastRoute,
    AppData,
    // 方法
    setMenu,
    setMenuName,
    addCachedView,
    clearCachedViews,
    removeCachedView,
    removeCachedPage
  }
})
