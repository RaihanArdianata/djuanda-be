/**
 * Kejadian (incident): satu pergerakan yang memicu banyak alert digabung jadi satu.
 *
 * Alert yang sama memicu ulang berkali-kali (81% jedanya di bawah satu menit) dan satu pergerakan bisa memicu beberapa jenis alert
 * (mis. Taxiway/Apron, lalu Area Penetration, lalu Runway Incursion untuk callsign yang sama dalam enam menit). Menghitung dan
 * memverifikasi satu per satu membuat angkanya kabur dan operator kewalahan. Aturannya:
 *
 *  - Kunci: **callsign** (lintas jenis alert). STCA melibatkan dua pesawat, jadi kuncinya **pasangan** callsign tanpa urutan
 *    (`A|B` sama dengan `B|A`) dan STCA tidak dilebur dengan jenis lain.
 *  - Rantai: alert baru bergabung bila jaraknya dari alert TERAKHIR di rantai tidak lebih dari `INCIDENT_WINDOW_MS` (15 menit);
 *    jeda yang lebih lama memulai kejadian baru. Satu kejadian bisa lebih panjang dari 15 menit selama terus berlanjut.
 *  - Pesawat terkait bukan bagian kunci incursion: yang menyimpang adalah perilaku pesawat utama, penghuni runway bisa berganti.
 *
 * Murni (tanpa database) supaya daftar Alert Management, Statistik, dan Excel memakai angka yang sama dan bisa diuji.
 */

export const INCIDENT_WINDOW_MS = 15 * 60_000;

export interface IncidentAlertInput {
  alertId: string;
  type: string;
  severity: string;
  status: string;
  /** epoch ms */
  triggeredAt: number;
  callsign: string | null;
  relatedCallsign: string | null;
  trackId: string;
  /** UNVERIFIED, VERIFIED, atau FALSE_ALARM. */
  verificationStatus: string;
}

export type IncidentKind = "SUBJECT" | "PAIR";

export type IncidentVerification =
  | "UNVERIFIED"
  | "VERIFIED"
  | "FALSE_ALARM"
  | "MIXED";

export interface Incident {
  /** Alert ID alert pertama; dipakai sebagai id kejadian. */
  id: string;
  kind: IncidentKind;
  /** Kunci kejadian, mis. `SUBJ:CTV494` atau `PAIR:GIA320|SIA929`. */
  subject: string;
  /** Callsign utama (kejadian SUBJECT); null untuk PAIR. */
  callsign: string | null;
  /** Dua callsign terurut abjad (kejadian PAIR); null untuk SUBJECT. */
  pair: [string, string] | null;
  startAt: number;
  endAt: number;
  /** Alert ID semua anggota, terlama dahulu. */
  alertIds: string[];
  count: number;
  typeCounts: Record<string, number>;
  /** Severity tertinggi di antara anggota. */
  severity: string;
  /** Pesawat terkait (penghuni runway dan sebagainya) yang muncul di anggota, tanpa duplikat. */
  relatedCallsigns: string[];
  /** Ada alert yang masih ACTIVE. */
  hasActive: boolean;
  verification: IncidentVerification;
  verificationCounts: {
    unverified: number;
    verified: number;
    falseAlarm: number;
  };
  /** Alert yang belum diverifikasi padahal anggota lain sudah (datang setelah verifikasi): "Terapkan juga". */
  newAfterVerification: number;
  /**
   * Ada alert Warning atau Critical yang belum dinilai. Alert Info hanya untuk diketahui: ia tidak membuat kejadian "perlu tindakan", jadi
   * kejadian yang isinya hanya Info tidak masuk hitungan itu.
   */
  needsAction: boolean;
}

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 4,
  HIGH: 3,
  WARNING: 2,
  CAUTION: 1,
  INFO: 0,
};

export const severityRank = (severity: string): number =>
  SEVERITY_RANK[severity.toUpperCase()] ?? -1;

const clean = (value: string | null | undefined): string | null => {
  const text = value?.trim().toUpperCase() ?? "";
  return text === "" ? null : text;
};

/** Kunci kejadian sebuah alert dan jenisnya. Tanpa callsign dipakai id track, supaya alert tanpa nama tidak menyatu satu sama lain. */
export function incidentSubject(alert: IncidentAlertInput): {
  subject: string;
  kind: IncidentKind;
  callsign: string | null;
  pair: [string, string] | null;
} {
  const callsign =
    clean(alert.callsign) ?? clean(alert.trackId) ?? alert.alertId;
  if (alert.type.toUpperCase() === "STCA") {
    const other = clean(alert.relatedCallsign) ?? callsign;
    const pair: [string, string] =
      callsign <= other ? [callsign, other] : [other, callsign];
    return {
      subject: `PAIR:${pair[0]}|${pair[1]}`,
      kind: "PAIR",
      callsign: null,
      pair,
    };
  }
  return { subject: `SUBJ:${callsign}`, kind: "SUBJECT", callsign, pair: null };
}

