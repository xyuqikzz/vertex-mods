// Log timestamps may be rounded to seconds. A current session must start after
// the process (within that rounding tolerance), not merely within ±15 seconds.
// Delayed initialization is valid while the same process remains alive.
export function isCurrentSession(time, startedAt, modifiedAt, now) {
  return (
    Number.isFinite(time) &&
    Number.isFinite(startedAt) &&
    Number.isFinite(modifiedAt) &&
    time >= startedAt - 2000 &&
    time <= now + 2000 &&
    modifiedAt >= startedAt - 2000
  )
}
