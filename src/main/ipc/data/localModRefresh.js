import { AsyncLocalStorage } from 'node:async_hooks'

const localModRefreshContext = new AsyncLocalStorage()

export function shouldDeferLocalModRefresh() {
  const context = localModRefreshContext.getStore()
  if (!context?.deferred) return false
  context.requested = true
  return true
}

// 一次安装可能写入多个模组。统一在任务退出时读取一次最终快照，部分成功后失败也要刷新。
export async function withDeferredLocalModRefresh(event, operation, refresh) {
  const context = { deferred: true, requested: false }
  // 旧安装适配层会将 event 转成通知端口；通过异步上下文传递，避免封装事件时丢失合并状态。
  return localModRefreshContext.run(context, async () => {
    try {
      const result = await operation(event)
      context.requested = true
      return result
    } finally {
      context.deferred = false
      if (context.requested) await refresh(event)
    }
  })
}
