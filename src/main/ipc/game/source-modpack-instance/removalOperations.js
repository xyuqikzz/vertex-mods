function toText(value = '') {
  return String(value ?? '').trim()
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function createFailure(operation = {}, detail = {}) {
  return {
    itemKey: toText(operation.itemKey),
    localModId: toNumber(operation.localModId, 0),
    name: toText(detail.name || operation.entry?.name || operation.previous?.name),
    code: toText(detail.code || 'unsafe_uninstall'),
    stage: toText(detail.stage || 'uninstall'),
    message: toText(detail.message || '模组未能安全卸载')
  }
}

export async function applySourceModpackRemovalOperations(plan = {}, dependencies = {}) {
  const failures = []
  const ownership = dependencies.getOwnershipReferences(plan.instanceId) || {}
  const operations = Array.isArray(plan.diff?.operations) ? plan.diff.operations : []

  for (const operation of [...operations].reverse()) {
    if (operation.action !== 'uninstall') continue

    const localModId = toNumber(operation.localModId, 0)
    const refs = ownership[localModId] || {}
    if (!localModId || toNumber(refs.otherInstanceCount, 0) > 0 || refs.userOwned === true) {
      failures.push(
        createFailure(operation, {
          code: 'unsafe_uninstall',
          stage: 'ownership',
          message:
            refs.userOwned === true ? '该模组由用户管理，已保留' : '该模组仍被其他实例引用，已保留'
        })
      )
      continue
    }

    const mod = dependencies.getMod(localModId, operation)
    if (!mod) {
      failures.push(
        createFailure(operation, {
          code: 'mod_not_found',
          stage: 'lookup',
          message: '未找到对应的本地模组记录'
        })
      )
      continue
    }

    const contentState = typeof dependencies.inspectModContent === 'function'
      ? await dependencies.inspectModContent(localModId, operation, mod)
      : null
    if (contentState?.exists === false || contentState?.contentIntact === false) {
      failures.push(
        createFailure(operation, {
          name: mod.name,
          code: 'local_content_changed',
          stage: 'integrity',
          message: contentState?.exists === false
            ? '本地模组记录已变化，已停止卸载'
            : '预检后本地文件发生变化，已停止卸载'
        })
      )
      continue
    }
    if (contentState && toNumber(contentState.manifestCount, 0) === 0) {
      failures.push(
        createFailure(operation, {
          name: mod.name,
          code: 'content_integrity_unavailable',
          stage: 'integrity',
          message: '缺少受管文件清单，无法确认本地内容未被修改'
        })
      )
      continue
    }

    const isActive = mod.isActive === true || toNumber(mod.is_active, 0) === 1
    if (isActive) {
      const disabled = await dependencies.disableMod(localModId, operation, mod)
      if (!disabled?.success) {
        failures.push(
          createFailure(operation, {
            name: mod.name,
            code: disabled?.code || 'disable_before_uninstall_failed',
            stage: 'disable',
            message: disabled?.message || '模组仍处于启用状态，无法继续卸载'
          })
        )
        continue
      }
    }

    const result = await dependencies.uninstallMod(localModId, operation)
    if (!result?.success) {
      failures.push(
        createFailure(operation, {
          name: mod.name,
          code: result?.code || 'unsafe_uninstall',
          stage: 'uninstall',
          message: result?.message
        })
      )
    }
  }

  return failures
}
