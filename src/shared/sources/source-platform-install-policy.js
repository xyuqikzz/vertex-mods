const SOURCE_PLATFORM_INSTALL_POLICY_MAP = Object.freeze({
  gamebanana: {
    source: 'gamebanana', displayName: 'Banana', supportsRuleInstall: true,
    noRuleAction: 'download_only', unmatchedRuleAction: 'download_only'
  },
  'steam-workshop': {
    source: 'steam-workshop', displayName: 'Steam', supportsRuleInstall: true,
    noRuleAction: 'download_only', unmatchedRuleAction: 'download_only'
  },
  nexus: {
    source: 'nexus',
    displayName: 'Nexus',
    supportsRuleInstall: true,
    noRuleAction: 'download_only',
    unmatchedRuleAction: 'download_only'
  },
  modio: {
    source: 'modio',
    displayName: 'mod.io',
    supportsRuleInstall: true,
    noRuleAction: 'download_only',
    unmatchedRuleAction: 'download_only'
  },
  thunderstore: {
    source: 'thunderstore',
    displayName: 'Thunderstore',
    supportsRuleInstall: true,
    noRuleAction: 'download_only',
    unmatchedRuleAction: 'download_only'
  },
  ficsit: {
    source: 'ficsit',
    displayName: 'Ficsit',
    supportsRuleInstall: true,
    noRuleAction: 'download_only',
    unmatchedRuleAction: 'download_only'
  }
})

const DEFAULT_SOURCE_PLATFORM_INSTALL_POLICY = Object.freeze({
  source: '',
  displayName: '来源平台',
  supportsRuleInstall: false,
  noRuleAction: 'keep_existing',
  unmatchedRuleAction: 'keep_existing'
})

export function normalizeSourcePlatform(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function getSourcePlatformInstallPolicy(sourcePlatform = '') {
  const source = normalizeSourcePlatform(sourcePlatform)
  const policy = SOURCE_PLATFORM_INSTALL_POLICY_MAP[source]
  if (policy) {
    return policy
  }

  return {
    ...DEFAULT_SOURCE_PLATFORM_INSTALL_POLICY,
    source,
    displayName: source || DEFAULT_SOURCE_PLATFORM_INSTALL_POLICY.displayName
  }
}

export function shouldDownloadOnlyWhenRuleUnmatched(sourcePlatform = '') {
  return getSourcePlatformInstallPolicy(sourcePlatform).unmatchedRuleAction === 'download_only'
}

export function buildSourceDownloadOnlyMessage(sourcePlatform = '', reason = 'no_rule') {
  const policy = getSourcePlatformInstallPolicy(sourcePlatform)
  const displayName = policy.displayName || policy.source || '当前来源'

  if (reason === 'rule_unmatched') {
    return `${displayName} 文件未命中安装规则，已保留为下载记录，不会执行安装。`
  }

  if (reason === 'inspect_failed') {
    return `${displayName} 文件规则分析失败，已保留为下载记录，不会执行安装。`
  }

  return `${displayName} 当前没有可用安装规则，仅加入下载队列。`
}