interface Draft {
  first: IncidentAlertInput;
  subject: ReturnType<typeof incidentSubject>;
  members: IncidentAlertInput[];
  lastAt: number;
}

function rollUp(members: IncidentAlertInput[]): {
  verification: IncidentVerification;
  counts: Incident["verificationCounts"];
  newAfterVerification: number;
} {
  const counts = { unverified: 0, verified: 0, falseAlarm: 0 };
  for (const m of members) {
    const s = m.verificationStatus.toUpperCase();
    if (s === "VERIFIED") counts.verified++;
    else if (s === "FALSE_ALARM") counts.falseAlarm++;
    else counts.unverified++;
  }
  const judged = counts.verified + counts.falseAlarm;
  let verification: IncidentVerification = "MIXED";
  if (judged === 0) verification = "UNVERIFIED";
  else if (counts.unverified === 0 && counts.falseAlarm === 0)
    verification = "VERIFIED";
  else if (counts.unverified === 0 && counts.verified === 0)
    verification = "FALSE_ALARM";
  return {
    verification,
    counts,
    newAfterVerification: judged > 0 ? counts.unverified : 0,
  };
}

function toIncident(d: Draft): Incident {
  const members = d.members;
  const typeCounts: Record<string, number> = {};
  const related = new Set<string>();
  let severity = members[0]?.severity ?? "INFO";
  let hasActive = false;
  for (const m of members) {
    typeCounts[m.type] = (typeCounts[m.type] ?? 0) + 1;
    if (severityRank(m.severity) > severityRank(severity))
      severity = m.severity;
    if (m.status.toUpperCase() === "ACTIVE") hasActive = true;
    const rel = clean(m.relatedCallsign);
    if (rel && rel !== d.subject.callsign) related.add(rel);
  }
  const roll = rollUp(members);
  const needsAction = members.some(
    (m) =>
      !["VERIFIED", "FALSE_ALARM"].includes(
        m.verificationStatus.toUpperCase(),
      ) && severityRank(m.severity) >= severityRank("WARNING"),
  );
  return {
    id: d.first.alertId,
    kind: d.subject.kind,
    subject: d.subject.subject,
    callsign: d.subject.callsign,
    pair: d.subject.pair,
    startAt: d.first.triggeredAt,
    endAt: d.lastAt,
    alertIds: members.map((m) => m.alertId),
    count: members.length,
    typeCounts,
    severity,
    relatedCallsigns: [...related],
    hasActive,
    verification: roll.verification,
    verificationCounts: roll.counts,
    newAfterVerification: roll.newAfterVerification,
    needsAction,
  };
}

/**
 * Kelompokkan alert menjadi kejadian. Hasil diurutkan dari yang terbaru (menurut waktu alert terakhir). Alert tidak perlu diurutkan
 * sebelumnya.
 */
export function groupIncidents(
  alerts: readonly IncidentAlertInput[],
  windowMs: number = INCIDENT_WINDOW_MS,
): Incident[] {
  const ordered = [...alerts].sort(
    (a, b) =>
      a.triggeredAt - b.triggeredAt || a.alertId.localeCompare(b.alertId),
  );
  const open = new Map<string, Draft>();
  const done: Draft[] = [];

  for (const alert of ordered) {
    const subject = incidentSubject(alert);
    const draft = open.get(subject.subject);
    if (draft && alert.triggeredAt - draft.lastAt <= windowMs) {
      draft.members.push(alert);
      draft.lastAt = alert.triggeredAt;
      continue;
    }
    if (draft) done.push(draft);
    open.set(subject.subject, {
      first: alert,
      subject,
      members: [alert],
      lastAt: alert.triggeredAt,
    });
  }
  done.push(...open.values());

  return done
    .map(toIncident)
    .sort((a, b) => b.endAt - a.endAt || b.id.localeCompare(a.id));
}

/** Jumlah kejadian per jenis alert yang ikut di dalamnya (satu kejadian lintas jenis dihitung sekali di tiap jenisnya). */
export function incidentCountByType(
  incidents: readonly Incident[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const incident of incidents) {
    for (const type of Object.keys(incident.typeCounts)) {
      out[type] = (out[type] ?? 0) + 1;
    }
  }
  return out;
}
