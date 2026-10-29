/**
 * Vertex Mod Installer - Chrome/Edge 浏览器扩展
 * 识别模组详情页，显示"使用 Vertex 安装"浮动面板
 * 点击后通过 vertex:// 协议唤起 Vertex 客户端
 */
(function () {
  'use strict'

  // ========== 模组页面识别规则 ==========
  const PAGE_RULES = [
    {
      source: 'nexus',
      name: 'Nexus Mods',
      pagePattern: /^https?:\/\/(?:www\.|next\.)?nexusmods\.com\/(?<gameDomain>[^/]+)\/mods\/(?<modId>\d+)/,
      modNameSelector: '.page-title h1, h1.title, h1[class*="title"]',
      modImageSelector: '.mod-image img, .gallery-image img, img[class*="mod"]'
    },
    {
      source: 'modio',
      name: 'Mod.io',
      pagePattern: /^https?:\/\/(www\.)?mod\.io\/g\/(?<gameSlug>[^/]+)\/m\/(?<modSlug>[^/]+)/,
      modNameSelector: 'h1[class*="name"], .profile-header h1, h1',
      modImageSelector: '.media-gallery img, .logo img'
    },
    {
      source: 'curseforge',
      name: 'CurseForge',
      pagePattern: /^https?:\/\/(www\.)?curseforge\.com\/(?<gameSlug>[^/]+)\/mc-mods\/(?<modSlug>[^/]+)/,
      modNameSelector: '.project-title h2, h1',
      modImageSelector: '.project-avatar img'
    },
    {
      source: 'thunderstore',
      name: 'Thunderstore',
      pagePattern: /^https?:\/\/(www\.|new\.)?thunderstore\.io\/c\/(?<gameSlug>[^/]+)\/p\/(?<author>[^/]+)\/(?<modSlug>[^/]+)/,
      modNameSelector: 'h1',
      modImageSelector: '.package-icon img, img[class*="icon"]'
    },
    {
      source: 'ficsit',
      name: 'Ficsit',
      pagePattern: /^https?:\/\/ficsit\.app\/mod\/(?<modSlug>[^/?#]+)/,
      modNameSelector: 'h1, [class*="title"]',
      modImageSelector: 'img[src*="logo"], img[src*="icon"]'
    }
  ]

  // ========== 页面匹配 ==========
  let panelElement = null
  let currentModInfo = null

  function matchCurrentPage() {
    const url = window.location.href
    for (const rule of PAGE_RULES) {
      const match = url.match(rule.pagePattern)
      if (match) return { rule, groups: match.groups }
    }
    return null
  }

  function extractModInfo(rule) {
    const modName = document.querySelector(rule.modNameSelector)?.textContent?.trim() || ''
    return { modName }
  }

  function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = String(str || '')
    return div.innerHTML
  }

  // ========== 构建 vertex:// 协议链接 ==========
  function buildVertexUrl(modInfo) {
    // vertex://open/mod-install?url=编码后的页面URL
    const params = new URLSearchParams({
      url: window.location.href,
      source: modInfo.source || '',
      modName: modInfo.modName || ''
    })
    return `vertex://open/mod-install?${params.toString()}`
  }

  // ========== 面板 UI ==========
  function createPanel(rule, matchGroups) {
    if (panelElement) panelElement.remove()

    const pageInfo = extractModInfo(rule)
    currentModInfo = { ...matchGroups, ...pageInfo, source: rule.source }

    const panel = document.createElement('div')
    panel.id = 'vertex-ext-panel'
    panel.innerHTML = `
      <div class="vertex-ext-header">
        <img class="vertex-ext-logo" src="${chrome.runtime.getURL('icon48.png')}" alt="" width="24" height="24">
        <span class="vertex-ext-title">Vertex</span>
        <button class="vertex-ext-close" id="vertex-ext-close">×</button>
      </div>
      <div class="vertex-ext-body">
        <div class="vertex-ext-mod-name">${escapeHtml(pageInfo.modName || '检测到模组页面')}</div>
        <div class="vertex-ext-source">${escapeHtml(rule.name)} · ${escapeHtml(matchGroups.gameDomain || matchGroups.gameSlug || matchGroups.modSlug || '')}</div>
        <button class="vertex-ext-btn" id="vertex-ext-install">
          ↓ 使用 Vertex 安装
        </button>
        <div class="vertex-ext-status" id="vertex-ext-status" style="display:none;"></div>
      </div>
      <div class="vertex-ext-footer">
        <span class="vertex-ext-badge">已识别</span>
        <span class="vertex-ext-id">${escapeHtml(rule.source)}:${escapeHtml(matchGroups.modId || matchGroups.modSlug || '')}</span>
      </div>
    `

    document.body.appendChild(panel)
    panelElement = panel

    // 入场动画
    requestAnimationFrame(() => {
      panel.classList.add('visible')
    })

    // 绑定事件
    panel.querySelector('#vertex-ext-close').addEventListener('click', () => {
      panel.classList.add('hidden')
      setTimeout(() => panel.remove(), 300)
      panelElement = null
    })

    panel.querySelector('#vertex-ext-install').addEventListener('click', () => {
      handleInstall(panel)
    })
  }

  // ========== 安装处理 ==========
  function handleInstall(panel) {
    if (!currentModInfo) return

    const btn = panel.querySelector('#vertex-ext-install')
    const status = panel.querySelector('#vertex-ext-status')

    btn.classList.add('loading')
    btn.textContent = '⏳ 正在唤起 Vertex...'

    // 通过 vertex:// 协议唤起客户端
    const vertexUrl = buildVertexUrl(currentModInfo)

    // 使用隐藏 iframe 方式唤起协议（兼容性最好）
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = vertexUrl
    document.body.appendChild(iframe)

    // 2秒后清理 iframe 并显示结果
    setTimeout(() => {
      iframe.remove()
      btn.classList.remove('loading')
      btn.textContent = '↓ 使用 Vertex 安装'
      status.style.display = 'block'
      status.className = 'vertex-ext-status success'
      status.textContent = '已发送到 Vertex，请查看客户端'

      setTimeout(() => {
        status.style.display = 'none'
      }, 5000)
    }, 2000)
  }

  // ========== SPA 路由监听 ==========
  function checkAndInject() {
    const result = matchCurrentPage()
    if (result) {
      // 延迟等待 DOM 渲染
      setTimeout(() => {
        createPanel(result.rule, result.groups)
      }, 800)
    } else if (panelElement) {
      panelElement.remove()
      panelElement = null
    }
  }

  // ========== 初始化 ==========
  function init() {
    // 初始检查
    checkAndInject()

    // 监听 SPA 路由变化
    let lastUrl = window.location.href
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href
        checkAndInject()
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })

    // 监听 popstate
    window.addEventListener('popstate', () => {
      setTimeout(checkAndInject, 500)
    })
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
