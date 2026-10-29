function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function buildManagedAssetDeleteSkipReasons(input = {}) {
  if (input.missing) {
    return []
  }

  const skipReasons = []

  if (input.ignored) skipReasons.push('已标记忽略')
  if (!input.canDeleteByMode) skipReasons.push('外部引用文件默认不删除')
  if (!input.canDeleteByOwner) skipReasons.push('仍被其他 owner 引用')
  if (!input.canDeleteByPolicy) skipReasons.push('当前清理策略不允许删除')
  if (!input.boundaryAllowed && !input.boundaryMissing) {
    skipReasons.push(toSafeText(input.boundaryReason) || '文件不在允许清理范围')
  }
  if (input.hasRegisteredChildren) {
    skipReasons.push('目录下仍有其他登记资产，避免误删父目录')
  }

  return skipReasons
}
