# 安装规则参考

<!-- install-engine:3.1.0 schema:5 -->

当前实现为安装引擎 **3.1.0**，规则格式为 **schema_version: 5**。以下说明面向当前代码能力，不能将文档或结构校验通过当成真实安装、游戏内加载或生产发布完成。

通过“一键复制 AI 提示词”发给通用 AI 时，客户端附带本文的规则规范与示例，并排除标记为内部用途的工具操作、会话续跑及执行计划章节。通用 AI 只生成 JSON；本机校验、保存、安装预检与实际部署由用户在客户端完成。

## 当前能力速查

当前安装引擎 3.1.0；规则使用 schema_version: 5，两者不是同一个版本号。技术参考：install-rule-reference.md。
支持能力：templates.v1、facts.v1、units.v1、components.v1、fomod.xml5.v1、nested.zip.v1、config.fields.v1、mapping.exact.v1。requires.schema 与 requires.capabilities 用于能力门禁；只声明实际使用的能力，不编造新能力。
可直接写非空 install_rules，也可用固定版本 templates + use_templates，展开后必须有安装规则。普通规则使用有证据的 match/source/target 或 routes；declarative 可由 facts/when、units/selector 或 fomod 描述，不强制外层 match/source/target。
declarative 支持环境及内容 facts、多单元 units、互斥/必选 components、FOMOD XML 5.0、config 字段修改和显式 nested_archives ZIP。遗漏文件须有明确去向或 ignore 理由；未知事实、能力、目标 base、组件歧义均不能猜测通过。
配置仅支持 JSON Pointer、INI 键和指定行；禁用时已还原到原值的字段可幂等释放归属，其他受管理字段改动仍阻断。更新在归属上下文内判断 expected。多单元共用一个包记录并整包启停；普通文件同计划使用一个部署边界。FOMOD 不执行 C#，嵌套展开仅支持受预算限制的 ZIP。FOMOD 配置支持 UTF-8 和带 BOM 的 UTF-16，最大 1 MiB；XML 元素最多 20000 个、深度 32，最多 32 个组件组和 128 个插件。
依赖按同游戏、端点和配置档案的已启用能力求解，更新排除旧版本能力。GitHub 未指定 tag 或 tag=latest 时选最新正式版；具体 tag 明确固定。asset_name_regex 有独立线程和超时预算。
路径、配套文件、目标、game_detect 和下载身份必须有真实包或作者说明支持。生成 JSON、编译通过、预检通过、实际安装和游戏内加载是不同阶段，不能互相冒充。

本文件是智能体与“一键复制 AI 提示词”共用的技术参考；旧文档 ID nexus-rule-reference 指向本文件。下方 3.1 能力在先，基础字段与兼容写法随后。

## 引擎 3.1.0 声明式能力（schema_version 仍为 5）

本节适用于所有接入统一安装任务的来源。常规游戏适配优先使用规则 JSON、版本化模板和样本；旧安装记录继续使用安装时保存的计划。新规则不会重新解释旧记录的卸载路径。

### 能力门禁与模板

```json
{
  "schema_version": 5,
  "requires": { "schema": 5, "capabilities": ["templates.v1", "facts.v1", "units.v1"] },
  "templates": {
    "plugin-directory": {
      "version": 1,
      "parameters": { "target": "Mods" },
      "rules": [{
        "id": "plugins",
        "declarative": {
          "units": [{
            "id": "plugin",
            "selector": { "anchor": "**/manifest.json" },
            "preserve_container": true,
            "target": { "base": "game", "path": "{{param:target}}" }
          }]
        }
      }]
    }
  },
  "use_templates": [{ "id": "plugin-directory", "version": 1, "parameters": { "target": "Mods" } }]
}
```

支持能力：`templates.v1`、`facts.v1`、`units.v1`、`components.v1`、`fomod.xml5.v1`、`nested.zip.v1`、`config.fields.v1`、`mapping.exact.v1`。未知必要能力及未来 schema 直接拒绝。模板随 JSON 携带，`version` 必须精确匹配；参数只能是标量，用 `{{param:名字}}` 引用。展开后规则 ID 不得重复，未声明参数会报错。模板不下载远程代码、不执行脚本。展开后的 `template_versions` 及参数进入计划快照，便于追溯；普通 `${变量}` 仍沿用已有编译语义。

### 声明式规则与环境事实

单条 `install_rules[*].declarative` 可包含 `facts`、`when`、`units`、`components`、`ignore`、`fomod`、`nested_archives`、`config`。可以与现有 `routes` 配合；没有外层 `match` 时，由声明式条件和选择器决定适用性。声明式字段严格校验，未知字段不忽略；没有明确去向的文件或空目录会阻止安装。

事实定义：`{ "base": "game", "path": "runtime.json", "read": "json", "pointer": "/runtime" }`。

| 字段 | 语义 |
| --- | --- |
| `base` | `game`、`package`、`local_appdata`、`roaming_appdata`，或 `context` |
| `path` | 文件的安全相对路径；内容读取不展开 glob |
| `read` | `exists`、`file_exists`、`dir_exists`、`json`、`ini`、`text`、`pe_arch`、`value` |
| `pointer` | JSON Pointer，例如 `/ContentPackFor/UniqueID`；空字符串读取整个 JSON |
| `section` / `key` | INI 段与键，重复同名键报错；context 使用 `key` |
| `optional` | 缺失文件/字段可成为未知事实，默认缺失即阻断；权限错误、坏 JSON 和越界始终报错 |

`pe_arch` 读取 PE 头，返回 `x86`、`x64` 或 `arm64`，不执行二进制。`context` 仅支持 `read: "value"`，键为 `platform`、`arch`、`source`、`game_id`、`domain`、`endpoint`、`profile`、`store`、`game_version`、`runtime`、`installed_capabilities`。商店、版本、运行时等值需要安装上下文明确提供，缺失时不会猜测；需要发现真实游戏变化时应使用文件事实。

条件示例：

```json
{
  "facts": {
    "architecture": { "base": "game", "path": "Game.exe", "read": "pe_arch" },
    "version": { "base": "game", "path": "version.json", "read": "json", "pointer": "/version" }
  },
  "when": { "all": [
    { "fact": "architecture", "one_of": ["x64", "arm64"] },
    { "fact": "version", "version": { "min": "1.2.0", "max": "2.0.0", "include_max": false } }
  ] }
}
```

支持 `all`、`any`、`not`，以及 `equals`、`one_of`、`contains`、数字 `min/max`、点分版本 `version.min/max/include_min/include_max`。版本允许预发布标识，默认包含边界。`contains` 用于字符串子串或数组成员。每个事实条件只使用一种比较（数字 min/max 可组合）。逻辑树全部分支均核验未知状态，`not` 不能把读取失败转成匹配。可用 `{ "fact": "名称", "exists": false }` 明确判断 optional 事实是否未知；它与文件存在事实的布尔值不是同一概念。

限制：每组最多 64 个事实、条件深度 16；单个文本/JSON/INI 文件 256 KiB；一次规划最多 1024 次事实读取、32 MiB 内容、30 秒。预览记录内容摘要，执行前重新读取关键事实和受管理配置；变化后必须重新预览。

### 安装单元、配套文件与稳定身份

```json
{
  "units": [{
    "id": "smapi",
    "role": "plugin",
    "selector": { "anchor": "**/manifest.json", "parent": 0, "min": 1, "max": 128 },
    "facts": { "identity": { "base": "package", "path": "manifest.json", "read": "json", "pointer": "/UniqueID" } },
    "identity_fact": "identity",
    "target": { "base": "game", "path": "Mods/{{unit.identity}}" }
  }],
  "ignore": [{ "pattern": "docs/**", "reason": "作者说明，不属于可部署内容" }]
}
```

选择器以 `anchor` glob 找文件，`kind: "directory"` 则找目录。文件锚点默认取父目录；目录锚点默认取目录本身。`parent` 再向上取指定层级，`common_ancestor: true` 明确合并候选共同祖先；`max_depth` 限制锚点深度。`include/exclude` 相对于各单元根目录，`companions` 必须在同一个单元内找到文件，不能跨目录拼凑标记。默认 `min: 1/max: 128`；目录候选最多 128，展开后普通单元路由最多 256。

`facts` 放在单元内时，只允许 `base: "package"`，路径相对于该单元根目录。`when` 可同时使用全局和本单元事实。`identity_fact` 提供稳定字符串/数字身份，未设置时使用目录名；重复身份和重复认领文件均阻断。目标支持 `{{unit.name}}`、`{{unit.root}}`、`{{unit.anchor}}`、`{{unit.identity}}`，现有 target/mapping 路径边界继续生效。`preserve_container: true` 在目标后追加原目录名，内部相对目录和空目录保留。

`ensure_files: [{ "path": "enabled.txt", "text": "" }]` 可放在单元内，在私有暂存树补齐缺失文本文件，已有内容保持不变。生成文件参与部署、更新、启停和卸载归属，不修改原始包。每单元最多 32 项，每项 64 KiB。

单元可带 `dependencies: [{ "id": "framework:ue4ss", "kind": "required", "version_range": ">=3.0.0", "alternatives": ["framework:compatible-loader"] }]`。kind 支持 required/optional/conflict，ID 必须带命名空间，避免按显示名称混淆来源。`provides: [{ "id": "smapi:{{unit.identity}}", "version_fact": "version" }]` 将本单元能力写入安装快照；`version_fact` 必须是本单元事实。只对选中的单元收集依赖和能力，并衔接同一游戏、端点和配置档案的已启用记录；更新时排除旧版本能力，使用新计划实际提供的能力求解。缺少必需依赖或命中冲突会阻断；复用预览及实际写入前重新核验，状态改变须重新预检。

每个包目前仍是一个事务和一条用户可见安装记录，单元分别保存在决策与文件映射中，共同启停；选择变化通过重新规划/更新处理。单个计划的普通文件部署要求同一目标边界，可包含多个目标子目录；用户配置文件可另用下述受管理配置能力跨到受支持的用户目录。

### 组件选择

```json
{
  "components": [{
    "id": "texture", "label": "纹理质量", "min": 1, "max": 1,
    "options": [
      { "id": "2k", "label": "2K", "default": true },
      { "id": "4k", "label": "4K", "when": { "fact": "architecture", "equals": "x64" } }
    ]
  }]
}
```

单元通过 `component: "2k"` 绑定选项。`required` 表示可用时必选，`default` 只提供建议。min/max 表达可选、互斥、至少/最多/必须选一；每包最多 32 组、每组 64 项，组件 ID 全局唯一。任务中心显示选择表单并校验约束；首次选择和环境变化后的重新选择都不能绕过主进程核验。选择绑定规则、包结构、游戏目录和事实摘要，随计划持久化。更新保留仍有效的选择并要求重新确认已变化的绑定。未选择的单元在覆盖账本中明确标记为忽略。

### FOMOD XML 5.0

```json
{
  "fomod": {
    "config": "**/fomod/ModuleConfig.xml",
    "target": { "base": "game", "path": "Data" },
    "file_state": "deployed"
  },
  "ignore": [{ "pattern": "README*", "reason": "包内说明" }]
}
```

配置文件必须唯一。支持必装 file/folder、安装步骤、SelectAny/SelectAll/SelectExactlyOne/SelectAtMostOne/SelectAtLeastOne、插件类型和条件类型、标记、可见条件、条件文件、alwaysInstall/installIfUsable、优先级和目标重命名。不同源文件映射到同目标且优先级相同时拒绝歧义。描述文件与展示资源不部署。FOMOD 自带组件和单元，不能同时手写 units/components 或隐式展开嵌套包。

存在文件依赖时，规则必须明确 `file_state`：`deployed` 将目标中已有普通文件视为 Active、缺失视为 Missing；`plugin_list` 使用 `active_plugins_fact` 指定的文本事实区分 Active/Inactive/Missing。不能仅凭存在把未启用插件猜成 Active。版本依赖使用 `version_facts` 将 gameDependency/fommDependency/foseDependency/skseDependency/nvseDependency/f4seDependency 映射到事实 ID，未知版本直接阻断。条件组件按已确认选择重新计算，必要时再次展示后续选项。

只处理声明式 XML，不执行 C#；拒绝 DTD、外部实体、未知节点/属性、损坏 XML 和重复单例结构。配置支持 UTF-8 和带 BOM 的 UTF-16LE/UTF-16BE，最多 1 MiB；XML 深度 32、元素 20000（空白不计入），最多 32 个组件组、128 个插件。格式语义参考 [FOMOD 文档](https://fomod-docs.readthedocs.io/en/latest/tutorial.html) 与 [Nexus XML 5.0 Schema](https://github.com/Nexus-Mods/fomod-installer/blob/master/src/InstallScripting/XmlScript/Schemas/XmlScript5.0.xsd)。

### 有归属的配置修改

```json
{
  "config": [
    { "base": "game", "path": "settings.json", "format": "json", "changes": [{ "pointer": "/loader/enabled", "value": true, "expected": false }] },
    { "base": "local_appdata", "path": "ExampleGame/settings.ini", "format": "ini", "changes": [{ "section": "Mods", "key": "Enabled", "value": "1" }] },
    { "path": "plugins.txt", "format": "lines", "changes": [{ "line": "*Example.esp", "present": true }] }
  ]
}
```

配置 base 支持 game/local_appdata/roaming_appdata，默认 game；可带 component 绑定选项。JSON 使用字段 Pointer，可创建缺失对象父路径，`remove: true` 删除字段；对象/数组作为字段整体替换，逐字段合并请列出多个 Pointer，不支持隐式数组下标或任意 JSONPath。INI 使用 section/key，value 为标量，重复键阻断；lines 管理指定行的存在性，不承担通用游戏加载顺序排序。`expected` 是显式前置值。配置最多 32 个文件，每文件 128 项修改、1 MiB 内容。

更新预览会核对当前模组的配置归属，在内存中撤销其旧修改后判断 `expected`，与执行阶段一致；不能借此覆盖用户后来改动的受管理字段。配置值中的 `schema_version`、`requires` 等普通数据不会被服务端当成安装引擎能力声明。安装目标的未知 base/scope 为错误，不能拼错后自动退回游戏目录；已明确支持的兼容别名继续有效。

