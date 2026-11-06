import os from "node:os";

/** Status mesin (VPS) dan proses ini pada saat terakhir dicuplik. Dicatat di tiap baris log permintaan. */
export interface SystemStatus {
  /** Pemakaian CPU seluruh mesin sejak cuplikan sebelumnya, persen (0-100). */
  cpuPct: number;
  /** Load average 1 menit (mesin; di dalam container tetap angka host). */
  load1: number;
  /** Memori terpakai di mesin, persen dari total. */
  memUsedPct: number;
  /** Memori yang masih bisa dipakai, MB. */
  memAvailMb: number;
  /** Memori resident proses gateway ini, MB. */
  rssMb: number;
  /** Keterlambatan timer cuplikan, ms: tanda event loop proses ini tertahan. */
  lagMs: number;
}

export interface CpuTimes {
  idle: number;
  total: number;
}

/** Jumlah waktu idle dan total semua inti, dari `os.cpus()`. */
export function readCpuTimes(
  cpus: readonly os.CpuInfo[] = os.cpus(),
): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Persen CPU terpakai di antara dua cuplikan; 0 bila belum ada selisih. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idle / total) * 100)));
}

const SAMPLE_MS = 5_000;
const MB = 1024 * 1024;

let previousCpu = readCpuTimes();
let lastTick = Date.now();

function take(lagMs: number, cpuPct: number): SystemStatus {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    cpuPct,
    load1: Math.round(os.loadavg()[0]! * 100) / 100,
    memUsedPct: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
    memAvailMb: Math.round(free / MB),
    rssMb: Math.round(process.memoryUsage().rss / MB),
    lagMs,
  };
}

let snapshot: SystemStatus = take(0, 0);

const timer = setInterval(() => {
  const now = Date.now();
  const lagMs = Math.max(0, now - lastTick - SAMPLE_MS);
  lastTick = now;
  const cpu = readCpuTimes();
  const cpuPct = cpuPercent(previousCpu, cpu);
  previousCpu = cpu;
  snapshot = take(lagMs, cpuPct);
}, SAMPLE_MS);
timer.unref?.();

/** Cuplikan terbaru (dibarui tiap 5 detik); murah dibaca di tiap permintaan. */
export const systemStatus = (): SystemStatus => snapshot;
