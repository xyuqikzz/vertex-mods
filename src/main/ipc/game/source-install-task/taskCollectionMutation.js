export async function runTaskCollectionMutation(mutation, options = {}) {
  if (typeof mutation !== 'function') {
    throw new TypeError('任务集合变更必须提供执行函数')
  }

  const result = await mutation()
  if (result?.success !== false && typeof options?.onChanged === 'function') {
    await options.onChanged({
      ...(result && typeof result === 'object' ? result : {}),
      changeType: String(options?.changeType || '').trim()
    })
  }
  return result
}