预览只读；同一路径不得同时作为本计划的普通部署文件与受管理配置目标。基础文件先部署，再应用配置字段。执行时保存原值、应用值和模组归属，原子写入，并先写事务日志。禁用、卸载或更新移除配置项时，只撤销自己拥有的字段；无关字段的用户修改保留。禁用时字段已等于记录的原值，可直接释放归属；缺失文件只有无需恢复任何原值时才可释放，不创建空配置文件。其他受管理字段改动、或另一模组占有重叠字段时，明确冲突并保留现场。更新沿用原归属 ID；禁用更新保持禁用。

配置归属变更会先写入持久事务记录，再修改文件；数据库提交后才清理事务记录。即使禁用已清空所有字段，启动恢复仍能找到原归属并按数据库状态处理；恢复期间保留无关字段的人工修改，受管理字段后来变化则报告冲突。缺少可信归属证据时不能伪报恢复成功。修改文件内容的旧安全生命周期动作会建立受限恢复快照，步骤失败或外层部署失败时撤销；快照上限为 4096 项/128 MiB。`ensure_dir_exists` 和 `remove_empty_dir` 只记录实际目录变更，不扫描或备份目录内文件；已有大目录不会消耗快照预算。命令动作的外部副作用不能自动逆向，恢复不完整会明确报告，不能当作全部恢复成功。

### 显式嵌套 ZIP 与预算

`nested_archives: { "include": ["**/*.zip"], "max_depth": 1, "max_entries": 5000, "max_bytes": 268435456 }` 仅展开声明命中的 ZIP；虚拟路径为 `包.zip.contents/内部路径`，可继续使用单元锚点。保留包摘要与父子来源，不执行其中的文件。单层 ZIP 最多 64 MiB、单条解压内容最多 64 MiB、压缩比最多 1000；深度最高 3，总条目最高 10000，总展开大小最高 512 MiB、时间 30 秒。加密、链接、重名大小写冲突、越界、坏 CRC 和超限均拒绝。其他原包继续使用 archive_file，不因存在 ZIP 就自动展开。

glob 支持既有 `*`、`?`、`**` 语义，使用有界状态匹配，避免回溯正则卡住主进程；模式最长 1024、路径最长 32768，单次模式长度乘路径长度最多 200 万。声明式选择器整批最多 200 万次模式比较、50000 个文件；快照最多 100000 项。超预算属于明确错误。

<!-- vertex-agent-only:start -->
### 规则维护与验收

编辑器提供新增字段补全、声明式错误路径及“手动映射”入口。手动映射生成 `routes[*].source.paths` 精确集合和前缀替换，先加入草稿，再沿用已有保存、预览和任务中心安装；不会在编辑器里直接写游戏目录。`paths` 仅用于 routes，不用于单目标 source。

规则验收应使用摘要已核对的作者原包，在隔离目录检查预览映射、组件选择、实际部署路径与文件内容，覆盖迁移及外层包装变化。样本证据必须区分作者原包、衍生变体和合成边界数据；缺少原包时不能报告实际安装已验证。

仓库提供 Palworld、Stardew Valley、Cyberpunk 2077 和 BepInEx JSON 示例。示例不是自动发布的线上规则，也不表示所有版本、前置依赖或游戏内加载均已验证；应按目标游戏环境补齐依赖/版本事实，并用完整文件映射验收后再发布。
<!-- vertex-agent-only:end -->

## 基础字段与兼容参考

本文档说明安装规则 JSON 怎么写，以及这些字段会怎样影响识别和安装。

<!-- vertex-agent-only:start -->
## 公共规则按游戏共用

公共安装规则通过游戏英文标识 `gameKey` 获取，例如 `palworld`、`dragonswordawakening`。同一游戏在 Nexus、Mod.io 等公共来源读取同一份文档及发布版本；平台 ID 用于来源业务，不用于分配另一份规则。已有游戏关系由后端复用，规则中心不要求重复绑定来源。Thunderstore 继续使用独立规则体系。

进入、返回或刷新模组中心时，客户端获取 `{ "gameKeys": ["palworld"] }` 形式的可用规则列表，不下载规则正文。卡片按游戏 key 显示是否具有规则，进入具体游戏后再请求正文。草稿和下架规则不进入支持列表；网络失败显示状态获取失败，不将游戏误判为无规则。规则存在不改变各来源原有下载、安装能力范围。

## 来源可用范围

Vertex 自有在线模组来源已下线。`vertex` 和历史别名 `server` 仅保留用于识别本地记录；在线搜索、详情、依赖解析、下载、安装和更新请求返回 `removed_source`，旧链接显示下线说明。

第三方来源的规则安装、配置档案、分享码、离线包、任务取消、失败重试与回滚继续使用原流程。Thunderstore 仍不支持 AI 安装预检，VAM-Hub 的 AI 查询/预检仍未开放；聚合页面必须先解析真实业务来源。来源能力以共享 registry 为准。

模组中心的 Banana（`gamebanana`）与 Steam（`steam-workshop`）使用统一游戏卡片，点击进入与 Nexus 相同的小卡片模组列表，支持搜索和分页；点击模组详情进入内嵌站点页面，通过右下角“下载模组”将文件保存到本地，任务进入统一任务中心。Steam的游戏目录由后端维护，UGC 文件通过本地 Steam 下载内核获取，无需先在 Steam 中订阅；匿名账号被明确拒绝访问的内容会自动请求 Steam 扫码授权，使用拥有该游戏的账号继续同一下载任务；网络失败不会触发扫码，授权账号仍无权限时停止并显示明确原因。列表卡片同时提供下载和安装操作：按游戏 `gameKey` 读取经过版本与哈希校验的公共规则，复用统一游戏目录识别、配置方案、安装任务中心及模组启停/卸载流程。规则缺失时仅下载；规则可用但目录未识别时，可手动选择游戏目录。Steam 原生下载目录先转换为标准安装包，再交给同一规则引擎预检和部署；规则未命中时不猜测安装路径。安装前再次确认规则发布版本，规则撤回、变更或网络校验失败会停止安装。这两个来源暂不提供自动跨平台依赖解析、分享码或离线包导出。

历史模组保留原始来源、部署清单、游戏终端和备份关联。在本地管理中可查看、导出记录及按可靠清单卸载；清单越界、缺失或备份不可用时停止操作，不猜路径删除。历史云盘任务只保留查看和移除记录功能。记录导出不等于可重新安装的离线包，自有历史来源不加入第三方 .vxpack 支持列表。

这里的来源 `server` 不等于游戏服务端终端；规则的 `source` 路径字段、客户端/服务端安装路径、生命周期动作以及 `vertex.install.*` 工具命名空间保持原有语义。已有本地库文件仍可经过本机库记录与路径校验后安装，不能使用请求中的“离线”标记绕过在线来源限制。
<!-- vertex-agent-only:end -->

建议按这个顺序写规则：

1. 先补 `game` 和 `game_detect`，确保游戏目录能被识别。
2. 主模组或普通文件的自动安装规则写进顶层 `install_rules`。
3. 默认依赖自己的下载包安装规则写进 `default_dependencies[*].install.install_rules` 或 `setup.default_dependencies[*].install.install_rules`。
4. 普通单目标安装写 `install_rules[*].source` 和 `install_rules[*].target`。
5. 一个压缩包需要同时分发到多个目录时，写 `install_rules[*].routes`。
6. 最后补 `default_dependencies` / `setup.default_dependencies`，处理前置依赖和补充安装。

> 建议先用已有配置做调整，再逐步补充细节。

## 1. 顶层结构

```json
{
  "schema_version": 5,
  "engine": {},
  "variables": {},
  "game": {},
  "setup": {
    "default_dependencies": []
  },
  "default_dependencies": [],
  "game_detect": {},
  "install_rules": []
}
```

### 1.1 顶层字段

| 字段                                                       | 类型     | 默认值 | 说明                   |
| ---------------------------------------------------------- | -------- | ------ | ---------------------- |
| `schema_version` / `schemaVersion`                         | `number` | 无     | 规则版本号。新增和公共规则统一使用 `5`（严格门控模式）；旧规则须迁移匹配字段后再发布 |
| `engine`                                                   | `object` | `{}`   | 高级配置，通常不用写   |
| `variables` / `vars`                                       | `object` | 无     | 顶层可复用规则变量     |
| `game`                                                     | `object` | `{}`   | 游戏基础信息           |
| `setup.default_dependencies` / `setup.defaultDependencies` | `array`  | `[]`   | 默认依赖               |
| `default_dependencies` / `defaultDependencies`             | `array`  | `[]`   | 顶层默认依赖           |
| `game_detect` / `gameDetect`                               | `object` | `{}`   | 游戏目录识别规则       |
| `install_rules` / `installRules`                           | `array`  | `[]`   | 当前安装规则主入口     |

说明：

- 当前统一安装引擎运行时只遍历“传入规则对象”编译后的 `install_rules`。
- 主模组安装传入整份规则 JSON，因此读取顶层 `install_rules`；默认依赖安装传入依赖自己的 `install` 对象，因此读取 `install.install_rules`。
- 前端配置校验要求至少存在一条 `install_rules` 规则。

## 2. 当前执行规则

### 2.1 字段兼容

规则支持常见的 `snake_case` / `camelCase` 写法。

**新规则必须使用 `snake_case`。** 本文档示例也统一使用 `snake_case`。

所有 `camelCase` 别名已进入弃用状态。编译阶段会对使用别名的字段产生 `deprecated_match_alias` 警告，提示推荐的标准字段名。旧规则仍能正常运行，但建议在维护时逐步迁移到标准字段。

如果字段里需要使用 `${var_name}` 变量，优先使用"当前支持的变量展开位置"中列出的字段。

当前已兼容的主要顶层别名：

| 标准字段                     | 兼容字段（已弃用，仍可用）                                |
| ---------------------------- | --------------------------------------------------------- |
| `schema_version`             | `schemaVersion`                                           |
| `variables`                  | `vars`                                                    |
| `game_detect`                | `gameDetect`                                              |
| `game_detect.candidates`     | `game_detect.candidate_list`、`game_detect.candidateList` |
| `install_rules`              | `installRules`                                            |
| `default_dependencies`       | `defaultDependencies`                                     |
| `setup.default_dependencies` | `setup.defaultDependencies`                               |

条件匹配（`match`）字段别名已弃用：

| 标准字段               | 已弃用别名                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `root_has_dirs`        | `rootHasDirs`、`allRootDirs`、`all_root_dirs`、`requiredDirs`、`required_dirs` |
| `any_root_dirs`        | `anyRootDirs`、`rootHasAnyDirs`、`root_has_any_dirs`               |
| `none_root_dirs`       | `noneRootDirs`、`rootHasNoDirs`、`root_has_no_dirs`                |
| `root_has_files`       | `rootHasFiles`、`allRootFiles`、`all_root_files`、`requiredFiles`、`required_files` |
| `any_root_files`       | `anyRootFiles`、`rootHasAnyFiles`、`root_has_any_files`            |
| `none_root_files`      | `noneRootFiles`、`rootHasNoFiles`、`root_has_no_files`             |
| `any_file_patterns`    | `anyFilePatterns`、`hasFilePattern`、`has_file_pattern`            |
| `all_file_patterns`    | `allFilePatterns`                                                  |
| `none_file_patterns`   | `noneFilePatterns`                                                 |
| `any_dir_patterns`     | `anyDirPatterns`                                                   |
| `all_dir_patterns`     | `allDirPatterns`                                                   |
| `none_dir_patterns`    | `noneDirPatterns`                                                  |
| `any_file_extensions`  | `anyFileExtensions`                                                |
| `all_file_extensions`  | `allFileExtensions`                                                |
| `none_file_extensions` | `noneFileExtensions`                                               |
| `any_file_names`       | `anyFileNames`                                                     |
| `all_file_names`       | `allFileNames`                                                     |
| `none_file_names`      | `noneFileNames`                                                    |
| `min_file_count`       | `minFileCount`                                                     |
| `max_file_count`       | `maxFileCount`                                                     |
| `root_entry_count_min` | `rootEntryCountMin`                                                |
| `root_entry_count_max` | `rootEntryCountMax`                                                |

> **迁移建议**：使用迁移器将旧规则升级为 v5。当同一条件混用标准名和兼容别名时，列表合并，数量下限取最大值、上限取最小值，保留原运行期约束，不能直接丢弃别名字段。当 `schema_version >= 5` 时，使用别名将直接报错阻断编译。

`any_of` 与 `any` 均接受单个条件对象或条件对象数组，至少命中一个子条件才通过；同级其他条件仍须全部满足。安装包扫描最多支持 80 层目录嵌套，超限会明确中止安装，不会将截断后的文件列表作为成功计划。

### 2.2 JSON 写法约束

规则必须是标准 JSON：

1. 根节点必须是对象，不能是数组或字符串。
2. 字段名和字符串必须使用双引号，不能使用注释、尾随逗号或单引号。
3. 路径统一写相对路径，推荐使用 `/`，不要写绝对路径、盘符路径或 `..` 越界片段。
4. 同一类字段优先使用 `snake_case`；兼容 `camelCase` 只是为了历史配置。
5. 列表字段既建议写数组，也允许部分旧字段写单个字符串；新规则建议统一写数组，便于后续维护。
6. `install_rules[*]` 使用 `match`；route 条件可以写 `when` / `match`。
7. 布尔值写 `true` / `false`，不要写字符串 `"true"`，除非字段说明明确兼容字符串。

Schema 校验会在规则编译阶段运行：

- 未知字段只产生 warning，旧规则仍会继续尝试匹配。
- 明显错误会让当前规则跳过，并继续评估后续规则，例如 `mathc` 会提示推荐改为 `match`。
- `match` 必须是对象；列表类条件推荐写数组，也兼容字符串或数字；对象等非法值会报错。
- `source.type`、`target.type`、`routes`、`priority`、`confidence` 等结构错误会给出字段路径。
- 兼容别名受版本门控保护：
  - 当 `schema_version >= 5` 时，所有条件匹配兼容别名（如 `rootHasDirs`、`allRootDirs` 等别名字段）将直接被判定为 `error`，并在规则编译层强力拦截抛错，阻断编译；
  - 当 `schema_version <= 4` 或缺省时，别名仅产生 `warning` 级别警告，且引擎内部仍会自动翻译放行以保持向下兼容。新规则推荐统一写标准 `snake_case`。

推荐结构骨架，提交前至少要在 `install_rules` 中补一条规则：

```json
{
  "schema_version": 5,
  "variables": {},
  "game_detect": {
    "candidates": []
  },
  "install_rules": []
}
```

<!-- vertex-agent-only:start -->
### 2.2.1 检测型本地规则

