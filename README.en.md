# DSH Startup Manager

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](#version)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#requirements)
[![DSH](https://img.shields.io/badge/for-DeepSeek%20Harness%20%E2%89%A50.2.x-3D7BFA)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](./README.md)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that gives you a clean, theme-aware panel inside the DSH web UI to **view and manage every auto-start entry on this machine** — registry keys, Startup folders, scheduled tasks, and services — flags entries added by **newly installed** software, and correctly reflects entries you already disabled via Task Manager. Zero third-party dependencies.

## Features

- **Four source families, one list**
  1. Registry `Run` / `RunOnce` keys (HKCU, HKLM, HKLM Wow6432Node — 5 keys total);
  2. The per-user and common Startup folders;
  3. **Scheduled Tasks**: logon/boot triggers, including already-disabled tasks;
  4. **Auto-start Services**: every `StartMode=Auto` service, including delayed-auto.

  Each entry shows its name, full command line, source location, target file's last-modified time, and a kind tag (Registry / Startup folder / Scheduled task / Service).
- **New-entry detection (including newly installed programs)**: entries are diffed against a local baseline (`~/.dsh-startup-manager/baseline.json`). Anything the baseline does not know — typically a just-installed app quietly adding persistence — gets a **NEW** badge and sorts to the top. One click on **Mark known** accepts the current list; only later additions get flagged again.
- **Disabled-state detection**: the Explorer `StartupApproved` markers (Run / Run32 / StartupFolder) are read, so entries you disabled via Task Manager correctly show as *Disabled*, matching what actually happens at sign-in.
- **Enable / disable**: one switch per entry, using the safest mechanism that matches Windows semantics:
  - **Registry / Startup-folder entries**: the same `StartupApproved` bit Task Manager uses (a HKCU marker write/delete) — **no administrator needed**, even for HKLM-sourced entries; items parked in the legacy `*_dsh_disabled` locations stay recognized and restorable;
  - **Scheduled tasks**: `schtasks /Change`;
  - **Services**: `sc config start=` to disable, re-enabling restores the original start mode (auto / delayed-auto) — requires an elevated Host.
- **Purpose annotations**: each row shows the target executable's "File description" and company (one batched PowerShell round-trip, base64 in/out to avoid encoding issues), with a built-in dictionary for well-known apps (Edge, WeChat, Sunlogin, Huorong, Everything, Steam, …).
- **Permission aware**: operations that need administrator rights (service toggles) fail with an explicit error on a non-elevated Host and never silently.
- **Clean UI**: a rocket icon in the sidebar opens a central management page with counters (Total / Enabled / Disabled / New), kind tags, filters (All / Enabled / Disabled / New), keyword search, refresh/rescan, and in-panel scrolling. All text goes through the DSH locale service (English / 简体中文) and all colors reference `--dsw-alias-*` theme tokens, so light and dark themes just work.
- **Zero dependencies**: the Host half uses only Node built-ins and Windows built-in tools (`reg.exe`, `schtasks.exe`, `sc.exe`, PowerShell, `node:http` route registration).

## Requirements

- Windows 10/11 (scanning and toggling rely on `reg.exe`, `schtasks.exe`, `sc.exe`, PowerShell, and Startup-folder conventions).
- DeepSeek Harness ≥ 0.2.x with the Web GUI active in the composition (the `webServer` service; the Desktop `file://` form is not supported yet — see Roadmap).
- A normal user session covers viewing everything and toggling registry/folder/task entries; **service** enable/disable requires an elevated DSH Host.

## Install

### Via the DSH plugin manager (recommended)

In a DSH session, call the plugin-manager tool with this repository's directory as the install target:

```
plugin_manager install_bundle  target=<absolute path to this repo>
```

The plugin is written into the current profile and activates (the Host route goes live immediately).

> Tip: after installing, **refresh the DSH page once** (to load the client panel); if the panel reports the API as unreachable, **restart DSH once** so the Host half activates cleanly (on a live Host, the first install's route is only released with a process restart).

### Manual

Clone this repository anywhere and point `plugin_manager install_bundle` at the directory. DSH reads the `dsh.bundle.patch` and `dsh.client` declarations in `package.json` and mounts both halves.

## Usage

1. Open the DSH web UI and click the **Startup Manager** rocket icon in the sidebar.
2. The header shows Total / Enabled / Disabled / **New** counters, the last scan time, and the machine name.
3. Use the filter tabs (All / Enabled / Disabled / New) or the search box (name, command, source, kind) to find an entry.
4. Click the switch at the end of a row to **disable/restore** auto-start: registry and Startup-folder entries behave exactly like Task Manager (applies on next sign-in); scheduled tasks change state immediately; services need an elevated Host.
5. After installing new software, hit **Refresh/Rescan**: brand-new entries float to the top with a **NEW** badge; click **Mark known** once you have reviewed them.
6. On first use, click **Mark known** once to establish the baseline (otherwise everything present at that moment is flagged as new).

## Data & security

- The only on-disk state is the baseline: `%USERPROFILE%\.dsh-startup-manager\baseline.json` (plain JSON, safe to delete). Purpose annotations are cached in memory only.
- The HTTP API is mounted at `/dsh-plugin/startup-manager/api` and requires the custom header `x-dsh-startup-manager: 1` on every request. A cross-origin page cannot set that header silently (it would trigger a CORS preflight, which this API never answers), which blocks cross-site calls.
- The plugin never modifies program files and never deletes entries: "disable" sets the same `StartupApproved` marker Task Manager uses (always reversible); legacy quarantined items remain restorable.
- No telemetry, no data collection.

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Overview:

```
┌─ Client (browser half, client.js) ─────────────────────────┐
│ sidebar.panellist icon ──▶ main panel (React, theme tokens)│
│        │  fetch /dsh-plugin/startup-manager/api            │
└────────┼───────────────────────────────────────────────────┘
         ▼
┌─ Host (Node half, index.js) ───────────────────────────────┐
│ webServer route                                            │
│  ├ scanner: reg.exe (Run keys + StartupApproved)           │
│  │           Startup folders, PowerShell (tasks/services/  │
│  │           file descriptions)                            │
│  ├ baseline store (~/.dsh-startup-manager/baseline.json)   │
│  └ toggles: StartupApproved bits / schtasks / sc config    │
└─────────────────────────────────────────────────────────────┘
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/list` | Scan and list all entries (3s cache) |
| POST | `/api/rescan` | Force a fresh scan |
| POST | `/api/toggle` | `{ id, enable }` — enable/disable one entry |
| POST | `/api/accept` | Write the current list into the baseline (clears NEW flags) |
| GET | `/api/health` | Health check and data directory |

Every request must carry the `x-dsh-startup-manager: 1` header.

## Known limitations

- UWP/Store app startup entries are not covered yet.
- `.lnk` shortcuts are not resolved to their real targets yet; the command column shows the shortcut path.
- Service enable/disable requires an elevated DSH Host; a non-elevated toggle fails with an explicit error and never silently.
- Desktop `file://` deployments without an HTTP server are not supported yet (a typert remote channel would replace the HTTP route).
- "New" is judged against the baseline: on the very first scan after installing the plugin, everything already present is effectively unknown — click **Mark known** once to establish the baseline.

## Roadmap

- [ ] `.lnk` target resolution
- [ ] UWP/Store app startup entries
- [ ] Multi-machine collection: aggregate startup snapshots from other PCs on the LAN (the data model already carries a `host` field)
- [ ] Desktop `file://` support (typert remote channel instead of HTTP routes)
- [ ] Baseline export/import

## Development

```
dsh-startup-manager/
├── package.json          # dsh.bundle.patch + dsh.client dual-face declarations
├── cordis.patch.yml      # Loader row insert (id: dsh-startup-manager)
├── index.js              # Host half: 4-family scan / toggles / baseline + webServer route
├── client.js             # Client half: main panel + sidebar icon (React, no JSX)
├── icon.svg              # original icon
├── locale/en.json        # Plugin Manager display metadata (English)
├── locale/zh.json        # Plugin Manager display metadata (Chinese)
└── docs/ARCHITECTURE.md  # architecture & data model
```

Syntax check locally:

```
node --input-type=module --check < index.js
node --input-type=module --check < client.js
```

After installing into your profile, confirm the live registrations with `cordis_inspect_query` (Slots): the `main` key and the `sidebar.panellist` entry should both appear.

## License

[MIT](./LICENSE)
