# Changelog

## 0.2.0 — 2026-10-31

- **覆盖扩展**：新增计划任务（登录/开机触发，含已被禁用的任务）与自动启动系统服务（含延迟启动）两类来源
- **禁用状态识别**：读取资源管理器 `StartupApproved`（Run / Run32 / StartupFolder），任务管理器里禁用过的条目现在正确显示为“已禁用”
- **启停策略升级**：注册表与启动文件夹条目改用 `StartupApproved` 位（与任务管理器同机制，HKLM 条目无需管理员即可禁用/恢复）；计划任务走 `schtasks /Change`；服务走 `sc config start=`（需管理员，恢复时还原原启动模式）
- 界面：来源行显示类型标签（注册表/启动文件夹/计划任务/系统服务），管理员徽标改为语义化文案
- 修复：面板内滚动（height:100% + overflow-y:auto）；条目用途备注（exe FileDescription/公司名 + 常见软件词典）

## 0.1.0 — 2026-10-31

- 首个版本：自启动项扫描（注册表 Run/RunOnce × HKCU/HKLM/Wow6432Node + 用户/公共启动文件夹）
- 启停管理：注册表值在 `Run` 与 `Run_dsh_disabled` 间迁移；启动文件夹文件移入 `_dsh_disabled` 子目录
- 新增检测：本地基线（`~/.dsh-startup-manager/baseline.json`）比对，新条目高亮 NEW，支持一键“标记已知”
- 用途备注：优先读取目标 exe 的文件属性（FileDescription / CompanyName，单次 PowerShell 批量读取），并以本地常见软件词典兜底
- DSH Web 界面：侧栏图标 + 中央管理面板（筛选、搜索、面板内滚动、明暗主题跟随）
- Host HTTP API：`/dsh-plugin/startup-manager/api`（list / rescan / toggle / accept / health），自定义请求头防跨站调用
- 稳健性：`webServer` 经 `inject` 声明保证激活顺序；`reg.exe` 按 System32 绝对路径调用；Client 对空/非 JSON 响应给出可读错误
