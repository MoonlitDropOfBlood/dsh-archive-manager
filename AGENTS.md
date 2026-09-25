# AGENTS.md — dsh-archive-manager

面向 AI agent 与协作者的开发指南。**读这里再动手**，尤其"关键机制"和"重要注意事项"，记录了本项目踩过的大量坑。

## 项目是什么

一个 **DeepSeek Harness（DSH）双面（Host + Client）插件**：在 DSH Web UI 里管理已归档会话。

**双版本自适应（特性检测，非版本号，详见 §7）：**

- **DSH < 0.1.7**：侧栏底部（Cordis Plugin 与设置之间）一个"归档"按钮，点击弹出归档管理面板——本文件主要描述的经典形态。
- **DSH ≥ 0.1.7**：DSH 自带归档管理（侧栏"仅显示已归档"筛选 + 行内归档/取消归档操作），本插件**只补它缺少的删除**：归档行 "…" 菜单多一行"删除会话…"（danger 红行）+ 行尾悬停多一个 🗑 按钮 → 弹永久删除二次确认框；**不显示**自己的面板按钮。

经典形态（< 0.1.7）的功能：

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
├── cordis.patch.yml      # dsh bundle patch（挂载行）
├── verify-constructor.mjs   # npm run verify ①：Host 构造 + Remote 标记
├── verify-typert-compat.mjs # npm run verify ②：双版本 typert 线格式（驱动真实 0.1.5/0.1.7 校验器）
├── verify-client-apply.mjs  # npm run verify ③：client apply 冒烟（三个槽位注入 + 现代模式注册）
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

### 5. 标准安装 = dsh bundle（package.json 声明 + 包内 cordis.patch.yml）

DSH 插件通过 **cordis composition** 挂载。本插件是**标准 DSH bundle**：`package.json` 的 `dsh.bundle.patch` 指向包内 `cordis.patch.yml`，用官方 `dsh plugin` 命令安装：

1. `dsh plugin --profile web add <本地路径或包>`：pnpm 把插件装成 profile 的 npm 依赖（本地路径走 `link:` 软链，改代码即生效），并把包名追加到 profile `package.json` 的 `dsh.profile.bundles`。`client-modules` 的 baseUrl 是 profile 目录，从这里 `require.resolve`。
2. 启动时 DSH 应用包内 `cordis.patch.yml` 的 `- insert:` 行挂载插件（**不要**再在 profile 的 `cordis.patch.yml` 里手工插一行，否则同一 id 重复挂载；也不要对不存在的 id 用普通 `- id:` 覆盖，会报 "entry not found"）：

```yaml
# cordis.patch.yml（随包分发）
- insert:
  - id: archive-manager
    name: '@duke-dsh-plugins/dsh-archive-manager'
```

3. 重启 DSH（`node <dsh bin> web --profile web`）。**必须重启**，Host 加载、typert 注册、client bundle 注入都在启动时发生。
4. 卸载：`dsh plugin --profile web remove dsh-archive-manager`（自动从 bundles 列表移除）。

### 6. 删除会话的实现要点

- **定位**：`sessionPersistence.locate(header)` → `{ path }`（会话日志目录，含 `session.jsonl.zstd` 及 `.bak`）。
- **删除**：直接用 `node:fs/promises` 的 `rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })`，再用 `existsSync` 验证。**跨平台**（Windows / macOS / Linux 行为一致），不拼任何 shell 命令。
  - 历史上的 Windows-only 实现是通过 `shell` 服务拼 PowerShell（`Remove-Item` + `Test-Path`），并以 `sandboxPolicy: danger-full-access` 提升绕过沙箱——已废弃。composition 插件跑在 DSH 主进程内、自带完整 Node 权限，直接 `fs` 调用与当年的 `danger-full-access` 等效，且不再依赖 shell 服务 / pwsh 是否存在。
  - `maxRetries` 用来吸收 Windows 上的瞬时文件锁（杀软 / 索引器），其他平台是 no-op。
- **ghost 检测（`state`）**：逐条 `existsSync(locate(header).path)`——live 但日志目录不存在 → ghost。原来也是拼 PowerShell 批量 `Test-Path`，同样已换成 `node:fs`。
- **正在运行**：只有 `agent.status === "running"` 才拒绝删除；`sessions.get(id)` 非空只表示"打开着"，允许删（idle 会话删日志后保留归档条目，作为 ghost，重启后彻底消失，避免在侧栏"复活"）。
- **还原**：通过 `workspaceRegistry.setState({ ...state, archivedSessionIds: next })` 写回归档集合——一次调用同时持久化、同步 registry 缓存、并触发 `domain/changed` → 客户端 `host/archived-sessions-changed` 自动刷新。不要直接改 `~/.dsh/storages/workspace.json`（会绕过内存缓存导致不一致）。

