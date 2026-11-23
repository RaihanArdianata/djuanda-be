/**
 * Meneruskan datagram UDP ke host lain. Satu berkas, tanpa dependensi, tanpa .env; jalan di Windows dan Linux.
 *
 * Dua mode:
 *
 *  relay (bawaan)  Mendengarkan port itu sendiri lalu meneruskan tiap datagram. Pakai bila port TIDAK dipegang aplikasi lain
 *                  di mesin ini (UDP unicast hanya sampai ke satu penerima).
 *      node udp-forward.js --port 13217 --to 172.168.40.3:24217
 *
 *  sniff           Menyadap paket yang sudah diterima aplikasi lain di port itu lalu meneruskan salinannya, tanpa mengganggu
 *                  aplikasinya. Butuh penyadap paket: tcpdump (Linux), atau dumpcap (Wireshark) / WinDump (Windows), dijalankan
 *                  sebagai Administrator atau root.
 *      node udp-forward.js --mode sniff --port 13217 --to 172.168.40.3:24217 --iface 1
 *      node udp-forward.js --mode sniff --port 13217 --to 172.168.40.3:24217 --iface "Ethernet" --capture "C:\Program Files\Wireshark\dumpcap.exe"
 *
 * Daftar antarmuka di Windows: "C:\Program Files\Wireshark\dumpcap.exe" -D   (pakai nomor atau namanya di --iface).
 * Hanya IPv4; datagram yang terfragmentasi dilewati (mode sniff).
 */
"use strict";

const { spawn } = require("child_process");
const { createSocket } = require("dgram");
const fs = require("fs");

const USAGE = [
  "pemakaian:",
  "  node udp-forward.js --port 13217 --to <ip>:<port>                          (relay)",
  "  node udp-forward.js --mode sniff --port 13217 --to <ip>:<port> [--iface 1] [--capture <jalur penyadap>]",
].join("\n");

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf("--" + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = get("mode") === undefined ? "relay" : get("mode");
  const port = Number(get("port"));
  const to = get("to");
  const parts = (to === undefined ? "" : to).split(":");
  const host = parts[0];
  const toPort = Number(parts[1] === undefined ? port : parts[1]);
  if ((mode !== "relay" && mode !== "sniff") || !port || !host || !toPort) return USAGE;
  return {
    mode,
    port,
    host,
    toPort,
    iface: get("iface"),
    capture: get("capture"),
  };
}

function log(text) {
  process.stderr.write(text + "\n");
}

/** Hitung dan catat: 20 datagram pertama satu per satu (feed jarang seperti AFTN), lalu tiap 1000. */
function makeCounter(label) {
  let sent = 0;
  return {
    count: () => sent,
    sent(payload) {
      sent += 1;
      if (sent <= 20 || sent % 1000 === 0) {
        const preview = payload
          .subarray(0, 60)
          .toString("latin1")
          .replace(/[^\x20-\x7e]/g, ".");
        log(label + " #" + sent + " (" + payload.length + " byte): " + preview);
      }
    },
  };
}

// ── mode relay ───────────────────────────────────────────────────────────────

function runRelay(args) {
  const out = createSocket("udp4");
  // Sengaja tanpa reuseAddr: bila aplikasi lain sudah memegang port ini, gagal saja, jangan merebut paketnya darinya.
  const input = createSocket("udp4");
  const counter = makeCounter("diteruskan");

  input.on("error", (err) => {
    if (err.code === "EADDRINUSE" || err.code === "EACCES") {
      // Windows melaporkan port yang sudah dipegang (atau dicadangkan sistem) sebagai EACCES.
      log("port " + args.port + " sudah dipegang aplikasi lain di mesin ini (atau dicadangkan sistem); UDP unicast hanya sampai ke satu penerima.");
      log("pakai --mode sniff untuk menyadapnya tanpa mengganggu, atau hentikan aplikasi itu.");
    } else {
      log("galat soket: " + err.message);
    }
    process.exit(1);
  });
  input.on("message", (payload) => {
    out.send(payload, args.toPort, args.host);
    counter.sent(payload);
  });
  input.bind(args.port, "0.0.0.0", () => {
    log("relay: mendengarkan udp/" + args.port + " -> " + args.host + ":" + args.toPort);
  });
  return input;
}

// ── mode sniff ───────────────────────────────────────────────────────────────

const PCAP_GLOBAL = 24;
const PCAP_RECORD = 16;

/** Bytes header lapisan link di depan paket IP, menurut tipe link pcap. */
function linkHeaderSize(linkType) {
  if (linkType === 1) return 14; // Ethernet
  if (linkType === 113) return 16; // Linux cooked (-i any)
  if (linkType === 276) return 20; // Linux cooked v2
  return -1;
}

