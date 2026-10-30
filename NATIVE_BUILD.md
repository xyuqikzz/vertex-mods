# 原生模块源码与构建

## 公开源码

Vertex Node API 已在 GitHub 公开：[xyuqikzz/vertex-node-api](https://github.com/xyuqikzz/vertex-node-api)。自有 C++ 实现与 Node.js 封装采用 **GPL-3.0-only**；第三方组件保留各自许可。

本次发布源码快照：[ec242b6](https://github.com/xyuqikzz/vertex-node-api/tree/ec242b6b4d3b489bb1c973cbd2dcdd83b12d0983)，来自维护者指定的原生项目，原始基线为 `5565d6e77c252c86e76bd319426375e5e78f6757`。构建配置、依赖锁文件、许可和构建说明均随源码提供。

`resources/node/` 包含两类文件：

| 文件 | 来源与说明 |
| --- | --- |
| `file_api*.node`、`process_api.node`、`system_api*.node` | Vertex 原生扩展；公开源码与当前随包版本的差异见下文 |
| `7z.exe`、`7z.dll` | 7-Zip 26.00，由 `7zip-bin-full` 提供；[上游源码](https://github.com/ip7z/7zip/releases/download/26.00/7z2600-src.tar.xz)与 [许可原文](./resources/licenses/7-Zip-26.00-LICENSE.txt) |

## 当前兼容性边界

客户端普通构建继续使用已随仓库分发的 Windows x64 二进制，不会自动编译或替换它们。

**公开源码目前不是客户端现有二进制的完整匹配版本，不能直接覆盖 `resources/node/`。** 2026-10-30 核对发现：

- 客户端 `file_api_v3.node` / `file_api.node` 还提供 `generateFileSHA256`、`generateFileSHA256Async`、`buildManifest`、`copyPath`、`deployFile`、`removePath`、`protectModSource`、`restoreModSource`、`validateModSourceReadable`、`repairModSourceAccess`；本次公开源码尚无这些导出。
- 客户端 `process_api.node` 还提供 `launchElevated`；本次公开源码尚无此导出。
- 原生项目仅构建 `file_api`、`process_api`、`system_api`，不生成客户端同步脚本要求的 `file_api_v3.node`。不能仅靠改名绕过检查。
- 两侧 `7z.exe`、`7z.dll` 的文件内容已核对一致；这不能证明 `.node` 文件对应或功能等价。

源码公开、编译成功、接口兼容、实际运行通过和逐字节复现是不同验收阶段。当前尚未建立客户端全部 `.node` 文件与公开源码的对应关系。

## 独立构建源码

需要 Windows x64、Node.js、Python 3，以及 Visual Studio 2022 C++ Build Tools 和 Windows SDK。依赖以原生仓库锁文件为准。

```powershell
git clone https://github.com/xyuqikzz/vertex-node-api.git
cd vertex-node-api
git checkout ec242b6b4d3b489bb1c973cbd2dcdd83b12d0983
npm ci --ignore-scripts
npm run build
```

`npm ci --ignore-scripts` 安装锁定依赖但不触发隐式编译，随后显式构建。产物在 `dist/file/`、`dist/process/`、`dist/system/`，许可原文在 `dist/licenses/`。构建只更新原生仓库的输出目录，不操作客户端或游戏文件。

本次本机验证使用 Node.js 26.7.0、Python 3.13.2 和 Visual Studio 2026：依赖安装、JavaScript 语法、许可原文及凭据扫描通过；node-gyp 11.5.0 未能识别 VS 2026，构建在工具链发现阶段失败，未完成编译、客户端加载与功能验收。请使用上述兼容工具链，不将此次发布理解为构建验证通过。

## 后续接入客户端

只有补齐当前客户端要求的能力并确认源码版本后，才进入以下流程：

1. 将两个仓库并排放置，原生目录名为 `vertex-node-api`；其他布局通过 `VERTEX_NODE_API_ROOT` 指定原生源码根目录，避免误用另一份旧源码。
2. 核对目标架构、导出函数、版本命名和 Node-API 加载能力，在隔离目录验证解压、哈希、部署、卸载及提权等受影响路径。
3. 在客户端执行 `node scripts/sync-node-api.cjs --check`。当前公开版本缺少所需版本产物，检查失败时应停止，不能复制旧版本或重命名文件冒充。
4. 检查通过且已确认对应关系后，再执行 `npm run sync:napi`，核对源文件和客户端目标文件 SHA-256，重新构建并验证客户端。

发布新原生产物时记录源码提交、工具链版本和文件 SHA-256。重建及验证使用隔离目录，不替换正在使用的游戏 DLL 或其他应用文件。
