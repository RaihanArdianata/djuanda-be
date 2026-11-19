import type { FusedTrackEvent } from "@aeroswarm/core";
import { distanceM } from "./geo";

/**
 * Penyaring bayangan: target tanpa identitas yang sebenarnya hanyalah gema atau duplikat target lain dari sensor yang sama.
 *
 * Kasus yang melatarinya: sensor MLAT melaporkan pesawat SJY567 (alamat Mode-S dikenal) dan, beberapa meter darinya, satu "target" lain tanpa
 * alamat Mode-S (id sintetis `r1-1-278`) yang hanya bertahan beberapa laporan. Tanpa penyaringan, target kedua itu tampil di peta sebagai
 * pesawat kedua dan memicu alert Critical "memasuki apron yang sedang dipakai SJY567", padahal yang masuk adalah gema SJY567 sendiri.
 *
 * Aturan (keduanya bisa diatur lewat env, lihat conditioning-config.ts):
 *  1. Target tanpa identitas yang berada dalam `radiusM` dari target BERIDENTITAS dari sensor yang sama (laporan terakhir tidak lebih lama
 *     dari `maxAgeMs`) dianggap bayangan dan tidak diteruskan.
 *  2. Target tanpa identitas baru dianggap nyata setelah `minReports` laporan; sebelum itu ditahan.
 *  3. Gema yang tidak punya induk beridentitas: target tanpa identitas yang masih muda (kurang dari `establishedReports` laporan) dan
 *     menempel dalam `radiusM` pada target tanpa identitas LAIN yang sudah mapan (tampil, dan sudah `establishedReports` laporan atau
 *     lebih, dari sensor yang sama) dianggap gema dari target mapan itu. Target yang bertahan sampai `establishedReports` laporan
 *     dianggap nyata (mis. dua kendaraan berdampingan) dan tidak lagi disaring. 0 mematikan aturan ini.
 * Penyaringan dilakukan SEBELUM fusi, jadi bayangan tidak ikut disimpan, tidak tampil di peta, dan tidak sampai ke alert-service.
 */

export interface GhostFilterOptions {
  /** Jarak ke target beridentitas dari sensor yang sama di bawah ini membuat target tanpa identitas dianggap bayangan, meter. */
  radiusM: number;
  /** Jumlah laporan sebelum target tanpa identitas dianggap nyata. */
  minReports: number;
  /** Laporan target beridentitas yang lebih tua dari ini tidak dipakai sebagai pembanding, ms. */
  maxAgeMs: number;
  /** State target yang diam sekian lama dibuang, ms. */
  forgetAfterMs: number;
  /**
   * Target tanpa identitas dengan sekian laporan atau lebih dianggap mapan: ia boleh menjadi "induk" gema (aturan 3), dan tidak
   * pernah dianggap gema lagi. 0 mematikan aturan 3.
   */
  establishedReports: number;
  /**
   * Sembunyikan SEMUA target tanpa identitas (id sintetis `r1-1-123`), bukan hanya gema. Peta hanya menampilkan target yang
   * beridentitas. Kendaraan atau pesawat yang memang tidak mengirim identitas ikut hilang, jadi bawaannya mati.
   */
  hideUnidentified: boolean;
  now?: () => number;
}

export const DEFAULT_GHOST_OPTIONS: GhostFilterOptions = {
  radiusM: 40,
  minReports: 3,
  maxAgeMs: 2_000,
  forgetAfterMs: 120_000,
  establishedReports: 10,
  hideUnidentified: false,
};

export type GhostVerdict =
  | { action: "pass" }
  /** Belum cukup laporan, atau sedang dianggap bayangan: jangan diteruskan. */
  | { action: "hold"; reason: "baru" | "bayangan" }
  /** Sempat tampil lalu terbukti bayangan: teruskan sebagai `dropped` sekali supaya hilang dari peta. */
  | { action: "retract" };

export interface GhostStats {
  /** Laporan yang dibuang sebagai bayangan. */
  ghostReports: number;
  /** Laporan target baru yang ditahan sampai cukup laporan. */
  heldNew: number;
  /** Target yang sempat tampil lalu ditarik. */
  retracted: number;
}

export interface GhostFilter {
  check(event: FusedTrackEvent): GhostVerdict;
  forget(trackId: string): void;
  sweep(): void;
  stats(): GhostStats;
}

/** Id sintetis yang dibuat ingest dari nomor track sensor bila tidak ada alamat Mode-S: `r1-1-278`, `v50-176-42`, `t1-1-9`. */
const SYNTHETIC: RegExp = /^[rtv]\d+-\d+-\d+$/;
export const isSyntheticId = (icao24: string | undefined): boolean =>
  icao24 === undefined || icao24 === "" || SYNTHETIC.test(icao24);

/** Sensor yang melaporkan: protokol beserta SAC/SIC-nya, supaya dua MLAT atau dua radar berbeda tidak saling menyaring. */
export const sensorKey = (event: FusedTrackEvent): string =>
  `${event.protocol}|${event.dataSource?.sac ?? "?"}:${event.dataSource?.sic ?? "?"}`;

interface Identified {
  lat: number;
  lon: number;
  at: number;
  sensor: string;
}

