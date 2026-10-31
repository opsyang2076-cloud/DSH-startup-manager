# 架构说明 / Architecture

> DSH Startup Manager · v0.2.0

## 双端结构 / Dual-face bundle

本包同时声明 Host 半端与 Client 半端，由 DSH 一次装载：

| 半端 | 文件 | 运行位置 | 职责 |
|---|---|---|---|
| Host | `index.js`（`apply(ctx)`，`inject: ["webServer"]`） | DSH 宿主进程（本机 Node） | 四类来源扫描、启停、基线存储、HTTP API |
| Client | `client.js`（`window.__ModuleLoader__` 工厂） | DSH Web 界面 | 面板渲染、侧栏图标、多语言 |

`package.json` 声明：

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // Loader 行：id = dsh-startup-manager
    "client": { "platform": "web", "immediately": true, "inject": [] }
  }
}
```

> Host 半端通过 `export const inject = ["webServer"]` 声明硬依赖：保证 `webServer` 行先于本插件激活，路由注册不会因启动顺序竞态而丢失（v0.1.0 的实际事故）。

## 槽位 / Slots

| Slot | 注册 | 用途 |
|---|---|---|
| `main`（keyed） | `{ key: "dsh-startup-manager" }` | 中央管理页（与侧栏图标 id 对应） |
| `sidebar.panellist`（list） | `{ id: "dsh-startup-manager", order: 60 }` | 侧栏面板图标（火箭） |

两处注册都带 `locale: "dshStartupManager"`，框架会把 `props.t` 注入组件；字典经 `ctx.locale.register(NS, { en, zh })` 注册。

## 扫描来源与数据流 / Sources & data flow

```
面板（Client）                 HTTP                          Host
─────────────               ─────────                     ─────
GET  /api/list    ────────▶  扫描器（3s 缓存）
                              ├ reg query ×10+  5 个 Run 键（启用） + 对应 *_dsh_disabled（遗留禁用）
                              │                 + StartupApproved\{Run,Run32,StartupFolder}
                              ├ 目录枚举        用户/公共启动文件夹（含 _dsh_disabled）
                              ├ PowerShell ×1   Get-ScheduledTask（登录/开机触发，含 Disabled 状态）
                              │                 Get-CimInstance Win32_Service（StartMode=Auto + DelayedAutoStart）
                              ├ PowerShell ×1   目标 exe 批量读取 FileDescription/CompanyName（base64 进出）
                              └ 基线比对        isNew / firstSeenAt
POST /api/toggle  ────────▶  定位条目 → 按类型执行（见下表） → 强制重扫
POST /api/accept  ────────▶  当前清单写入 baseline.json
POST /api/rescan  ────────▶  强制重扫
```

## 条目模型 / Entry model

```jsonc
{
  "id": "a1b2c3d4e5f6",              // sha1(kind|source|name)[0..12]
  "kind": "registry" | "folder" | "task" | "service",
  "source": "HKCU\\...\\Run",         // 注册表键 / 文件夹绝对路径 / 任务路径 / "Services"
  "name": "Everything",
  "command": "\"C:\\Tools\\Everything.exe\" -startup",
  "targetPath": "C:\\Tools\\Everything.exe",
  "targetModifiedAt": "2026-10-31T02:11:09.000Z",
  "enabled": true,
  "canToggle": true,
  "adminRequired": false,             // service 恒为 true（sc config 需管理员）
  "description": "Everything 文件搜索工具",   // exe FileDescription → 本地词典 → 缺省
  "company": "voidtools",
  "isNew": true,
  "firstSeenAt": "2026-10-31T02:30:00.000Z",
  // task 专属
  "state": "Ready" | "Disabled" | "...",
  // service 专属
  "serviceName": "WSearch",
  "startMode": "auto" | "delayed-auto"
}
```

基线文件 `~/.dsh-startup-manager/baseline.json`：

```jsonc
{
  "version": 1,
  "host": "DESKTOP-XXXX",
  "acceptedAt": "2026-10-31T02:35:00.000Z",
  "known": { "a1b2c3d4e5f6": "2026-10-31T02:30:00.000Z" }
}
```

## 启停语义 / Toggle semantics

| 类型 | 禁用 | 恢复 | 管理员 |
|---|---|---|---|
| 注册表 | 确保值在 live 键后，写 `HKCU\...\Explorer\StartupApproved\<Run\|Run32>` 二进制标记（首字节 03 + FILETIME，与任务管理器同格式） | 删除该 StartupApproved 值；若值已被移入遗留 `*_dsh_disabled` 键则先迁回 | 不需要 |
| 启动文件夹 | 活动项：写 `StartupApproved\StartupFolder` 标记；已位于 `_dsh_disabled\` 的遗留项：移回/移出 | 同左 | 不需要 |
| 计划任务 | `schtasks /Change /TN "<path>" /DISABLE` | `... /ENABLE` | 视任务而定，失败显式报错 |
| 系统服务 | `sc config <name> start= disabled` | `sc config <name> start= auto \| delayed-auto`（还原原启动模式） | 需要（失败显式报错） |

- 全程**不修改、不删除任何程序文件与自启动注册表值本身**（注册表/文件夹启停只增删 `StartupApproved` 标记值）。
- 历史 note：v0.1.0 曾把注册表值整体迁移到 `*_dsh_disabled` 键、把启动文件移入隔离目录；v0.2.0 起保留对这些条目的识别与还原。

## StartupApproved 二进制格式 / Marker format

`reg query` 读出 `REG_BINARY`（12 字节）：首字节偶数（0x02/0x06）= 启用；奇数（0x03/0x07/0x0B）= 禁用；第 5–12 字节为禁用时刻的 FILETIME。写入禁用标记：

```
03000000 + <16 位十六进制 FILETIME（little-endian，当前时刻）>
```

## 安全 / Security

- API 要求请求头 `x-dsh-startup-manager: 1`。跨源页面无法静默携带自定义头（会触发 CORS 预检，本 API 不应答 OPTIONS），从而阻止恶意网页跨站调用。
- 面板与 API 同源（都由 DSH 的 `webServer` 提供服务），Desktop 场景监听回环地址。
- PowerShell 子进程全部使用 `-EncodedCommand`（UTF-16LE base64）传参：中文路径、引号、特殊字符零歧义；输出同样 base64 回传。
- 所有子进程调用带超时（15–30s），超时即杀，扫描不会卡死面板。
- 建议不要将该端口暴露到非回环地址（这是 DSH 自身的部署配置）。

## 性能 / Performance

- 一次完整扫描 ≈ 2 个 PowerShell 往返（系统条目 + 文件说明）+ 10 余次 `reg query`，实测 3–6s；`/api/list` 有 3s 缓存，面板打开与开关后的刷新共用该缓存。
- 目标文件说明按路径去重后批量读取（单次 PowerShell）。

## 已知边界 / Boundaries

- UWP/商店应用启动项未覆盖；`.lnk` 目标未解析。
- 计划任务/服务的启停依赖 Windows 工具，对他用户的任务可能报权限错误（显式失败）。
- 桌面 `file://` 形态（无 HTTP server）需要未来的 typert 远程通道。