AI 兜底识别游戏目录时，允许保存只有 `game_detect` 的检测型本地规则。检测型规则只用于识别和绑定游戏目录，不代表该游戏已经具备可执行安装规则。

保存检测型规则时必须使用 `mergeStrategy=game_detect_only`：

- 只保存或合并 `game_detect`。
- 已存在本地规则时，必须保留原有 `install_rules`。
- 不存在本地规则时，可以保存 `install_rules: []`，但该配置类型是 `game_detect_only`。
- 空 `install_rules` 不能被当作可安装规则。

示例：

```json
{
  "schema_version": 5,
  "game_detect": {
    "select": {
      "strategy": "highest_confidence"
    },
    "candidates": [
      {
        "name": "exe_and_markers",
        "type": "exe_search",
        "confidence": 80,
        "exe_globs": ["Game.exe"],
        "root_from": {
          "type": "exe_dir",
          "up": 0
        },
        "markers": {
          "any_paths": ["Game.exe"],
          "all_paths": []
        }
      }
    ]
  },
  "install_rules": []
}
```

### 2.2.2 AI 推断临时规则

当 `install_rules` 缺失或预演未命中时，AI 可以根据模组详情、README、压缩包结构和页面上下文生成临时规则。临时规则必须先经过：

先调用 `vertex.install.location_hints`，提供 `sourcePlatform`、`modId` 和 Nexus 的 `domainName` 或 Mod.io 的 `sourceGameId`；已选择文件时同时提供 `fileId`。工具会通过现有来源接口主动读取对应详情页的完整描述和所选文件说明，支持 HTML / BBCode 安装段落；不抓取任意链接，也不把网页命令当成执行授权。仅有简介不代表没有安装说明。

- `detailStatus` 区分已读取、身份缺失、读取失败和身份不匹配；失败时保留已有 README 线索，不把网络或授权失败误报为页面没有说明。
- `detailText`、`readmeText`、`installation`、`description` 每项允许最多 128000 字符；超长输入明确报错，避免被通用参数长度限制截去末尾安装段落。
- `hints[*].evidence` 保留线索来源与脱敏片段；完整游戏子路径必须保留，`Pal/Content/Paks/~mods` 不能简化为 `Content/Paks/~mods`。
- 多个目标会标记 `ambiguous` / `requiresReview`，需核对平台、版本、组件和当前选择的文件。仅有 `.pak` / `.dll` 扩展名不能确定目标目录；纯压缩包结构线索也需复核。
- `gameDetectionCandidates` 来自说明中的具体游戏 EXE，可用于 `game_detect.candidates`，随后调用 `vertex.game.detect_root` 验证实际目录。EXE 位置不是模组安装目标，示例绝对路径也不是本机目录。
- `suggestedRule` 仅在目标唯一、包结构完整且能明确映射时提供。已带目标层级的包使用 `fixed_subdir` 避免目录重复；平铺文件使用精确 `file_by_pattern`，同时考虑 `.pak`、`.utoc`、`.ucas`。缺少结构、结构截断或存在歧义时不生成草案。

规则草案仍然必须依次经过：

1. `vertex.install.archive.inspect`
2. `vertex.install.rule.match_preview`
3. `vertex.install.inspect_plan`

只有预检可提交且用户确认后，才能进入安装任务中心。AI 推断规则不得绕过预检，也不得直接写入用户目录。
<!-- vertex-agent-only:end -->

### 2.2.3 用户作用域路径

安装说明中的用户目录绝对线索必须转换为受控基准路径：