/** Isi UDP dari satu frame, atau null bila bukan datagram IPv4/UDP yang utuh. */
function udpPayload(frame, linkSize) {
  const ip = frame.subarray(linkSize);
  if (ip.length < 20 || ip[0] >> 4 !== 4 || ip[9] !== 17) return null;
  if ((ip.readUInt16BE(6) & 0x3fff) !== 0) return null; // fragmen
  const ihl = (ip[0] & 0x0f) * 4;
  const total = Math.min(ip.readUInt16BE(2), ip.length);
  if (total < ihl + 8) return null;
  return ip.subarray(ihl + 8, total);
}

/** Pembaca bertahap untuk aliran pcap yang ditulis penyadap ke stdout. */
class PcapReader {
  constructor(onPayload) {
    this.buf = Buffer.alloc(0);
    this.linkSize = 0;
    this.onPayload = onPayload;
  }

  /** false bila tipe link tidak bisa dibaca skrip ini. */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.linkSize === 0 && !this.readGlobalHeader()) {
      return this.buf.length < PCAP_GLOBAL;
    }
    this.drain();
    return true;
  }

  readGlobalHeader() {
    if (this.buf.length < PCAP_GLOBAL) return false;
    const size = linkHeaderSize(this.buf.readUInt32LE(20));
    if (size < 0) return false;
    this.linkSize = size;
    this.buf = this.buf.subarray(PCAP_GLOBAL);
    return true;
  }

  drain() {
    while (this.buf.length >= PCAP_RECORD) {
      const len = this.buf.readUInt32LE(8);
      if (this.buf.length < PCAP_RECORD + len) return;
      const frame = this.buf.subarray(PCAP_RECORD, PCAP_RECORD + len);
      this.buf = this.buf.subarray(PCAP_RECORD + len);
      const payload = udpPayload(frame, this.linkSize);
      if (payload) this.onPayload(payload);
    }
  }
}

/** Penyadap yang dipakai: --capture, atau yang ditemukan (Wireshark dumpcap di Windows, tcpdump di Linux). */
function findCapture(explicit) {
  if (explicit) return explicit;
  if (process.platform !== "win32") return "tcpdump";
  const candidates = [
    "C:\\Program Files\\Wireshark\\dumpcap.exe",
    "C:\\Program Files (x86)\\Wireshark\\dumpcap.exe",
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return "windump";
}

/** Argumen penyadap: dumpcap memakai -f untuk filter dan -P untuk format pcap; tcpdump dan WinDump memakai ekspresi di akhir. */
function captureArgs(tool, iface, port) {
  const filter = "udp dst port " + port;
  const name = tool.toLowerCase();
  if (name.indexOf("dumpcap") >= 0) {
    return ["-q", "-P", "-i", iface === undefined ? "1" : iface, "-f", filter, "-w", "-"];
  }
  return ["-l", "-U", "-n", "-i", iface === undefined ? "any" : iface, "-w", "-", filter];
}

function runSniff(args) {
  const out = createSocket("udp4");
  const counter = makeCounter("disalin");
  const tool = findCapture(args.capture);
  const child = spawn(tool, captureArgs(tool, args.iface, args.port), {
    stdio: ["ignore", "pipe", "inherit"],
  });

  child.on("error", (err) => {
    log("tidak bisa menjalankan penyadap '" + tool + "': " + err.message);
    log("pasang Wireshark (berisi dumpcap) atau WinDump di Windows, atau tcpdump di Linux, dan jalankan sebagai Administrator/root.");
    process.exit(1);
  });

  const reader = new PcapReader((payload) => {
    out.send(payload, args.toPort, args.host);
    counter.sent(payload);
  });
  child.stdout.on("data", (chunk) => {
    if (reader.push(chunk)) return;
    log("tipe link tidak didukung; pakai --iface <antarmuka Ethernet>");
    process.exit(1);
  });
  child.on("exit", (code) => {
    log("penyadap berhenti (" + code + ") setelah " + counter.count() + " datagram");
    process.exit(code === null ? 1 : code);
  });
  log(
    "sniff: " + tool + " menyadap udp/" + args.port + " -> " + args.host + ":" + args.toPort,
  );
  return child;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    log(args);
    return 2;
  }
  if (args.mode === "sniff") runSniff(args);
  else runRelay(args);
  return 0;
}

if (require.main === module) {
  const code = main();
  if (code !== 0) process.exit(code);
} else {
  module.exports = { parseArgs, PcapReader, udpPayload, captureArgs };
}
