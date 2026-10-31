# DSH Startup Manager（自启动管理）

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](#版本)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#环境要求)
[![DSH](https://img.shields.io/badge/for-DeepSeek%20Harness%20≥0.2.x-3D7BFA)](https://github.com/deepseek-ai/deepseek-harness)

**English** | [中文](#中文说明) · [README.en.md](./README.en.md)

一个 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)插件：在 DSH Web 界面中集中查看并管理**本机全部开机自启动项**——注册表、启动文件夹、计划任务、系统服务四类来源一网打尽，自动高亮**新安装**软件写入的自启动条目，并正确识别你在任务管理器里禁用过的项。界面简洁、跟随 DSH 明暗主题，零第三方依赖。

---

## <a id="中文说明"></a>功能特性

- **四类来源全景扫描**
  1. 注册表 `Run` / `RunOnce`（HKCU、HKLM、HKLM Wow6432Node 共 5 个键）；
  2. 「用户启动文件夹」与「公共启动文件夹」；
  3. **计划任务**：登录/开机触发的任务，包括已被禁用的任务；
  4. **自动启动系统服务**：`StartMode=Auto` 的全部服务，含延迟启动（DelayedAutoStart）。

  每条列出名称、完整命令行、来源位置、目标文件修改时间，以及类型标签（注册表 / 启动文件夹 / 计划任务 / 系统服务）。
- **新增检测（包括新安装的）**：本地基线（`~/.dsh-startup-manager/baseline.json`）比对。基线中不存在的条目（典型场景：刚安装的软件悄悄加了自启动）高亮 **NEW** 徽标并置顶；确认后一键 **标记已知**，之后新增的才会再次提示。
- **禁用状态识别**：读取资源管理器的 `StartupApproved` 标记（Run / Run32 / StartupFolder）——你在任务管理器里禁用过的条目会正确显示为“已禁用”，与本机真实生效状态一致。
- **启停管理**：每个条目一个开关，按类型选择与 Windows 语义一致的最安全机制：
  - **注册表 / 启动文件夹**：与任务管理器相同的 `StartupApproved` 位（写入/删除 HKCU 标记），**无需管理员**，HKLM 来源的条目也可按用户禁用/恢复；早期版本移入 `*_dsh_disabled` 位置的条目仍能识别与还原；
  - **计划任务**：`schtasks /Change` 启用/禁用；
  - **系统服务**：`sc config start=` 禁用，恢复时还原原启动模式（自动 / 延迟启动）——需要管理员权限的宿主。
- **用途备注**：每条显示目标程序的“文件说明”与发布公司（单次 PowerShell 批量读取全部目标，Base64 进出避免编码问题），常见软件（微信、Edge、向日葵、火绒、Everything、Steam 等）由内置词典兜底。
- **权限感知**：需要管理员的操作（系统服务启停）在非提权宿主上会明确报错，绝不静默失败。
- **简洁界面**：侧栏火箭图标 → 中央管理页；统计徽标（总数/已启用/已禁用/新增）、筛选（全部/已启用/已禁用/新增）、关键字搜索、刷新/重扫、面板内滚动；全部文本走 DSH 多语言服务（中/英），配色仅引用 `--dsw-alias-*` 主题令牌，自动跟随明暗主题。
- **零依赖**：Host 半端仅使用 Node 内置模块与 Windows 自带工具（`reg.exe`、`schtasks.exe`、`sc.exe`、PowerShell、`node:http` 路由）。

## 环境要求

- Windows 10/11（扫描与启停依赖 `reg.exe`、`schtasks.exe`、`sc.exe`、PowerShell 与启动文件夹约定）。
- DeepSeek Harness ≥ 0.2.x，且当前组合中激活了 Web GUI（提供 `webServer` 服务；桌面 file:// 形态暂不支持，见 Roadmap）。
- 普通用户权限即可查看全部条目、切换注册表/启动文件夹/计划任务；**系统服务**的启停需要 DSH 宿主以管理员身份运行。

## 安装

### 方式一：通过 DSH 插件管理（推荐）

在 DSH 会话中调用插件管理工具，将本仓库目录作为安装目标：

```
plugin_manager install_bundle  target=<本仓库的绝对路径>
```

安装后插件写入当前 profile 并激活（Host 路由即时生效）。

> 提示：安装后请**刷新一次 DSH 页面**以装载 Client 面板；若面板提示 API 不可达，**重启一次 DSH** 让 Host 半端干净激活（在已运行的宿主上首次安装时，旧模块的路由需随进程重启释放）。

### 方式二：手动安装

把本仓库克隆到任意目录，然后同样用 `plugin_manager install_bundle` 指向该目录即可；DSH 会读取 `package.json` 的 `dsh.bundle.patch` 与 `dsh.client` 声明完成双端装载。

## 使用

1. 打开 DSH Web 界面，点击左侧栏的 **Startup Manager / 自启动管理** 图标（火箭）。
2. 顶部展示 总数 / 已启用 / 已禁用 / **新增** 统计与上次扫描时间、主机名。
3. 用筛选页签（全部/已启用/已禁用/新增）或搜索框（名称、命令、来源、类型）定位条目。
4. 点击行尾开关即可 **禁用/恢复**：注册表与启动文件夹项与任务管理器行为一致（下次登录生效）；计划任务立即改变任务状态；系统服务需要管理员宿主。
5. 装了新软件后点 **刷新/重扫**：新条目带 **NEW** 徽标浮顶；确认后点 **标记已知**。
6. 首次使用请先点一次 **标记已知** 建立基线（否则当时已存在的条目全部标记为“新”）。

## 数据与安全

- 本机数据只有一份基线：`%USERPROFILE%\.dsh-startup-manager\baseline.json`（纯 JSON，可随时删除重建）。用途备注在内存中缓存，不落盘。
- HTTP API 挂载在 `/dsh-plugin/startup-manager/api`，每个请求必须携带自定义头 `x-dsh-startup-manager: 1`——跨源页面无法静默设置该头（会触发 CORS 预检，而本 API 不应答预检），从而防跨站调用。
- 不修改任何程序文件、不删除任何条目：注册表/启动文件夹的“禁用”是打上 `StartupApproved` 标记（与任务管理器同机制，随时可逆）；历史遗留的隔离位置条目仍可还原。
- 不采集、不上传任何数据。

## 架构

详见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。概览：

```
┌─ Client（浏览器半端 client.js）────────────────────────────┐
│ sidebar.panellist 图标 ──▶ main 面板（React，主题令牌）      │
│        │  fetch /dsh-plugin/startup-manager/api            │
└────────┼───────────────────────────────────────────────────┘
         ▼
┌─ Host（Node 半端 index.js）────────────────────────────────┐
│ webServer 路由                                             │
│  ├ 扫描器：reg.exe（Run 键 + StartupApproved）              │
│  │          启动文件夹、PowerShell（计划任务/服务/文件说明） │
│  ├ 基线存储（~/.dsh-startup-manager/baseline.json）         │
│  └ 启停：StartupApproved 位 / schtasks / sc config          │
└─────────────────────────────────────────────────────────────┘
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/list` | 扫描并列出全部条目（3 秒缓存） |
| POST | `/api/rescan` | 强制重扫 |
| POST | `/api/toggle` | `{ id, enable }` 启用/禁用单个条目 |
| POST | `/api/accept` | 将当前列表写入基线（清除 NEW 标记） |
| GET | `/api/health` | 健康检查与数据目录位置 |

所有请求必须携带 `x-dsh-startup-manager: 1` 头。

## 已知限制

- UWP/商店应用的启动项暂不覆盖。
- `.lnk` 快捷方式暂不解析真实目标，命令列显示为快捷方式路径。
- 系统服务的启停需要 DSH 宿主以管理员权限运行；非提权时点击会明确报错，不会静默失败。
- 桌面 file:// 形态的 DSH（无 HTTP 服务）暂不支持，需未来接入 typert 远程通道。
- “新安装”的判定以**基线比对**为准：首次安装插件后的第一次扫描会把当时已存在的条目全部视为“新”（请先点一次“标记已知”建立基线）。

## Roadmap

- [ ] `.lnk` 目标解析
- [ ] UWP/商店应用启动项
- [ ] 多机采集：聚合局域网内多台电脑的自启动快照（数据模型已预留 `host` 字段）
- [ ] 桌面 file:// 形态支持（typert 远程通道替代 HTTP 路由）
- [ ] 导出/导入基线快照

## 开发

```
dsh-startup-manager/
├── package.json          # dsh.bundle.patch + dsh.client 双端声明
├── cordis.patch.yml      # Loader 行插入（id: dsh-startup-manager）
├── index.js              # Host 半端：四类来源扫描/启停/基线 + webServer 路由
├── client.js             # Client 半端：main 面板 + 侧栏图标（React 无 JSX）
├── icon.svg              # 原创图标
├── locale/en.json        # 插件管理器展示元数据（英文）
├── locale/zh.json        # 插件管理器展示元数据（中文）
└── docs/ARCHITECTURE.md  # 架构与数据模型
```

本地校验语法：

```
node --input-type=module --check < index.js
node --input-type=module --check < client.js
```

安装进当前 profile 后，可通过 `cordis_inspect_query`（Slots）确认 `main` 与 `sidebar.panellist` 的注册是否生效。

## License

[MIT](./LICENSE)
