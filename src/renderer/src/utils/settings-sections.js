// 设置页分类按通用、来源与账号、下载与存储、AI 和系统分组。
export const SETTINGS_GROUPS = Object.freeze([
  { id: 'general', name: '通用' },
  { id: 'sources', name: '来源与账号' },
  { id: 'storage', name: '下载与存储' },
  { id: 'ai', name: 'AI' },
  { id: 'system', name: '系统' }
])

export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'general', group: 'general', name: '常规', icon: 'sliders' },
  { id: 'pet', group: 'general', name: '桌宠', icon: 'paw' },
  { id: 'nexus', group: 'sources', name: 'Nexus Mods', icon: 'link' },
  { id: 'steam', group: 'sources', name: 'Steam', icon: 'gamepad' },
  { id: 'modio', group: 'sources', name: 'Mod.io', icon: 'package' },
  { id: 'download', group: 'storage', name: '下载', icon: 'download' },
  { id: 'storage', group: 'storage', name: '存储位置', icon: 'folder' },
  { id: 'packages', group: 'storage', name: '安装包', icon: 'archive' },
  { id: 'services', group: 'ai', name: '模型服务', icon: 'server' },
  { id: 'translate', group: 'general', name: '模组翻译', icon: 'translate' },
  { id: 'assistant', group: 'ai', name: 'AI 助手', icon: 'sparkle' },
  { id: 'privacy', group: 'system', name: '隐私', icon: 'shield' },
  { id: 'about', group: 'system', name: '关于', icon: 'info' }
])

// 旧地址里的 section 值（分区 id 和卡片锚点）继续可用。
const aliases = {
  preference: 'general',
  sources: 'nexus',
  apiSetting: 'nexus',
  toolSetting: 'packages',
  systemToolSetting: 'packages',
  aiTranslation: 'services',
  aiTranslationSetting: 'assistant',
  appUpdate: 'about'
}

export function resolveSettingsSection(value = '') {
  const id = String(value || '').trim()
  if (Object.hasOwn(aliases, id)) return aliases[id]
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.id || 'general'
}

// 搜索只匹配设置名和关键词（不搜说明全文）。
export const SETTINGS_SEARCH_INDEX = Object.freeze([
  ['general', '界面语言', 'language 语言 中文 英文 english'],
  ['general', '开机时自动启动', '开机 自启 启动 autostart'],
  ['general', '关闭主窗口时', '托盘 退出 关闭 窗口 tray'],
  ['pet', '显示桌宠', '宠物 桌宠 形象 pet'],
  ['pet', '导入桌宠压缩包', 'petdex zip 宠物 导入'],
  ['nexus', 'Nexus 授权方式', '登录 账号 oauth 授权'],
  ['nexus', 'Nexus Personal API Key', 'api key 密钥 nexus'],
  ['steam', 'Steam 账号', '登录 授权 创意工坊 workshop'],
  ['modio', 'Mod.io API Key', 'api key 密钥 modio mod.io'],
  ['modio', 'Mod.io API 地址', 'api path 地址 modio'],
  ['download', '下载引擎', 'aria2 浏览器 下载 engine'],
  ['download', '同时下载的任务数', '并发 下载 任务 concurrent'],
  ['storage', '下载文件夹', '路径 下载 位置 目录 path'],
  ['storage', '文件管理', '清理 磁盘 文件 空间'],
  ['storage', '应用缓存文件夹', '缓存 路径 目录 cache'],
  ['storage', '优先使用游戏所在磁盘做下载缓存', '缓存 磁盘 同盘 cache'],
  ['packages', '安装后保留安装包', '安装包 缓存 压缩包 备份'],
  ['packages', '清理安装包缓存', '缓存 清理 删除 安装包'],
  ['services', '模型服务', 'api key base url 模型 ai 接口'],
  ['translate', '微软翻译', '翻译 microsoft edge translate', 'modelSettings.microsoft'],
  ['translate', '目标语言', '翻译 语言 target language', 'modelSettings.targetLanguage'],
  ['translate', '每批条数', '批量 batch 翻译', 'modelSettings.batchSize'],
  ['assistant', '启用 AI 助手', '助手 ai 智能体 assistant'],
  ['assistant', '角色与技能', '智能体 ai-agent.json 技能 角色'],
  ['assistant', '工具日志', '日志 工具 log'],
  ['privacy', '发送使用统计与错误报告', '隐私 统计 上报 错误 报告'],
  ['about', '检查更新', '版本 更新 发布 下载 安装 update release version', 'settings.update.check'],
  [
    'about',
    '复制版本信息',
    '版本信息 系统 反馈 问题 issue feedback bug source 源代码',
    'settings.update.copy'
  ],
  [
    'about',
    '',
    '开源 第三方 项目 许可 许可证 仓库 致谢 依赖 open source third party projects license repository credits dependencies about',
    'settings.aboutProjects.title'
  ]
])

export function searchSettings(keyword = '') {
  const query = String(keyword || '')
    .trim()
    .toLowerCase()
  if (!query) return []
  return SETTINGS_SEARCH_INDEX.filter(([section, title, keywords]) => {
    const name = SETTINGS_SECTIONS.find((item) => item.id === section)?.name || ''
    return `${title} ${keywords} ${name}`.toLowerCase().includes(query)
  }).map(([section, title, , titleKey]) => ({ section, title, ...(titleKey ? { titleKey } : {}) }))
}
