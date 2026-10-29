/**
 * 并发度自适应：依据待处理条目数在 [min, max] 内推导并发度。
 * 小批量收敛到条目数本身，大批量随规模线性升至 max（每约 64 项 +1）。
 * 纯函数、确定性，便于单测与基准对比。
 *
 * @param {number} itemCount 待处理条目数
 * @param {{ min?: number, max?: number, base?: number }} options
 * @returns {number} 建议并发度
 */
export function resolveAdaptiveConcurrency(itemCount = 0, options = {}) {
  const min = Math.max(1, Math.floor(Number(options.min ?? 1) || 1))
  const max = Math.max(min, Math.floor(Number(options.max ?? 16) || 16))
  const base = Math.min(max, Math.max(min, Math.floor(Number(options.base ?? 4) || 4)))
  const count = Math.max(0, Math.floor(Number(itemCount) || 0))
  if (count <= 1) return min
  if (count <= base) return Math.max(min, count)
  const scaled = base + Math.floor(count / 64)
  return Math.min(max, Math.max(base, scaled))
}

export async function runWithConcurrencyLimit(items = [], limit = 1, worker = async (item) => item) {
  const sourceItems = Array.isArray(items) ? items : []
  const maxConcurrency = Math.max(1, Math.floor(Number(limit) || 1))
  const workerCount = Math.min(maxConcurrency, sourceItems.length)
  if (!workerCount) return []

  const results = new Array(sourceItems.length)
  let nextIndex = 0
  let failed = false
  let failure

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failed && nextIndex < sourceItems.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        try {
          results[currentIndex] = await worker(sourceItems[currentIndex], currentIndex)
        } catch (error) {
          if (!failed) failure = error
          failed = true
        }
      }
    })
  )

  // 物化包含真实文件写入，所有在途工作结束后才能交给上层回退或清理。
  if (failed) throw failure
  return results
}
