export const INSTALL_FAILURE_RECOVERY_INSTRUCTIONS = [
  '安装失败先调用 vertex.install.failure_diagnose，再按 jobId/itemId 读取 vertex.install.archive.inspect；复用任务已下载文件，不让用户重复下载或手抄本地路径。',
  'packageSupport.supported=false 表示有证据确认文件不支持自动安装（例如纯 Cheat Engine 表）。说明文件类型和替代方案，禁止编造复制规则、修改游戏目录或重试相同任务。',
  '规则未命中不等于安装目录缺失：核对包内相对路径、作者说明和当前规则，读取 vertex.install_rule.reference_docs 后仅草拟当前模组需要的修正，并调用 vertex.install.rule.match_preview 验证。',
  '匹配预演通过不等于安装成功。展示修正范围、文件目标、冲突及风险；涉及保存配置、重试或部署时遵守工具确认流程。不要直接覆盖整款游戏的通用规则，也不要在规则未改变时重复重试。',
  '无法确定包用途或安装目标时，说明具体缺失证据；不要把下载完成、入队或生成草案报告成修复成功。'
].join('\n')

export function canDiagnoseSourceInstallTask(task = {}) {
  return (
    task.kind === 'source' && ['failed', 'partial_failed'].includes(task.state) && Boolean(task.id)
  )
}

export function buildInstallFailureRecoveryPrompt(task = {}) {
  return [
    `请诊断安装失败的任务（编号：${JSON.stringify(String(task.id || ''))}），复用已下载的文件检查原因。`,
    '如果是安装规则问题，请提出修正方案并先预演；如果文件不适合自动安装，请说明原因和处理办法。'
  ].join('\n')
}
