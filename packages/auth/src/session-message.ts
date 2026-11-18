/** Sesi aktif yang menggantikan sesi yang diputus: perangkat yang login belakangan. */
export interface ReplacingSession {
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: Date | null;
}

/** Urutan penting: yang pertama cocok dipakai (Edge dan Opera memuat kata "Chrome"; Android dan iOS memuat "Linux" dan "Mac OS X"). */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
  [/curl\//i, "curl"],
];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iOS/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const firstMatch = (
  table: ReadonlyArray<[RegExp, string]>,
  ua: string,
): string | null => table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

/** "Chrome di Windows" dari header User-Agent; "curl", nama sistem saja, atau potongan User-Agent bila tidak dikenali. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "perangkat tidak dikenal";
  const browser = firstMatch(BROWSERS, ua);
  const system = firstMatch(SYSTEMS, ua);
  if (browser && system) return `${browser} di ${system}`;
  return browser ?? system ?? ua.slice(0, 60);
}

function wibTime(at: Date): string {
  const text = at.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${text} WIB`;
}

/**
 * Pesan untuk sesi yang diputus karena akun login di perangkat lain. Undefined bila perangkat yang menggantikan tampak
 * sama dengan perangkat yang sekarang meminta (token berputar di perangkat yang sama), supaya tidak menuduh perangkat lain.
 */
export function sessionTerminatedOverrides(
  other: ReplacingSession | null,
  requestUserAgent: string | null | undefined,
): { message: string; details: Record<string, unknown> } | undefined {
  if (!other) return undefined;
  const ua = (requestUserAgent ?? "").trim();
  const theirs = (other.deviceInfo ?? "").trim();
  if (ua && theirs && (ua === theirs || ua.startsWith(theirs))) {
    return undefined;
  }

  const device = describeDevice(other.deviceInfo);
  const ip = other.ipAddress?.trim() || null;
  const since = other.createdAt ? wibTime(other.createdAt) : null;
  const where = ip ? `${device}, ${ip}` : device;
  const message = `Akun ini sedang digunakan di perangkat lain (${where})${since ? ` sejak ${since}` : ""}. Sesi di perangkat ini telah diakhiri, silakan login kembali.`;
  return {
    message,
    details: {
      replacedBy: {
        device,
        userAgent: other.deviceInfo,
        ipAddress: ip,
        since: other.createdAt?.toISOString() ?? null,
      },
    },
  };
}
