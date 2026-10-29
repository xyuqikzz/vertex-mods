export function resolveAiAgentOutcome(result = {}) {
  if (result.outcome) return result.outcome
  if (result.cancelled || result.error?.kind === 'cancelled') return 'cancelled'
  if (result.success === false) return 'failed'
  if (
    result.stopReason === 'confirmation_required' ||
    result.confirmations?.some((item) => !item.status || item.status === 'pending')
  )
    return 'waiting_confirmation'
  if (['context_budget', 'round_limit', 'no_progress'].includes(result.stopReason)) return 'partial'
  const calls = result.toolCalls || []
  const failed = calls.filter((call) => call.success === false && !call.confirmationRequired)
  if (failed.length) return calls.some((call) => call.success !== false) ? 'partial' : 'failed'
  // A reply is not evidence that a submitted installation has completed.
  if (
    result.installPlan?.submitted ||
    result.toolCalls?.some((call) => call.resultSummary?.accepted)
  )
    return 'submitted'
  return 'answered'
}

export function getAiAgentOutcomeLabel(outcome) {
  return (
    {
      answered: '',
      waiting_confirmation: '等待确认',
      partial: '部分完成',
      failed: '未完成',
      cancelled: '已停止',
      submitted: '已提交任务'
    }[outcome] || ''
  )
}
