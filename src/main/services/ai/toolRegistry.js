import { applyAgentToolConfiguration } from '../../../shared/ai/config/ai-agent-definition.js'

export const DEFAULT_AI_AGENT_TOOLS = Object.freeze([
  Object.freeze({
    name: 'vertex.game.list',
    title: '读取本地游戏列表',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.mod.search',
    title: '搜索模组',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.mod.detail',
    title: '读取模组详情',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.install.tasks',
    title: '读取安装任务',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.install.task_detail',
    title: '读取安装任务详情',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.install_rule.reference_docs',
    title: '读取安装规则参考文档',
    readonly: true,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.install.resolve_dependencies',
    title: '解析安装依赖',
    readonly: false,
    enabled: true
  }),
  Object.freeze({
    name: 'vertex.mod.create_install_plan',
    title: '生成安装计划',
    readonly: false,
    enabled: false
  }),
  Object.freeze({
    name: 'vertex.mod.submit_install',
    title: '提交安装任务',
    readonly: false,
    enabled: false
  })
])

export function listAiAgentTools() {
  return DEFAULT_AI_AGENT_TOOLS.map((item) => applyAgentToolConfiguration(item))
}
