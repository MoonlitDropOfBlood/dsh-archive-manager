/**
 * dsh-archive-manager — Client half (web bundle).
 *
 * Rendered by the DSH web shell via `window.__ModuleLoader__.load`. Registers:
 *   - a sidebar footer action button (archived-session entry),
 *   - a frame-wide archive manager panel (search / group / restore / delete).
 *
 * The panel mirrors the DSH 工作区 (workspace) browsing region: a dialog
 * surface using the same design tokens as the workspace browser — folder
 * group headers, compact 32px session rows with a leading slot icon and
 * relative time, and hover-revealed actions (workspace rowActions pattern).
 *
 * Host communication goes through the `archiveManager` Remote namespace
 * (`ctx.remote.archiveManager.restore/delete/state`), published by the Host
 * half in `index.js`.
 */
window.__ModuleLoader__.load({
  id: "dsh-archive-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    // ---- CSS (package-owned, mirrors the DSH workspace browser + Modal) ----
    const CSS = `
[class*="footerActions"]{flex-direction:column;align-items:center;}

/* Overlay — same mask surface as DSH Modal */
.am-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;}

/* Panel — same surface & size as the DSH Settings dialog (width 800px) */
.am-panel{position:relative;display:flex;flex-direction:column;width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px);overflow:hidden;border:1px solid var(--dsw-alias-border-inverted,rgba(128,128,128,.3));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:var(--dsw-shadow-lv3,0 12px 40px rgba(0,0,0,.25));}

/* Header — DSH Modal header */
.am-header{display:flex;align-items:center;gap:10px;padding:18px 14px 10px 24px;}
.am-title{font-weight:500;font-size:16px;line-height:24px;flex:1;color:var(--dsw-alias-label-primary,inherit);}
.am-count{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit);flex:none;}
.am-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,inherit);padding:0;}
.am-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,inherit);}

/* Search — workspace expanded search input */
.am-search{padding:0 24px 12px;}
.am-search input{box-sizing:border-box;width:100%;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:18px;outline:none;}
.am-search input::placeholder{color:var(--dsw-alias-label-tertiary,inherit);}
.am-search input:focus{border-color:var(--dsw-alias-brand-primary,#4a7dff);}

/* Body — workspace list area */
.am-body{flex:1;overflow-y:auto;padding:4px 8px 16px;overscroll-behavior:contain;}

/* Group sections, spaced like workspace group sections */
.am-group{margin-top:2px;}
.am-group+.am-group{margin-top:4px;}

/* Group head — workspace project row (folder + label + count), clickable + collapsible */
.am-group-head{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:34px;width:100%;padding:0 8px;border-radius:8px;border:none;background:transparent;color:inherit;font-family:inherit;font-size:inherit;text-align:left;cursor:pointer;}
.am-group-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));}
.am-chevron{flex:none;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,inherit);transition:transform .15s var(--ds-ease-in-out);}
.am-chevron.am-open{transform:rotate(90deg);}
.am-group-icon{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,inherit);}
.am-group-label{flex:1;min-width:0;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.am-group-count{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,inherit);}

/* Session row — workspace session row (32px, radius 8, hover bg), indented under its group */
.am-row{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 32px;border-radius:8px;color:var(--dsw-alias-label-primary,inherit);}
.am-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));}
.am-slot{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,inherit);}
.am-title{flex:1;min-width:0;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.am-time{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,inherit);}
.am-row-actions{flex:none;display:none;align-items:center;gap:2px;}
.am-row:hover .am-time{display:none;}
.am-row:hover .am-row-actions{display:inline-flex;}

/* Action buttons — subtle text buttons, hover-revealed like workspace rowActions */
.am-btn{border:none;background:transparent;font-size:12px;line-height:18px;padding:4px 8px;border-radius:8px;cursor:pointer;white-space:nowrap;}
.am-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}
.am-btn-restore{color:var(--dsw-alias-brand-primary,#4a7dff);}
.am-btn-danger{color:var(--dsw-alias-state-error-primary,#e5484d);}
.am-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.1));}
.am-btn[disabled]{opacity:.5;cursor:default;}

/* Orphan rows (log gone) */
.am-orphan .am-slot{color:var(--dsw-alias-state-warn-primary,#d99a06);}
.am-orphan .am-title{color:var(--dsw-alias-label-secondary,inherit);}

/* Empty / error / ghost — workspace empty style */
.am-empty{color:var(--dsw-alias-label-tertiary,inherit);padding:16px 12px;font-size:13px;line-height:20px;text-align:center;}
.am-error{color:var(--dsw-alias-state-error-primary,#e5484d);padding:8px 24px;font-size:12px;line-height:18px;}
.am-ghost{color:var(--dsw-alias-label-secondary,inherit);padding:8px 24px;font-size:12px;line-height:18px;}

/* Sidebar footer entry (unchanged) */
.am-foot-layer{flex:none;width:100%;margin:8px 0 0;display:flex;align-items:center;}
.am-foot-layer .am-foot{width:100%;height:49px;border-radius:12px;padding:0 8px 0 6px;display:inline-flex;align-items:center;gap:8px;background:transparent;border:none;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;cursor:pointer;overflow:hidden;}
.am-foot-layer .am-foot:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));}
.am-foot-layer .am-foot.am-active{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));}
.am-foot-layer .am-foot .am-foot-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;}
.am-foot-layer .am-foot .am-foot-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;}
.am-foot-layer .am-foot .am-badge{color:var(--dsw-alias-label-tertiary,inherit);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px;}
.am-foot-layer.am-foot-rail{width:36px;height:36px;margin:0;}
.am-foot-layer.am-foot-rail .am-foot{width:36px;height:36px;padding:0;justify-content:center;border-radius:10px;}
`;

    // ---- Client Remote contribution ----------------------------------------
    // The browser-side `remote.archiveManager` service only exists after this
    // module mounts its namespace via ctx.remote.$mount(): dsh-api-remotes'
    // client assembly mounts only the five official namespaces, so a plugin
    // must mount its own. Mirrors the invocations in typert.host.js (ids,
    // service/namespace/method, wire fields). zod is not requirable in the
    // browser module loader, so codecs use passthrough schemas — the runtime
    // contract only requires typeSymbol + schema.parse().
    const passthrough = () => ({ parse: (v) => v });
    const CLIENT_REMOTE = {
      package: "dsh-archive-manager",
      descriptors: [
        {
          id: "dsh-archive-manager#archiveManager/restore",
          service: "archiveManager",
          namespace: "archiveManager",
          method: "restore",
          invocation: { kind: "direct" },
          parameters: [
            {
              name: "request",
              wire: "request",
              source: "json",
              codec: { mode: "strict", typeSymbol: "dsh-archive-manager#ArchiveManagerRestoreRequest", schema: passthrough() },
            },
          ],
          result: { mode: "strict", typeSymbol: "dsh-archive-manager#ArchiveManagerRestoreResult", schema: passthrough() },
        },
        {
          id: "dsh-archive-manager#archiveManager/delete",
          service: "archiveManager",
          namespace: "archiveManager",
          method: "delete",
          invocation: { kind: "direct" },
          parameters: [
            {
              name: "request",
              wire: "request",
              source: "json",
              codec: { mode: "strict", typeSymbol: "dsh-archive-manager#ArchiveManagerDeleteRequest", schema: passthrough() },
            },
          ],
          result: { mode: "strict", typeSymbol: "dsh-archive-manager#ArchiveManagerDeleteResult", schema: passthrough() },
        },
        {
          id: "dsh-archive-manager#archiveManager/state",
          service: "archiveManager",
          namespace: "archiveManager",
          method: "state",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "dsh-archive-manager#ArchiveManagerStateResult", schema: passthrough() },
        },
      ],
    };

    async function apply(ctx) {
      // Mount the archiveManager namespace before anything touches it; the
      // mount's lifetime is bound to this plugin's context by $mount itself.
      await ctx.remote.$mount(CLIENT_REMOTE);

      const styleTag = document.createElement("style");
      styleTag.textContent = CSS;
      document.head.appendChild(styleTag);
      ctx.effect(() => () => styleTag.remove());

      // ctx.get() reads the service without the property-accessor inject
      // guard; it exists because the $mount above just created it.
      const remote = ctx.get("remote.archiveManager");

      // Shared open state between the footer button and the overlay.
      let open = false;
      const listeners = new Set();
      function getOpen() { return open; }
      function setOpen(v) { if (open !== v) { open = v; for (const fn of listeners) fn(); } }
      function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
      function useOpen() { return React.useSyncExternalStore(subscribe, getOpen); }

      // Ghost state (deleted-but-resident archived sessions), shared by both components.
      const ghostStore = (() => {
        let ids = [];
        const listeners = new Set();
        return {
          getSnapshot: () => ids,
          subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
          set: (next) => { ids = next; for (const fn of listeners) fn(); },
        };
      })();
      function useGhostIds() { return React.useSyncExternalStore(ghostStore.subscribe, ghostStore.getSnapshot); }
      async function refreshState() {
        try {
          const res = await remote.state();
          ghostStore.set(res && res.ok && Array.isArray(res.value.ghostIds) ? res.value.ghostIds : []);
        } catch {
          ghostStore.set([]);
        }
      }

      function ArchiveIcon() {
        return React.createElement(
          "svg",
          { width: 16, height: 16, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.1, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("rect", { x: 1.5, y: 2, width: 11, height: 3.5, rx: 0.8 }),
          React.createElement("path", { d: "M2.5 5.5v5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-5" }),
          React.createElement("path", { d: "M5.5 8h3" })
        );
      }

      function FolderIcon() {
        return React.createElement(
          "svg",
          { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("path", { d: "M1.5 4.5a1 1 0 0 1 1-1h3l1.5 2h6.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7Z" })
        );
      }

      function WarningIcon() {
        return React.createElement(
          "svg",
          { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("path", { d: "M8 2.5 14.5 13.5h-13L8 2.5Z" }),
          React.createElement("path", { d: "M8 6.5v3" }),
          React.createElement("circle", { cx: 8, cy: 11.5, r: 0.4, fill: "currentColor" })
        );
      }

      function ChevronIcon() {
        return React.createElement(
          "svg",
          { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("path", { d: "m5 3.5 3.5 3.5L5 10.5" })
        );
      }

      function fmtTime(ts) {
        if (typeof ts !== "number" || !isFinite(ts) || ts <= 0) return "";
        const diff = Date.now() - ts;
        const min = 60 * 1000, hour = 60 * min, day = 24 * hour, month = 30 * day;
        if (diff < min) return "刚刚";
        if (diff < hour) return Math.floor(diff / min) + " 分钟前";
        if (diff < day) return Math.floor(diff / hour) + " 小时前";
        if (diff < month) return Math.floor(diff / day) + " 天前";
        const d = new Date(ts);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      }

      function deriveGroups(byId, ids, workspaces, archivedIds, query) {
        const q = (query || "").trim().toLowerCase();
        const archived = new Set(archivedIds);
        const groups = [];
        const accounted = new Set();
        const resolved = new Set();
        for (const ws of workspaces) {
          const members = [];
          for (const sid of ws.sessionIds) {
            if (!archived.has(sid)) continue;
            resolved.add(sid);
            const s = byId[sid];
            if (s === undefined) continue;
            accounted.add(sid);
            if (s.blank) continue;
            const label = s.displayTitle || s.title || "未命名会话";
            if (q && label.toLowerCase().indexOf(q) === -1 && ws.title.toLowerCase().indexOf(q) === -1 && String(s.cwd || "").toLowerCase().indexOf(q) === -1) continue;
            members.push(s);
          }
          if (members.length === 0) continue;
          members.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
          groups.push({ key: ws.workspaceId, label: ws.title, sessions: members });
        }
        const stray = [];
        for (const sid of ids) {
          if (accounted.has(sid)) continue;
          if (!archived.has(sid)) continue;
          resolved.add(sid);
          const s = byId[sid];
          if (s === undefined) continue;
          if (s.blank) continue;
          const label = s.displayTitle || s.title || "未命名会话";
          if (q && label.toLowerCase().indexOf(q) === -1 && String(s.cwd || "").toLowerCase().indexOf(q) === -1) continue;
          stray.push(s);
        }
        if (stray.length > 0) {
          stray.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
          groups.push({ key: "__ungrouped__", label: "未分组", sessions: stray });
        }
        const orphans = [];
        for (const sid of archivedIds) {
          if (resolved.has(sid)) continue;
          const s = byId[sid];
          if (s !== undefined && !s.blank) continue;
          if (q) {
            const sidLower = String(sid).toLowerCase();
            if (sidLower.indexOf(q) === -1) continue;
          }
          orphans.push({ id: sid, orphan: true, displayTitle: "未知会话（日志已不存在）", updatedAt: 0, cwd: undefined });
        }
        return { groups, orphans };
      }

      function ArchiveManager({ slotProps, onClose }) {
        const [query, setQuery] = React.useState("");
        const [busy, setBusy] = React.useState(null);
        const [confirming, setConfirming] = React.useState(null);
        const [error, setError] = React.useState(null);
        // Groups are collapsed by default so a large archive stays manageable;
        // a non-empty search query force-expands every group to show matches.
        const [expanded, setExpanded] = React.useState(() => new Set());
        const ghostIds = useGhostIds();
        const rawArchivedIds = slotProps.useWorkspaces((s) => s.archivedSessionIds);
        const byId = slotProps.useSessions((s) => s.byId);
        const ids = slotProps.useSessions((s) => s.ids);
        const workspaces = slotProps.useWorkspaces((s) => s.items);
        React.useEffect(() => { refreshState(); }, []);
        const archivedIds = React.useMemo(() => {
          if (ghostIds.length === 0) return rawArchivedIds;
          const ghost = new Set(ghostIds);
          return rawArchivedIds.filter((id) => !ghost.has(id));
        }, [rawArchivedIds, ghostIds]);
        const derived = React.useMemo(() => {
          try {
            const d = deriveGroups(byId, ids, workspaces, archivedIds, query);
            return { groups: d.groups, orphans: d.orphans, error: null };
          } catch (e) {
            return { groups: [], orphans: [], error: e instanceof Error ? e.message : String(e) };
          }
        }, [byId, ids, workspaces, archivedIds, query]);
        const runAction = async (action, sessionId) => {
          setBusy(action + ":" + sessionId);
          setError(null);
          try {
            const res = await remote[action]({ sessionId });
            if (res && res.ok) {
              if (action === "delete") {
                try {
                  const sessions = ctx.get("sessions");
                  if (sessions && typeof sessions.refresh === "function") sessions.refresh();
                } catch { /* non-fatal */ }
                refreshState();
              }
            } else {
              const err = res && res.error;
              setError((err && err.message) || (err && err.code) || "操作失败");
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        };
        const total = archivedIds.length;
        const groups = derived.groups.slice();
        if (derived.orphans.length > 0) {
          groups.push({ key: "__orphan__", label: "无效的归档记录", orphanGroup: true, sessions: derived.orphans });
        }
        const searching = query.trim() !== "";
        const isExpanded = (key) => searching || expanded.has(key);
        const toggleGroup = (key) => {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          });
        };
        const empty = total === 0 && ghostIds.length === 0;
        const allGhost = total === 0 && ghostIds.length > 0;
        const header = React.createElement(
          "div", { className: "am-header" },
          React.createElement("span", { className: "am-title" }, "归档管理"),
          React.createElement("span", { className: "am-count" }, total + " 个归档"),
          typeof onClose === "function"
            ? React.createElement("button", { className: "am-close", onClick: onClose, title: "关闭", "aria-label": "关闭" }, "✕")
            : null
        );
        const search = React.createElement(
          "div", { className: "am-search" },
          React.createElement("input", {
            type: "text",
            placeholder: "搜索归档标题或项目…",
            value: query,
            onChange: (e) => { setQuery(e.target.value); setConfirming(null); },
          })
        );
        const body = React.createElement(
          "div", { className: "am-body" },
          derived.error
            ? React.createElement("div", { className: "am-error" }, "渲染出错：" + derived.error)
            : empty
              ? React.createElement("div", { className: "am-empty" }, "暂无归档会话")
              : allGhost
                ? React.createElement("div", { className: "am-empty" }, "归档均已删除，重启 DSH 后自动清除")
                : groups.map((g) =>
                    React.createElement(
                      "div", { className: "am-group", key: g.key },
                      React.createElement(
                        "button", {
                          type: "button",
                          className: "am-group-head",
                          onClick: () => toggleGroup(g.key),
                          "aria-expanded": isExpanded(g.key),
                        },
                        React.createElement(
                          "span", { className: "am-chevron" + (isExpanded(g.key) ? " am-open" : ""), "aria-hidden": true },
                          React.createElement(ChevronIcon)
                        ),
                        React.createElement(
                          "span", { className: "am-group-icon", "aria-hidden": true },
                          g.orphanGroup ? React.createElement(WarningIcon) : React.createElement(FolderIcon)
                        ),
                        React.createElement("span", { className: "am-group-label" }, g.label),
                        React.createElement("span", { className: "am-group-count" }, g.sessions.length + " 个")
                      ),
                      isExpanded(g.key) ? g.sessions.map((s) => {
                        const restoring = busy === "restore:" + s.id;
                        const deleting = busy === "delete:" + s.id;
                        const isConfirm = confirming === s.id;
                        const isOrphan = s.orphan === true;
                        const timeLabel = isOrphan ? s.id : fmtTime(s.updatedAt);
                        const titleAttr = isOrphan ? s.id : (s.cwd || undefined);
                        const actions = [];
                        if (!isOrphan) {
                          actions.push(React.createElement("button", {
                            key: "restore",
                            type: "button",
                            className: "am-btn am-btn-restore",
                            disabled: !!busy,
                            onClick: () => runAction("restore", s.id),
                          }, restoring ? "…" : "还原"));
                        }
                        actions.push(React.createElement("button", {
                          key: "delete",
                          type: "button",
                          className: "am-btn am-btn-danger",
                          disabled: !!busy,
                          onClick: () => {
                            if (isConfirm) { setConfirming(null); runAction("delete", s.id); }
                            else { setConfirming(s.id); }
                          },
                        }, deleting ? "…" : (isConfirm ? "确认删除?" : "删除")));
                        return React.createElement(
                          "div", { className: "am-row" + (isOrphan ? " am-orphan" : ""), key: s.id, title: titleAttr },
                          React.createElement(
                            "span", { className: "am-slot", "aria-hidden": true },
                            isOrphan ? React.createElement(WarningIcon) : React.createElement(ArchiveIcon)
                          ),
                          React.createElement("span", { className: "am-title" }, isOrphan ? "未知会话（日志已不存在）" : (s.displayTitle || s.title || "未命名会话")),
                          React.createElement("span", { className: "am-time" }, timeLabel),
                          React.createElement("span", { className: "am-row-actions" }, actions)
                        );
                      }) : null
                    )
                )
        );
        const ghostNotice = ghostIds.length > 0
          ? React.createElement("div", { className: "am-ghost" }, ghostIds.length + " 个已删除会话仍驻留内存（已隐藏），重启 DSH 后自动清除")
          : null;
        return React.createElement(
          "div", { className: "am-panel", onClick: (e) => e.stopPropagation() },
          header,
          error ? React.createElement("div", { className: "am-error" }, error) : null,
          ghostNotice,
          search,
          body
        );
      }

      // Sidebar footer action entry (Cordis Plugin 下方、设置上方；纵向排列由注入 CSS 保证)。
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
        { name: "sidebar.footer.action", id: "archive-manager", order: 500, label: () => "归档" },
        (props) => {
          const wide = props.wide === true;
          const ghostIds = useGhostIds();
          let rawCount = 0;
          try { rawCount = props.useWorkspaces((s) => s.archivedSessionIds.length) || 0; } catch { rawCount = 0; }
          React.useEffect(() => { refreshState(); }, []);
          const count = rawCount - (ghostIds.length > rawCount ? rawCount : ghostIds.length);
          const safeCount = count > 0 ? count : 0;
          const isOpen = useOpen();
          const children = [];
          children.push(React.createElement("span", { key: "icon", className: "am-foot-icon", "aria-hidden": true }, React.createElement(ArchiveIcon)));
          if (wide) children.push(React.createElement("span", { key: "label", className: "am-foot-label" }, "归档"));
          if (wide && safeCount > 0) children.push(React.createElement("span", { key: "cnt", className: "am-badge" }, String(safeCount)));
          return React.createElement(
            "div", { className: "am-foot-layer" + (wide ? "" : " am-foot-rail") },
            React.createElement("button", {
              type: "button",
              onClick: () => { refreshState(); setOpen(!getOpen()); },
              title: "归档管理",
              "aria-label": "归档管理",
              className: "am-foot" + (isOpen ? " am-active" : ""),
            }, children)
          );
        }
      ));

      // Frame-wide archive manager panel.
      ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "archive-manager", order: 200 },
        (props) => {
          const isOpen = useOpen();
          if (!isOpen) return null;
          return React.createElement(
            "div", { className: "am-overlay", onClick: () => setOpen(false) },
            React.createElement(ArchiveManager, { slotProps: props, onClose: () => setOpen(false) })
          );
        }
      ));
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote"];
    return module.exports;
  },
});
