/**
 * Client half of the DSH Startup Manager bundle (plain React, no build step).
 *
 * Renders two slot entries:
 *  - `main` panel (key `dsh-startup-manager`): the management list page.
 *  - `sidebar.panellist` icon (id `dsh-startup-manager`): opens the panel.
 *
 * Data comes from the Host half's package-private HTTP API
 * (/dsh-plugin/startup-manager/api). All visible text goes through the Client
 * locale service; styling uses --dsw-alias-* theme tokens only.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-startup-manager",
  factory(require) {
    const React = require("react");
    const { useState, useEffect, useMemo, useCallback } = React;
    const h = React.createElement;

    const NS = "dshStartupManager";
    const PANEL_KEY = "dsh-startup-manager";
    const API = "/dsh-plugin/startup-manager/api";
    const REQUEST_HEADERS = { "x-dsh-startup-manager": "1" };

    const en = {
      "panel.title": "Startup Manager",
      "panel.subtitle": "Auto-start entries of programs installed on this machine",
      "panel.refresh": "Refresh",
      "panel.accept": "Mark known",
      "panel.acceptHint": "Mark every currently listed entry as known; future additions will be flagged as NEW.",
      "panel.search": "Filter by name, command or source…",
      "panel.all": "All",
      "panel.enabled": "Enabled",
      "panel.disabled": "Disabled",
      "panel.new": "New",
      "panel.total": "Total",
      "panel.statusEnabled": "Enabled",
      "panel.statusDisabled": "Disabled",
      "panel.badgeNew": "NEW",
      "panel.badgeAdmin": "Admin",
      "panel.kindRegistry": "Registry",
      "panel.kindFolder": "Startup folder",
      "panel.kindTask": "Scheduled task",
      "panel.kindService": "Service",
      "panel.empty": "No startup entries match the current filter.",
      "panel.loading": "Scanning startup entries…",
      "panel.loadFailed": "Scan failed",
      "panel.toggleFailed": "Toggle failed",
      "panel.acceptDone": "All listed entries marked as known.",
      "panel.adminRequired": "HKLM entry: requires an elevated Host to toggle.",
      "panel.lastScan": "Last scan",
      "panel.host": "Host",
      "panel.count": "{count} entries",
      "panel.disclaimer": "Changes apply on next sign-in. HKLM entries need administrator rights on the Host.",
    };

    const zh = {
      "panel.title": "自启动管理",
      "panel.subtitle": "本机安装程序的开机自启动项",
      "panel.refresh": "刷新",
      "panel.accept": "标记已知",
      "panel.acceptHint": "将当前列表全部标记为已知，之后新增的条目才会再次标记为“新”。",
      "panel.search": "按名称、命令或来源筛选…",
      "panel.all": "全部",
      "panel.enabled": "已启用",
      "panel.disabled": "已禁用",
      "panel.new": "新增",
      "panel.total": "总数",
      "panel.statusEnabled": "已启用",
      "panel.statusDisabled": "已禁用",
      "panel.badgeNew": "新",
      "panel.badgeAdmin": "管理员",
      "panel.kindRegistry": "注册表",
      "panel.kindFolder": "启动文件夹",
      "panel.kindTask": "计划任务",
      "panel.kindService": "系统服务",
      "panel.empty": "当前筛选条件下没有自启动项。",
      "panel.loading": "正在扫描自启动项…",
      "panel.loadFailed": "扫描失败",
      "panel.toggleFailed": "切换失败",
      "panel.acceptDone": "已将当前列表全部标记为已知。",
      "panel.adminRequired": "HKLM 项：需要管理员权限的主机才能切换。",
      "panel.lastScan": "上次扫描",
      "panel.host": "主机",
      "panel.count": "{count} 项",
      "panel.disclaimer": "更改在下次登录时生效；HKLM 下的系统项需要 Host 以管理员权限运行。",
    };

    const DICTS = { en, zh };

    const STYLES = `
.dsm-root { height: 100%; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;
  padding: 24px clamp(20px, 5vw, 56px) 32px; background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.45; }
.dsm-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsm-title { margin: 0; font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsm-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsm-actions { display: flex; gap: 8px; align-items: center; }
.dsm-button { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.dsm-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dsm-button:disabled { opacity: 0.55; cursor: default; }
.dsm-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsm-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.dsm-chip { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 999px;
  padding: 4px 12px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dsm-chip strong { color: var(--dsw-alias-label-primary); font-weight: 600; margin-left: 4px; }
.dsm-chip.warn strong { color: var(--dsw-alias-state-warn-primary); }
.dsm-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsm-tabs { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1); }
.dsm-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  padding: 6px 14px; font-size: 13px; cursor: pointer; }
.dsm-tab[aria-pressed="true"] { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsm-search { flex: 1 1 200px; min-width: 180px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 6px 10px; font-size: 13px; outline: none; }
.dsm-search:focus { border-color: var(--dsw-alias-brand-primary); }
.dsm-list { display: flex; flex-direction: column; gap: 8px; }
.dsm-row { display: flex; align-items: center; gap: 14px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 10px 14px; }
.dsm-row.is-new { border-color: var(--dsw-alias-state-warn-primary); }
.dsm-main { flex: 1 1 auto; min-width: 0; }
.dsm-name { font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px; }
.dsm-cmd { margin-top: 2px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.dsm-desc { margin-top: 2px; font-size: 12.5px; color: var(--dsw-alias-label-primary); opacity: 0.92;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsm-desc .dsm-company { color: var(--dsw-alias-label-secondary); margin-left: 8px; }
.dsm-src { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.dsm-badge { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
.dsm-badge.new { color: var(--dsw-alias-state-warn-primary); border: 1px solid var(--dsw-alias-state-warn-primary); }
.dsm-badge.on { color: var(--dsw-alias-state-success-primary); }
.dsm-badge.off { color: var(--dsw-alias-state-idle-primary); }
.dsm-badge.admin { color: var(--dsw-alias-state-error-primary); border: 1px solid var(--dsw-alias-state-error-primary); }
.dsm-switch { flex: 0 0 auto; width: 40px; height: 22px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); position: relative; cursor: pointer; padding: 0; }
.dsm-switch[aria-checked="true"] { background: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary); }
.dsm-switch:disabled { opacity: 0.5; cursor: default; }
.dsm-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-bg-base); transition: left 0.15s ease; }
.dsm-switch[aria-checked="true"] .dsm-knob { left: 20px; }
.dsm-note { font-size: 13px; border-radius: 8px; padding: 8px 12px; }
.dsm-note.error { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-state-error-primary); }
.dsm-note.info { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); }
.dsm-empty { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 28px; text-align: center;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.dsm-footer { font-size: 12px; color: var(--dsw-alias-label-secondary); }
`;

    /** Single response parser: empty/non-JSON bodies become explicit, readable errors. */
    async function requestJson(path, init) {
      const response = await fetch(API + path, init);
      const text = await response.text();
      if (text.length === 0) throw new Error(`HTTP ${response.status}: empty response`);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}: non-JSON response (${text.slice(0, 60)})`);
      }
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    }

    const api = {
      list: () => requestJson("/list", { headers: REQUEST_HEADERS }),
      rescan: () => requestJson("/rescan", { method: "POST", headers: REQUEST_HEADERS }),
      accept: () => requestJson("/accept", { method: "POST", headers: REQUEST_HEADERS }),
      toggle: (id, enable) => requestJson("/toggle", {
        method: "POST",
        headers: { ...REQUEST_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ id, enable }),
      }),
    };

    const KIND_KEY = {
      registry: "panel.kindRegistry",
      folder: "panel.kindFolder",
      task: "panel.kindTask",
      service: "panel.kindService",
    };

    function fill(template, vars) {
      return String(template ?? "").replace(/\{(\w+)\}/g, (match, key) => String(vars?.[key] ?? match));
    }

    function Switch(props) {
      return h("button", {
        className: "dsm-switch",
        role: "switch",
        "aria-checked": props.checked ? "true" : "false",
        "aria-label": props.title,
        disabled: props.disabled ? true : undefined,
        title: props.title,
        onClick: props.onToggle,
      }, h("span", { className: "dsm-knob" }));
    }

    function PanelIcon() {
      return h("svg", {
        width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true,
        style: { display: "block" },
      },
        h("path", {
          d: "M12 2.5c3.2 2.2 5.2 5.8 5.2 9.9 0 1.9-.4 3.7-1.2 5.3h-8a12.6 12.6 0 0 1-1.2-5.3c0-4.1 2-7.7 5.2-9.9z",
          fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinejoin: "round",
        }),
        h("circle", { cx: 12, cy: 9.6, r: 1.9, fill: "none", stroke: "currentColor", strokeWidth: 1.5 }),
        h("path", {
          d: "M8 17.7 6 20.4l1.4 1.1 2.1-2.4M16 17.7l2 2.7-1.4 1.1-2.1-2.4M10.6 20.6h2.8",
          fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
        }),
      );
    }

    function App(props) {
      const t = useCallback((key, vars) => {
        const translate = typeof props.t === "function" ? props.t : undefined;
        if (translate) return translate(key, vars);
        return fill(DICTS.en[key] ?? key, vars);
      }, [props.t]);

      const [data, setData] = useState(undefined);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [busyId, setBusyId] = useState(undefined);
      const [filter, setFilter] = useState("all");
      const [query, setQuery] = useState("");
      const [notice, setNotice] = useState(undefined);

      useEffect(() => {
        if (notice === undefined) return undefined;
        const timer = setTimeout(() => setNotice(undefined), 4000);
        return () => clearTimeout(timer);
      }, [notice]);

      const load = useCallback(async (force) => {
        setLoading(true);
        setError("");
        try {
          const payload = await (force ? api.rescan() : api.list());
          setData(payload);
          return payload;
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          return undefined;
        } finally {
          setLoading(false);
        }
      }, [t]);

      useEffect(() => {
        load(false);
      }, [load]);

      const onToggle = async (entry) => {
        setBusyId(entry.id);
        setError("");
        try {
          await api.toggle(entry.id, !entry.enabled);
          const fresh = await load(true);
          if (fresh) {
            setNotice({
              kind: "info",
              text: `${entry.name}: ${t(entry.enabled ? "panel.statusEnabled" : "panel.statusDisabled")} → ${t(entry.enabled ? "panel.statusDisabled" : "panel.statusEnabled")}`,
            });
          }
        } catch (failure) {
          setError(`${t("panel.toggleFailed")}: ${failure instanceof Error ? failure.message : String(failure)}`);
        } finally {
          setBusyId(undefined);
        }
      };

      const onAccept = async () => {
        setBusyId("__accept__");
        setError("");
        try {
          await api.accept();
          const fresh = await load(true);
          if (fresh) setNotice({ kind: "info", text: t("panel.acceptDone") });
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusyId(undefined);
        }
      };

      const entries = data?.entries ?? [];
      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return entries.filter((entry) => {
          if (filter === "enabled" && !entry.enabled) return false;
          if (filter === "disabled" && entry.enabled) return false;
          if (filter === "new" && !entry.isNew) return false;
          if (!needle) return true;
          return `${entry.name}\n${entry.command}\n${entry.source}`.toLowerCase().includes(needle);
        });
      }, [entries, filter, query]);

      const tabs = [
        ["all", t("panel.all")],
        ["enabled", t("panel.enabled")],
        ["disabled", t("panel.disabled")],
        ["new", t("panel.new")],
      ];

      return h("div", { className: "dsm-root" },
        h("style", null, STYLES),
        h("div", { className: "dsm-header" },
          h("div", null,
            h("h1", { className: "dsm-title" }, t("panel.title")),
            h("p", { className: "dsm-subtitle" }, t("panel.subtitle")),
          ),
          h("div", { className: "dsm-actions" },
            h("button", {
              className: "dsm-button",
              disabled: busyId !== undefined,
              title: t("panel.acceptHint"),
              onClick: onAccept,
            }, t("panel.accept")),
            h("button", {
              className: "dsm-button primary", disabled: busyId !== undefined,
              onClick: () => load(true),
            }, loading ? "…" : t("panel.refresh")),
          ),
        ),
        h("div", { className: "dsm-meta" },
          data
            ? `${t("panel.lastScan")}: ${data.scannedAt} · ${t("panel.host")}: ${data.host}`
            : "",
        ),
        data ? h("div", { className: "dsm-chips" },
          h("span", { className: "dsm-chip" }, t("panel.total"), h("strong", null, String(data.counts.total))),
          h("span", { className: "dsm-chip" }, t("panel.enabled"), h("strong", null, String(data.counts.enabled))),
          h("span", { className: "dsm-chip" }, t("panel.disabled"), h("strong", null, String(data.counts.disabled))),
          h("span", { className: "dsm-chip warn" }, t("panel.new"), h("strong", null, String(data.counts.new))),
        ) : null,
        notice ? h("div", { className: `dsm-note ${notice.kind}`, role: "status" }, notice.text) : null,
        error ? h("div", { className: "dsm-note error", role: "alert" }, `${t("panel.loadFailed")}: ${error}`) : null,
        h("div", { className: "dsm-toolbar" },
          h("div", { className: "dsm-tabs" },
            [["all", t("panel.all")], ["enabled", t("panel.enabled")], ["disabled", t("panel.disabled")], ["new", t("panel.new")]]
              .map(([key, label]) => h("button", {
                key,
                className: "dsm-tab",
                "aria-pressed": filter === key ? "true" : "false",
                onClick: () => setFilter(key),
              }, label)),
          ),
          h("input", {
            className: "dsm-search",
            type: "search",
            value: query,
            placeholder: t("panel.search"),
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        loading && !data ? h("div", { className: "dsm-empty", role: "status" }, t("panel.loading")) : null,
        !loading && data && visible.length === 0 ? h("div", { className: "dsm-empty" }, t("panel.empty")) : null,
        h("div", { className: "dsm-list" },
          visible.map((entry) => h("div", { key: entry.id, className: `dsm-row${entry.isNew ? " is-new" : ""}` },
            h("div", { className: "dsm-main" },
              h("div", { className: "dsm-name" },
                h("span", null, entry.name),
                entry.isNew ? h("span", { className: "dsm-badge new" }, t("panel.badgeNew")) : null,
                entry.adminRequired
                  ? h("span", { className: "dsm-badge admin", title: t("panel.adminRequired") }, t("panel.badgeAdmin"))
                  : null,
              ),
              h("div", { className: "dsm-cmd", title: entry.command }, entry.command || "—"),
              entry.description || entry.company
                ? h("div", { className: "dsm-desc", title: [entry.description, entry.company].filter(Boolean).join(" · ") },
                    entry.description ?? "",
                    entry.company ? h("span", { className: "dsm-company" }, entry.company) : null)
                : null,
              h("div", { className: "dsm-src", title: entry.source },
                `[${t(KIND_KEY[entry.kind] ?? "panel.kindRegistry")}] ${entry.source}`),
            ),
            h("span", { className: `dsm-badge ${entry.enabled ? "on" : "off"}` },
              t(entry.enabled ? "panel.statusEnabled" : "panel.statusDisabled")),
            Switch({
              checked: entry.enabled,
              disabled: busyId === entry.id,
              title: entry.name,
              onToggle: () => onToggle(entry),
            }),
          )),
        ),
        h("div", { className: "dsm-footer" }, t("panel.disclaimer")),
      );
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS));
        ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
          name: "main",
          key: PANEL_KEY,
          locale: NS,
        }, App)));
        ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_KEY,
          order: 60,
          locale: NS,
        }, PanelIcon)));
      },
    };
  },
});
