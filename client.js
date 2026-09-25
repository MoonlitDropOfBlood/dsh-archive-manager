/**
 * dsh-archive-manager — Client half (web bundle).
 *
 * Rendered by the DSH web shell via `window.__ModuleLoader__.load`. Two
 * operating modes, chosen by feature detection (never by version string):
 *
 * - DSH < 0.1.7 (legacy): registers a sidebar footer action button
 *   (archived-session entry) plus a frame-wide archive manager panel
 *   (search / group / restore / delete), rendered together from the
 *   sidebar.footer.action slot — mirroring how ui-settings renders its modal
 *   from sidebar.settings (see the registration comment for the
 *   stacking-context rationale).
 * - DSH >= 0.1.7 (modern): the shell ships its own archive management (the
 *   sidebar "仅显示已归档" filter with per-row archive actions), so this
 *   plugin adds ONLY the missing delete affordance: a danger row in each
 *   archived session's "..." menu (`sidebar.workspaces.session.menu.item`)
 *   and a hover trash button at the row end
 *   (`sidebar.workspaces.session.row.action`), both opening a confirm dialog
 *   rendered from the sidebar foot slot. Detection = whether those slots
 *   ever get declared: `ctx.slots.inject()` on an undeclared key never
 *   fires, so pre-0.1.7 builds stay on the legacy path automatically, and
 *   the footer button hides itself the moment the modern slots appear.
 *
 * The panel/dialog mirrors the DSH 工作区 (workspace) browsing region: a
 * dialog surface using the same design tokens as the workspace browser —
 * folder group headers, compact 32px session rows with a leading slot icon
 * and relative time, and hover-revealed actions (workspace rowActions
 * pattern).
 *
 * Host communication goes through the `archiveManager` Remote namespace
 * (`ctx.remote.archiveManager.restore/delete/state`), published by the Host
 * half in `index.js`.
 */
