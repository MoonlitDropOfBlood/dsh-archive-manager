# AGENTS.md — dsh-archive-manager

面向 AI agent 与协作者的开发指南。**读这里再动手**，尤其"关键机制"和"重要注意事项"，记录了本项目踩过的大量坑。

## 项目是什么

一个 **DeepSeek Harness（DSH）双面（Host + Client）插件**：在 DSH Web UI 里管理已归档会话。

- 侧栏底部（Cordis Plugin 与设置之间）一个"归档"按钮，点击弹出归档管理面板。
- 按**项目（工作区）分组**展示归档会话，组内按**最新更新时间倒序**。
- 支持**搜索**（标题 / 项目名）。
- 每个归档可**还原**（回到侧栏项目原位）或**删除**（永久删除日志 + 移除归档记录，二次确认，运行中的智能体会拦截）。
- 自动识别"日志已不存在的无效归档记录"和"已删除但仍驻留内存的 ghost 会话"，保持计数准确。

## 目录结构

```
dsh-archive-manager/
├── package.json          # ESM 双面包：dsh.client: {platform:"web"} + exports(., /client, /typert, /package.json)
├── index.js              # Host 半：ArchiveManagerService（TypertRemoteService 子类，类插件）
├── client.js             # Client 半：window.__ModuleLoader__.load bundle（Slot UI + Remote 调用）
├── typert.host.js        # Typert Host manifest：archiveManager Remote 服务的 schema/调用描述
├── scripts/install.mjs   # 本地安装脚本：复制到 profile + 写入 patch
├── .github/workflows/release.yml  # 打 v* 标签时构建并发布 GitHub Release
├── AGENTS.md             # 本文件
├── README.md
└── LICENSE               # MIT
```

## 关键机制

### 1. DSH 正式插件 = 三件套（Host / Client / Typert）

一个"正式"（非动态运行时）DSH 插件需要**三个文件协作**，缺一不可：

| 文件 | 作用 | 被谁加载 |
|---|---|---|
| `index.js` | Host 半：Cordis **类插件**（导出 Service 类），注册 `archiveManager` 服务 | cordis loader（composition `insert` 行） |
| `client.js` | Client 半：浏览器 UI bundle | `client-modules`（扫描 `dsh.client` 声明 → 注入 `window.__DSH_BOOT__`） |
| `typert.host.js` | 描述 `archiveManager` 服务的 Remote 方法（wire schema / invocation） | `typert-loader`（扫描包的 `./typert` 导出） |

三者的**关键名字必须一致**：
- `index.js` 导出的类名 → `ArchiveManagerService`
- `typert.host.js` 的 `model.services[].key` / `exportName` → `archiveManager` / `ArchiveManagerService`
- `client.js` 的 `inject: ["remote.archiveManager"]` 与 `ctx.remote.archiveManager.*`
- `package.json` 的 `exports`：`"."`、`"./client"`、`"./typert"`、`"./package.json"`（**必须**有 `./package.json`，否则 `require.resolve("<pkg>/package.json")` 失败）

### 2. Host 半：类插件 + Remote 方法

cordis 的 loader 会把**导出的 Service 类**当作"类插件"：`isConstructor(callback)` 为真时 `new callback(ctx, config)` 实例化，再调用 `[Service.init]()`。所以 Host 半**不要导出插件对象 `{apply}`**，而是：

```js
export class ArchiveManagerService extends TypertRemoteService {
  static inject = ["workspaceRegistry", "storageDomain", "sessionPersistence", "sessionQuery", "sessions", "agents"];
  [Service.init]() {
    markRemoteMethod(this, "restore", "restore");
    markRemoteMethod(this, "delete", "delete");
    markRemoteMethod(this, "state", "state");
  }
  async restore(request) { ... }
  async delete(request) { ... }
  async state() { ... }
}
```

`TypertRemoteService` 来自 `@deepseek-ai/dsh-typert-protocol`，构造函数会 `ctx.reflect.provide(name, this)` 注册服务。

### 3. Remote 标记不能直接用装饰器语法

**Node ESM 不支持 Stage 3 装饰器**（`@Remote("x")` 直接写会 `SyntaxError: Invalid or unexpected token`）。DSH 官方包（如 `dsh-message-feedback`）是 **TypeScript 编译产物**（`__esDecorate` helpers），但我们手写 JS 不能用。

解决：**手动驱动装饰器**。`Remote(name)` 实际返回一个装饰器函数，接受 `(method, context)`，其中 context 需提供 `kind/name/static/private/addInitializer`。手动构造 context 并执行注册的 initializer：

```js
function markRemoteMethod(instance, method, exportName) {
  const decorator = Remote(method, undefined);
  const initializers = [];
  decorator(undefined, {
    kind: "method", name: method, static: false, private: false,
    addInitializer: (fn) => initializers.push(fn),
  });
  for (const fn of initializers) fn.call(instance);
}
```

在 `[Service.init]()`（构造后、发布前）对每个方法调用它即可。

### 4. Client 半：bundle 格式

