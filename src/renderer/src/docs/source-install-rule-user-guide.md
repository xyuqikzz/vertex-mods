# 安装规则编写指南

<!-- install-engine:3.1.0 schema:5 -->

本文是当前安装引擎的入门指南。完整字段、兼容别名和预算以“一键复制 AI 提示词”附带的安装规则参考为准。智能体读取同一份技术参考；旧 nexus-rule-reference 仅为兼容名称。

## 1. 当前版本与能力

当前安装引擎 3.1.0；规则使用 schema_version: 5，两者不是同一个版本号。技术参考：install-rule-reference.md。
支持能力：templates.v1、facts.v1、units.v1、components.v1、fomod.xml5.v1、nested.zip.v1、config.fields.v1、mapping.exact.v1。requires.schema 与 requires.capabilities 用于能力门禁；只声明实际使用的能力，不编造新能力。
可直接写非空 install_rules，也可用固定版本 templates + use_templates，展开后必须有安装规则。普通规则使用有证据的 match/source/target 或 routes；declarative 可由 facts/when、units/selector 或 fomod 描述，不强制外层 match/source/target。
declarative 支持环境及内容 facts、多单元 units、互斥/必选 components、FOMOD XML 5.0、config 字段修改和显式 nested_archives ZIP。遗漏文件须有明确去向或 ignore 理由；未知事实、能力、目标 base、组件歧义均不能猜测通过。
配置仅支持 JSON Pointer、INI 键和指定行；禁用时已还原到原值的字段可幂等释放归属，其他受管理字段改动仍阻断。更新在归属上下文内判断 expected。多单元共用一个包记录并整包启停；普通文件同计划使用一个部署边界。FOMOD 不执行 C#，嵌套展开仅支持受预算限制的 ZIP。FOMOD 配置支持 UTF-8 和带 BOM 的 UTF-16，最大 1 MiB；XML 元素最多 20000 个、深度 32，最多 32 个组件组和 128 个插件。
依赖按同游戏、端点和配置档案的已启用能力求解，更新排除旧版本能力。GitHub 未指定 tag 或 tag=latest 时选最新正式版；具体 tag 明确固定。asset_name_regex 有独立线程和超时预算。
路径、配套文件、目标、game_detect 和下载身份必须有真实包或作者说明支持。生成 JSON、编译通过、预检通过、实际安装和游戏内加载是不同阶段，不能互相冒充。

编写前先提供真实包的目录树、作者安装说明、游戏目录特征及已有加载器信息。不能把示例中的文件名、目标目录、清单字段、Steam ID 或依赖版本当成当前游戏事实。

## 2. AI 辅助编写与保存

通过游戏页“更多设置 → AI 生成安装规则”打开弹窗。复制内容面向 ChatGPT、DeepSeek、Claude 等通用 AI：包含公开游戏标识、用户补充信息、当前引擎能力及来自同一技术参考的完整规则字段和示例，排除 Vertex 内部工具、会话续跑与执行计划说明，不自动带出凭据或本机游戏路径。

将整段提示词发送给你使用的 AI。提示词要求 AI 不反问、直接编写游戏级通用规则：依据公开安装说明、社区 wiki 和通行打包结构覆盖该游戏的主流模组类型，并提供 game_detect；拿不准的模组类型和依赖下载直接省略（未命中的包不会被安装），依据与前置要求写在各规则的 description 中。AI 应只返回一个完整的 json 代码块；它不负责调用 Vertex 工具或执行安装。“补充安装说明”为可选项：填入 README、压缩包目录树或加载器信息可提高准确度；预检发现某类包未命中时，把该包目录树补充进去重新生成即可。

“粘贴规则 JSON”支持纯 JSON 和完整 json 代码块。先进行语法、共享编译、能力和路径校验，再保存本地规则。Nexus、Mod.io、Ficsit、VAM-Hub 支持该弹窗的本地保存；其他来源按页面和 registry 的实际能力提供操作，不因生成了 JSON 就自动具备安装权限或流程。Thunderstore 的通用 JSON 草稿不能替代其内置安装器。

模板文档先展开为可执行 install_rules 再校验。无效模板、未来 schema 或未知能力会阻断；保存成功不代表已发布云端、已安装或游戏内生效。

## 3. 选择适合包结构的写法

- 普通单目标：install_rules 中使用有证据的 match、source、target。
- 多目录映射：使用 routes；同一计划的普通文件仍须处在一个部署边界内。
- 清单或标记型包：使用 declarative.units，让 selector 绑定每个独立目录；配套文件必须属于同一单元。
- 多架构、语言或可选资源：使用 declarative.facts/when 与 components，不把多个候选任意取第一个。
- 复用公共加载器约定：使用固定版本 templates/use_templates，展开后必须至少有一条安装规则。
- 包已有 FOMOD：仅在确认其为支持的声明式 XML 5.0 时使用 declarative.fomod。