### 7. DSH 0.1.7 版本适配（双版本线格式 + 特性检测）

0.1.7 有两个独立的破坏面，对应两套解法：

**(a) Typert 线格式变更——插件在 0.1.7 上彻底不工作的根因。**

严格 codec 的必填字段换名了（两处校验、两个方向）：

| 版本 | Host manifest（typert-loader `requireStrictCodec` + typert-registry `validateCodec`） | Client contribution（浏览器侧 typert-registry `validateCodec`） |
|---|---|---|
| DSH < 0.1.7 | 必须有 `codec.schema`：zod v4 **实例**（`"_zod" in schema` + `parse` 函数），运行时 `codec.schema.parse(v)` | 必须有 `codec.schema.parse` |
| DSH ≥ 0.1.7 | 必须有 `codec.create`：**工厂函数**（否则报 `strict codec has no create() factory`），运行时 `codec.create().parse(v)`；`schema` 字段被完全忽略 | 必须有 `codec.create`（同样报 "has no create() factory"） |

解法 = **双字段 codec**，`typert.host.js` 与 `client.js` 的 CLIENT_REMOTE 都一样：

```js
// typert.host.js
function lazy(build) { let value; return () => (value ??= build()); }
const restoreRequestSchema = lazy(() => z.object({ sessionId: sessionIdSchema() }));
// 一个 codec 同时带两个字段，各自版本只校验自己那半，另一半当不存在：
codec: { mode: "strict", typeSymbol: "...", schema: restoreRequestSchema(), create: restoreRequestSchema }
```

- client 侧不能 require zod，passthrough 同样出两份：`{ parse: (v) => v }` 实例 + 工厂。
- `TYPERT.schemas[]` 同规则（0.1.7 要求每项 `create`）；本插件保持 `schemas: []`，两版都过。
- `Remote` 装饰器 / `TypertRemoteService` / cordis `[Service.init]` / 六个注入服务（workspaceRegistry、storageDomain、sessionPersistence、sessionQuery、sessions、agents）/ `locate` / `setState` / `listSessions` 在 0.1.7 全部保持兼容——**Host 半 `index.js` 无需改动**。
- 校验改没改，`npm run verify` 会拿**真实安装里的校验器**跑（见下），别靠肉眼。

**(b) 0.1.7 自带归档管理——UI 按特性检测分双模式。**

- **检测信号**：0.1.7 的 ui-workspace 在注册内置归档浏览区时，通过 `children` 声明 `sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action` 两个列表槽。`ctx.slots.inject(key, cb)` 对**未声明的 key 永远不触发**（等声明，不抛错——`dsh-client-ui-renderer` 的声明感知实现），于是：
  - 注册这两个 inject，回调里 `markModern()` + `ctx.slots.register(...)` 注入删除入口；
  - < 0.1.7 上两个回调永不执行 → 现代 UI 完全不存在、`modernStore` 保持 false → 侧栏按钮/面板照旧（= 维持现状）；
  - ≥ 0.1.7 上回调在 ui-workspace 注册时执行 → `modernStore` 翻 true → footer 渲染器改道（不渲染按钮，只按 `deleteStore` 渲染确认框），同时 `legacyStyleTag.textContent = ""` 永久撤掉 `[class*="footerActions"]` 列排 CSS，不干扰 0.1.7 自己的页脚布局。
- **不要用版本号**：版本字符串客户端拿不到、也不覆盖 0.1.6-alpha 之类的中间形态；槽位声明与内置归档管理**同源同现**，是唯一可靠的信号。
- **删除入口**（都只对"已归档且非 ghost"的行渲染，判定走 `GlobalStandardProps.useWorkspaces`——每个槽组件都有的全局标准 hook，旧版页脚同样靠它）：
  - `menu.item` order 450：ui-primitives `MenuItemButton`（`danger` + `separatorBefore`），选中后 `setMenuOpen(false)` 再弹框；无 primitives 时退回 `role="menuitem"` 原生按钮。
  - `row.action` order 300：28×28 图标按钮（对齐 ui-workspace 自家 `iconButton` 尺寸），Tooltip 包裹。
  - 两者都只 `deleteStore.set({sessionId, displayTitle})`，确认框统一由 footer 槽渲染（层级结论与 §注意事项第一条相同：foot 槽的 fixed 层才能压过 better-sidebar）。
