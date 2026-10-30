# 第三方项目与许可边界

Vertex 自有代码采用根目录的 GNU GPL 第 3 版许可证（仅第 3 版，`GPL-3.0-only`）。第三方代码、二进制、字体和其他素材保留原作者的权利及各自许可与声明；分发组合后的程序时仍须满足适用的许可证兼容性与对应源码要求。

## 随附工具及改编代码

| 项目 | 使用范围 | 许可及来源 |
| --- | --- | --- |
| DepotDownloader 3.4.0 | 独立进程执行 Steam 授权和工坊下载；Vertex 增加私有会话管道及授权入口 | GPL-2.0；原文、修改说明、完整对应源码及哈希位于 `resources/workshop/`；上游 https://github.com/SteamRE/DepotDownloader |
| aria2 1.37.0 | 独立下载进程 | GPL-2.0-or-later 及上游 OpenSSL 例外；见 `resources/licenses/aria2-1.37.0-*`；上游 https://github.com/aria2/aria2/tree/release-1.37.0 ，对应源码 https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0.tar.xz |
| 7-Zip 26.00 | 归档读取与提取 | LGPL-2.1-or-later、部分 BSD 代码及 unRAR 限制；见 `resources/licenses/7-Zip-26.00-LICENSE.txt`；上游 https://github.com/ip7z/7zip/tree/26.00 ，对应源码 https://github.com/ip7z/7zip/releases/download/26.00/7z2600-src.tar.xz |
| DLSS5-Swapper | 改编其部分实现以接入 Vertex 的 Vue、IPC、任务与文件管理 | MIT，Copyright (c) 2026 Rakan Alkhaldi；原文及上游第三方说明位于 `resources/licenses/DLSS5-Swapper-*`；来源、版本及修改记录见 `src/main/services/dlss/swapper/upstream.json` |

上表中的源码链接应与分发版本一起保留。维护者分发 GPL/LGPL 工具时仍需落实相应的完整对应源码提供方式；上游主页链接或本索引本身不能替代该义务。

## npm 与 Electron

`resources/licenses/npm-third-party-notices.txt` 汇总锁定依赖实际安装包附带的版权、许可证和 NOTICE 原文，
`npm-license-inventory.json` 登记包名、版本及来源。构建工具会在打包前重新生成，避免渲染进程打包或 Markdown 排除规则丢失许可文本。

该清单包含当前构建平台的应用依赖和开发工具。包内缺少许可全文的条目会明确标识，需结合上游材料核对。
Electron/Chromium 发行物自带的 `LICENSE` 和 `LICENSES.chromium.html` 同样应随发行物保留。

## 图形与字体素材

- `src/renderer/src/assets/font/AlimamaFangYuanTiVF-Thin.woff2` 是阿里妈妈方圆体，保留其独立许可，不因 Vertex 的代码许可证而重新授权。官方入口：https://www.iconfont.cn/fonts 。当前尚待补齐与本文件对应的官方授权原文。
- Vertex 标志与 Nono 桌宠包含第三方素材。维护者正在补充原作者、来源和授权范围；在确认前，根目录许可证不对这些素材提供额外授权。
- 发布前应逐项核实其他图标、游戏图片、第三方运行库及其许可，不从“免费商用”或项目根许可证推定所有素材均可任意再分发。

## 原生模块

Vertex Node API 源码已公开于 [GitHub](https://github.com/xyuqikzz/vertex-node-api)，自有代码采用 GPL-3.0-only。当前公开快照尚不包含客户端随附 `.node` 的全部接口，不能作为这些二进制已完成源码对应验证的声明；版本差异、工具链限制和接入条件见 [NATIVE_BUILD.md](./NATIVE_BUILD.md)。第三方 7-Zip 文件采用上文所列许可。
