/**
 * Host half of the DSH Startup Manager bundle.
 *
 * Responsibilities:
 *  - Scan Windows auto-start entries: registry Run/RunOnce keys (HKCU, HKLM,
 *    HKLM Wow6432Node) plus per-user and common Startup folders.
 *  - Persist a baseline so entries that were not known before are flagged as
 *    "new" (typically just-installed programs).
 *  - Enable/disable entries: registry values are moved between the live key and
 *    a sibling `<key>_dsh_disabled` key; Startup-folder files are moved into a
 *    `_dsh_disabled` subfolder. HKLM entries need an elevated Host.
 *  - Serve a package-private HTTP API under /dsh-plugin/startup-manager/api
 *    through the Host webServer service, consumed by the Client panel.
 *
 * No third-party dependencies: only node: builtins.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const API_PREFIX = "/dsh-plugin/startup-manager/api";
/** Custom header required on every API call; a cross-origin page cannot set it without a CORS preflight, which this API never answers. */
const REQUEST_HEADER = "x-dsh-startup-manager";
const DISABLED_SUFFIX = "_dsh_disabled";
const FOLDER_DISABLED_DIR = "_dsh_disabled";
const FOLDER_EXTENSIONS = new Set([".lnk", ".url", ".exe", ".bat", ".cmd", ".vbs", ".ps1", ".js"]);
const SCAN_TTL_MS = 3000;
/** Local descriptions for well-known auto-start programs (fallback when the exe carries no FileDescription). */
const KNOWN_APPS = {
  "msedge.exe": "Microsoft Edge 浏览器",
  "microsoftedgeupdate.exe": "Microsoft Edge 更新组件",
  "microsoftedgeautolaunch.exe": "Microsoft Edge 自启动",
  "everything.exe": "Everything 文件搜索工具",
  "awesun.exe": "向日葵远程控制",
  "sunloginclient.exe": "向日葵远程控制",
  "hipstray.exe": "火绒安全软件托盘",
  "sysdiag.exe": "火绒安全软件",
  "wsctrlsvc.exe": "火绒安全服务",
  "baidupinyin.exe": "百度输入法",
  "vmware-tray.exe": "VMware Workstation 托盘程序",
  "vmware.exe": "VMware Workstation 虚拟机",
  "rtkauduservice64.exe": "Realtek 高清音频管理器",
  "workbuddy.exe": "WorkBuddy 桌面助手",
  "wechat.exe": "微信",
  "weixin.exe": "微信",
  "qq.exe": "腾讯 QQ",
  "dingtalk.exe": "钉钉",
  "feishu.exe": "飞书",
  "lark.exe": "飞书",
  "onedrive.exe": "Microsoft OneDrive 同步客户端",
  "steam.exe": "Steam 游戏平台",
  "teamviewer.exe": "TeamViewer 远程控制",
  "todesk.exe": "ToDesk 远程控制",
};
/** The Host process PATH may be minimal; reg.exe is resolved absolutely. */
const REG_EXE = join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", "reg.exe");
const SCHTASKS_EXE = join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", "schtasks.exe");
const SC_EXE = join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32", "sc.exe");

const REGISTRY_SOURCES = [
  { root: "HKCU", key: "Software\\Microsoft\\Windows\\CurrentVersion\\Run" },
  { root: "HKCU", key: "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce" },
  { root: "HKLM", key: "Software\\Microsoft\\Windows\\CurrentVersion\\Run" },
  { root: "HKLM", key: "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce" },
  { root: "HKLM", key: "Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run" },
];

function fullKey(source) {
  return `${source.root}\\${source.key}`;
}

function disabledKey(source) {
  return `${fullKey(source)}${DISABLED_SUFFIX}`;
}

function entryId(kind, source, name) {
  return createHash("sha1").update(`${kind}|${source}|${name}`).digest("hex").slice(0, 12);
}

