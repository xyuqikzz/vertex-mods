import { createRouter, createWebHashHistory } from 'vue-router'
import { $message } from '@renderer/common/message.js'
import { getAccountState } from '../utils/account-bootstrap.js'

const routes = [
  {
    path: '/app/ai-assistant-sidecar',
    name: 'AiAssistantSidecar',
    component: () => import('@views/ai-assistant/sidecar.vue'),
    meta: { title: 'AiAssistantSidecar' }
  },
  {
    path: '/app',
    name: 'App',
    component: () => import('@views/index.vue'),
    children: [
      {
        path: 'home',
        name: 'Home',
        component: () => import('@views/home/index.vue'),
        meta: { title: 'Home', saveScrollPosition: true }
      },
      {
        path: 'device',
        redirect: {
          path: '/app/system'
        }
      },
      {
        path: 'game-tools',
        name: 'GameTools',
        component: () => import('@views/game-tools/index.vue'),
        meta: { title: 'GameTools', usePathKey: true }
      },
      {
        path: 'game',
        name: 'Game',
        component: () => import('@views/game/index.vue'),
        meta: { title: 'Games', saveScrollPosition: true, usePathKey: true }
      },
      {
        path: 'system',
        name: 'System',
        component: () => import('@views/system/index.vue'),
        // 与游戏工具一致：?tool= 切换模块时复用同一个页面实例，不重新挂载。
        meta: { title: 'System', usePathKey: true }
      },
      {
        path: 'game/details/:id',
        name: 'GameDetails',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameDetails', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/mod/list/:id',
        alias: ['game/vertex/mod/list/:id', 'game/server/mod/list/:id'],
        name: 'GameModList',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameModList', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/mod/details/:id',
        name: 'GameModDetails',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameModDetails', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/community/:source(gamebanana|steam-workshop)/:id',
        name: 'GameCommunityModList',
        component: () => import('@views/game/community/mod-list.vue'),
        meta: { title: '模组列表', saveScrollPosition: true, usePathKey: true }
      },
      {
        path: 'game/site/detail',
        name: 'GameSiteDetail',
        component: () => import('@views/game/site-detail.vue'),
        meta: { title: 'GameSiteDetail', saveScrollPosition: false }
      },
      {
        path: 'game/repository',
        name: 'GameRepository',
        component: () => import('@views/game/gameRepository.vue'),
        meta: { title: 'GameRepository', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/modManagement/:source/:id',
        name: 'GameModManagement',
        component: () => import('@views/game/modManagement.vue'),
        meta: { title: 'GameModManagement', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/modManagement/:id',
        redirect: (to) => {
          const source =
            String(to.query?.source || 'vertex')
              .trim()
              .toLowerCase() || 'vertex'
          return {
            name: 'GameModManagement',
            params: {
              source,
              id: String(to.params?.id || '').trim()
            },
            query: to.query
          }
        }
      },
      {
        path: 'game/addModpack/:id',
        name: 'GameAddModpack',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameAddModpack', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/modpack/details/:id',
        name: 'GameModpackDetails',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameModpackDetails', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/addMod',
        name: 'GameAddMod',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameAddMod', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/editMod/:id',
        name: 'GameEditMod',
        component: () => import('@views/game/retired-source.vue'),
        meta: { title: 'GameEditMod', saveScrollPosition: true },
        props: true
      },
      {
        path: 'game/thunderstore/mod/list/:id',
        name: 'GameThunderStoreModList',
        component: () => import('@views/game/thunderstore/mod-list.vue'),
        meta: {
          title: 'GameEditMod',
          saveScrollPosition: true,
          usePathKey: true
        },
        props: true
      },
      {
        path: 'game/thunderstore/config/:id',
        name: 'GameThunderStoreConfigEditor',
        component: () => import('@views/game/thunderstore/config-editor.vue'),
        meta: {
          title: 'GameThunderStoreConfigEditor',
          saveScrollPosition: true,
          usePathKey: true
        },
        props: true
      },
      {
        path: 'game/ficsit/mod/list/:id',
        name: 'GameFicsitModList',
        component: () => import('@views/game/ficsit/mod-list.vue'),
        meta: { title: 'GameFicsitModList', saveScrollPosition: true, usePathKey: true },
        props: true
      },
      {
        path: 'game/nexus/mod/list/:id',
        name: 'GameNexusModList',
        component: () => import('@views/game/nexus/mod-list.vue'),
        meta: { title: 'GameNexusModList', saveScrollPosition: true, usePathKey: true },
        props: true
      },
      {
        path: 'game/modio/mod/list/:id',
        name: 'GameModioModList',
        component: () => import('@views/game/modio/mod-list.vue'),
        meta: { title: 'GameModioModList', saveScrollPosition: true, usePathKey: true },
        props: true
      },
      {
        path: 'game/vamhub/mod/list/:id',
        name: 'GameVamHubModList',
        component: () => import('@views/game/vamhub/mod-list.vue'),
        meta: { title: 'GameVamHubModList', saveScrollPosition: true, usePathKey: true },
        props: true
      },
      {
        path: 'game/source/:sourcePlatform/config/:id',
        name: 'GameSourceInstallConfig',
        component: () => import('@views/game/source/pages/SourceInstallConfigPage.vue'),
        meta: { title: 'GameSourceInstallConfig', saveScrollPosition: true, usePathKey: true },
        props: true
      },
      {
        path: 'game/install-tasks',
        name: 'GameInstallTaskCenter',
        component: () => import('@views/game/installTaskCenter.vue'),
        meta: { title: 'GameInstallTaskCenter', saveScrollPosition: true, usePathKey: true }
      },
      {
        // 整合包已并入模组中心内容区：旧地址（含 ?code=、?tab=）转到模组中心并打开整合包面板。
        path: 'game/source-modpacks',
        name: 'GameSourceModpacks',
        redirect: (to) => ({ name: 'Game', query: { ...to.query, view: 'modpack' } })
      },
      {
        path: 'game/modio/config/:id',
        name: 'GameModioConfigEditor',
        component: () => import('@views/game/source/pages/SourceInstallConfigPage.vue'),
        meta: {
          title: 'GameModioConfigEditor',
          saveScrollPosition: true,
          usePathKey: true,
          sourcePlatform: 'modio'
        },
        props: true
      },
      {
        path: 'game/nexus/config/:id',
        name: 'GameNexusConfigEditor',
        component: () => import('@views/game/source/pages/SourceInstallConfigPage.vue'),
        meta: {
          title: 'GameNexusConfigEditor',
          saveScrollPosition: true,
          usePathKey: true,
          sourcePlatform: 'nexus'
        },
        props: true
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@views/settings/index.vue'),
        // ?section= 切换分类时复用同一个页面实例，不重新挂载。
        meta: { title: 'Settings', usePathKey: true }
      },
      {
        path: 'download',
        name: 'Download',
        redirect: to => ({ path: '/app/game/install-tasks', query: { ...to.query, tab: 'downloads' } }),
        meta: { title: 'Downloads', saveScrollPosition: true }
      },
      {
        path: 'devConsole',
        name: 'DevConsole',
        component: () => import('@views/dev/index.vue'),
        meta: { title: 'DevConsole', saveScrollPosition: true },
        props: true
      },
      {
        path: 'devConsole/ui-components',
        name: 'DevUiComponents',
        component: () => import('@views/dev/ui-components.vue'),
        meta: { title: 'DevUiComponents', saveScrollPosition: true }
      },
      {
        path: 'user',
        name: 'User',
        component: () => import('@views/user/index.vue'),
        meta: { title: '个人中心', saveScrollPosition: true },
        props: true
      }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 }
  }
})

function isAssistantSidecarWindow() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('window') === 'ai-assistant-sidecar'
}

router.beforeEach((to, from, next) => {
  if (!to.matched.length) {
    next(
      isAssistantSidecarWindow()
        ? '/app/ai-assistant-sidecar'
        : '/app/home'
    )
    return
  }
  if (!isAssistantSidecarWindow() && to.path === '/app/ai-assistant-sidecar') {
    next('/app/home')
    return
  }
  if (isAssistantSidecarWindow() && to.path !== '/app/ai-assistant-sidecar') {
    next('/app/ai-assistant-sidecar')
    return
  }
  // 检查目标路由是否需要认证
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    const token = getAccountState().token

    if (!token) {
      // 如果没有 token，重定向到登录页
      $message.warning('请先登录')
      next('/app/home')
    } else {
      // 有 token 则继续
      next()
    }
  } else {
    // 不需要认证的路由直接放行
    next()
  }
})

router.afterEach((to) => {
  console.log('[Router]', to.fullPath)
})

export default router
