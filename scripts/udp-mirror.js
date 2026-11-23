/**
 * Mirrors UDP datagrams that another process already receives (e.g. AeroSwarm
 * on port 2026) to a second host, without touching that process. It sniffs the
 * interface with tcpdump and re-sends each payload, so run it on the machine
 * that receives the datagrams, as root.
 *
 *   node scripts/udp-mirror.js --port 13217 --to 172.168.40.3:24217 [--iface eth0]
 *
 * Needs: Node.js and tcpdump on that machine. IPv4 only; fragmented datagrams are skipped.
 * Plain JavaScript (CommonJS), no dependencies, no build step.
 */
"use strict";

const { spawn } = require("child_process");
const { createSocket } = require("dgram");

const USAGE =
  "usage: node scripts/udp-mirror.js --port 13217 --to <ip>:<port> [--iface eth0]";

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf("--" + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(get("port"));
  const to = get("to");
  const parts = (to === undefined ? "" : to).split(":");
  const host = parts[0];
  const toPort = Number(parts[1] === undefined ? port : parts[1]);
  if (!port || !host || !toPort) return USAGE;
  const iface = get("iface");
  return { port, host, toPort, iface: iface === undefined ? "any" : iface };
}

function log(text) {
  process.stderr.write(text + "\n");
}

const PCAP_GLOBAL = 24;
const PCAP_RECORD = 16;

/** Bytes of link-layer header in front of the IP packet, by pcap link type. */
function linkHeaderSize(linkType) {
  if (linkType === 1) return 14; // Ethernet
  if (linkType === 113) return 16; // Linux cooked (-i any)
  if (linkType === 276) return 20; // Linux cooked v2
  return -1;
}

/** UDP payload of one captured frame, or null if it is not a whole IPv4/UDP datagram. */
function udpPayload(frame, linkSize) {
  const ip = frame.subarray(linkSize);
  if (ip.length < 20 || ip[0] >> 4 !== 4 || ip[9] !== 17) return null;
  if ((ip.readUInt16BE(6) & 0x3fff) !== 0) return null; // fragment
  const ihl = (ip[0] & 0x0f) * 4;
  const total = Math.min(ip.readUInt16BE(2), ip.length);
  if (total < ihl + 8) return null;
  return ip.subarray(ihl + 8, total);
}

/** Incremental reader for the pcap stream tcpdump writes to stdout. */
class PcapReader {
  constructor(onPayload) {
    this.buf = Buffer.alloc(0);
    this.linkSize = 0;
    this.onPayload = onPayload;
  }

  /** Returns false when the capture uses a link type this script cannot parse. */
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    log(args);
    return 2;
  }
  const out = createSocket("udp4");
  const tcpdump = spawn(
    "tcpdump",
    ["-l", "-U", "-n", "-i", args.iface, "-w", "-", "udp dst port " + args.port],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  tcpdump.on("error", (err) => {
    log("cannot start tcpdump: " + err.message + " (is it installed, and are you root?)");
    process.exit(1);
  });

  let sent = 0;
  const reader = new PcapReader((payload) => {
    out.send(payload, args.toPort, args.host);
    sent += 1;
    // Low-volume feeds (AFTN) show every datagram at first, so it is clear the mirror works.
    if (sent <= 20 || sent % 1000 === 0) {
      log("mirrored " + sent + " datagram(s), last " + payload.length + " bytes");
    }
  });

  tcpdump.stdout.on("data", (chunk) => {
    if (reader.push(chunk)) return;
    log("unsupported link type; use --iface <ethernet interface>");
    process.exit(1);
  });

  tcpdump.on("exit", (code) => {
    log("tcpdump exited (" + code + ") after " + sent + " datagrams");
    process.exit(code === null ? 1 : code);
  });
  log(
    "mirroring udp/" + args.port + " on " + args.iface + " -> " + args.host + ":" + args.toPort,
  );
  return 0;
}

const code = main();
if (code !== 0) process.exit(code);