- **ui-primitives 用 try/catch require**：`require("@deepseek-ai/dsh-client-ui-primitives")` 在 apply 里做，拿不到就 `ui = null` 走 fallback；它的消费组件只在 0.1.7 槽位存在时才会渲染，所以旧版拿不到也无影响。
- **ghost/错误反馈**：确认框里失败原因内联展示（运行中拦截、文件锁）；删完但 `live=true` 转为"重启后清除"提示再关闭——语义与旧面板一致。

## 开发 / 验证

```bash
npm run check     # node --check index.js client.js typert.host.js
npm run verify    # 三连：verify-constructor + verify-typert-compat + verify-client-apply
dsh plugin --profile web add /path/to/dsh-archive-manager   # 安装/重装到本机 DSH profile
```

`verify-typert-compat.mjs` 分两层：永远跑**复制自两个版本源码的规则**（§7(a) 那张表）；发现真实 DSH 安装时再用**安装里的 `validateTypertManifest` 和 `TypertRegistry` 本尊**把 host manifest 和 client contribution 各过一遍。真实安装探测顺序：`DSH_INSTALL_015` / `DSH_INSTALL_017` 环境变量 → 本机默认 DSH 安装目录（0.1.5）→ 仓库内 `.tmppkg/v017/`（`npm pack @deepseek-ai/*@0.1.7-rc.2` 解包出来的 0.1.7 包；`.tmppkg/`、`.npm-cache/` 已 gitignore）。缺席的安装会记 skip，不计失败。

改插件后**必须重启 DSH 进程**才生效（动态 HMR 不适用于正式安装的插件）。按版本分别验证：

**DSH < 0.1.7：**
1. 侧栏底部出现"归档"按钮（Cordis Plugin 下方、设置上方）。
2. 点开面板，按项目分组、更新时间倒序、搜索正常。
3. 还原 / 删除 / 无效记录清理 / ghost 提示正常。

**DSH ≥ 0.1.7：**
1. 侧栏底部**不再**出现"归档"按钮（内置归档管理接管）。
2. 归档筛选视图里，行尾悬停出现 🗑、"…" 菜单出现"删除会话…"红行（非归档行不出现）。
3. 删除走二次确认框：取消 / Esc / 失败原因 / ghost 提示 / 成功后行消失都正常。

## 发布

打 `v1.0.0` 标签推送到 GitHub，`.github/workflows/release.yml` 会自动构建 `npm pack` 产物并发布为 GitHub Release（需要 `GH_TOKEN` secret，权限 `contents:write`）。

## 常规注意事项

- **弹窗层级（z-index / stacking context）**：全屏弹窗**不要**注册到 `shell.overlay` 槽。AppFrame 把 `shell.overlay` 渲染在 `.overlayLayer`（`position:absolute; z-index:20`）内，该层形成独立 stacking context，子元素的 z-index 被锁死在其下；dsh-better-sidebar 会把整层 append 到 `document.body`（`position:fixed; z-index:25`），因此 `shell.overlay` 里的弹窗会被它盖住。**照抄 ui-settings 的做法**：把 `position:fixed; inset:0; z-index:1000` 的遮罩从侧栏 foot 槽（`sidebar.settings` / `sidebar.footer.action`）渲染——侧栏列不构成 stacking context，fixed 层直接参与根 stacking context，压过 better-sidebar 的 25。DSH 生态约定：shell overlay = 20、better-sidebar = 25、ui-cordis 动态插件面板 = 30、应用弹层（菜单/tooltip/modal）= 100+。
- **不要直接编辑 `~/.dsh/profiles/web/cordis.yml`**（那是生成的文件，patch 覆盖在 `cordis.patch.yml`）。
- `cordis.patch.yml` 顶层是一个 patch 数组：`- insert:` 用于新增行，`- id:` 用于覆盖已有行。
- `client.js` 用 `require("react")`（bundle 的模块表提供），**不要** `import` 或动态插件的 `styles`/`host` 全局。
- 删除是**永久性**的（日志文件不可恢复），UI 里已加二次确认。