window.__ModuleLoader__.load({
  id: "@duke-dsh-plugins/dsh-archive-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    // ---- CSS (package-owned, mirrors the DSH workspace browser + Modal) ----
    // CSS_COMMON renders in both modes; CSS_LEGACY is the footer-button
    // dressing, injected only while the legacy panel exists (cleared the
    // moment the 0.1.7+ slots declare, so the modern shell keeps its own
    // footer layout untouched).
    const CSS_COMMON = `
/* Overlay — same mask surface as DSH Modal, same z-index tier as the DSH
   settings overlay (1000). This layer MUST be rendered from a slot that sits
   outside any stacking context (the sidebar foot, like Settings does), never
   from the shell.overlay slot: AppFrame renders that slot inside its
   .overlayLayer (position:absolute;z-index:20, a stacking context), which
   traps any child z-index below it — dsh-better-sidebar appends a
   position:fixed;z-index:25 layer to document.body and would cover the
   modal. */
.am-overlay{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;padding:24px;}

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

/* ---- 0.1.7+ modern surfaces (delete affordances on the built-in archive) ---- */

/* Danger row in an archived session's "..." menu. Rendered through
   ui-primitives' MenuItemButton when the module table provides it (native
   look); this class styles the defensive plain-button fallback. */
.am-menu-del{display:flex;align-items:center;gap:8px;width:100%;padding:5px 12px;border:none;background:transparent;color:var(--dsw-alias-state-error-primary,#e5484d);font-family:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm,6px);}
.am-menu-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12));}
.am-menu-del[disabled]{opacity:.5;cursor:default;}

/* Hover button at the row end — same 28px metrics as ui-workspace's own
   row-action iconButton so it sits in the strip without reflow. */
.am-row-del{border-radius:var(--dsw-radius-sm,6px);cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary,inherit);background:0 0;border:none;flex:none;display:inline-flex;justify-content:center;align-items:center;padding:0;}
.am-row-del:hover{color:var(--dsw-alias-state-error-primary,#e5484d);}
.am-row-del[disabled]{opacity:.5;cursor:default;}

/* Confirm dialog — same surface family as the legacy panel, compact width.
   Rendered from the sidebar foot slot (fixed, root stacking context) so
   dsh-better-sidebar's z-index:25 body layer cannot cover it. */
.am-confirm{position:relative;display:flex;flex-direction:column;width:440px;max-width:calc(100vw - 48px);overflow:hidden;border:1px solid var(--dsw-alias-border-inverted,rgba(128,128,128,.3));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:var(--dsw-shadow-lv3,0 12px 40px rgba(0,0,0,.25));}
.am-confirm .am-confirm-body{padding:4px 24px 16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,inherit);}
.am-confirm .am-confirm-title{font-weight:500;font-size:16px;line-height:24px;color:var(--dsw-alias-label-primary,inherit);}
.am-confirm .am-confirm-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px 20px;}
.am-confirm .am-confirm-error{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;line-height:18px;padding:0 24px 12px;}
.am-confirm .am-confirm-note{color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;line-height:18px;}
.am-confirm .am-confirm-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));background:transparent;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:13px;line-height:18px;padding:6px 14px;border-radius:10px;cursor:pointer;}
.am-confirm .am-confirm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}
.am-confirm .am-confirm-btn.am-confirm-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-bg-base,#fff);}
.am-confirm .am-confirm-btn.am-confirm-danger:hover{background:var(--dsw-alias-state-error-primary,#e5484d);filter:brightness(1.06);}
.am-confirm .am-confirm-btn[disabled]{opacity:.5;cursor:default;}

/* Sidebar footer entry (legacy mode only) */
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

    // Footer-column layout: only meaningful while OUR footer button exists.
    // Injected at boot, cleared permanently once the 0.1.7+ slots declare
    // (markModern), so a modern DSH footer keeps its own layout rules.
    const CSS_LEGACY = `
[class*="footerActions"]{flex-direction:column;align-items:center;}
`;

    // ---- Client Remote contribution ----------------------------------------
    // The browser-side `remote.archiveManager` service only exists after this
    // module mounts its namespace via ctx.remote.$mount(): dsh-api-remotes'
    // client assembly mounts only the five official namespaces, so a plugin
    // must mount its own. Mirrors the invocations in typert.host.js (ids,
    // service/namespace/method, wire fields). zod is not requirable in the
    // browser module loader, so codecs use passthrough schemas — the runtime
    // contract only needs typeSymbol plus a parse (DSH < 0.1.7 reads
    // `codec.schema.parse`) or a create() factory (the typert registry on
    // DSH >= 0.1.7 rejects a strict codec with "has no create() factory").
    // Every codec therefore carries BOTH fields, like typert.host.js.
    let passthroughValue;
    const passthroughSchema = () => (passthroughValue ??= { parse: (v) => v });
    const strictClientCodec = (typeSymbol) => ({
      mode: "strict",
      typeSymbol,
      schema: passthroughSchema(),
      create: passthroughSchema,
    });
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
              codec: strictClientCodec("dsh-archive-manager#ArchiveManagerRestoreRequest"),
            },
          ],
          result: strictClientCodec("dsh-archive-manager#ArchiveManagerRestoreResult"),
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
              codec: strictClientCodec("dsh-archive-manager#ArchiveManagerDeleteRequest"),
            },
          ],
          result: strictClientCodec("dsh-archive-manager#ArchiveManagerDeleteResult"),
        },
        {
          id: "dsh-archive-manager#archiveManager/state",
          service: "archiveManager",
          namespace: "archiveManager",
          method: "state",
          invocation: { kind: "direct" },
          parameters: [],
          result: strictClientCodec("dsh-archive-manager#ArchiveManagerStateResult"),
        },
      ],
    };

    async function apply(ctx) {
      // Mount the archiveManager namespace before anything touches it; the
      // mount's lifetime is bound to this plugin's context by $mount itself.
      await ctx.remote.$mount(CLIENT_REMOTE);

      const styleTag = document.createElement("style");
      styleTag.textContent = CSS_COMMON;
      document.head.appendChild(styleTag);
      ctx.effect(() => () => styleTag.remove());

      // Legacy footer-column override; cleared for good by markModern() once
      // the 0.1.7+ built-in archive slots declare.
      const legacyStyleTag = document.createElement("style");
      legacyStyleTag.textContent = CSS_LEGACY;
      document.head.appendChild(legacyStyleTag);
      ctx.effect(() => () => legacyStyleTag.remove());

      // ctx.get() reads the service without the property-accessor inject
      // guard; it exists because the $mount above just created it.
      const remote = ctx.get("remote.archiveManager");

      // ui-primitives (MenuItemButton / Tooltip / IconTrashOutlineRegular) is
      // part of the 0.1.7+ module table — ui-workspace requires it from the
      // same table. Loaded defensively: pre-0.1.7 builds may not ship it, and
      // the modern components (its only consumers) render only when the 0.1.7
      // slots exist. Fallbacks below keep every surface functional without it.
      let ui = null;
      try {
        ui = require("@deepseek-ai/dsh-client-ui-primitives");
      } catch {
        ui = null;
      }

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

      // ---- Modern (DSH >= 0.1.7) mode state --------------------------------
      // modernStore flips on exactly when the built-in archive's row slots
      // declare (see the inject registrations at the bottom of apply). Until
      // then the legacy footer button renders; afterwards it hides itself and
      // the footer slot only carries the delete confirm dialog.
      const modernStore = (() => {
        let value = false;
        const listeners = new Set();
        return {
          getSnapshot: () => value,
          subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
          set: (next) => { if (value !== next) { value = next; for (const fn of listeners) fn(); } },
        };
      })();
      function useModern() { return React.useSyncExternalStore(modernStore.subscribe, modernStore.getSnapshot); }

      // Pending delete request for the modern confirm dialog ({sessionId,
      // displayTitle} | null), set by the menu row / hover button.
      const deleteStore = (() => {
        let value = null;
        const listeners = new Set();
        return {
          getSnapshot: () => value,
          subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
          set: (next) => { if (value !== next) { value = next; for (const fn of listeners) fn(); } },
        };
      })();
      function useDeleteRequest() { return React.useSyncExternalStore(deleteStore.subscribe, deleteStore.getSnapshot); }

      // Enter modern mode: hide the legacy button (and its footer-layout CSS)
      // for good, then let the caller register its slot entries.
      const markModern = () => {
        modernStore.set(true);
        legacyStyleTag.textContent = "";
      };

      /**
       * Whether one session is in the registry-global archive set, read from
       * the framework's global `useWorkspaces` standard hook (delivered to
       * every slot component on every supported DSH). Fails closed to false
       * when the hook is unavailable.
       *
       * @param {Function} useWorkspaces - the global workspace snapshot hook.
       * @param {string} sessionId - row session id.
       * @returns {boolean} archived membership.
       */
      function useArchivedMember(useWorkspaces, sessionId) {
        try {
          return useWorkspaces(
            (s) => Array.isArray(s.archivedSessionIds) && s.archivedSessionIds.indexOf(sessionId) !== -1
          ) === true;
        } catch {
          return false;
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

      // Trash glyph for the modern delete surfaces: ui-primitives' shipped
      // icon when available (identical to the shell's own artwork), a plain
      // outline SVG otherwise.
      function TrashIcon({ size }) {
        const px = size || 14;
        if (ui && ui.IconTrashOutlineRegular) {
          return React.createElement(ui.IconTrashOutlineRegular, { size: px });
        }
        return React.createElement(
          "svg",
          { width: px, height: px, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          React.createElement("path", { d: "M2.5 4.5h11" }),
          React.createElement("path", { d: "M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" }),
          React.createElement("path", { d: "M4 4.5l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1" }),
          React.createElement("path", { d: "M6.5 7v4M9.5 7v4" })
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

      // ---- Modern (DSH >= 0.1.7) delete surfaces ---------------------------
      // The built-in archive management owns listing/restore on 0.1.7+; these
      // three components add only DELETION on top of it. Both entry points
      // show for archived, non-ghost rows only and open the shared confirm
      // dialog (rendered from the sidebar foot slot — see the stacking note
      // on the footer registration below).

      /**
       * Danger row in an archived session's "..." menu
       * (`sidebar.workspaces.session.menu.item`, order 450 — after the
       * shipped pin/rename/fork/archive rows). Dismisses the menu through the
       * slot's `useMenuOpenState` hook before raising the confirm dialog.
       *
       * @param props - owner share (row identity) + the slot's hook seat + the global workspace hook.
       * @returns the menu row, or null when delete does not apply.
       */
      function DeleteMenuEntry({ sessionId, displayTitle, useMenuOpenState, useWorkspaces }) {
        const archived = useArchivedMember(useWorkspaces, sessionId);
        const ghostIds = useGhostIds();
        const ghost = ghostIds.indexOf(sessionId) !== -1;
        const menuState = typeof useMenuOpenState === "function" ? useMenuOpenState() : null;
        const setMenuOpen = menuState ? menuState[1] : () => {};
        // Keep the ghost list fresh while the menu offering delete is open.
        React.useEffect(() => { if (archived) refreshState(); }, [archived, sessionId]);
        if (!archived || ghost) return null;
        const select = () => {
          setMenuOpen(false);
          deleteStore.set({ sessionId, displayTitle });
        };
        if (ui && ui.MenuItemButton) {
          return React.createElement(
            ui.MenuItemButton,
            {
              danger: true,
              separatorBefore: true,
              icon: React.createElement(TrashIcon, { size: 14 }),
              onSelect: select,
            },
            "删除会话…"
          );
        }
        return React.createElement(
          "button",
          { type: "button", role: "menuitem", className: "am-menu-del", onClick: select },
          React.createElement(TrashIcon, { size: 14 }),
          "删除会话…"
        );
      }

      /**
       * Hover trash button at the archived row's end
       * (`sidebar.workspaces.session.row.action`, order 300 — after the
       * shipped archive/pin buttons). Clicks inside the row-action strip stay
       * in the strip, so no propagation handling is needed.
       *
       * @param props - owner share (row identity) + the global workspace hook.
       * @returns the button, or null when delete does not apply.
       */
      function DeleteRowButton({ sessionId, displayTitle, useWorkspaces }) {
        const archived = useArchivedMember(useWorkspaces, sessionId);
        const ghostIds = useGhostIds();
        const ghost = ghostIds.indexOf(sessionId) !== -1;
        React.useEffect(() => { if (archived) refreshState(); }, [archived, sessionId]);
        if (!archived || ghost) return null;
        const button = React.createElement(
          "button",
          {
            type: "button",
            className: "am-row-del",
            title: "删除会话",
            "aria-label": "删除会话",
            onClick: () => deleteStore.set({ sessionId, displayTitle }),
          },
          React.createElement(TrashIcon, { size: 14 })
        );
        if (ui && ui.Tooltip) {
          return React.createElement(
            ui.Tooltip,
            { label: "删除会话", side: "bottom", align: "end", delayMs: 500 },
            button
          );
        }
        return button;
      }

      /**
       * The modern confirm dialog: permanent deletion gets the same 二次确认
       * treatment as the legacy panel (per-request state dies with the
       * request; errors stay visible; a live-but-idle target resolves into a
       * ghost explanation instead of closing silently).
       *
       * @param props - the pending request and its dismissal.
       * @returns the fixed overlay + dialog.
       */
      function DeleteConfirmForm({ req, onClose }) {
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [ghost, setGhost] = React.useState(false);
        // Esc cancels: the dialog owns z-index:1000, so swallow the key to
        // keep it from reaching the shell's global Escape handlers.
        React.useEffect(() => {
          const onKeyDown = (e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!busy) onClose();
            }
          };
          document.addEventListener("keydown", onKeyDown, true);
          return () => document.removeEventListener("keydown", onKeyDown, true);
        }, [busy]);
        const close = () => { if (!busy) onClose(); };
        const confirm = async () => {
          if (busy) return;
          setBusy(true);
          setError(null);
          try {
            const res = await remote.delete({ sessionId: req.sessionId });
            if (res && res.ok) {
              try {
                const sessions = ctx.get("sessions");
                if (sessions && typeof sessions.refresh === "function") sessions.refresh();
              } catch { /* non-fatal */ }
              refreshState();
              if (res.value && res.value.live) {
                // Live-but-idle: files are gone, the archive entry stays as a
                // ghost until restart (same semantics as the legacy panel).
                setGhost(true);
              } else {
                onClose();
              }
            } else {
              const err = res && res.error;
              setError((err && err.message) || (err && err.code) || "删除失败");
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };
        const title = req.displayTitle || req.sessionId;
        return React.createElement(
          "div", { className: "am-overlay", onClick: close },
          React.createElement(
            "div", { className: "am-confirm", onClick: (e) => e.stopPropagation() },
            React.createElement(
              "div", { className: "am-header" },
              React.createElement("span", { className: "am-title" }, ghost ? "已删除会话" : "删除会话"),
              React.createElement(
                "button",
                { className: "am-close", onClick: close, disabled: busy, title: "关闭", "aria-label": "关闭" },
                "✕"
              )
            ),
            React.createElement(
              "div", { className: "am-confirm-body" },
              ghost
                ? "日志文件已删除。该会话仍驻留内存，删除条目将在重启 DSH 后自动清除。"
                : "将永久删除「" + title + "」的会话日志文件，此操作不可恢复。"
            ),
            error && !ghost
              ? React.createElement("div", { className: "am-confirm-error" }, error)
              : null,
            React.createElement(
              "div", { className: "am-confirm-actions" },
              ghost
                ? React.createElement(
                    "button",
                    { type: "button", className: "am-confirm-btn", onClick: onClose },
                    "关闭"
                  )
                : [
                    React.createElement(
                      "button",
                      { key: "cancel", type: "button", className: "am-confirm-btn", disabled: busy, onClick: close },
                      "取消"
                    ),
                    React.createElement(
                      "button",
                      { key: "confirm", type: "button", className: "am-confirm-btn am-confirm-danger", disabled: busy, onClick: confirm },
                      busy ? "删除中…" : "永久删除"
                    ),
                  ]
            )
          )
        );
      }

      // Sidebar footer action entry (Cordis Plugin 下方、设置上方；纵向排列由注入
      // CSS 保证) + frame-wide archive manager panel.
      //
      // 弹窗为什么从这里渲染而不是 `shell.overlay`：AppFrame 把 `shell.overlay`
      // 渲染在 `.overlayLayer`（position:absolute; z-index:20）内，该层形成独立
      // stacking context，把子元素 z-index 锁死在其下；而 dsh-better-sidebar 把
      // 整层 append 到 document.body（position:fixed; z-index:25），归档弹窗因此
      // 会被它盖住。设置弹窗（ui-settings）的做法是把全屏 fixed 遮罩
      // （z-index:1000）从 sidebar.settings 槽渲染——侧栏列不构成 stacking
      // context，fixed 层直接参与根 stacking context，压过 better-sidebar 的 25。
      // 这里照搬同一做法：弹窗与按钮同从 sidebar.footer.action 槽渲染，两者共享
      // useOpen 状态，UI 行为不变。
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
          const modern = useModern();
          const deleteReq = useDeleteRequest();
          // Esc 关闭弹窗：打开期间在 document 捕获阶段监听 keydown，命中
          // Escape 即关闭并 stopPropagation——弹窗位于 z-index:1000 顶层，
          // 此时 Esc 应只作用于它，不穿透到 shell 的全局快捷键或底层输入框。
          React.useEffect(() => {
            if (!isOpen) return undefined;
            const onKeyDown = (e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            };
            document.addEventListener("keydown", onKeyDown, true);
            return () => document.removeEventListener("keydown", onKeyDown, true);
          }, [isOpen]);
          // DSH >= 0.1.7: the shell's built-in archive management owns the
          // sidebar entry — no button, no panel; this slot carries only the
          // delete confirm dialog that this mode exists to add.
          if (modern) {
            return deleteReq
              ? React.createElement(DeleteConfirmForm, {
                  key: deleteReq.sessionId,
                  req: deleteReq,
                  onClose: () => deleteStore.set(null),
                })
              : null;
          }
          const children = [];
          children.push(React.createElement("span", { key: "icon", className: "am-foot-icon", "aria-hidden": true }, React.createElement(ArchiveIcon)));
          if (wide) children.push(React.createElement("span", { key: "label", className: "am-foot-label" }, "归档"));
          if (wide && safeCount > 0) children.push(React.createElement("span", { key: "cnt", className: "am-badge" }, String(safeCount)));
          const button = React.createElement(
            "div", { className: "am-foot-layer" + (wide ? "" : " am-foot-rail") },
            React.createElement("button", {
              type: "button",
              onClick: () => { refreshState(); setOpen(!getOpen()); },
              title: "归档管理",
              "aria-label": "归档管理",
              className: "am-foot" + (isOpen ? " am-active" : ""),
            }, children)
          );
          const overlay = isOpen
            ? React.createElement(
                "div", { className: "am-overlay", onClick: () => setOpen(false) },
                React.createElement(ArchiveManager, { slotProps: props, onClose: () => setOpen(false) })
              )
            : null;
          return [button, overlay];
        }
      ));

      // ---- Modern-mode registrations (fired only on DSH >= 0.1.7) ----------
      // ui-workspace declares these two lists when it registers the built-in
      // archive browsing region (the "仅显示已归档" filter world). On earlier
      // DSH builds the keys are never declared: ctx.slots.inject() waits
      // silently, these callbacks never run, no entry is registered, and the
      // legacy footer button stays — that IS the version switch. The first
      // declaration also flips markModern(), which hides the legacy button
      // and drops the footer-column CSS for good.
      ctx.slots.inject("sidebar.workspaces.session.menu.item", () => {
        markModern();
        return ctx.slots.register(
          { name: "sidebar.workspaces.session.menu.item", id: "dsh-archive-manager.delete", order: 450 },
          DeleteMenuEntry
        );
      });
      ctx.slots.inject("sidebar.workspaces.session.row.action", () => {
        markModern();
        return ctx.slots.register(
          { name: "sidebar.workspaces.session.row.action", id: "dsh-archive-manager.delete", order: 300 },
          DeleteRowButton
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote"];
    // Exposed for verify-typert-compat.mjs (the browser wiring contract has
    // to satisfy both DSH typert registries; nothing else reads this).
    exports.CLIENT_REMOTE = CLIENT_REMOTE;
    return module.exports;
  },
});
