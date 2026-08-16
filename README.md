<p align="center">
  <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" color="#4D6BFE"><rect x="1.5" y="2" width="11" height="3.5" rx="0.8"/><path d="M2.5 5.5v5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-5"/><path d="M5.5 8h3"/></svg>
</p>

<h3 align="center">DeepSeek Harness 归档管理插件</h3>

<p align="center">
  <img src="https://img.shields.io/badge/DSH-Plugin-4D6BFE?style=flat" alt="DSH plugin">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Web%20UI-Yes-22C55E?style=flat" alt="Web UI">
</p>

<p align="center"><sub>中文</sub></p>

---

为 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) Web UI 打造的**归档管理**插件：把已归档的会话重新变得可见、可管理。

归档后消失在侧栏的会话，在这里统一呈现——**按项目分组、按更新时间倒序、支持搜索**，并且每个归档都能**一键还原**或**永久删除**。

## 功能

| 功能 | 说明 |
|---|---|
| 📂 按项目分组 | 归档会话按工作区（项目）分组，含"未分组"桶 |
| ⏱ 更新时间倒序 | 每个项目组内按最新更新时间从新到旧 |
| 🔍 搜索 | 按会话标题 / 项目名实时过滤 |
| ♻️ 还原 | 从归档集合移除，会话回到侧栏项目原位 |
| 🗑️ 删除 | 永久删除会话日志 + 移除归档记录；二次确认；运行中的智能体会拦截 |
| 🧹 无效记录清理 | "日志已不存在"的残留归档记录单独分组，可一键清理 |
| 👻 已删会话提示 | 已删除但仍驻留内存的会话自动隐藏，提示重启后彻底清除 |
| 🌗 主题适配 | 全部使用 DSH 设计 token，明暗主题自动跟随 |

## 安装

### 本地安装

```bash
# 1. 克隆本仓库
git clone git@github.com:MoonlitDropOfBlood/dsh-archive-manager.git
cd dsh-archive-manager

# 2. 安装到本机 DSH profile（复制插件包 + 写入 cordis.patch.yml）
node scripts/install.mjs

# 3. 重启 DSH（命令行：node <dsh bin> web --profile web）
```

重启后，侧栏底部（Cordis Plugin 下方、设置上方）会出现"归档"按钮。

> 需要插件能在 profile 的 `node_modules` 解析到依赖（`zod`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-storage-domain`）。若本机 DSH 未提供这些依赖，先在插件目录 `npm install`，再手动把 `node_modules` 一并复制，或把插件作为依赖加入 profile。

### 手动安装（原理）

1. 将插件包放入 `<DSH_HOME>/profiles/web/node_modules/dsh-archive-manager/`。
2. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
  - id: archive-manager
    name: 'dsh-archive-manager'
```

3. 重启 DSH。

## 使用

1. 点侧栏底部的 **🗂 归档** 按钮（带归档数量）。
2. 面板按项目列出所有归档会话：
   - **还原**：会话回到侧栏对应项目下。
   - **删除**：点一下变"确认删除?"，再点一次才真正删除（永久，不可恢复）。
   - **无效的归档记录**：日志已不存在的残留，点删除清理记录。
3. 顶部搜索框可实时过滤。

## 工作原理

```
DSH Web UI
  └─ client.js (window.__ModuleLoader__.load bundle)
       └─ ctx.remote.archiveManager.{restore|delete|state}   ← Remote 调用
            └─ index.js (ArchiveManagerService, TypertRemoteService)
                 ├─ restore: workspaceRegistry.setState(移除归档) → 侧栏复原
                 ├─ delete : 拒绝 running agent → Remove-Item 删日志 → 移除归档
                 └─ state  : 检测"live 但日志已删"的 ghost 会话
```

## 目录结构

```
dsh-archive-manager/
├── index.js            # Host 半：ArchiveManagerService（Remote 服务）
├── client.js           # Client 半：归档管理 UI bundle
├── typert.host.js      # Typert Host manifest（Remote 方法描述）
├── scripts/install.mjs # 本地安装脚本
├── .github/workflows/  # GitHub Actions 发布
├── AGENTS.md           # 面向 AI agent 的开发指南（含踩坑）
└── LICENSE             # MIT
```

## 开发

```bash
node --check index.js
node --check client.js
node --check typert.host.js
```

详见 [AGENTS.md](AGENTS.md)——记录了 DSH 正式插件（Host/Client/Typert 三件套）的完整机制和踩坑。

## License

本项目遵循 [MIT License](LICENSE)。

> 本项目是基于 DeepSeek Harness 构建的社区插件，并非 DeepSeek 官方产品。