interface Anonymous {
  lat: number;
  lon: number;
  sensor: string;
  reports: number;
  farStreak: number;
  shown: boolean;
  ghost: boolean;
  lastAt: number;
}

export function createGhostFilter(
  options: Partial<GhostFilterOptions> = {},
): GhostFilter {
  const opts: GhostFilterOptions = {
    ...DEFAULT_GHOST_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ),
  };
  const now = options.now ?? ((): number => Date.now());
  const identified = new Map<string, Identified>();
  const anonymous = new Map<string, Anonymous>();
  const counters: GhostStats = { ghostReports: 0, heldNew: 0, retracted: 0 };

  const nearIdentified = (event: FusedTrackEvent, at: number): boolean => {
    const pos = event.position;
    if (!pos) return false;
    const sensor = sensorKey(event);
    for (const other of identified.values()) {
      if (other.sensor !== sensor || at - other.at > opts.maxAgeMs) continue;
      if (distanceM(pos, other) <= opts.radiusM) return true;
    }
    return false;
  };

  /** Target tanpa identitas yang menempel pada target beridentitas: bayangan. Yang sempat tampil ditarik satu kali. */
  const onGhost = (st: Anonymous): GhostVerdict => {
    st.farStreak = 0;
    st.ghost = true;
    counters.ghostReports++;
    if (!st.shown) return { action: "hold", reason: "bayangan" };
    st.shown = false;
    counters.retracted++;
    return { action: "retract" };
  };

  /** Target tanpa identitas yang jauh dari target beridentitas: nyata setelah cukup laporan, dan setelah bayangan lepas bila sudah menjauh. */
  const onClear = (st: Anonymous): GhostVerdict => {
    st.farStreak++;
    if (st.ghost && st.farStreak < opts.minReports) {
      counters.ghostReports++;
      return { action: "hold", reason: "bayangan" };
    }
    st.ghost = false;
    if (!st.shown && st.reports < opts.minReports) {
      counters.heldNew++;
      return { action: "hold", reason: "baru" };
    }
    st.shown = true;
    return { action: "pass" };
  };

  /** `other` layak menjadi induk gema bagi `st`: tampil, bukan bayangan, masih aktif, mapan, dan lebih tua dari `st`. */
  const canBeParent = (other: Anonymous, st: Anonymous, at: number): boolean =>
    other.sensor === st.sensor &&
    at - other.lastAt <= opts.maxAgeMs &&
    other.shown &&
    !other.ghost &&
    other.reports >= opts.establishedReports &&
    other.reports > st.reports;

  /** Ada target tanpa identitas lain yang mapan dari sensor yang sama di dekat `st`; `st` sendiri harus masih muda. */
  const nearEstablishedAnonymous = (
    trackId: string,
    st: Anonymous,
    at: number,
  ): boolean => {
    if (opts.establishedReports <= 0) return false;
    if (st.reports >= opts.establishedReports) return false;
    for (const [id, other] of anonymous) {
      if (id === trackId || !canBeParent(other, st, at)) continue;
      if (distanceM(st, other) <= opts.radiusM) return true;
    }
    return false;
  };

  const checkAnonymous = (
    event: FusedTrackEvent,
    pos: { lat: number; lon: number },
    at: number,
  ): GhostVerdict => {
    const st = anonymous.get(event.trackId) ?? {
      lat: pos.lat,
      lon: pos.lon,
      sensor: sensorKey(event),
      reports: 0,
      farStreak: 0,
      shown: false,
      ghost: false,
      lastAt: at,
    };
    anonymous.set(event.trackId, st);
    st.reports++;
    st.lastAt = at;
    st.lat = pos.lat;
    st.lon = pos.lon;
    const echo =
      nearIdentified(event, at) ||
      nearEstablishedAnonymous(event.trackId, st, at);
    return echo ? onGhost(st) : onClear(st);
  };

  return {
    check(event: FusedTrackEvent): GhostVerdict {
      const at = now();
      const id = event.trackId;

      if (event.lifecycle === "dropped") {
        const was = anonymous.get(id);
        identified.delete(id);
        anonymous.delete(id);
        // Track yang tidak pernah tampil tidak perlu "dihapus" dari gambaran udara.
        return was && !was.shown
          ? { action: "hold", reason: "bayangan" }
          : { action: "pass" };
      }

      const pos = event.position;
      if (!pos) return { action: "pass" };

      if (!isSyntheticId(event.identity?.icao24)) {
        identified.set(id, {
          lat: pos.lat,
          lon: pos.lon,
          at,
          sensor: sensorKey(event),
        });
        return { action: "pass" };
      }
      if (opts.hideUnidentified) {
        counters.ghostReports++;
        return { action: "hold", reason: "bayangan" };
      }
      return checkAnonymous(event, pos, at);
    },

    forget(trackId: string): void {
      identified.delete(trackId);
      anonymous.delete(trackId);
    },

    sweep(): void {
      const t = now();
      for (const [id, v] of identified) {
        if (t - v.at > opts.forgetAfterMs) identified.delete(id);
      }
      for (const [id, v] of anonymous) {
        if (t - v.lastAt > opts.forgetAfterMs) anonymous.delete(id);
      }
    },

    stats(): GhostStats {
      return { ...counters };
    },
  };
}
