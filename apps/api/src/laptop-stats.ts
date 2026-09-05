import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir, hostname, loadavg, totalmem, freemem, cpus, uptime, platform, release, arch } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readNumber(path: string): Promise<number | null> {
  const t = await readText(path);
  if (t == null || t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface BatteryInfo {
  percent: number | null;
  status: string | null;
  present: boolean;
}

export interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: string;
  mount: string;
}

export interface FanInfo {
  name: string;
  rpm: number;
}

export interface TempInfo {
  name: string;
  celsius: number;
}

export interface LaptopStats {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: {
    model: string;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: {
    total: string;
    used: string;
    free: string;
    usedPercent: number;
  };
  battery: BatteryInfo;
  disks: DiskInfo[];
  fans: FanInfo[];
  temps: TempInfo[];
  collectedAt: string;
}

async function readBattery(): Promise<BatteryInfo> {
  try {
    const entries = await readdir("/sys/class/power_supply");
    const bat = entries.find((e) => e.toUpperCase().startsWith("BAT"));
    if (!bat) return { percent: null, status: null, present: false };
    const base = `/sys/class/power_supply/${bat}`;
    const percent = await readNumber(join(base, "capacity"));
    const status = await readText(join(base, "status"));
    return { percent, status, present: true };
  } catch {
    return { percent: null, status: null, present: false };
  }
}

async function readDisks(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execFileAsync("df", ["-h", "--output=source,size,used,avail,pcent,target", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs"]);
    const lines = stdout.trim().split("\n").slice(1);
    const disks: DiskInfo[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [filesystem, size, used, avail, usePercent, ...mountParts] = parts;
      const mount = mountParts.join(" ");
      if (!filesystem || !mount) continue;
      if (!mount.startsWith("/") || mount.startsWith("/snap") || mount.startsWith("/boot/efi")) continue;
      if (mount.startsWith("/sys") || mount.startsWith("/proc") || mount.startsWith("/run")) continue;
      if (seen.has(filesystem + mount)) continue;
      seen.add(filesystem + mount);
      disks.push({
        filesystem,
        size: size!,
        used: used!,
        avail: avail!,
        usePercent: usePercent!,
        mount,
      });
    }
    return disks.slice(0, 8);
  } catch {
    return [];
  }
}

async function readHwmon(): Promise<{ fans: FanInfo[]; temps: TempInfo[] }> {
  const fans: FanInfo[] = [];
  const temps: TempInfo[] = [];
  try {
    const hwmons = await readdir("/sys/class/hwmon");
    for (const hw of hwmons) {
      const base = `/sys/class/hwmon/${hw}`;
      const chip = (await readText(join(base, "name"))) ?? hw;
      const files = await readdir(base);

      for (const f of files) {
        const fanMatch = /^fan(\d+)_input$/.exec(f);
        if (fanMatch) {
          const rpm = await readNumber(join(base, f));
          if (rpm != null && rpm > 0) {
            const label =
              (await readText(join(base, `fan${fanMatch[1]}_label`))) ?? `Fan ${fanMatch[1]}`;
            fans.push({ name: `${chip}/${label}`, rpm });
          }
        }
        const tempMatch = /^temp(\d+)_input$/.exec(f);
        if (tempMatch) {
          const milli = await readNumber(join(base, f));
          if (milli != null) {
            const celsius = milli / 1000;
            if (celsius > 0 && celsius < 150) {
              const label =
                (await readText(join(base, `temp${tempMatch[1]}_label`))) ??
                `Temp ${tempMatch[1]}`;
              // Prefer CPU package / core / ACPI over wifi noise
              if (/core|package|acpitz|cpu|Composite/i.test(`${chip} ${label}`) || temps.length < 6) {
                temps.push({ name: `${chip}/${label}`, celsius: Math.round(celsius * 10) / 10 });
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Deduplicate / sort
  fans.sort((a, b) => a.name.localeCompare(b.name));
  temps.sort((a, b) => b.celsius - a.celsius);
  return {
    fans: fans.slice(0, 8),
    temps: temps.slice(0, 8),
  };
}

export async function getLaptopStats(): Promise<LaptopStats> {
  const cpuList = cpus();
  const total = totalmem();
  const free = freemem();
  const used = total - free;
  const [load1, load5, load15] = loadavg();
  const battery = await readBattery();
  const disks = await readDisks();
  const { fans, temps } = await readHwmon();

  return {
    hostname: hostname(),
    platform: `${platform()} ${release()}`,
    arch: arch(),
    uptime: formatUptime(uptime()),
    cpu: {
      model: cpuList[0]?.model?.trim() || "CPU",
      cores: cpuList.length,
      load1: Math.round((load1 ?? 0) * 100) / 100,
      load5: Math.round((load5 ?? 0) * 100) / 100,
      load15: Math.round((load15 ?? 0) * 100) / 100,
    },
    memory: {
      total: formatBytes(total),
      used: formatBytes(used),
      free: formatBytes(free),
      usedPercent: Math.round((used / total) * 100),
    },
    battery,
    disks,
    fans,
    temps,
    collectedAt: new Date().toISOString(),
  };
}

export function formatLaptopReport(stats: LaptopStats): string {
  const lines: string[] = [
    `Laptop status — ${stats.hostname}`,
    `OS: ${stats.platform} (${stats.arch}) · up ${stats.uptime}`,
    "",
    `CPU: ${stats.cpu.model}`,
    `  Cores: ${stats.cpu.cores} · Load: ${stats.cpu.load1} / ${stats.cpu.load5} / ${stats.cpu.load15}`,
    `Memory: ${stats.memory.used} / ${stats.memory.total} (${stats.memory.usedPercent}% used)`,
  ];

  if (stats.battery.present) {
    lines.push(
      `Battery: ${stats.battery.percent ?? "?"}% · ${stats.battery.status ?? "unknown"}`,
    );
  } else {
    lines.push("Battery: not detected (desktop / no BAT sysfs)");
  }

  if (stats.fans.length) {
    lines.push("Fans:");
    for (const f of stats.fans) lines.push(`  ${f.name}: ${f.rpm} RPM`);
  } else {
    lines.push("Fans: not available (no fan sensors exposed)");
  }

  if (stats.temps.length) {
    lines.push("Temperatures:");
    for (const t of stats.temps.slice(0, 5)) lines.push(`  ${t.name}: ${t.celsius}°C`);
  }

  if (stats.disks.length) {
    lines.push("Storage:");
    for (const d of stats.disks) {
      lines.push(`  ${d.mount}: ${d.used} / ${d.size} (${d.usePercent}) · free ${d.avail}`);
    }
  }

  lines.push("", `Home: ${homedir()}`);
  return lines.join("\n");
}

export function isLaptopStatusIntent(message: string): boolean {
  const m = message.toLowerCase().trim();
  if (!m) return false;

  // Never treat file/search intents as laptop status
  if (/\b(create|delete|folder|file|download|search|google|wikipedia)\b/.test(m)) {
    return false;
  }

  // Short / casual phrases users actually say
  if (
    /^(how'?s?\s+(the\s+)?system|how\s+(is\s+)?(the\s+)?system|the\s+system|my\s+system|system\s*(status|info|health)?|laptop(\s+status)?|pc\s+status|check\s+(the\s+)?system|show\s+(the\s+)?system)$/i.test(
      m,
    )
  ) {
    return true;
  }

  if (
    /\b(battery|fan\s*speeds?|fans?|temperature|temps?|cpu\s*usage|ram|memory\s*usage|storage|disk\s*space|laptop\s*status|system\s*status|system\s*info)\b/.test(
      m,
    )
  ) {
    return true;
  }

  if (
    /\b(how'?s?|how\s+is|check|show|what'?s?|tell\s+me)\b.*\b(battery|laptop|system|pc|computer|storage|fan|temp|memory|cpu)\b/i.test(
      m,
    )
  ) {
    return true;
  }

  if (/\bmy (laptop|pc|computer|system)\b/i.test(m)) return true;

  return false;
}