普通规则与声明式规则不能互相套用必填条件：declarative 可省略外层 match/source/target，但必须通过单元、FOMOD 或明确 routes 产生安装路由。仅写 config 或游戏目录检测不能形成文件安装计划。

## 4. 声明式清单包示例

以下仅假定每个模组目录实际包含 manifest.json 与 main.dll，manifest 中有非空 UniqueID；Mods 只是示例目标。请先核实当前游戏确有此约定。

```json
{
  "schema_version": 5,
  "requires": {
    "schema": 5,
    "capabilities": [
      "units.v1",
      "facts.v1"
    ]
  },
  "install_rules": [
    {
      "id": "manifest-mods",
      "declarative": {
        "units": [
          {
            "id": "plugin",
            "selector": {
              "anchor": "**/manifest.json",
              "companions": [
                "main.dll"
              ]
            },
            "facts": {
              "identity": {
                "base": "package",
                "path": "manifest.json",
                "read": "json",
                "pointer": "/UniqueID"
              }
            },
            "identity_fact": "identity",
            "target": {
              "base": "game",
              "path": "Mods/{{unit.identity}}"
            }
          }
        ]
      }
    }
  ]
}
```

selector.anchor 支持 glob、parent、common_ancestor、max_depth、include/exclude、companions 和 min/max 数量约束。identity_fact 使身份不依赖外层包装目录名。每个包内单元分别保存身份和映射，但仍作为一个用户可见包整体启用、禁用与卸载。

ensure_files 只在私有暂存树补充缺失标记，已有作者文件保留；生成内容纳入归属和卸载。无法安装的文件必须通过 ignore 给出理由，不能用“匹配成功”掩盖漏装。

## 5. 固定版本模板示例

```json
{
  "schema_version": 5,
  "requires": {
    "schema": 5,
    "capabilities": [
      "templates.v1",
      "units.v1",
      "facts.v1"
    ]
  },
  "templates": {
    "manifest-mods": {
      "version": 1,
      "parameters": {
        "target": "Mods"
      },
      "rules": [
        {
          "id": "manifest-mods",
          "declarative": {
            "units": [
              {
                "id": "plugin",
                "selector": {
                  "anchor": "**/manifest.json",
                  "companions": [
                    "main.dll"
                  ]
                },
                "facts": {
                  "identity": {
                    "base": "package",
                    "path": "manifest.json",
                    "read": "json",
                    "pointer": "/UniqueID"
                  }
                },
                "identity_fact": "identity",
                "target": {
                  "base": "game",
                  "path": "{{param:target}}/{{unit.identity}}"
                }
              }
            ]
          }
        }
      ]
    }
  },
  "use_templates": [
    {
      "id": "manifest-mods",
      "version": 1,
      "parameters": {
        "target": "Mods"
      }
    }
  ]
}
```

模板参数用 {{param:name}}；单元绑定用 {{unit.name}}、{{unit.root}}、{{unit.anchor}}、{{unit.identity}}；普通变量仍按技术参考的 variables 规则使用。模板 version 必须是明确整数并精确匹配，不能由隐藏的模板升级改变旧安装意图。

## 6. 游戏目录识别与内容事实

game_detect.candidates 负责识别游戏根目录，declarative.facts 负责当前安装所需的内容事实，不能混为文件部署动作。

游戏目录识别支持 root_hint：通过 root_hints（兼容 search_roots）提供明确的绝对目录，再用 markers 确认。markers.none_paths 可排除卸载目录等错误候选。root_hint 不会触发额外全盘扫描；路径只应来自用户明确提供或可靠检测，不把开发者机器路径复制进公共规则。exe_search、path_marker 以及其字段详见技术参考。

facts 的基准可为 game/package/context/local_appdata/roaming_appdata；支持存在性、JSON Pointer、INI、文本及 PE 架构。单元事实以各单元根目录为基准。条件可组合 all/any/not、相等、集合、包含、数值与版本比较；未知事实不能被取反为成功。必要事实缺失时停止，不能猜版本或架构。

## 7. 源选择、目标与组件

基础 source 支持 package_root、fixed_subdir、folder_containing、文件模式/扩展名以及 archive_file 原包部署。folder_containing 可用 marker_pattern 绑定证据，selection 默认 unique；多个明确独立单元须显式 all。不要靠通用 Docs/Scripts/Mods 名字猜加载器。

安装目标和包内路径采用相对路径和 /，禁止盘符路径或 ..。目标 base 可使用 game、download、local_appdata、roaming_appdata 及已登记别名；未知拼写会阻断。游戏检测 root_hints 是明确约束的绝对目录提示，不能用它绕过部署边界。

components 用组选项、min/max、required/default 和 when 描述选择。任务中心在安装前等待用户选择；包、规则或环境变化时重新核验，失效选择不能直接执行。不能宣称包内单元有独立启停开关。