| 原始线索 | 推荐规则写法 |
| --- | --- |
| `%LOCALAPPDATA%\Pal\Saved\Config\Windows\` | `target.type=user_relative`、`base_type=local_appdata`、`path=Pal/Saved/Config/Windows` |
| `%APPDATA%\Game\Mods` | `target.type=user_relative`、`base_type=roaming_appdata`、`path=Game/Mods` |
| `GameRoot\Content\Paks\~mods` | `target.type=game_relative`、`path=Content/Paks/~mods` |
| `BepInEx\plugins` | `target.type=game_relative`、`path=BepInEx/plugins` |

禁止在规则里生成盘符绝对路径、UNC 路径、`..` 越界路径、磁盘根目录或用户主目录作为安装目标。

示例：

```json
{
  "schema_version": 5,
  "install_rules": [
    {
      "id": "ai_inferred_local_appdata_config",
      "priority": 60,
      "confidence": 75,
      "match": {
        "archive": {
          "has_file": {
            "pattern": "Engine.ini"
          }
        }
      },
      "source": {
        "type": "package_root"
      },
      "target": {
        "type": "user_relative",
        "base_type": "local_appdata",
        "path": "Pal/Saved/Config/Windows"
      }
    }
  ]
}
```

### 2.3 执行顺序

安装时会按下面的顺序匹配规则：

1. 下载或选择文件后，先在后台生成统一安装预案 `InstallPlan`。
2. 普通命中规则且预案可自动执行时，会直接进入安装进度，不再要求确认安装路径。
3. 如果预案包含高风险生命周期动作、阻塞风险或显式要求确认，会先提示用户确认。
4. 如果规则未命中，不会自动安装，只保留下载文件并记录未命中信息。
5. 默认启用统一安装引擎：先编译变量和字段别名，再遍历 `install_rules`。
6. 默认依赖安装任务只会从该依赖自己的 `install.install_rules` 开始匹配，不会去顶层 `install_rules` 里找依赖包规则。
7. 运行时按 `priority` 倒序匹配；同优先级再按 `confidence` 倒序匹配；第一条命中后停止。
8. 命中规则带 `routes` 且非空时进入多 route 规划；没有 `routes` 时进入单目标规划。
9. 统一规划会生成 `changeSet`、`conflictResult`、`dependencyResult`、`deployStrategy`、`transactionPlan`、`healthExpectations` 和 `replaySnapshot`。
10. 统一引擎未命中时不会回退旧引擎，只保留下载文件并记录未命中信息。
11. 已安装的模组在启用、禁用、卸载时，会继续使用安装时记录的命中规则、目标路径、部署文件和生命周期动作，不会重新匹配规则。

### 2.4 规则排序

1. 统一安装引擎按 `priority` 倒序。
2. 同优先级按 `confidence`（兼容 `weight`）倒序；两者都未写时默认按 `80` 处理，显式的 `0` 保持为 `0`。
3. 第一条命中并成功生成计划后停止，不再继续匹配后续规则。
4. 如果命中规则构建计划失败，会记录失败原因并继续尝试下一条规则。
5. 如果写了 `variables.game_dir`，可能会自动追加根目录匹配规则。
6. 不要依赖数组天然顺序表达优先级，需要优先生效的规则请明确提高 `priority`。

### 2.5 glob 规则

当前支持：

- `*`
- `**`
- `?`

路径匹配时会统一按 `/` 处理，大小写不敏感。

### 2.6 规则变量

变量是可选能力。只有写了 `variables` 或 `vars`，才会展开变量。

#### 2.6.1 定义字段名

- 推荐使用 `variables`
- 兼容别名 `vars`

#### 2.6.2 引用语法

- `${var_name}`

#### 2.6.3 变量作用域

- 整份规则文件内全局可见
- `game_detect`
- `install_rules`
- `install_rules[*].post_install`
- `install_rules[*].on_enable`
- `install_rules[*].on_disable`
- `install_rules[*].on_uninstall`
- `default_dependencies[*].install`
- `setup.default_dependencies[*].install`

#### 2.6.4 展开规则

1. 解析 JSON
2. 统一字段别名
3. 读取 `variables` / `vars`
4. 先解析变量之间的相互引用
5. 再把支持字段里的 `${var_name}` 替换成变量值
6. 最后继续识别游戏目录和安装规则

> H10 补充：`variables` 值支持字符串、数字、布尔、`null`。数字和布尔会自动转为字符串（`3` → `"3"`，`true` → `"true"`），`null` 转为空串 `""`。对象和数组不支持，会抛 `rule_variable_invalid_type` 错误。

#### 2.6.5 当前支持的变量展开位置

- `game_detect.candidates[*].markers.*`
- `game_detect.candidates[*].exe_globs`
- `game_detect.candidates[*].root_hints` / `rootHints` / `search_roots` / `searchRoots`
- `install_rules[*].match.*`
- `install_rules[*].source.path` / `source_path` / `sourcePath`
- `install_rules[*].source.marker`
- `install_rules[*].source.extension`
- `install_rules[*].source.pattern` / `patterns` / `file_pattern` / `filePattern` / `file_patterns` / `filePatterns`
- `install_rules[*].target.path` / `target_path` / `targetPath`
- `install_rules[*].target.launch_target` / `inject_target` / `enable_target` / `enable_exe` / `launch_exe` / `inject_exe` 及其 `camelCase` 写法
- `install_rules[*].target.launch_args` / `launch_target_args` / `inject_target_args` / `enable_target_args` / `enable_exe_args` / `launch_exe_args` / `inject_exe_args` 及其 `camelCase` 写法
- `install_rules[*].target.launch_target_base` / `launch_target_base_type` / `inject_target_base` / `enable_target_base` 等启动目标基准字段及其 `camelCase` 写法
- `install_rules[*].routes` 整棵数组里的所有字符串值，包括 route 的 `when` / `match` / `source` / `target` / `mapping` / `group` / `health_expectations`
- `install_rules[*].post_install[*]` / `on_enable[*]` / `on_disable[*]` / `on_uninstall[*]` 中的 `path` / `relative_path` / `relativePath` / `dir` / `directory` / `from` / `source` / `source_path` / `sourcePath` / `to` / `target` / `target_path` / `targetPath` / `backup` / `backup_path` / `backupPath` / `text` / `content` / `value` / `patch` / `section` / `key` / `args` / `arguments` / `stdin` / `input` / `inputs`
- 默认依赖里的 `install` 子规则使用同一套支持项

#### 2.6.6 变量错误

变量写错时会直接报错。常见错误包括：

- `rule_variable_undefined`
- `rule_variable_cycle`
- `rule_variable_invalid_type`

#### 2.6.7 说明

- 没有配置 `variables` / `vars` 时，不会展开变量
- 现有 `game` / `game_detect` / `install_rules` / `source` / `target` 语义不变
- 规则匹配时使用的是展开后的最终字符串

#### 2.6.8 内置自动规则：根路径匹配

如果写了 `variables.game_dir`，并且它是单段目录名，会自动追加一条根目录匹配规则：

```json
{
  "id": "__auto_root_dir_match__",
  "name": "内置-根路径匹配",
  "priority": 100,
  "match": {
    "root_has_dirs": ["${game_dir}"]
  },
  "source": {
    "type": "package_root"
  },
  "target": {
    "type": "game_root",
    "path": "."
  }
}
```

说明：

- 这条规则作为低优先级兜底规则参与匹配，默认 `priority` 为 `100`
- 根路径安装会先做内置预检；如果同一压缩包还能命中更具体的安装规则，会跳过根路径规则
- 根路径安装默认排除 `.exe` 文件，排除后的源目录会作为实际安装源
- 它等价于“压缩包根目录里正好包含一个与 `game_dir` 同名的完整游戏根目录容器”
- 如果 `variables.game_dir` 缺失、为空、包含 `/` 或 `\`，则不会启用该能力
- 不会从其他字段自动推断 `game_dir`

## 3. `game_detect`

### 3.1 结构

```json
{
  "game_detect": {
    "select": {
      "strategy": "highest_confidence"
    },
    "candidates": []
  }
}
```

### 3.2 已支持字段

| 字段              | 类型     | 默认值               | 说明                                                             |
| ----------------- | -------- | -------------------- | ---------------------------------------------------------------- |
| `select.strategy` | `string` | `highest_confidence` | 候选选择策略，兼容 `selector.strategy` 和 `game_detect.strategy` |
| `candidates`      | `array`  | `[]`                 | 候选规则列表，兼容 `candidate_list` / `candidateList`            |

`select.strategy` 当前支持的枚举位（H9 完善）：

- `highest_confidence`（默认）：按 `confidence` 从高到低排序，第一个命中的候选即返回。
- `first_match`：按 `candidates` 数组原始顺序，第一个命中的候选即返回（不排序）。
- `most_specific`：按 `markers` 数量加权（`all_paths` + `any_paths` 总数越多越具体），最具体的候选优先。
- `interactive`：当前未实现（需通过 IPC 让用户从多个候选中选择），回退 `highest_confidence` 并告警。

### 3.3 `candidates[*]` 已支持字段

| 字段                     | 类型            | 默认值                       | 说明                                                            |
| ------------------------ | --------------- | ---------------------------- | --------------------------------------------------------------- |
| `name`                   | `string`        | `candidate_{n}`              | 候选名称                                                        |
| `type`                   | `string`        | `exe_search`                 | 识别类型，支持 `exe_search`、`path_marker` 和 `root_hint`         |
| `confidence`             | `number`        | `0`                          | 命中后置信度                                                    |
| `markers`                | `object`        | `{}`                         | 根目录校验条件                                                  |
| `exe_globs` / `exeGlobs` | `array<string>` | `[]`                         | 可执行文件提示，可写完整 glob，但当前会抽取可执行文件名参与搜索 |
| `root_hints` / `rootHints` | `array<string>` | `[]`                       | `root_hint` 使用的显式游戏根目录提示                            |
| `root_from` / `rootFrom` | `object`        | `{ type: "exe_dir", up: 0 }` | 从 exe 回推根目录                                               |

`type` 当前支持的枚举位：

- `exe_search`（默认）：依赖 `exe_globs` 或 markers 中的 `.exe` 文件名，通过本地游戏列表 / 磁盘扫描 / 目录内搜索定位游戏根。
- `path_marker`（H4 新增）：仅靠 `markers.all_dirs / any_dirs / all_files / any_files` 命中，不需要 exe 提示。适用于目录结构独特的游戏（如 VAM 的 `AddonPackages/` + `Saves/`）。当前实现优先从本地游戏列表中查找满足 markers 的目录（用 `client_exe_path` 推导 rootPath）；本地列表为空时返回 `not_found`，建议配合 `root_from` 指定更精确的查找路径或使用 `exe_search` 类型。
- `root_hint`：按 `root_hints` 中的显式目录依次校验 markers（包括用 `none_paths` 排除错误目录），命中后作为游戏根目录；兼容 `rootHints`、`search_roots`、`searchRoots`，不会触发额外全盘扫描。
- 其他枚举位（`registry_key` / `steam_manifest`）保留但未实现，规则编写者不应使用；如误用会被静默回退到 `exe_search` 处理并告警。

### 3.4 `markers` 已支持字段

| 字段                     | 说明                              |
| ------------------------ | --------------------------------- |
| `all_files` / `allFiles` | 所有路径必须存在                  |
| `any_files` / `anyFiles` | 至少一个路径存在                  |
| `all_paths` / `allPaths` | 与 `all_files` 等价的通用路径写法 |
| `any_paths` / `anyPaths` | 与 `any_files` 等价的通用路径写法 |
| `all_dirs` / `allDirs`   | 目录存在性别名写法                |
| `any_dirs` / `anyDirs`   | 目录存在性别名写法                |
| `none_paths` / `nonePaths` | 任一路径存在时不命中            |
| `none_files` / `noneFiles` | 排除文件的兼容别名写法          |
| `none_dirs` / `noneDirs` | 排除目录的兼容别名写法            |

### 3.5 `root_from` 已支持字段

| 字段                              | 类型     | 默认值    | 说明           |
| --------------------------------- | -------- | --------- | -------------- |
| `type` / `root_type` / `rootType` | `string` | `exe_dir` | 根目录回推起点 |
| `up` / `levels_up` / `levelsUp`   | `number` | `0`       | 向上回退层数   |

### 3.6 识别来源与顺序

当前候选会按选择策略处理并依次尝试：

1. 先从本地已记录游戏列表里匹配可执行文件名和 markers。
2. 未命中时，再按候选可执行文件名进行磁盘扫描。
3. 用户手动选择目录时，会先校验所选目录 markers；如果 markers 不足以直接命中，再在目录内搜索候选 exe 并按 `root_from` 回推根目录。
4. `root_hint` 只检查规则提供的目录提示，并复用相同的 markers / exe 提示校验能力。

说明：

- 当前统一规则接入来源包含 Nexus、mod.io、Ficsit、VAM-Hub 等平台。接入来源只负责传入游戏标识、原始下载文件和规则对象，游戏目录识别与安装落点都由本规则引擎决定。
- `highest_confidence` 会按 `confidence` 从高到低处理候选。
- `exe_globs` 中包含通配符时，当前只会抽取不含 `*` / `?` 的文件名部分作为 exe 搜索提示。

### 3.7 示例

```json
{
  "game_detect": {
    "select": {
      "strategy": "highest_confidence"
    },
    "candidates": [
      {
        "name": "stellar_blade_steam",
        "type": "exe_search",
        "confidence": 100,
        "markers": {
          "all_files": ["SB.exe"]
        },
        "root_from": {
          "type": "exe_dir",
          "up": 0
        }
      }
    ]
  }
}
```

显式目录提示与排除 marker 示例：

```json
{
  "variables": {
    "common_game_root": "D:/Games/StellarBlade"
  },
  "game_detect": {
    "candidates": [
      {
        "name": "stellar_blade_common_root",
        "type": "root_hint",
        "root_hints": ["${common_game_root}"],
        "exe_globs": ["SB.exe"],
        "markers": {
          "all_paths": ["SB.exe"],
          "none_paths": ["UninstallOnly.marker"]
        }
      }
    ]
  }
}
```

## 4. `default_dependencies`

默认依赖会合并这两个位置：

1. `setup.default_dependencies`
2. `default_dependencies`

### 4.1 常用字段

| 字段       | 类型      | 说明                                          |
| ---------- | --------- | --------------------------------------------- |
| `id`       | `string`  | 依赖唯一标识                                  |
| `name`     | `string`  | 依赖名称                                      |
| `source`   | `string`  | 来源类型，例如 `github_release`、`nexus_file` |
| `provider` | `object`  | 下载定位信息                                  |
| `install`  | `object`  | 安装规则，结构与主模组一致                    |
| `blocking` | `boolean` | 是否阻塞型前置依赖                            |
| `required` | `boolean` | 是否强依赖                                    |

说明：

- `install` 是默认依赖自己的独立安装规则对象。
- 默认依赖下载完成后，运行时通常只把这个 `install` 对象传给统一安装引擎，所以可执行匹配规则必须写在 `install.install_rules`。
- 只写 `install.source` / `install.target` 可以作为旧式兼容或兜底路径信息，但不会提供统一引擎需要遍历的规则列表；缺少 `install.install_rules` 时可能出现 `no_install_rules`。
- `install.install_rules` 使用与顶层 `install_rules` 相同的 `match`、`source`、`target`、`routes` 和生命周期结构。
- 默认依赖也可以使用变量，写法与主规则一致；在完整规则 JSON 中会随顶层 `variables` 一起编译展开。
- AI 安装计划会读取默认依赖；能解析出下载链接和独立 `install` 规则的默认依赖会作为 `default_dependency` 任务项排在主模组前，强制默认依赖缺少下载链接或安装规则时会进入计划的缺失依赖提示并阻止直接提交。

### 4.2 `source: "nexus_file"` Provider

`nexus_file` 默认依赖支持两种定位方式：

1. 显式提供 `file_id`：直接用该文件请求 Nexus `download_link.json`，不请求文件列表。
2. 不提供 `file_id`：先用 `game_domain + mod_id` 请求 Nexus `files.json`，再按 provider 的分类和文件名筛选条件自动解析目标文件。

Provider 推荐统一使用 `snake_case`：

| 字段                 | 类型               | 说明                                                                    |
| -------------------- | ------------------ | ----------------------------------------------------------------------- |
| `game_domain`        | `string`           | Nexus 游戏域名；缺失时可从当前游戏 `domainName` 兜底                    |
| `mod_id`             | `number\|string`   | Nexus Mod ID                                                            |
| `file_id`            | `number\|string`   | 显式 Nexus 文件 ID；有值时不走 `files.json` 自动解析                    |
| `category`           | `string`           | 支持 `MAIN`、`UPDATE`、`OPTIONAL`、`OLD_VERSION`、`MISCELLANEOUS`       |
| `file_name`          | `string`           | 文件名精确匹配，优先级高于正则和包含词                                  |
| `file_name_regex`    | `string`           | 文件名正则匹配                                                          |
| `file_name_contains` | `string\|string[]` | 文件名必须包含全部关键词                                                |
| `prefer_latest`      | `boolean`          | 多候选时按上传时间 / `file_id` 倒序选择                                 |
| `allow_archived`     | `boolean`          | 是否允许 `ARCHIVED` 文件；默认不允许                                    |
| `allow_old_files`    | `boolean`          | 是否允许 `OLD_VERSION` 文件；默认不允许，除非 `category` 显式指定旧文件 |
| `strict`             | `boolean`          | 默认 `true`；无匹配时报错，写 `false` 时回退到默认优先级选择            |

兼容读取别名：

| 标准字段             | 兼容别名                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| `game_domain`        | `game_domain_name`、`domain_name`、`domainName`、`gameDomain`、`gameDomainName` |
| `mod_id`             | `modId`、`nexus_mod_id`、`nexusModId`、`id`                                     |
| `file_id`            | `fileId`、`nexus_file_id`、`nexusFileId`                                        |
| `file_name`          | `fileName`、`filename`                                                          |
| `file_name_contains` | `fileNameContains`、`name_contains`、`nameContains`                             |
| `file_name_regex`    | `fileNameRegex`、`name_regex`、`nameRegex`                                      |
| `prefer_latest`      | `preferLatest`                                                                  |
| `allow_archived`     | `allowArchived`                                                                 |
| `allow_old_files`    | `allowOldFiles`                                                                 |

分类 ID 语义以客户端常量为准：`MAIN=1`、`UPDATE=2`、`OPTIONAL=3`、`OLD_VERSION=4`、`MISCELLANEOUS=5`、`DELETED=6`、`ARCHIVED=7`。自动解析默认排除 `DELETED`、`ARCHIVED`、hidden/deleted/archived 状态文件，并默认排除 `OLD_VERSION`。

显式 `file_id` 示例：

```json
{
  "id": "dmm_tool",
  "name": "Definitive Mod Manager",
  "source": "nexus_file",
  "provider": {
    "game_domain": "crimsondesert",
    "mod_id": 633,
    "file_id": 11132
  },
  "install": {
    "install_rules": []
  },
  "required": true,
  "blocking": true
}
```

自动解析最新主文件示例：

```json
{
  "id": "dmm_tool",
  "name": "Definitive Mod Manager",
  "source": "nexus_file",
  "provider": {
    "game_domain": "crimsondesert",
    "mod_id": 633,
    "category": "MAIN",
    "prefer_latest": true
  },
  "install": {
    "install_rules": []
  }
}
```

文件名正则筛选示例：

```json
{
  "source": "nexus_file",
  "provider": {
    "game_domain": "crimsondesert",
    "mod_id": 633,
    "category": "MAIN",
    "file_name_regex": "DMM|Definitive.*Mod.*Manager",
    "prefer_latest": true
  },
  "install": {
    "install_rules": []
  }
}
```

说明：`download_link.json` 返回的是短效下载链接，规则里不要长期保存 Nexus 直链；默认依赖应保存 provider 条件，由客户端在提交安装任务时解析并换取下载地址。

### 4.3 `source: "github_release"` Provider

默认安装 GitHub 最新正式发布版本。省略 `tag`、写空字符串或 `"latest"` 时，在创建安装任务前请求 `/repos/{owner}/{repo}/releases/latest`，再从该版本选择资产。最新正式版由 GitHub 的 Latest Release 接口确定，不按文件名字典序猜测，也不默认包含预发布版本。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `owner`、`repo` | `string` | 必填的仓库所有者与仓库名 |
| `tag` | `string` | 可选；省略、空值或 `latest` 为最新正式版；其他值为明确固定的 Release tag，可指定预发布版 |
| `asset_name` / `assetName` | `string` | 资产文件名精确匹配，优先于其他筛选条件 |
| `asset_name_regex` / `assetNameRegex` | `string` | 文件名正则，不区分大小写；在可终止的独立线程匹配，模式最多 512 字符，超时 2 秒则拒绝 |
| `asset_name_contains` / `assetNameContains` | `string\|string[]` | 没有精确名称和正则时使用，文件名必须包含全部关键词，不区分大小写 |
| `prefer_latest` / `preferLatest` | `boolean` | 兼容字段；未指定 tag 本来就取最新，不能覆盖明确指定的 tag |
| `download_url` / `downloadUrl` / `browser_download_url` | `string` | 仅在明确固定 tag 且提供精确 `asset_name` 时保留旧式直链；latest 模式忽略残留旧直链 |
| `github_token` / `githubToken` / `token` | `string` | 可选 API 认证字段；不要在公开规则中保存个人凭据 |

筛选必须得到唯一资产；没有匹配或有多个匹配都会报错。省略全部资产筛选时，仅允许该 Release 有一个可下载资产。固定版本失败不会静默回退最新版；latest 查询失败也不会回退旧版本。

帕鲁 UE4SS 推荐 provider（既能匹配旧文件名，也能匹配带构建号的新文件名，并排除 zDev 包）：

```json
{
  "owner": "Okaetsu",
  "repo": "RE-UE4SS",
  "asset_name_regex": "^UE4SS-Palworld(?:-g[0-9a-f]+)?\\.zip$"
}
```

确实需要固定版本时，加上 `"tag": "2281fa31"`。已有规则的非空具体 tag 继续视为明确指定，不会被引擎擅自升级；要跟随最新版本，应删除该 tag 或改为 `latest`，并检查资产名称是否也写死了版本。

任务和安装记录保存实际解析出的 tag、资产 ID、文件名、下载地址和可用的资产摘要；记录中的版本采用实际 tag，不再采用 ZIP 文件名。原始 provider 策略与解析结果分开保存，安装详情优先打开当次实际版本页面。已有安装记录仍按原流程复用，此规则不表示每次安装其他模组时强制更新加载器。

默认依赖示例：

```json
{
  "setup": {
    "default_dependencies": [
      {
        "id": "game_loader",
        "name": "Game Loader",
        "source": "github_release",
        "provider": {
          "owner": "example-owner",
          "repo": "game-loader",
          "asset_name": "Loader.zip"
        },
        "install": {
          "target": {
            "type": "game_relative",
            "path": "${win64_dir}"
          },
          "install_rules": [
            {
              "id": "game_loader_root",
              "match": {
                "any_file_patterns": ["**/Loader.dll"]
              },
              "source": {
                "type": "folder_containing",
                "marker": "Loader.dll"
              },
              "target": {
                "type": "game_relative",
                "path": "${win64_dir}"
              }
            }
          ]
        },
        "required": true,
        "blocking": true
      }
    ]
  }
}
```

## 5. `install_rules`

### 5.1 单条规则结构

```json
{
  "id": "sb_pak_mod_auto",
  "name": "基础 Pak 模组",
  "priority": 401,
  "match": {
    "any_file_extensions": [".pak"]
  },
  "source": {},
  "target": {},
  "post_install": [],
  "on_enable": [],
  "on_disable": [],
  "on_uninstall": []
}
```

### 5.2 已支持字段

| 字段           | 类型     | 默认值                     | 说明                         |
| -------------- | -------- | -------------------------- | ---------------------------- |
| `id`           | `string` | 自动生成                   | 规则 ID                      |
| `name`         | `string` | 空                         | 规则名称                     |
| `priority`     | `number` | `0`                        | 优先级                       |
| `confidence` / `weight` | `number` | `80`             | 规则置信度；同优先级时越高越先匹配 |
| `description`  | `string` | 空                         | 规则说明                     |
| `match`        | `object` | `{}`                       | 匹配条件；空对象不会命中     |
| `source`       | `object` | `{ type: "package_root" }` | 安装源                       |
| `target`       | `object` | `{ type: "game_root" }`    | 安装目标                     |
| `routes`       | `array`  | `[]`                       | 多 route 安装路线；非空时进入多 route 规划 |
| `dependencies` / `default_dependencies` / `defaultDependencies` | `array` | `[]` | 规则依赖，会进入依赖求解 |
| `health_expectations` / `healthExpectations` | `object` | `{}` | 安装后健康检查期望 |
| `post_install` | `array`  | `[]`                       | 安装后处理                   |
| `on_enable`    | `array`  | `[]`                       | 启用模组前执行的生命周期动作 |
| `on_disable`   | `array`  | `[]`                       | 禁用模组前执行的生命周期动作 |
| `on_uninstall` | `array`  | `[]`                       | 卸载模组前执行的生命周期动作 |

说明：

- 如果写了 `variables.game_dir`，可能会自动追加 `__auto_root_dir_match__`
- 自动追加的规则和手写规则一样参与排序和匹配
- `match: {}` 或无有效条件不会命中，请至少填写一个压缩包或游戏目录条件。
- 生命周期字段兼容 `postInstall`、`onEnable`、`onDisable`、`onUninstall`。

### 5.3 `match` 已支持字段

| 字段                   | 说明                                   |
| ---------------------- | -------------------------------------- |
| `root_has_dirs`        | 顶层目录必须全部存在                   |
| `root_has_files`       | 顶层文件必须全部存在                   |
| `any_root_dirs`        | 顶层目录至少命中一个                   |
| `none_root_dirs`       | 顶层目录不允许命中                     |
| `any_root_files`       | 顶层文件至少命中一个                   |
| `none_root_files`      | 顶层文件不允许命中                     |
| `any_file_names`       | 顶层子项名称至少命中一个               |
| `all_file_names`       | 顶层子项名称必须全部存在               |
| `none_file_names`      | 顶层子项名称不允许命中                 |
| `any_file_basenames`   | 递归文件名至少命中一个                 |
| `any_dir_basenames`    | 递归目录名至少命中一个                 |
| `any_file_patterns`    | 递归文件路径至少命中一个 glob          |
| `all_file_patterns`    | 递归文件路径必须全部命中               |
| `none_file_patterns`   | 递归文件路径黑名单                     |
| `any_dir_patterns`     | 递归目录路径至少命中一个 glob          |
| `all_dir_patterns`     | 递归目录路径必须全部命中               |
| `none_dir_patterns`    | 递归目录路径黑名单                     |
| `any_file_extensions`  | 递归文件至少命中一种扩展名             |
| `all_file_extensions`  | 递归文件必须全部属于指定扩展名集合     |
| `none_file_extensions` | 递归文件扩展名黑名单                   |
| `min_file_count`       | 递归文件数量下限（含），低于此值不通过 |
| `max_file_count`       | 递归文件数量上限（含），高于此值不通过 |
| `root_entry_count_min` | 顶层条目数量下限（含），低于此值不通过 |
| `root_entry_count_max` | 顶层条目数量上限（含），高于此值不通过 |
| `any_of`               | 子条件数组，至少一个子条件满足         |
| `all`                  | 子条件数组，必须全部满足               |
| `any`                  | 子条件数组，至少一个满足               |
| `not`                  | 子条件数组，命中任意子条件即不通过     |
| `archive`              | 压缩包命名空间条件对象                 |
| `game`                 | 游戏目录命名空间条件对象               |

常用兼容别名：

| 推荐字段               | 兼容字段                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `root_has_dirs`        | `rootHasDirs`、`all_root_dirs`、`allRootDirs`、`required_dirs`、`requiredDirs`      |
| `any_root_dirs`        | `anyRootDirs`、`root_has_any_dirs`、`rootHasAnyDirs`                                |
| `none_root_dirs`       | `noneRootDirs`、`root_has_no_dirs`、`rootHasNoDirs`                                 |
| `root_has_files`       | `rootHasFiles`、`all_root_files`、`allRootFiles`、`required_files`、`requiredFiles` |
| `any_root_files`       | `anyRootFiles`、`root_has_any_files`、`rootHasAnyFiles`                             |
| `none_root_files`      | `noneRootFiles`、`root_has_no_files`、`rootHasNoFiles`                              |
| `any_file_names`       | `anyFileNames`                                                                      |
| `all_file_names`       | `allFileNames`                                                                      |
| `none_file_names`      | `noneFileNames`                                                                     |
| `has_file_pattern`     | `hasFilePattern`，会合并到 `any_file_patterns`                                      |
| `any_file_patterns`    | `anyFilePatterns`                                                                   |
| `all_file_patterns`    | `allFilePatterns`                                                                   |
| `none_file_patterns`   | `noneFilePatterns`                                                                  |
| `any_dir_patterns`     | `anyDirPatterns`                                                                    |
| `all_dir_patterns`     | `allDirPatterns`                                                                    |
| `none_dir_patterns`    | `noneDirPatterns`                                                                   |
| `any_file_extensions`  | `anyFileExtensions`                                                                 |
| `all_file_extensions`  | `allFileExtensions`                                                                 |
| `none_file_extensions` | `noneFileExtensions`                                                                |
| `min_file_count`       | `minFileCount`                                                                      |
| `max_file_count`       | `maxFileCount`                                                                      |
| `root_entry_count_min` | `rootEntryCountMin`                                                                 |
| `root_entry_count_max` | `rootEntryCountMax`                                                                 |

> [!IMPORTANT]
> 当 `schema_version >= 5` 时，**严禁使用上述任何兼容别名字段**！引擎的运行时 Schema 校验会将别名直接作为 `error` 报错处理，并在编译阶段抛出阻断异常强行拦截，阻止规则运行。新增规则统一使用 `schema_version: 5` 和标准 `snake_case` 字段。公共规则中心保存、发布及旧规则导入时会统一升级为 v5；存量公共文档通过后台“升级公共规则到 v5”迁移，已发布内容生成新修订并保留历史和未发布草稿。旧版私人配置仍保留兼容读取。

v5 同时拒绝未知的匹配字段、命名空间条件和条件参数，不能用不支持的 `architecture` 等字段作为必要约束。`not` 不会把游戏目录不可读、路径越界或扫描失败当作“条件不存在”。

说明：

- `match` 内多个字段默认是 AND 关系。
- `any_of` 和 `any` 内部是 OR 关系，子条件仍按同一套 `match` 字段解释；`all` 是 AND 子条件组；`not` 是排除子条件组。
- `archive.*` 和 `game.*` 命名空间条件可直接写在 `install_rules[*].match` 中，也可写成 `archive` / `game` 对象命名空间。
- `archive.has_file` / `archive.has_dir` 使用 `name` 或 `names` 时递归匹配文件名或目录名；使用 `path` / `paths` / `pattern` / `patterns` 时按递归路径 glob 匹配。
- `root_has_dirs`、`root_has_files`、`any_root_dirs`、`any_root_files` 等顶层条件只读取压缩包顶层；递归文件、目录、扩展名和数量条件会按需补全递归快照。

命名空间条件：

| 写法 | 说明 |
| ---- | ---- |
| `archive.has_file` / `archive.file` / `archive.has_files` / `archive.any_files` / `archive.any_file_patterns` | 压缩包递归文件路径或文件名命中 |
| `archive.has_dir` / `archive.dir` / `archive.has_dirs` / `archive.any_dirs` / `archive.any_dir_patterns` | 压缩包递归目录路径或目录名命中 |
| `archive.root_has_file` / `archive.root_has_files` | 压缩包顶层文件必须存在 |
| `archive.root_has_dir` / `archive.root_has_dirs` | 压缩包顶层目录必须存在 |
| `archive.has_extension` / `archive.extension` / `archive.extensions` | 压缩包递归文件至少命中一种扩展名 |
| `archive.file_count` | 压缩包递归文件数量范围，支持 `min` / `gte` / `max` / `lte` |
| `archive.root_entry_count` | 压缩包顶层条目数量范围，支持 `min` / `gte` / `max` / `lte` |
| `archive.all_file_patterns` / `archive.all_files` | 压缩包递归文件路径必须全部命中 |
| `game.has_file` | 游戏目录中存在指定文件路径 |
| `game.has_dir` | 游戏目录中存在指定目录路径 |

命名空间 payload 字段：

- `archive` 文件/目录条件可用 `path` / `paths` / `pattern` / `patterns` / `include` 指定路径 glob，也可用 `name` / `names` / `entry` / `entries` 指定递归文件名或目录名。
- `archive` 扩展名条件可用 `extension` / `extensions` / `ext` / `exts`。
- `game` 条件可用 `path` / `paths` / `pattern` / `patterns`，路径相对当前游戏根目录。
- `game.has_file` / `game.has_dir` 支持 `*`、`?`、`**` glob；先定位模式的固定目录前缀，再进行受限扫描。每次查询最多扫描 20,000 个条目、32 层目录；超过预算、无有效游戏目录或遇到不可安全遍历的链接时明确失败，不将“未知”当作不存在。规则应尽量限定到 `Bin`、`Mods` 等具体目录。

### 5.4 `source` 已支持类型

| `source.type` / `source.select`                             | 说明                       | 必要字段                |
| ----------------------------------------------------------- | -------------------------- | ----------------------- |
| `package_root` / `root` / `archive_root` / `candidate_root` | 直接使用命中的候选根目录   | 无                      |
| `fixed_subdir` / `dir` / `directory` / `folder` / `subdir`  | 使用候选根目录下固定子目录 | `path`                  |
| `folder_containing`                                         | 保留命中 marker 的目录容器 | `marker` 或 `path`      |
| `file_by_extension` / `extension` / `extensions` / `ext`    | 只抽取指定扩展名文件       | `extension`             |
| `file_by_pattern` / `files` / `file` / `patterns` / `pattern` / `glob` | 按 glob 模式递归抽取文件   | `pattern`、`patterns` 或 `include` |
| `archive_file` / `download_file` / `source_file` / `package_file` | 使用原始下载文件本身作为安装源，适合 `.var` 这类原包直放格式 | 无 |

### 5.5 `source` 已支持字段

| 字段                                                                                                                              | 说明                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `type` / `source_type` / `sourceType`                                                                                             | 安装源类型                                                                                        |
| `select` / `kind` / `mode`                                                                                                        | 统一引擎支持的源选择写法，可使用 `files`、`extension`、`dir` 等简写                               |
| `path` / `source_path` / `sourcePath`                                                                                             | `fixed_subdir` 的路径                                                                             |
| `marker` / `marker_name` / `markerName` / `entry_name` / `entryName`                                                              | `folder_containing` 的 marker                                                                     |
| `marker_pattern` | 单目标 `folder_containing` 的锚点文件 glob，例如 `**/Scripts/main.lua`；只有包含该锚点的 marker 才能被选中 |
| `selection` | 单目标 marker 选择的基数：默认 `unique`，多个候选时阻止安装；`all` 明确安装全部独立单元，最多 128 个。它与表示源类型的 `select` 是不同字段 |
| `ensure_files` | 单目标 `folder_containing` 为每个单元补齐缺失文本文件，数组项为 `{ "path": "enabled.txt", "text": "" }`；已有文件原样保留。最多 32 项，每项文本不超过 64 KiB |
| `extension` / `extensions` / `ext` / `exts`                                                                                       | `file_by_extension` 的扩展名，支持省略开头的 `.`；多个扩展名会转换为多组 glob                     |
| `include` / `includes` / `pattern` / `patterns` / `file_pattern` / `filePattern` / `file_patterns` / `filePatterns`               | `file_by_pattern` 的 glob 模式，字符串或数组                                                      |
| `file_name` / `fileName` / `name`                                                                                                 | `archive_file` 物化原始下载文件时使用的文件名；未写时使用下载任务里的文件名                      |
| `preserve_candidate_dir` / `preserveCandidateDir` / `keep_candidate_dir` / `keepCandidateDir`                                     | 是否保留候选目录名                                                                                |
| `unwrap_single_root` / `unwrapSingleRoot` / `strip_single_root` / `stripSingleRoot` / `unwrap_package_root` / `unwrapPackageRoot` | 是否剥离单层外壳目录                                                                              |
| `unwrap_mode` / `unwrapMode` / `unwrap_single_root_mode`                                                                          | 剥离模式，默认 `fallback`；`strict` 表示必须成功剥离单层目录，`fallback` 表示剥不动时保留当前目录 |
| `filename_prefix_subdirs` / `filenamePrefixSubdirs` / `filename_prefix_dirs` / `filenamePrefixDirs`                               | 按文件名前缀把抽取文件重组到指定子目录，可写在 `source` 或 `target`                               |
| `filename_prefix_delimiters` / `filenamePrefixDelimiters` / `filename_prefix_separator` / `filenamePrefixSeparator`               | 文件名前缀分隔符，默认 `_`，可写字符串或数组                                                      |

说明：

- `file_by_extension` 和 `file_by_pattern` 会把命中的文件复制到临时规则根目录后再安装。
- `archive_file` 不使用解包后的文件作为安装源，而是把当前下载的原始文件复制到临时规则根目录后再安装。匹配条件仍读取解包后的候选结构，因此规则仍可以用 `match` 做安全判断。
- `source.select` 是统一引擎推荐的短写；标准 `source.type` 仍可继续使用。
- 安装源快照会拒绝符号链接 / junction；`staging` 或 `sourceRoot` 内的目录项不能通过链接指向边界外路径，命中后会以 `PATH_UNSAFE` 中止规划。
- Schema 校验会检查 `fixed_subdir.path`、`folder_containing.marker` 或 `path`、`file_by_extension.extension`、`file_by_pattern.patterns` / `include` 等必要字段。
- `file_extension` / `fileExtension` 仅旧兼容规划路径读取；新规则请使用 `extension` / `ext`。
- `folder_containing` 使用 `marker` 时，选择命中项的父目录作为单元。提供 `marker_pattern` 时绑定该文件证据；旧规则的正向文件 glob 条件也会传递命中证据，避免 `Docs/Scripts` 抢占真正的脚本目录。多个候选默认阻断，不再按目录深度或名称任取第一个；只有明确 `selection: "all"` 才安装全部。
- 所选单元互相嵌套、名称重复或文件目标冲突时阻断。单包多个单元目前共同归属于一条安装记录，作为一组启用、禁用、更新和卸载；尚不提供包内单元的独立开关或组件选择 UI。
- `ensure_files` 在引擎私有暂存区补文件，原始解包树和游戏目录不因预览而被改写。新增文件进入同一部署计划及归属账本，随模组启停、更新和卸载处理，不通过生命周期命令直接改写共享启用列表。单元源路径、目标前缀和生成文件保存在回放上下文中。
- `marker_pattern`、`ensure_files` 的路径与文本支持顶层 `${var_name}` 编译变量；生成路径必须留在单元内，禁止绝对路径、上级路径及 Windows 特殊文件名字符。这些新字段只适用于单目标 `folder_containing`；多路由继续使用既有 route 映射语义。

同包多个 UE4SS Lua 单元的规则示例：

```json
{
  "schema_version": 5,
  "install_rules": [{
    "id": "ue4ss_lua_units",
    "match": { "archive": { "has_file": { "pattern": "**/Scripts/main.lua" } } },
    "source": {
      "type": "folder_containing",
      "marker": "Scripts",
      "marker_pattern": "**/Scripts/main.lua",
      "selection": "all",
      "ensure_files": [{ "path": "enabled.txt", "text": "" }]
    },
    "target": { "type": "game_relative", "path": "Pal/Binaries/Win64/ue4ss/Mods" }
  }]
}
```

仓库 `resources/install-rules/palworld.json` 是本次真实原包验证的帕鲁手动 UE4SS 布局模板：包括完整加载器识别、默认最新依赖和 Lua 标记文件。它不是自动下发或自动覆盖已安装客户端规则的机制。Workshop、Game Pass 或多加载器共存环境需要另外的环境规则及样本验收。
- `preserve_candidate_dir` 为 `true` 时，复制结果会保留候选目录名；当候选根就是暂存根时，目录名来自当前包名。安装 UE4SS、SML 等加载器根目录时应显式设置为 `false`，避免把临时包目录名一并安装到目标目录。
- `filename_prefix_subdirs` 是兼容单目标抽取路径能力，例如把 `menu_0.bk2` 的前缀 `menu` 映射到 `Menu`，输出会变成 `Menu/menu_0.bk2`。
- 多 route 规则需要改写输出路径时，优先使用 route 的 `mapping.strip_prefix` / `replace_prefix` / `flatten`。

### 5.6 `target` 已支持类型

| `target.type`       | 说明                     | 必要字段            |
| ------------------- | ------------------------ | ------------------- |
| `game_root`         | 安装到游戏根目录         | 无                  |
| `game_relative`     | 安装到游戏根目录相对路径，`path: "."` 表示游戏根目录 | `path`              |
| `download_relative` | 安装到下载目录相对路径   | 通常建议配置 `path` |
| `user_relative`     | 安装到用户作用域相对路径 | `path`              |

说明：

- `target.type` 推荐使用 `game_root`、`game_relative`、`download_relative`、`user_relative`。
- `download_relative` 的单目标、多路由规划及预览复用统一读取客户端配置的下载目录；未配置时使用客户端默认的 `Vertex/dow` 目录。
- `user_relative` 必须写非空 `target.path`，通常配合 `base_type: "local_appdata"` 或 `base_type: "roaming_appdata"`。
- `base`、`scope`、`user_scope` 等旧写法仍兼容；新规则推荐写 `base_type`。

### 5.7 `target` 已支持字段

| 字段                                                                                                                                                       | 说明                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `type` / `target_type` / `targetType`                                                                                                                      | 安装目标类型                                                     |
| `path` / `target_path` / `targetPath`                                                                                                                      | 目标相对路径                                                     |
| `base` / `base_type` / `baseType` / `scope` / `scope_type` / `scopeType` / `user_scope` / `userScope`                                                      | 目标基准目录，常用于 `user_relative`                             |
| `usage_type` / `usageType`                                                                                                                                 | 用途类型，支持 `1`、`2`、`3`、`4`                                |
| `mark_runnable` / `markRunnable` / `runnable` / `launchable`                                                                                               | 是否标记为可运行工具                                             |
| `show_inject_button` / `showInjectButton` / `inject_button` / `injectButton`                                                                               | 是否暴露“注入启动”入口，必须显式为 `true` 才会显示               |
| `launch_action` / `launchAction` / `execute_mode` / `executeMode` / `executable_action` / `executableAction`                                               | 启动行为，可选 `inject_mod`、`default_execute`、`manual_execute` |
| `enable_executable_path` / `enableExecutablePath`                                                                                                          | 统一引擎计划里记录的可执行目标路径                               |
| `enable_executable_base_type` / `enableExecutableBaseType`                                                                                                 | `enable_executable_path` 的基准路径类型                          |
| `launch_target` / `launchTarget`                                                                                                                           | 启动目标路径，可为 `exe`、`bat`、`cmd`、`ps1`                    |
| `launch_target_base` / `launch_target_base_type` / `launchTargetBase` / `launchTargetBaseType`                                                             | `launch_target` 的基准路径类型，默认 `game`                      |
| `launch_args` / `launchArgs` / `launch_target_args` / `launchTargetArgs`                                                                                   | 启动参数，数组或单个字符串均可                                   |
| `inject_target` / `injectTarget` / `enable_target` / `enableTarget` / `enable_exe` / `enableExe` / `launch_exe` / `launchExe` / `inject_exe` / `injectExe` | 兼容旧字段，等价于 `launch_target`                               |
| `inject_target_args` / `enable_target_args` / `enable_exe_args` / `launch_exe_args` / `inject_exe_args` 及其 `camelCase` 写法                              | 兼容旧字段，等价于 `launch_args`                                 |
| `inject_target_base` / `enable_target_base` / `enable_exe_base` / `launch_exe_base` / `inject_exe_base` 及对应 `_base_type` / `camelCase` 写法             | 兼容旧字段，等价于 `launch_target_base_type`                     |
| `append_package_dir` / `appendPackageDir` / `append_archive_dir` / `appendArchiveDir`                                                                      | 下载目录安装时是否追加包目录名，默认追加                         |
| `filename_prefix_subdirs` / `filenamePrefixSubdirs` / `filename_prefix_dirs` / `filenamePrefixDirs`                                                        | 按文件名前缀映射子目录，也可写在 `source`                        |
| `filename_prefix_delimiters` / `filenamePrefixDelimiters` / `filename_prefix_separator` / `filenamePrefixSeparator`                                        | 文件名前缀分隔符，默认 `_`                                       |

说明：

- 推荐字段名使用 `target.launch_target`
- 推荐配套字段：`target.launch_action`、`target.show_inject_button`、`target.launch_args`
- 当前统一安装计划会优先输出 `enableExecutablePath`；为了兼容旧入口，规则里可继续写 `launch_target` 系列字段
- `target.base_type` 支持 `game`、`download`、`local_appdata`、`roaming_appdata`
- `user_relative` 未显式指定 `base_type` 时，默认按 `local_appdata` 解析
- `launch_target_base_type` 额外支持 `target`，表示相对当前已解析安装目标目录
- `launch_action` 兼容别名值：`inject` / `enable_exe` 等价于 `inject_mod`，`default` / `default_launch` / `auto_execute` / `auto_launch` 等价于 `default_execute`，`manual` / `run_tool` / `manual_launch` 等价于 `manual_execute`
- 只有当 `target.show_inject_button` 显式为 `true` 且 `target.launch_action` 为 `inject_mod` 时，支持顶部按钮的来源页会显示为“注入模组”，其他接入规则引擎的来源会在已安装管理中显示“注入启动”
- `launch_target` 可指向 `exe`、`bat`、`cmd`、`ps1`；启动时会按文件类型选择对应方式
- `launch_target` 默认按游戏根目录解析；如需相对已解析安装目标目录，可显式写 `launch_target_base_type: "target"`

### 5.8 生命周期动作当前支持

生命周期字段：

| 字段                           | 执行时机               |
| ------------------------------ | ---------------------- |
| `post_install` / `postInstall` | 安装文件部署完成后执行 |
| `on_enable` / `onEnable`       | 启用模组前执行         |
| `on_disable` / `onDisable`     | 禁用模组前执行         |
| `on_uninstall` / `onUninstall` | 卸载模组前执行         |

当前支持动作：

| `action`            | 说明                               |
| ------------------- | ---------------------------------- |
| `ensure_dir_exists` | 确保目录存在；未写 `path` 时使用当前已解析目标目录 |
| `remove_path`       | 删除指定路径                       |
| `remove_empty_dir`  | 删除空目录；目录非空时跳过删除     |
| `run_command`       | 执行命令或可执行文件               |
| `run_script`        | 执行脚本，当前按目标文件扩展名处理 |
| `execute`           | 与 `run_command` 同类的执行动作    |

底层安全动作表（H1 后已完整可用）：`copy_path`、`move_path`、`rename_path`、`write_text_file`、`patch_ini`、`patch_json`、`backup_path`、`ensure_dir_exists`、`remove_path`、`remove_empty_dir`。这些动作需要 `from` / `to` / `text` / `patch` / `section` / `key` 等专用字段；归一化阶段会原样透传所有专用字段（不归一化字段名，由 `lifecycleActions` 的多别名回退处理），`pathBaseResolver` 会对路径类字段做模板展开 + 边界校验，文本类字段做模板展开。新规则可放心使用。

安全动作字段表（H1 后完整支持）：

| 动作              | 必填字段                          | 可选字段                                  | 说明                                                       |
| ----------------- | --------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `copy_path`       | `from` / `source` / `source_path` | `to` / `target` / `target_path` / `path`  | 复制文件或目录，`overwrite` 默认 `true`                    |
| `move_path`       | `from` / `source`                 | `to` / `target` / `path`                  | 移动文件或目录                                             |
| `rename_path`     | `from` / `source`                 | `to` / `target` / `path`                  | 同目录内重命名（跨目录会拒绝）                             |
| `remove_path`     | -                                 | `path` / `target`                         | 删除文件或目录                                             |
| `remove_empty_dir`| -                                 | `path` / `target`                         | 仅删除空目录，非空时跳过                                   |
| `ensure_dir_exists`| -                                | `path` / `target`                         | 确保目录存在，未写 `path` 时使用当前已解析目标目录         |
| `write_text_file` | `path` / `target`                 | `text` / `content` / `value`              | 写文本文件，未提供 `text` 时写入空串                       |
| `patch_ini`       | `path` / `target` + `key`         | `section`、`value`                        | INI 文件 section merge；未写 `section` 时按无 section 处理 |
| `patch_json`      | `path` / `target`                 | `patch` / `value` / `content`（对象）     | JSON 浅合并（`{...current, ...patch}`）                    |
| `backup_path`     | `from` / `source` / `path`        | `to` / `backup` / `backup_path` / `target`| 复制源到备份目标                                           |

字段别名（每个动作都接受 camelCase 与 snake_case 两种写法）：

| 字段类别  | 别名                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| 源路径    | `from`、`source`、`source_path`、`sourcePath`                                                     |
| 目标路径  | `to`、`target`、`target_path`、`targetPath`、`path`                                                |
| 备份目标  | `to`、`backup`、`backup_path`、`backupPath`、`target`                                              |
| 文本内容  | `text`、`content`、`value`                                                                        |
| INI 段名  | `section`                                                                                         |
| INI 键名  | `key`                                                                                             |
| INI 键值  | `value`                                                                                           |
| JSON 补丁 | `patch`、`value`、`content`                                                                       |
| JSON 路径 | `json_path`、`jsonPath`（保留字段，当前实现未消费）                                                |
| 覆盖开关  | `overwrite`                                                                                       |
| 编码      | `encoding`（保留字段，当前实现固定 `utf8`）                                                       |
| 创建缺失  | `create_if_missing`、`createIfMissing`（保留字段，当前实现固定为 `true`）                          |

已支持字段（通用，所有动作都接受）：

| 字段                                                                                                                                                                                                                                            | 说明                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `action` / `type` / `name`                                                                                                                                                                                                                      | 动作名                                  |
| `path` / `relative_path` / `relativePath` / `dir` / `directory`                                                                                                                                                                                 | 动作路径或命令路径                      |
| `base` / `base_type` / `baseType` / `path_type` / `pathType` / `target_type` / `targetType`                                                                                                                                                     | 基准路径类型                            |
| `args` / `arguments` / `argv`                                                                                                                                                                                                                   | 命令参数，数组或单个字符串均可          |
| `stdin` / `input` / `inputs`                                                                                                                                                                                                                    | 自动输入内容，数组或单个字符串均可      |
| `stdin_interval_ms` / `stdinIntervalMs` / `stdin_delay_ms` / `stdinDelayMs` / `input_interval_ms` / `inputIntervalMs` / `input_delay_ms` / `inputDelayMs`                                                                                       | 多段自动输入之间的间隔，默认 `220` 毫秒 |
| `repeat` / `repeat_count` / `repeatCount` / `times`                                                                                                                                                                                             | 重复执行次数，默认 `1`                  |
| `timeout_ms` / `timeoutMs` / `timeout` / `max_wait_ms`                                                                                                                                                                                          | 单次执行超时时间，默认 `300000` 毫秒    |
| `requires_console` / `requiresConsole` / `require_console` / `requireConsole` / `console_window` / `consoleWindow` / `new_console_window` / `newConsoleWindow` / `use_console_window` / `useConsoleWindow` / `create_console` / `createConsole` | 是否需要真实 Windows 控制台窗口         |

默认语义：

- 显式写了 `base_type` 时，按声明的基准路径解释
- 未写 `base_type` 时，会回退到当前安装目标的默认基准
- `ensure_dir_exists` 保留已有目录，只记录本次实际创建的各级目录；回滚时按逆序仅删除身份未变且仍为空的目录。目录被替换或出现后续文件时保留内容并报告恢复未完成。
- `remove_empty_dir` 使用原子空目录删除，目录非空或并发出现文件时跳过；回滚只恢复本次实际删除的空目录，不覆盖后来创建的内容。这两类目录动作均不建立整目录快照。
- `game_relative` / `game_root` 目标默认回退到 `game`
- `download_relative` 目标默认回退到 `download`
- 支持的生命周期基准包括 `game`、`download`、`local_appdata`、`roaming_appdata`、`staging`、`target`
- 需要“相对已解析目标目录”时，请显式写 `base_type: "target"`
- `run_command` / `run_script` / `execute` 支持 `.bat`、`.cmd`、`.ps1`，其中 `.bat` / `.cmd` 会通过 `cmd.exe` 执行，`.ps1` 会通过 Windows PowerShell 执行
- `run_command` / `run_script` / `execute` 或执行路径扩展名为 `.exe`、`.bat`、`.cmd`、`.ps1` 时，会作为高风险生命周期动作进入用户确认流程
- `requires_console: true` 会在 Windows 新控制台中执行命令，但不支持 `stdin` 自动输入

命令动作安全约束（主进程强制执行，规则无法绕过）：

- **可执行扩展名白名单**：`run_command` / `run_script` / `execute` 只允许执行 `.bat`、`.cmd`、`.ps1`、`.exe`；其余类型（如 `.vbs`、`.js`、`.scr`、`.msi`、`.com`、无扩展名等）一律拒绝执行（错误码 `lifecycle_executable_not_allowed`）。
- **参数安全校验**：`args` / `stdin` 中包含 `NUL` 或控制字符（U+0000~U+001F）时拒绝执行（错误码 `lifecycle_command_args_unsafe`）。
- **信任 + 授权双闸门**：命令动作仅在「官方可信规则（`trust_level=official`）」或「用户对本次操作显式授权」时才允许执行；普通社区/服务器下发规则在未授权时被拒绝（错误码 `lifecycle_command_not_authorized`）。客户端用户主动发起的安装 / 启用 / 禁用 / 卸载视为已授权。
- **规则完整性校验**：规则入库时记录 `rule_checksum`（SHA-256）与 `trust_level`；读取时校验和不一致即判定被篡改，信任级别自动降级为 `community`（不可信）。
- **全局熔断开关**：设置环境变量 `VERTEX_DISABLE_LIFECYCLE_COMMANDS=1` 可一键禁用全部命令动作（错误码 `lifecycle_command_disabled`），文件类安全动作不受影响。
- **结构校验**：生命周期步骤会做结构校验——`action` 必须是受支持枚举（未知动作报 `unsupported_lifecycle_action`），`path` 必须为字符串，`args` / `stdin` 必须为数组或字符串，`repeat` / `timeout_ms` 必须为数字。
- **运行时兜底**：未知或尚未实现的动作会抛出 `unsupported_lifecycle_action` 并阻断当前生命周期阶段，不会静默跳过；如果此前已有动作成功执行，会先按 LIFO 逆序回滚可自动回滚的动作，再保留原始错误。
- 说明：完整的加密签名密钥体系（官方规则签名与公钥分发）为后续硬化项；当前以「默认禁用 + 白名单 + 信任分级/校验和 + 逐次授权」实现首道防线。

生命周期字符串模板：

| 模板                                | 说明                   |
| ----------------------------------- | ---------------------- |
| `{game_root}` / `{game_path}`       | 当前游戏根目录         |
| `{target_root}` / `{target_path}`   | 当前已解析安装目标目录 |
| `{staging_root}` / `{staging_path}` | 当前安装暂存源目录     |

模板可用于 `path`、`args`、`stdin`。生命周期路径会做边界校验，不能越过对应基准目录。

## 6. 已废弃的历史规则入口

旧版顶层规则入口已不再参与编译迁移，也不会被运行时匹配。请把可执行安装逻辑直接写到 `install_rules` 中：单目标规则写 `source` / `target`，多目标规则写 `routes`。

已安装模组在启用、禁用、卸载时，仍会使用安装时保存的命中规则、目标路径、部署文件和生命周期动作，不会因为规则文档更新而重新匹配。

## 7. `install_rules[*].routes` 多 route 安装规则

`install_rules[*].routes` 用于一个压缩包需要同时安装到多个目标位置的场景。命中后会生成统一 `InstallPlan`，其中 `operations` 仍是旧任务中心可读取的合并部署列表，同时新增 `routes`、`routeOperations`、`coverageLedger` 和 `coverageSummary`。

推荐写法：

```json
{
  "schema_version": 5,
  "install_rules": [
    {
      "id": "mixed_package",
      "priority": 800,
      "match": {
        "any": [
          {
            "archive.has_file": {
              "patterns": ["**/*.pak"]
            }
          },
          {
            "archive.has_dir": {
              "patterns": ["Pal/Binaries/Win64/Mods/*"]
            }
          }
        ]
      },
      "routes": []
    }
  ]
}
```

`install_rules[*]` 多 route 字段：

| 字段                                                            | 类型     | 说明                                                             |
| --------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `id`                                                            | `string` | 规则 ID                                                          |
| `priority`                                                      | `number` | 规则排序，数值越大越先规划                                       |
| `match`                                                         | `object` | 命中条件                                                         |
| `routes`                                                        | `array`  | 多路安装路线                                                     |
| `confidence` / `weight`                                         | `number` | 规则置信度；同优先级时数值越大越先规划                           |
| `dependencies` / `default_dependencies` / `defaultDependencies` | `array`  | 规则依赖，会进入依赖求解                                         |
| `coverage_policy` / `coveragePolicy`                            | `object` | 覆盖策略声明；当前未匹配条目会进入解释信息并要求确认             |
| `conflict_policy` / `conflictPolicy`                            | `string` | 规则级默认冲突策略：`overwrite` / `skip` / `fail` / `backup`（默认）；route 可覆盖；`merge` 为保留值但不支持 |
| 生命周期字段                                                    | `array`  | 与旧 `install_rules` 生命周期一致                                |

`routes[*]` 字段：

| 字段                                                                                                                                                                        | 类型      | 说明                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `id`                                                                                                                                                                        | `string`  | route ID                                                                |
| `when` / `match`                                                                                                                                                            | `object`  | 可选 route 条件；不写时继承父规则命中结果                               |
| `source.include` / `source.includes` / `source.pattern` / `source.patterns` / `source.file_pattern` / `source.filePattern` / `source.file_patterns` / `source.filePatterns` | `array`   | 要接住的源路径 glob                                                     |
| `source.exclude` / `source.excludes` / `source.ignore` / `source.ignores`                                                                                                   | `array`   | 显式忽略的源路径 glob，命中后账本标记 `ignored`                         |
| `source.case_sensitive` / `source.caseSensitive`                                                                                                                            | `boolean` | route 源路径匹配是否区分大小写                                          |
| `target.type`                                                                                                                                                               | `string`  | 支持 `game_relative`、`game_root`、`download_relative`、`user_relative` |
| `target.path`                                                                                                                                                               | `string`  | route 安装目标相对路径                                                  |
| `target.base` / `target.base_type` / `target.baseType` / `target.scope` / `target.scope_type` / `target.scopeType` / `target.user_scope` / `target.userScope`               | `string`  | route 目标基准，常用于 `user_relative`                                  |
| `mapping`                                                                                                                                                                   | `object`  | 路径映射规则                                                            |
| `group`                                                                                                                                                                     | `object`  | 文件组规则，当前支持 `type: "unreal_pak"` / `type: "unreal_iostore"`    |
| `conflict_policy` / `conflictPolicy`                                                                                                                                        | `string`  | route 级冲突策略，覆盖规则默认；取值同规则级                            |
| `health_expectations`                                                                                                                                                       | `object`  | route 级健康检查期望                                                    |

### 冲突策略 conflict_policy

`conflict_policy` 决定「目标文件已存在」时的处理方式，可写在 `install_rules[*]`（规则默认）或 `routes[*]`（覆盖规则默认）。取值与执行语义：

| 策略             | changeSet 动作 | 是否备份 | 冲突级别 | 说明                                  |
| ---------------- | -------------- | -------- | -------- | ------------------------------------- |
| `backup`（默认） | `overwrite`    | 是       | warning  | 覆盖前备份并提示确认；等价历史默认行为 |
| `overwrite`      | `overwrite`    | 否       | warning  | 直接覆盖、不备份                       |
| `skip`           | `skip`         | 否       | none     | 目标已存在则跳过，不计冲突             |
| `fail`           | `fail`         | 否       | blocker  | 目标已存在即阻断安装                   |

未声明时按 `backup` 处理；route 未声明时继承规则默认。仅对「目标文件已存在」生效，新增文件（`add`）与同哈希跳过（`skip_same_hash`）不受影响。

Vertex 2.0.0 支持的冲突策略只有 `overwrite`、`skip`、`fail`、`backup`。`merge` 是已识别但未支持的保留值，使用时会报 `merge_policy_not_supported` 并阻断安装，不会自动降级为 `backup` 或 `overwrite`。当前版本没有实现通用 INI/JSON 文件内容合并；生命周期中的显式 `patch_ini` / `patch_json` 是独立、受限的补丁动作，不等于 `conflict_policy=merge`。

`mapping` 字段：

| 字段                                        | 说明                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `strip_prefix` / `stripPrefix`              | 从源相对路径剥离前缀                                            |
| `replace_prefix` / `replacePrefix`          | 将源路径前缀替换为新前缀，支持 `{ "from": "...", "to": "..." }`；对象内 `source` / `match` 等价于 `from`，`target` / `with` 等价于 `to` |
| `replace_prefix_from` / `replacePrefixFrom` | `replace_prefix` 的 `from` 拆分写法                             |
| `replace_prefix_to` / `replacePrefixTo`     | `replace_prefix` 的 `to` 拆分写法                               |
| `flatten`                                   | 只保留文件名，拍平目录                                          |
| `preserve_container` / `preserveContainer`  | 保留 `strip_prefix` 后剩余路径中的容器结构；与 `flatten` 同写时优先保留容器 |
| `append_package_dir` / `appendPackageDir`   | 在映射结果前追加压缩包目录名                                    |
| `case_sensitive` / `caseSensitive`          | 是否按大小写敏感匹配                                            |

`group` 字段：

| 字段                                   | 说明                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `type` / `kind`                        | 当前支持 `unreal_pak`、`unreal_iostore`                                                      |
| `require_siblings` / `requireSiblings` | 写 `true` 时，`.pak`、`.ucas`、`.utoc` 需要成组出现；缺少配套文件会标记为 `group_incomplete` |

`health_expectations` 字段：

| 字段 | 说明 |
| ---- | ---- |
| `required_files` / `requiredFiles` | route 完成后必须存在的文件 |
| `required_dirs` / `requiredDirs` | route 完成后必须存在的目录 |
| `optional_files` / `optionalFiles` | 可选记录文件 |
| `recordRequired` | 写 `false` 时不强制记录 route 自动生成的 required 项 |

多 route 说明：

- 父规则直接写 `match`；route 可以写 `when` / `match`，route 不写条件时继承父规则命中结果。
- route 不写 `source.include` 时默认只接住文件；需要保留目录结构时建议写明确 glob。
- route 数组内所有字符串值都会参与 `${var_name}` 变量展开，包括 `source`、`target`、`mapping`、`group` 和 `health_expectations`。
- 同一个多 route 计划内暂不支持跨目标边界混合安装，例如同一条规则同时写 `game_relative` 和 `user_relative`。
- 多个 route 映射到同一目标路径时会进入 `conflict`，自动安装会被阻断或要求用户确认。
- `coverageSummary.unmatchedCount` 大于 `0` 时会要求用户确认，避免压缩包里有未被规则接住的内容。

覆盖账本状态：

| 状态                 | 说明                   |
| -------------------- | ---------------------- |
| `installed`          | 已进入部署计划         |
| `ignored`            | 被 route 显式忽略      |
| `unmatched`          | 没有 route 接住        |
| `conflict`           | route 目标冲突         |
| `unsafe`             | 源路径或映射目标不安全 |
| `duplicate`          | 重复命中，已合并或跳过 |
| `dependency_pending` | 依赖未满足             |
| `group_incomplete`   | 文件组缺少配套文件     |

Palworld 混合包示例：

```json
{
  "install_rules": [
    {
      "id": "palworld_mixed_package",
      "match": {
        "any_file_patterns": ["Pal/Content/Paks/LogicMods/**/*.pak", "Pal/Binaries/Win64/Mods/**"]
      },
      "routes": [
        {
          "id": "pal_logicmods_files",
          "source": {
            "include": ["Pal/Content/Paks/LogicMods/**/*.pak"]
          },
          "target": {
            "type": "game_relative",
            "path": "Pal/Content/Paks/LogicMods"
          },
          "mapping": {
            "strip_prefix": "Pal/Content/Paks/LogicMods"
          }
        },
        {
          "id": "pal_legacy_ue4ss_mods",
          "source": {
            "include": ["Pal/Binaries/Win64/Mods/**"]
          },
          "target": {
            "type": "game_relative",
            "path": "Pal/Binaries/Win64/ue4ss/Mods"
          },
          "mapping": {
            "strip_prefix": "Pal/Binaries/Win64/Mods",
            "preserve_container": true
          }
        }
      ]
    }
  ]
}
```

## 8. 最小完整示例

```json
{
  "schema_version": 5,
  "game_detect": {
    "select": {
      "strategy": "highest_confidence"
    },
    "candidates": [
      {
        "name": "stellar_blade_steam",
        "type": "exe_search",
        "confidence": 100,
        "markers": {
          "all_files": ["SB.exe"]
        },
        "root_from": {
          "type": "exe_dir",
          "up": 0
        }
      }
    ]
  },
  "install_rules": [
    {
      "id": "sb_pak_mod_auto",
      "name": "基础 Pak 模组",
      "priority": 401,
      "match": {
        "any_file_extensions": [".pak"]
      },
      "source": {
        "type": "file_by_extension",
        "extension": ".pak"
      },
      "target": {
        "type": "game_relative",
        "path": "SB/Content/Paks/~mods"
      },
      "post_install": [
        {
          "action": "ensure_dir_exists",
          "path": "SB/Content/Paks/~mods"
        }
      ]
    }
  ]
}
```

## 9. 常见写法

### 9.1 标准游戏根目录包

```json
{
  "match": {
    "root_has_dirs": ["SB"]
  },
  "source": {
    "type": "package_root"
  },
  "target": {
    "type": "game_root"
  }
}
```

### 9.2 固定子目录安装

```json
{
  "match": {
    "root_has_dirs": ["Data"]
  },
  "source": {
    "type": "fixed_subdir",
    "path": "Data"
  },
  "target": {
    "type": "game_relative",
    "path": "SB/Content"
  }
}
```

### 9.3 按扩展名抽取文件

```json
{
  "match": {
    "any_file_extensions": [".bk2"]
  },
  "source": {
    "type": "file_by_extension",
    "extension": ".bk2"
  },
  "target": {
    "type": "game_relative",
    "path": "SB/Content/Movies"
  }
}
```

### 9.4 Unreal Engine 用户配置目录包

```json
{
  "match": {
    "any_file_names": [
      "Engine.ini",
      "Game.ini",
      "Input.ini",
      "Scalability.ini",
      "GameUserSettings.ini"
    ]
  },
  "source": {
    "type": "package_root"
  },
  "target": {
    "type": "user_relative",
    "base_type": "local_appdata",
    "path": "b1/Saved/Config/Windows"
  }
}
```

说明：

- `local_appdata` 表示当前用户的 `%LOCALAPPDATA%`
- 上例会落到类似 `C:/Users/yuqikzz/AppData/Local/b1/Saved/Config/Windows`

### 9.5 使用顶层变量减少重复路径

```json
{
  "variables": {
    "game_root_name": "b1",
    "win64_dir": "Binaries/Win64",
    "user_config_dir": "Saved/Config/Windows",
    "full_user_config_dir": "${game_root_name}/${user_config_dir}"
  },
  "game_detect": {
    "candidates": [
      {
        "exe_globs": ["${game_root_name}/${win64_dir}/*.exe"]
      }
    ]
  },
  "install_rules": [
    {
      "match": {
        "any_file_names": ["Engine.ini", "Game.ini", "Input.ini"]
      },
      "source": {
        "type": "package_root"
      },
      "target": {
        "type": "user_relative",
        "base_type": "local_appdata",
        "path": "${full_user_config_dir}"
      }
    }
  ]
}
```

### 9.6 自动匹配完整根目录包

当规则里声明了：

```json
{
  "variables": {
    "game_dir": "Pal"
  }
}
```

且压缩包结构是：

```text
Pal/
  Content/
  Binaries/
