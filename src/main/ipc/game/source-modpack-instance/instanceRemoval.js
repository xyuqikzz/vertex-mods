function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function createFailure(item = {}, localModId = 0, message = '', code = 'unsafe_uninstall') {
  return {
    itemKey: toText(item.itemKey || item.item_key),
    localModId,
    code,
    message: toText(message || '模组未能安全卸载')
  }
}

export async function removeManagedSourceModpackItems(context = {}, dependencies = {}) {
  const instance = context.instance || {}
  const ownership = context.ownership || {}
  const failures = []
  const processedModIds = new Set()
  let removedCount = 0

  // 安装清单按依赖优先排列，卸载时反向处理，避免先删仍被依赖的前置。
  for (const item of [...(Array.isArray(instance.items) ? instance.items : [])].reverse()) {
    if (['detached', 'removed'].includes(toText(item.state).toLowerCase())) continue

    const localModId = toNumber(item.localModId ?? item.local_mod_id, 0)
    const ownershipMode = toText(item.ownershipMode || item.ownership_mode).toLowerCase()
    const refs = ownership[localModId] || ownership[String(localModId)] || {}
    if (
      ownershipMode !== 'managed' ||
      !localModId ||
      refs.userOwned === true ||
      toNumber(refs.otherInstanceCount, 0) > 0 ||
      processedModIds.has(localModId)
    ) {
      continue
    }
    processedModIds.add(localModId)

    const actual = dependencies.inspectActualItem(localModId, item) || {}
    if (actual.contentIntact === false) {
      failures.push(
        createFailure(item, localModId, '检测到用户修改的本地文件，已保留该模组', 'local_content_changed')
      )
      continue
    }
    if (actual.exists === false) {
      if (toNumber(actual.manifestCount, 0) > 0) {
        failures.push(
          createFailure(item, localModId, '本地模组记录缺失，但仍存在受管文件清单，无法确认已安全卸载', 'mod_record_missing')
        )
        continue
      }
      dependencies.markItemsRemoved(instance.instanceId, localModId)
      removedCount += 1
      continue
    }
    if (toNumber(actual.manifestCount, 0) === 0) {
      failures.push(
        createFailure(item, localModId, '缺少受管文件清单，无法确认本地内容未被修改', 'content_integrity_unavailable')
      )
      continue
    }

    if (actual.active === true) {
      const disabled = typeof dependencies.disableMod === 'function'
        ? await dependencies.disableMod(localModId, item)
        : { success: false, message: '该模组仍在启用，无法卸载' }
      if (!disabled?.success) {
        failures.push(createFailure(item, localModId, disabled?.message || '禁用模组失败', 'disable_before_uninstall_failed'))
        continue
      }
    }
    const result = await dependencies.uninstallMod(localModId, item)
    if (!result?.success) {
      failures.push(createFailure(item, localModId, result?.message, result?.code))
      continue
    }
    dependencies.markItemsRemoved(instance.instanceId, localModId)
    removedCount += 1
  }

  return { removedCount, failures }
}