## 8. 配置、FOMOD 与嵌套包

config 支持 JSON Pointer、INI section/key 和指定行存在性；对象/数组作为字段整体处理，不支持任意 JSONPath。expected 是前置值，更新会在归属上下文中先模拟撤销旧修改再判断。基础文件先部署，再应用字段。仅撤销自己管理的字段；禁用时字段已还原到原值可直接释放归属，缺失文件在无需恢复任何原值时不会被重建为空文件；其他受管理字段改动仍报告冲突，无关字段的修改保留。

配置文件写入前保存事务日志，数据库提交后再清理；禁用中断即使已清空所有字段仍可核对数据库恢复。缺少证据时停止，不能假装恢复成功。配置目标不得同时由本计划的普通文件覆盖。

FOMOD 只解释有界 XML 5.0，转成相同的组件和统一计划，不执行 C#。file_state 与版本事实必须显式声明，不能把文件存在当成插件一定启用。

nested_archives 只展开明确 include 命中的 ZIP，保留父子来源和摘要，受深度、条目、体积、压缩比及时间预算限制；不自动解开所有内层包。预算数值与字段以技术参考为准。

## 9. 依赖、生命周期与验收

依赖需要带命名空间的稳定 ID，可表达 required/optional/conflict、版本范围与 alternatives。只使用同游戏、端点、配置档案的已启用能力；更新排除将被移除的旧版本能力。

GitHub 未指定 tag 或写 latest 时解析最新正式版本；明确 tag 才固定版本。资产可按精确名称、asset_name_regex 或包含词筛选，多结果拒绝。正则在可终止线程运行，超限不能卡住界面。不要写短效下载链接或猜测资产身份。

生命周期文件动作、命令白名单与授权规则沿用技术参考；配置字段修改优先用 config。不能借 JSON 获得任意脚本执行能力，也不能承诺外部命令的副作用全部自动回滚。

`ensure_dir_exists` 只确保目录存在，不备份已有目录内的游戏资源；回滚只删除本次创建且仍为空的目录。`remove_empty_dir` 只删除空目录，非空时跳过。目录被替换或后来加入文件时保留内容，无法安全撤销会报告恢复未完成；其他需要文件恢复快照的动作仍受 4096 项/128 MiB 限制。

批处理 `.bat/.cmd` 仅接受字面路径和参数，不能使用 cmd 命令连接符、重定向或环境变量展开字符。授权窗口展示实际执行程序、展开后的参数和工作目录。常见配置及文本文件采用独立复制，旧配置链接会保留现有内容后拆分；增量和完整重建均保留归属、源路径及计划哈希未变的配置，完整重建仍核验资源文件。仍有字段归属或未完成配置事务的文件不能被整文件替换或删除，须先禁用相关模组。同一部署域的安装、启停、排序和卸载会排队，中断后先恢复；遇到用户后改的文件会保留并提示需要修复。大体积离线包采用流式处理，失败时保留原导出文件。

规则交付前至少核对真实文件全集、目标映射、未处理文件、组件和依赖，并测试包装变体、更新移除单元、禁用更新和失败恢复。手动映射也须生成统一计划再预检。区分作者原包、衍生包和合成样本，不能把模拟数据或文件安装成功写成游戏内兼容性证明。

## 10. 让智能体继续完成任务

安装失败时，可在任务详情点击“让 AI 诊断”。助手会复用任务已经下载的包，先区分文件用途与规则缺口。纯 Cheat Engine 表（`.CT`）需要按作者说明由外部工具使用，不能靠新增复制规则变成可部署模组；下载文件会保留，确认此类型后不再提供直接重试。

普通模组规则未命中时，助手先核对包结构、作者说明和规则差异，为当前模组提出修正并执行匹配预演。保存配置、重新部署仍遵循确认流程；预演通过不能当作安装成功，不能无依据覆盖整款游戏的通用规则。

若模组藏在内层 ZIP，智能体可显式指定 `nestedPath` 逐层检查目录和清单，确认真实内容后再生成嵌套规则；不会默认解开所有内层包。

包目录或作者说明未显示完整时，智能体可分页读取，并用包引用继续查 README、清单与配置片段。已下载的安装任务可直接提供包证据，无需手动抄路径。ZIP 文本读取有体积预算，超出时会明确说明，不能把未读取部分当成不存在。

新规则预演直接使用统一引擎。需要选择组件时，一次说明全部组件组的偏好；智能体携带原计划与选择绑定重新预检，或在已有任务中继续安装。规则、包或环境变化导致旧选择失效时，按最新选项重新确认。

指定文件与版本不会因刷新详情而自动换成新版。同一会话、同目标的操作可复用已确认授权；全自动模式可以直接执行主进程核对过的明确目标。任务入队、安装完成、写后核验通过、游戏内验证仍是不同阶段；失败时先读取结构化诊断，再修正规则或按任务中心的重试与恢复流程处理。
