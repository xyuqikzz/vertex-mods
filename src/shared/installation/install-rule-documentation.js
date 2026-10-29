import {
  INSTALL_RULE_CAPABILITIES,
  INSTALL_RULE_ENGINE_VERSION
} from './install-rule-declarations.js'
import { CURRENT_RULE_SCHEMA_VERSION } from './compiler/schemaMigrator.js'

export const INSTALL_RULE_REFERENCE_FILE = 'install-rule-reference.md'
export const INSTALL_RULE_GUIDE_FILE = 'source-install-rule-user-guide.md'

export function getInstallRuleDocumentationContract() {
  return {
    engineVersion: INSTALL_RULE_ENGINE_VERSION,
    schemaVersion: CURRENT_RULE_SCHEMA_VERSION,
    capabilities: Object.keys(INSTALL_RULE_CAPABILITIES),
    referenceFile: INSTALL_RULE_REFERENCE_FILE,
    guideFile: INSTALL_RULE_GUIDE_FILE
  }
}

// Shared by the built-in agent and the external-AI copy action; versions come from runtime definitions.
export function buildInstallRuleAuthoringSummary({ audience = 'agent' } = {}) {
  const contract = getInstallRuleDocumentationContract()
  return [
    `当前安装引擎 ${contract.engineVersion}；规则使用 schema_version: ${contract.schemaVersion}，两者不是同一个版本号。${audience === 'external' ? '所需字段规范与示例已附在本消息中。' : `技术参考：${contract.referenceFile}。`}`,
    `支持能力：${contract.capabilities.join('、')}。requires.schema 与 requires.capabilities 用于能力门禁；只声明实际使用的能力，不编造新能力。`,
    '可直接写非空 install_rules，也可用固定版本 templates + use_templates，展开后必须有安装规则。普通规则使用有证据的 match/source/target 或 routes；declarative 可由 facts/when、units/selector 或 fomod 描述，不强制外层 match/source/target。',
    'declarative 支持环境及内容 facts、多单元 units、互斥/必选 components、FOMOD XML 5.0、config 字段修改和显式 nested_archives ZIP。遗漏文件须有明确去向或 ignore 理由；未知事实、能力、目标 base、组件歧义均不能猜测通过。',
    '配置仅支持 JSON Pointer、INI 键和指定行；禁用时已还原到原值的字段可幂等释放归属，其他受管理字段改动仍阻断。更新在归属上下文内判断 expected。多单元共用一个包记录并整包启停；普通文件同计划使用一个部署边界。FOMOD 不执行 C#，嵌套展开仅支持受预算限制的 ZIP。FOMOD 配置支持 UTF-8 和带 BOM 的 UTF-16，最大 1 MiB；XML 元素最多 20000 个、深度 32，最多 32 个组件组和 128 个插件。',
    '基础文件先部署，再应用配置字段。常见配置和文本文件独立复制，协调时保留旧配置链接当前内容后拆分；同归属、源路径及计划哈希未变的配置在增量和完整重建时均保留。仍有字段归属或未完成配置事务时，禁止整文件替换和删除。完整重建仍校验资源文件。生命周期授权展示实际执行程序、展开参数及工作目录。',
    'ensure_dir_exists 和 remove_empty_dir 只记录实际目录变更，不备份目录内容；回滚只撤销本次创建且仍为空的目录，保留后来加入的文件。其他文件动作恢复快照仍受 4096 项/128 MiB 预算限制。',
    '依赖按同游戏、端点和配置档案的已启用能力求解，更新排除旧版本能力。GitHub 未指定 tag 或 tag=latest 时选最新正式版；具体 tag 明确固定。asset_name_regex 有独立线程和超时预算。',
    '路径、配套文件、目标、game_detect 和下载身份必须有真实包或作者说明支持。生成 JSON、编译通过、预检通过、实际安装和游戏内加载是不同阶段，不能互相冒充。',
    ...(audience === 'external'
      ? []
      : [
          '来源工具是否可用仍以当前 registry 和实际工具为准。',
          '内置工具 archive.inspect 可按 offset 分页目录、按 entryPath/textOffset 读取 ZIP 内文本，后续使用 archiveRef；nestedPath 显式进入最多三层 ZIP，续读保留该数组；也可按 jobId/itemId 读取已下载包。rule.match_preview 复用统一引擎，返回 mappings、依赖诊断和 selectionRequest。组件偏好一次问清，用原 binding 和 selected 重新预演或 inspect_plan；任务已入队时用 control_task.retry 的 componentSelections 按 itemId 续跑。',
          '预检 agentTaskId 可在同会话续跑；失败预检不能提交。execute_plan 的 accepted 仅代表入队，task_detail 的 verified 和 health 才表示写后核验；用户指定文件/版本时不得退回最新。授权绑定主进程核对的实际目标与操作，full_auto 可自动执行明确目标，范围变化重新裁决。'
        ])
  ].join('\n')
}

// 规则字段仍只有一份正文；复制给通用 AI 时只去除明确标记的内部操作说明。
export function getExternalInstallRuleReference(reference = '') {
  let internal = false
  const lines = []
  for (const line of String(reference).replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '<!-- vertex-agent-only:start -->') {
      if (internal) throw new Error('安装规则参考的内部章节标记重复')
      internal = true
    } else if (line.trim() === '<!-- vertex-agent-only:end -->') {
      if (!internal) throw new Error('安装规则参考的内部章节标记不匹配')
      internal = false
    } else if (!internal) {
      lines.push(line)
    }
  }
  if (internal) throw new Error('安装规则参考的内部章节标记未闭合')
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