Client 半必须是 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` 格式（否则报 "loaded without registering via __ModuleLoader__.load"）：

```js
window.__ModuleLoader__.load({
  id: "dsh-archive-manager",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    const React = require("react");
    function apply(ctx) { ... }
    exports.apply = apply;
    exports.inject = ["slots", "remote", "remote.archiveManager"];
    return module.exports;
  }
});
```

要点：
- `exports.inject` 声明依赖：`["slots", "remote", "remote.archiveManager"]`。用 `ctx.slots` 必须声明 `"slots"`；用 `ctx.remote.archiveManager` 必须声明 `"remote.archiveManager"`，否则 "cannot get property x without inject"。
- **CSS 注入**用 `document.createElement("style")`（动态插件的 `styles.insert` 在这里不存在），并 `ctx.effect(() => () => styleTag.remove())` 清理。
- **调用 Host**：`ctx.remote.archiveManager.restore({ sessionId })` 返回 `{ ok, value|error }`。
- 样式一律用 DSH 主题变量（`--dsw-alias-*`、`--dsw-specific-*`、`--dsw-shadow-lv2` 等），自动适配明暗主题。

### 5. 本地安装 = 复制包 + composition patch

DSH 插件通过 **cordis composition** 挂载，流程（`scripts/install.mjs` 自动做）：

1. 把插件包复制到 `<DSH_HOME>/profiles/web/node_modules/dsh-archive-manager/`（`client-modules` 的 baseUrl 是 profile 目录，从这里 `require.resolve`）。
2. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 里 **`- insert:`** 新增行（**不要**用普通 `- id:` 覆盖，新 id 会报 "entry not found"）：

```yaml
- insert:
  - id: archive-manager
    name: 'dsh-archive-manager'
```

3. 重启 DSH（`node <dsh bin> web --profile web`）。**必须重启**，Host 加载、typert 注册、client bundle 注入都在启动时发生。

### 6. 删除会话的实现要点

- **定位**：`sessionPersistence.locate(header)` → `{ path }`（会话日志目录，含 `session.jsonl.zstd` 及 `.bak`）。
- **删除**：直接用 `node:fs/promises` 的 `rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })`，再用 `existsSync` 验证。**跨平台**（Windows / macOS / Linux 行为一致），不拼任何 shell 命令。
  - 历史上的 Windows-only 实现是通过 `shell` 服务拼 PowerShell（`Remove-Item` + `Test-Path`），并以 `sandboxPolicy: danger-full-access` 提升绕过沙箱——已废弃。composition 插件跑在 DSH 主进程内、自带完整 Node 权限，直接 `fs` 调用与当年的 `danger-full-access` 等效，且不再依赖 shell 服务 / pwsh 是否存在。
  - `maxRetries` 用来吸收 Windows 上的瞬时文件锁（杀软 / 索引器），其他平台是 no-op。
- **ghost 检测（`state`）**：逐条 `existsSync(locate(header).path)`——live 但日志目录不存在 → ghost。原来也是拼 PowerShell 批量 `Test-Path`，同样已换成 `node:fs`。
- **正在运行**：只有 `agent.status === "running"` 才拒绝删除；`sessions.get(id)` 非空只表示"打开着"，允许删（idle 会话删日志后保留归档条目，作为 ghost，重启后彻底消失，避免在侧栏"复活"）。
- **还原**：通过 `workspaceRegistry.setState({ ...state, archivedSessionIds: next })` 写回归档集合——一次调用同时持久化、同步 registry 缓存、并触发 `domain/changed` → 客户端 `host/archived-sessions-changed` 自动刷新。不要直接改 `~/.dsh/storages/workspace.json`（会绕过内存缓存导致不一致）。

## 开发 / 验证

```bash
node --check index.js        # 语法检查
node --check client.js
node --check typert.host.js
node scripts/install.mjs     # 安装到本机 DSH profile
```

改插件后**必须重启 DSH 进程**才生效（动态 HMR 不适用于正式安装的插件）。验证：
1. 侧栏底部出现"归档"按钮（Cordis Plugin 下方、设置上方）。
2. 点开面板，按项目分组、更新时间倒序、搜索正常。
3. 还原 / 删除 / 无效记录清理 / ghost 提示正常。

## 发布

打 `v1.0.0` 标签推送到 GitHub，`.github/workflows/release.yml` 会自动构建 `npm pack` 产物并发布为 GitHub Release（需要 `GH_TOKEN` secret，权限 `contents:write`）。

## 常规注意事项

- **不要直接编辑 `~/.dsh/profiles/web/cordis.yml`**（那是生成的文件，patch 覆盖在 `cordis.patch.yml`）。
- `cordis.patch.yml` 顶层是一个 patch 数组：`- insert:` 用于新增行，`- id:` 用于覆盖已有行。
- `client.js` 用 `require("react")`（bundle 的模块表提供），**不要** `import` 或动态插件的 `styles`/`host` 全局。
- 删除是**永久性**的（日志文件不可恢复），UI 里已加二次确认。
