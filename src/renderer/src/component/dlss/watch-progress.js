// Never overlap polls or apply a response after the operation/page has changed.
export function watchProgress(read, apply, isCurrent, intervalMs = 400) {
  let stopped = false,
    timer
  const active = () => !stopped && isCurrent()
  const refresh = async () => {
    try {
      const value = await read()
      if (active() && value) apply(value)
    } catch {
      // Status transport failure does not cancel the operation being observed.
    }
  }
  const poll = async () => {
    await refresh()
    if (active()) timer = setTimeout(poll, intervalMs)
  }
  poll()
  return {
    refresh,
    stop() {
      stopped = true
      clearTimeout(timer)
    }
  }
}
