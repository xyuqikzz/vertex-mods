export const AGENT_SCRIPT_MAX_LENGTH = 20000
export const AGENT_SCRIPT_DEFAULT_TIMEOUT_MS = 60000
export const AGENT_SCRIPT_MAX_TIMEOUT_MS = 300000
export const AGENT_SCRIPT_OUTPUT_LIMIT = 32000

export function formatAgentScriptResult(result = {}) {
  const lines = [result.message || '脚本执行结束。']
  if (Number.isInteger(result.exitCode)) lines.push(`退出码：${result.exitCode}`)
  if (Number.isFinite(result.durationMs)) lines.push(`耗时：${(result.durationMs / 1000).toFixed(2)} 秒`)
  for (const [label, text] of [['输出', result.stdout], ['错误输出', result.stderr]]) {
    if (!text) continue
    // 使用比输出中最长反引号序列更长的围栏，避免日志被解释成 Markdown。
    const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    lines.push(`${label}：\n${fence}text\n${text}\n${fence}`)
  }
  if (result.outputTruncated) lines.push('输出过长，已截断显示。')
  return lines.join('\n\n')
}