```

则无需再手写一条 `root_has_dirs: ["Pal"]` 的规则。系统会自动追加一条根目录匹配规则：

```json
{
  "match": {
    "root_has_dirs": ["Pal"]
  },
  "source": {
    "type": "package_root"
  },
  "target": {
    "type": "game_root",
    "path": "."
  },
  "priority": 100
}
```

如果你已经手写了更高优先级的特殊规则，例如脚本模组、资源模组、工具包规则，那么这些规则仍然会优先生效。

### 9.7 指定规则引擎注入启动 EXE

如果某个模组安装完成后，不应该直接点“启动游戏”，而是应该优先启动某个注入器或加载器 EXE，可以这样写：

```json
{
  "match": {
    "any_file_extensions": [".pak", ".ucas", ".utoc"]
  },
  "source": {
    "type": "package_root",
    "unwrap_single_root": true
  },
  "target": {
    "type": "game_relative",
    "path": "${paks_dir}",
    "launch_action": "inject_mod",
    "show_inject_button": true,
    "enable_executable_path": "${win64_dir}/SimpleModMenuInjector.exe",
    "enable_executable_base_type": "game",
    "launch_target": "${win64_dir}/SimpleModMenuInjector.exe"
  }
}
```

语义说明：

- `enable_executable_path` / `launch_target` 只影响规则引擎接入来源的启动目标，不影响安装路径本身
- 只有当 `show_inject_button: true` 时，支持顶部按钮的来源页才会显示为“注入模组”，其他来源会在已安装管理中显示“注入启动”
- 点击后会启动 `${win64_dir}/SimpleModMenuInjector.exe`
- Nexus 顶部按钮遇到多个已启用注入记录时，会优先使用第一条已启用记录对应的路径；Mod.io 等管理列表入口按当前模组记录启动

### 9.8 生命周期脚本

如果某个模组需要在安装后创建目录，并在启用前运行脚本，可以这样写：

```json
{
  "match": {
    "any_file_extensions": [".pak"]
  },
  "source": {
    "type": "package_root"
  },
  "target": {
    "type": "game_relative",
    "path": "Content/Paks/~mods"
  },
  "post_install": [
    {
      "action": "ensure_dir_exists",
      "base_type": "target",
      "path": "."
    }
  ],
  "on_enable": [
    {
      "action": "run_script",
      "base_type": "game",
      "path": "Binaries/Win64/EnableMod.bat",
      "args": ["{target_root}"],
      "timeout_ms": 120000
    }
  ],
  "on_disable": [
    {
      "action": "run_command",
      "base_type": "game",
      "path": "Binaries/Win64/DisableMod.exe",
      "args": ["--target", "{target_root}"]
    }
  ]
}
```

语义说明：

- `post_install` 会在安装部署完成后执行
- `on_enable` 会在启用模组前执行，脚本成功后才继续部署
- `on_disable` 会在禁用模组前执行，命令成功后才继续取消部署
- `{target_root}` 会替换为当前安装目标目录

### 9.9 VAM-Hub `.var` 原包安装

VAM-Hub 的 `.var` 文件需要把原始下载包直接放到 VaM 的 `AddonPackages` 目录，不应把 `.var` 内部内容解包后复制出去。规则可以这样写：

```json
{
  "schema_version": 5,
  "game_detect": {
    "select": {
      "strategy": "highest_confidence"
    },
    "candidates": [
      {
        "id": "vam_root",
        "confidence": 90,
        "exe_globs": ["VaM.exe", "VaM_Updater.exe"],
        "root_from": {
          "up": 0
        },
        "markers": {
          "any_dirs": ["AddonPackages"]
        }
      }
    ]
  },
  "install_rules": [
    {
      "id": "vamhub_var_archive_file",
      "match": {
        "min_file_count": 1
      },
      "source": {
        "type": "archive_file"
      },
      "target": {
        "type": "game_relative",
        "path": "AddonPackages"
      }
    }
  ]
}
```

语义说明：

- VAM-Hub 页面提交标准来源安装任务，规则匹配、游戏目录识别和最终安装都由统一安装引擎处理。
- `archive_file` 会把当前下载的 `.var` 原文件物化为安装源，再按 `target` 复制到 `AddonPackages`。
- `match` 仍读取解包后的暂存结构；如果包内容不满足规则条件，安装不会绕过统一匹配直接落盘。

<!-- vertex-agent-only:start -->
## 10. 统一安装规划器字段

InstallPlan 版本仍为 4，与规则 JSON 的 schema 版本不同。

当前运行时只启用统一安装引擎。运行时主入口是编译后的 `install_rules`。命中后都会输出统一 `InstallPlan`，任务中心和已安装管理会读取同一套计划字段。统一引擎未命中时不会回退旧引擎。

### 10.1 规划解释

安装计划会包含：

```json
{
  "planner": {
    "mode": "unified_single_target",
    "version": "3.0.0",
    "fallbackUsed": false
  },
  "explain": {
    "mode": "unified_single_target",
    "matchedRuleId": "pak_mod",
    "score": 92,
    "checkedRules": [],
    "matchedSignals": [],
    "missedReasons": []
  }
}
```

字段语义：

- `planner.mode`：规划模式，常见值为 `unified_single_target`、`unified_multi_route`
- `explain.matchedRuleId`：最终命中的规则 ID
- `explain.checkedRules`：参与评分的候选规则摘要
- `explain.matchedSignals`：命中的压缩包或游戏目录信号
- `missedReasons`：未命中规则的原因列表，规则中心可用于修正规则

### 10.2 变更集与冲突

安装计划会包含：

```json
{
  "changeSet": {
    "summary": {
      "addCount": 3,
      "overwriteCount": 1,
      "backupRequiredCount": 1
    },
    "entries": []
  },
  "conflictResult": {
    "level": "warning",
    "requiresUserConfirm": true,
    "blockInstall": false,
    "conflicts": [],
    "warnings": []
  }
}
```

语义说明：

- `addCount` 表示新增文件数
- `overwriteCount` 表示覆盖文件数
- `backupRequiredCount` 表示需要备份的文件数
- `conflictResult.level` 可为 `none`、`warning`、`blocker`
- `blockInstall: true` 会阻断自动安装
- 目标路径越界和高风险占用会进入冲突诊断

### 10.3 事务、回滚与部署策略

安装计划会包含：

```json
{
  "transactionPlan": {
    "transactionId": "install_tx_xxx",
    "rollbackPolicy": "backup",
    "rollbackAvailable": true,
    "backupRequired": true
  },
  "deployStrategy": {
    "preferred": "hardlink",
    "actual": "symlink",
    "fallbackReasons": [
      {
        "from": "hardlink",
        "to": "symlink",
        "reason": "源目录与目标目录不在同一盘符，不能使用硬链接"
      }
    ]
  }
}
```

语义说明：

- `rollbackPolicy` 可为 `none`、`manifest`、`backup`、`manual`、`blocked`
- 存在覆盖文件时优先使用 `backup`
- 新增文件为主时可使用 `manifest`
- 普通资源文件部署优先级为同盘符硬链接、符号链接、复制；`.ini/.cfg/.json/.toml/.yaml/.yml/.xml/.txt` 配置及文本文件采用独立复制。协调时会将仍与暂存源共享文件的旧配置链接拆为独立文件，保留当前内容并恢复源文件保护；资源硬链接发生内容漂移时保留现场并阻断，需重新下载后更新。
- 普通增量协调复用未变化的已锁定清单及目标文件校验结果，只写入变化的账本行。同一配置文件的归属、源路径及计划哈希未变时，增量和完整重建均保留游戏及配置字段写入的内容；完整重建仍重新扫描、校验资源文件。仍有字段归属或未完成配置事务的文件不能被整文件替换或删除，须先禁用相关模组。路径、大小、修改时间、变更时间或文件身份变化时不复用资源文件校验结果。
- 每次降级到下一级部署方式时，都会在 `fallbackReasons` 记录上一级不可用原因
- 任务中心会展示事务 ID、回滚策略、部署方式和降级原因

统一部署以归一化目标绝对路径区分文件归属和备份；同一游戏、端点和部署域的文件写入跨来源排队。文件变更前记录恢复意图，账本和提交状态一起提交；中断后重试恢复，发现用户修改时保留文件并返回 `needRecovery`，不能把恢复未完成当作成功。备份清理只处理超过 7 天且没有活跃引用的终态会话，旧版无日志目录保留。

生命周期 `.bat/.cmd` 路径和参数必须使用字面值，拒绝 cmd 特殊字符（如 `& | < > ^ % !` 和双引号）；普通可执行程序仍接收独立参数。命令授权必须明确提供，超时终止 Windows 进程树，错误输出最多保留每路末尾 64 KiB。外部命令的副作用不能据此视为可自动撤销。

授权清单与执行层共用命令解析：展示实际程序（含 cmd/PowerShell 解释器）、展开后的参数、工作目录、重复次数及是否打开控制台。离线 `.vxpack` 使用流式 ZIP64 读写及 SHA-256 校验，包和条目原有上限保持不变；JSON 元数据最多 16 MiB，重复路径、链接条目和导出期间变化的源文件会被拒绝，失败不会覆盖原导出文件。

### 10.4 依赖与包类型适配

原生规划器会识别常见包结构并输出：

```json
{
  "packageProfile": {
    "type": "bepinex",
    "adapter": "bepInEx",
    "confidence": 92,
    "signals": [],
    "suggestedTarget": ".",
    "provides": ["bepinex"]
  },
  "dependencyResult": {
    "status": "resolved",
    "required": [],
    "optional": [],
    "conflicts": [],
    "missing": []
  }
}
```

第一批包类型识别：

- `bepinex`：识别 `BepInEx/plugins`、`BepInEx/patchers`
- `melonloader`：识别 `Mods`、`MelonLoader/Mods`
- `ue4ss`：识别 `UE4SS-settings.ini`、`UE4SS`、注入 DLL
- `unreal_pak`：识别 `.pak`、`.ucas`、`.utoc`
- `smapi`：识别 SMAPI `manifest.json`
- `thunderstore`：识别 `thunderstore.toml` 或 Thunderstore `manifest.json`

### 10.5 健康检查与回放

安装计划会包含：

```json
{
  "healthExpectations": {
    "requiredFiles": [],
    "requiredDirs": []
  },
  "replaySnapshot": {
    "archiveStructureSummary": {},
    "ruleVersion": 1,
    "plannerVersion": 2
  }
}
```

语义说明：

- `healthExpectations` 用于安装后验证关键文件和目录是否落地
- `replaySnapshot` 用于失败样本回放，验证规则修复是否让同一结构重新命中
- 规则问题上报会附带规划解释、未命中原因、冲突结果和回放快照

## 智能体的证据、选择与续跑

失败任务从 `vertex.install.failure_diagnose` 开始，按返回的 `jobId/itemId` 复用下载产物进行 `vertex.install.archive.inspect`，避免重复下载。诊断的 `readyToRetry=false` 表示尚有未修复阻塞；`recoverable` 只表示可以处理，并不等于原样重试会成功。

ZIP 包类型检查在 64 MiB 包、2000 条目和累计 1 MiB CT 内容预算内识别纯 Cheat Engine 表及说明文件，必须验证 `.CT` 内容的 `CheatTable` 根标记。结果 `packageSupport.supported=false` / `install_engine.external_tool_package` 对应 `unsupported_package`：禁止生成复制规则或部署，保留下载文件，说明外部工具用途。混合包、未知类型与超预算结果不据此判为不可安装，仍需结构与作者证据。

规则未命中时先核对结构和作者说明，提出当前模组范围的修正，用 `vertex.install.rule.match_preview` 验证，再按既有配置确认、安装预检和任务控制流程处理。不得把仅修改提示词、生成规则草案或预演通过称为安装修复完成；不得未获确认覆盖整款游戏的通用规则。

嵌套 ZIP 可用 `archive.inspect` 的 `nestedPath` 相对路径数组显式逐层读取，例如 `["bundle.zip", "plugins.zip"]`；后续目录分页和文本读取必须保留相同数组。证据读取最多三层、内层累计 64 MiB 和总计 50000 条目，校验 CRC，不执行或写出包内容。实际安装仍使用规则的 `nested_archives` 和统一引擎自身预算。

`vertex.install.archive.inspect` 支持 `offset/limit` 分页目录，ZIP 文本用 `entryPath/textOffset/textLimit` 定向读取；按返回的 `nextOffset` 续读，不从首屏推断整个包。`archiveRef` 保留包身份并隔离会话、游戏和配置档案；文件变化后重新检查。已下载包可通过 `jobId/itemId` 引用，无需传递本地绝对路径。定向读取限 64 MiB ZIP、1 MiB 文本和每页 8000 字符，RAR/7z 保留原生结构检查。

`vertex.install.rule.match_preview` 在临时副本中运行统一引擎，支持普通、模板和声明式规则；`mappings` 按 `offset/maxResults` 分页。返回 `selectionRequest` 时集中收集组件偏好，并用其真实 `binding` 和 `selected` 重新预演；不可伪造绑定值。`inspect_plan` 可通过同会话 `agentTaskId`、`installChoices` 和 `archiveRef` 重新预检。已创建任务通过 `control_task` 的 `retry` 动作提交 `componentSelections: {itemId:{binding,selected}}`，沿用任务中心的校验和事务。

预检失败不能提交；`execute_plan.accepted` 仅表示入队。`task_detail` 返回分页任务项、组件请求和健康检查，只有任务完成且 `verified=true` 才能报告写后核验通过；不能据此声称游戏内加载正常。授权由主进程绑定实际计划或已安装模组；同一目标与操作复用适用授权，`full_auto` 自动执行明确目标，范围变化重新裁决。脚本、回滚及批量破坏性动作保留各自确认规则。
<!-- vertex-agent-only:end -->
