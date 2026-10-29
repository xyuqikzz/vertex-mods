# 原生模块构建

客户端普通构建使用 `resources/node/` 中已随源码分发的 Windows x64 二进制。
需要修改或重建原生模块时，使用独立仓库：https://gitee.com/YuQiKzz/vertex-node-api 。

本次核对的原生仓库提交为 `f28493839a7ea4d84152eaf24b396fa8fca5bf15`，仓库工作区无未提交修改。
这记录了源码检查基线，不表示已经验证该提交能逐字节重现当前二进制。

1. 安装匹配项目要求的 Node.js、Python 3 和 Visual Studio C++ 构建工具，目标平台选择 Windows x64。
2. 克隆原生仓库并检出维护者确认的对应版本，在其中执行 `npm ci` 和 `npm run build`。
3. 默认将两个仓库并排放置，原生目录名为 `vertex-node-api`；也可用环境变量 `VERTEX_NODE_API_ROOT` 指定源码目录。
4. 回到客户端，先运行 `node scripts/sync-node-api.cjs --check`。确认版本与能力匹配后执行 `npm run sync:napi`。
5. 构建客户端后，在隔离临时目录核验原生导出能力、解压、哈希和历史加载回退；构建成功不代表这些运行路径已验证。

发布新原生产物时，应一并记录源码提交、工具链版本及文件 SHA-256；源码和二进制必须对应。
重建验证必须在隔离目录进行，不能为了测试替换正在使用的游戏 DLL 或其他应用文件。