/** Run one process, resolving with { code, stdout, stderr }; killed after timeoutMs. */
function run(command, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill();
        reject(new Error(`Process timed out after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      }
    });
  });
}

/** Parse `reg query` output rows into { name, type, data }; skips the (Default) row and headers. */
function parseRegQuery(stdout) {
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s{2,}(REG_[A-Z]+)\s{2,}(.*)$/);
    if (!match) continue;
    const name = match[1].trim();
    if (name === "(默认)" || name === "(Default)") continue;
    rows.push({ name, type: match[2], data: match[3].trim() });
  }
  return rows;
}

/** Best-effort executable path extracted from a startup command line. */
function targetOf(command) {
  if (!command) return "";
  const quoted = command.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  const exe = command.match(/^(\S+?\.exe)\b/i);
  if (exe) return exe[1];
  const first = command.split(/\s+/)[0] ?? "";
  return first.trim();
}

function statSafe(path) {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

class StartupManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.baselineFile = join(dataDir, "baseline.json");
    this.baseline = this.loadBaseline();
    this.lastScan = undefined;
    this.scanPromise = undefined;
  }

  loadBaseline() {
    try {
      const parsed = JSON.parse(readFileSync(this.baselineFile, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.known && typeof parsed.known === "object") return parsed;
    } catch {
      /* first run or unreadable file: start from an empty baseline */
    }
    return { version: 1, host: hostname(), acceptedAt: undefined, known: {} };
  }

  saveBaseline() {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.baselineFile, `${JSON.stringify(this.baseline, null, 2)}\n`, "utf8");
  }

  /** Scan every supported source; results are cached briefly. */
  async scan(force = false) {
    if (!force && this.lastScan && Date.now() - this.lastScan.at < SCAN_TTL_MS) return this.lastScan.value;
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.doScan().finally(() => {
      this.scanPromise = undefined;
    });
    return this.scanPromise;
  }

  async doScan() {
    const entries = [];
    for (const source of REGISTRY_SOURCES) {
      entries.push(...(await this.scanRegistryKey(source, false)));
      entries.push(...(await this.scanRegistryKey(source, true)));
    }
    for (const folder of this.startupFolders()) {
      entries.push(...this.scanFolder(folder, false));
      entries.push(...this.scanFolder(join(folder, FOLDER_DISABLED_DIR), true));
    }
    const system = await this.scanTasksAndServices();
    for (const task of system.tasks) {
      const command = [task.exec, task.args].filter(Boolean).join(" ");
      const targetPath = targetOf(command);
      entries.push({
        id: entryId("task", task.taskPath, task.taskName),
        kind: "task",
        source: task.taskPath,
        name: task.taskName,
        command,
        targetPath,
        targetModifiedAt: statSafe(targetPath),
        enabled: task.state !== "Disabled",
        canToggle: true,
        adminRequired: false,
        state: task.state,
      });
    }
    for (const service of system.services) {
      const targetPath = targetOf(service.pathName ?? "");
      entries.push({
        id: entryId("service", "Services", service.serviceName),
        kind: "service",
        source: "Services",
        name: service.displayName || service.serviceName,
        command: service.pathName ?? "",
        targetPath,
        targetModifiedAt: statSafe(targetPath),
        enabled: true,
        canToggle: true,
        adminRequired: true,
        serviceName: service.serviceName,
        startMode: service.delayed ? "delayed-auto" : "auto",
        state: service.state,
      });
    }
    const approved = await this.scanStartupApproved();
    const descriptions = await this.describeTargets(entries.map((entry) => entry.targetPath));
    const scannedAt = new Date().toISOString();
    for (const entry of entries) {
      const info = descriptions[(entry.targetPath ?? "").toLowerCase()] ?? {};
      const exeName = (entry.targetPath ?? "").split("\\").pop()?.toLowerCase() ?? "";
      entry.description = info.description || KNOWN_APPS[exeName] || undefined;
      entry.company = info.company || undefined;
      if (entry.kind === "registry" && !entry.source.includes(DISABLED_SUFFIX)) {
        const state = approved[this.approvedScopeFor(entry.source)].get(entry.name);
        if (state) entry.enabled = state.enabled;
      } else if (entry.kind === "folder" && !entry.source.includes(FOLDER_DISABLED_DIR)) {
        const state = approved.StartupFolder.get(entry.name);
        if (state) entry.enabled = state.enabled;
      }
      const known = this.baseline.known[entry.id];
      entry.firstSeenAt = known ?? scannedAt;
      entry.isNew = !known;
    }
    entries.sort((a, b) => (a.isNew === b.isNew ? a.name.localeCompare(b.name) : a.isNew ? -1 : 1));
    const result = {
      ok: true,
      host: hostname(),
      scannedAt,
      entries,
      counts: {
        total: entries.length,
        enabled: entries.filter((entry) => entry.enabled).length,
        disabled: entries.filter((entry) => !entry.enabled).length,
        new: entries.filter((entry) => entry.isNew).length,
      },
    };
    this.lastScan = { at: Date.now(), value: result };
    return result;
  }

  startupFolders() {
    const folders = [];
    const appData = process.env.APPDATA;
    const programData = process.env.ProgramData;
    if (appData) folders.push(join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"));
    if (programData) folders.push(join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"));
    return folders.filter((folder) => existsSync(folder));
  }

  /**
   * Read Windows version metadata (FileDescription / CompanyName) for every unique
   * target executable in ONE PowerShell round-trip (base64 in/out, encoding-safe).
   * Returns a map keyed by lower-cased path.
   */
  async describeTargets(paths) {
    const unique = [...new Set((paths ?? []).filter((p) => p && /\.(exe|dll)$/i.test(p) && existsSync(p)))];
    const result = {};
    if (unique.length === 0) return result;
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$paths = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(unique), "utf8").toString("base64")}')) | ConvertFrom-Json`,
      "$out = @($paths | ForEach-Object { $i = Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue; if ($i) { [pscustomobject]@{ path = $_.ToLowerInvariant(); description = [string]$i.VersionInfo.FileDescription; company = [string]$i.VersionInfo.CompanyName } } })",
      "if ($out.Count -gt 0) { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($out | ConvertTo-Json -Compress))) } else { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('[]')) }",
    ].join("\n");
    const { code, stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      20000,
    );
    if (code !== 0 || !stdout.trim()) return result;
    try {
      const rows = JSON.parse(Buffer.from(stdout.trim(), "base64").toString("utf8"));
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (row && row.path) result[row.path] = { description: row.description || "", company: row.company || "" };
      }
    } catch {
      /* metadata is best-effort: missing descriptions fall back to the local dictionary */
    }
    return result;
  }

  async scanRegistryKey(source, disabled) {
    const key = disabled ? disabledKey(source) : fullKey(source);
    const { code, stdout, stderr } = await run(REG_EXE, ["query", key]);
    if (code !== 0) {
      // A missing key is normal (never created / nothing disabled yet).
      if (stderr.includes("unable to find") || stderr.includes("系统找不到") || code === 1) return [];
      return [];
    }
    return parseRegQuery(stdout).map((row) => ({
      id: entryId("registry", fullKey(source), row.name),
      kind: "registry",
      source: fullKey(source),
      name: row.name,
      command: row.data,
      targetPath: targetOf(row.data),
      targetModifiedAt: statSafe(targetOf(row.data)),
      enabled: !disabled,
      canToggle: true,
      adminRequired: false,
    }));
  }

  /** Explorer-approved state (HKCU StartupApproved): first byte odd = disabled, matching Task Manager toggles. */
  async scanStartupApproved() {
    const approved = { Run: new Map(), Run32: new Map(), StartupFolder: new Map() };
    const roots = [
      ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run", "Run"],
      ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32", "Run32"],
      ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder", "StartupFolder"],
    ];
    for (const [key, scope] of roots) {
      const { code, stdout } = await run(REG_EXE, ["query", key]);
      if (code !== 0) continue;
      for (const row of parseRegQuery(stdout)) {
        const hex = row.data.replace(/\s+/g, "");
        const first = Number.parseInt(hex.slice(0, 2), 16);
        if (Number.isNaN(first)) continue;
        approved[scope].set(row.name, { enabled: first % 2 === 0 });
      }
    }
    return approved;
  }

  /** One PowerShell round-trip: logon/boot-triggered scheduled tasks (any state) + auto-start services. */
  async scanTasksAndServices() {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Triggers | Where-Object { $_.CimClass.CimClassName -in @('MSFT_TaskLogonTrigger','MSFT_TaskBootTrigger') } } | ForEach-Object { $t = $_; $a = @($t.Actions)[0]; if ($a) { [pscustomobject]@{ taskPath = $t.TaskPath; taskName = $t.TaskName; state = [string]$t.State; exec = [string]$a.Execute; args = [string]$a.Arguments } } })",
      "$services = @(Get-CimInstance Win32_Service -Filter \"StartMode='Auto'\" | ForEach-Object { $d = (Get-ItemProperty -Path ('HKLM:\\SYSTEM\\CurrentControlSet\\Services\\' + $_.Name) -Name DelayedAutoStart -ErrorAction SilentlyContinue).DelayedAutoStart; [pscustomobject]@{ serviceName = $_.Name; displayName = $_.DisplayName; delayed = [bool]$d; state = [string]$_.State; pathName = $_.PathName } })",
      "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ tasks = $tasks; services = $services } | ConvertTo-Json -Compress -Depth 4)))",
    ].join("\n");
    const { code, stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      30000,
    );
    if (code !== 0 || !stdout.trim()) return { tasks: [], services: [] };
    try {
      const parsed = JSON.parse(Buffer.from(stdout.trim(), "base64").toString("utf8"));
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        services: Array.isArray(parsed.services) ? parsed.services : [],
      };
    } catch {
      return { tasks: [], services: [] };
    }
  }

  scanFolder(folder, disabled) {
    if (!existsSync(folder)) return [];
    const source = folder;
    const out = [];
    for (const name of readdirSync(folder)) {
      if (!FOLDER_EXTENSIONS.has(name.slice(name.lastIndexOf(".")).toLowerCase())) continue;
      const fullPath = join(folder, name);
      let isFile = true;
      try {
        isFile = statSync(fullPath).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      out.push({
        id: entryId("folder", source, name),
        kind: "folder",
        source,
        name,
        command: fullPath,
        targetPath: fullPath,
        targetModifiedAt: statSafe(fullPath),
        enabled: !disabled,
        canToggle: true,
        adminRequired: false,
      });
    }
    return out;
  }

  /**
   * Toggle one entry by id. Strategy by kind:
   *  - registry: the Explorer-approved bit under HKCU StartupApproved (no admin needed,
   *    identical to Task Manager), restoring values parked in the legacy *_dsh_disabled key.
   *  - folder: the StartupApproved\StartupFolder bit, or a file move for items in _dsh_disabled.
   *  - task: schtasks /Change.  - service: sc config start= (administrator required).
   */
  async toggle(id, enable) {
    const snapshot = await this.scan();
    const entry = snapshot.entries.find((row) => row.id === id);
    if (!entry) return { ok: false, error: `Unknown entry id ${id}` };
    if (entry.enabled === enable) return { ok: true, entry: await this.refetchEntry(id) };
    let result;
    if (entry.kind === "registry") result = await this.toggleRegistry(entry, enable);
    else if (entry.kind === "folder") result = await this.toggleFolder(entry, enable);
    else if (entry.kind === "task") result = await this.toggleTask(entry, enable);
    else if (entry.kind === "service") result = await this.toggleService(entry, enable);
    else result = { ok: false, error: `Unsupported kind ${entry.kind}` };
    if (!result.ok) return result;
    this.lastScan = undefined;
    return { ok: true, entry: await this.refetchEntry(id) };
  }

  approvedScopeFor(source) {
    return source.includes("Wow6432Node") ? "Run32" : "Run";
  }

  approvedKeyFor(scope) {
    return `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\${scope}`;
  }

  async approvedValueExists(key, name) {
    const query = await run(REG_EXE, ["query", key, "/v", name]);
    return query.code === 0;
  }

  /** Ensure the Run value exists in its live key, restoring it from the legacy disabled key when needed. */
  async ensureValueInLiveKey(source, name) {
    const liveKey = fullKey(source);
    const query = await run(REG_EXE, ["query", liveKey, "/v", name]);
    if (query.code === 0) return true;
    const legacyKey = disabledKey(source);
    const legacy = await run(REG_EXE, ["query", legacyKey, "/v", name]);
    const row = parseRegQuery(legacy.stdout).find((item) => item.name === name);
    if (!row) return false;
    await run(REG_EXE, ["delete", legacyKey, "/v", name, "/f"]);
    const add = await run(REG_EXE, ["add", liveKey, "/v", row.name, "/t", row.type, "/d", row.data, "/f"]);
    return add.code === 0;
  }

  async toggleRegistry(entry, enable) {
    const source = REGISTRY_SOURCES.find((row) => fullKey(row) === entry.source);
    if (!source) return { ok: false, error: `Unknown registry source ${entry.source}` };
    const approvedKey = this.approvedKeyFor(this.approvedScopeFor(entry.source));
    if (enable) {
      // Removing the Explorer-approved disable marker re-enables the value wherever it lives.
      if (await this.approvedValueExists(approvedKey, entry.name)) {
        const del = await run(REG_EXE, ["delete", approvedKey, "/v", entry.name, "/f"]);
        if (del.code !== 0) return { ok: false, error: `reg delete failed: ${del.stderr.trim()}` };
      }
      if (!(await this.ensureValueInLiveKey(source, entry.name))) {
        return { ok: false, error: `Value ${entry.name} was not found under ${fullKey(source)} or its legacy disabled key` };
      }
      return { ok: true };
    }
    // Disable: the value must live under the real Run key, then flag it via StartupApproved.
    if (!(await this.ensureValueInLiveKey(source, entry.name))) {
      return { ok: false, error: `Value ${entry.name} was not found under ${fullKey(source)} or its legacy disabled key` };
    }
    const filetime = (BigInt(Date.now()) * 10000n + 116444736000000000n).toString(16).padStart(16, "0");
    const add = await run(REG_EXE, ["add", approvedKey, "/v", entry.name, "/t", "REG_BINARY", "/d", `03000000${filetime}`, "/f"]);
    if (add.code !== 0) return { ok: false, error: `reg add failed: ${add.stderr.trim()}` };
    return { ok: true };
  }

  async toggleFolder(entry, enable) {
    // Items already parked in _dsh_disabled keep the file-move strategy.
    if (entry.source.includes(FOLDER_DISABLED_DIR) || entry.command.includes(FOLDER_DISABLED_DIR)) {
      const dir = dirname(entry.command);
      const from = enable ? join(dir, FOLDER_DISABLED_DIR, basename(entry.command)) : entry.command;
      const to = enable ? join(dir, basename(entry.command)) : join(dir, FOLDER_DISABLED_DIR, basename(entry.command));
      try {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: `File move failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    // Live items use the Explorer-approved StartupFolder bit (same as Task Manager).
    const approvedKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder";
    if (enable) {
      if (await this.approvedValueExists(approvedKey, entry.name)) {
        const del = await run(REG_EXE, ["delete", approvedKey, "/v", entry.name, "/f"]);
        if (del.code !== 0) return { ok: false, error: `reg delete failed: ${del.stderr.trim()}` };
      }
      return { ok: true };
    }
    const filetime = (BigInt(Date.now()) * 10000n + 116444736000000000n).toString(16).padStart(16, "0");
    const add = await run(REG_EXE, ["add", approvedKey, "/v", entry.name, "/t", "REG_BINARY", "/d", `03000000${filetime}`, "/f"]);
    if (add.code !== 0) return { ok: false, error: `reg add failed: ${add.stderr.trim()}` };
    return { ok: true };
  }

  async toggleTask(entry, enable) {
    const taskPath = `${entry.source}${entry.name}`;
    const result = await run(SCHTASKS_EXE, ["/Change", "/TN", taskPath, enable ? "/ENABLE" : "/DISABLE"], 20000);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
      return { ok: false, error: `schtasks failed: ${detail}` };
    }
    return { ok: true };
  }

  async toggleService(entry, enable) {
    if (!enable) {
      const result = await run(SC_EXE, ["config", entry.serviceName, "start=", "disabled"], 20000);
      if (result.code !== 0) {
        return { ok: false, error: `sc config failed (administrator required): ${(result.stderr || result.stdout).trim()}` };
      }
      return { ok: true };
    }
    const startMode = entry.startMode === "delayed-auto" ? "delayed-auto" : entry.startMode ?? "auto";
    const result = await run(SC_EXE, ["config", entry.serviceName, "start=", startMode], 20000);
    if (result.code !== 0) {
      return { ok: false, error: `sc config failed (administrator required): ${(result.stderr || result.stdout).trim()}` };
    }
    return { ok: true };
  }

  async refetchEntry(id) {
    const fresh = await this.scan(true);
    return fresh.entries.find((row) => row.id === id) ?? undefined;
  }

  /** Mark every currently listed entry as known; future entries will be flagged as new. */
  async acceptBaseline() {
    const snapshot = await this.scan(true);
    const now = new Date().toISOString();
    for (const entry of snapshot.entries) {
      this.baseline.known[entry.id] = this.baseline.known[entry.id] ?? entry.firstSeenAt ?? now;
    }
    this.baseline.acceptedAt = now;
    this.baseline.host = hostname();
    this.saveBaseline();
    this.lastScan = undefined;
    return { ok: true, acceptedAt: now, total: snapshot.entries.length };
  }
}


function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** The webServer row must activate before this plugin: the whole capability hangs off its route table. */
export const inject = ["webServer"];

/** Host plugin entry. */
export function apply(ctx) {
  const webServer = ctx.get?.("webServer");
  if (!webServer || typeof webServer.register !== "function") {
    ctx.logger?.warn?.("startup-manager: webServer service unavailable; the panel API stays disabled.");
    return;
  }

  const manager = new StartupManager(join(homedir(), ".dsh-startup-manager"));

  ctx.effect(() => webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      async handler(req, res) {
        const url = new URL(req.url ?? "/", "http://local");
        const route = url.pathname.slice(API_PREFIX.length) || "/";
        const send = (code, payload) => {
          const body = JSON.stringify(payload);
          res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(body);
        };
        try {
          if (req.headers[REQUEST_HEADER] !== "1") {
            send(403, { ok: false, error: "Missing request header" });
            return;
          }
          if (req.method === "GET" && route === "/list") {
            send(200, await manager.scan(false));
            return;
          }
          if (req.method === "POST" && route === "/rescan") {
            send(200, await manager.scan(true));
            return;
          }
          if (req.method === "POST" && route === "/accept") {
            send(200, await manager.acceptBaseline());
            return;
          }
          if (req.method === "POST" && route === "/toggle") {
            const raw = await readBody(req);
            const body = JSON.parse(raw || "{}");
            const result = await manager.toggle(String(body.id ?? ""), Boolean(body.enable));
            send(result.ok ? 200 : 409, result);
            return;
          }
          if (req.method === "GET" && route === "/health") {
            send(200, { ok: true, host: hostname(), dataDir: manager.dataDir });
            return;
          }
          send(404, { ok: false, error: `Unknown API route ${route}` });
        } catch (error) {
          send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
  }));

  // Readiness pre-warm: populate the cache so the first panel open is instant.
  manager.scan(false).catch(() => {});
}

export default apply;
