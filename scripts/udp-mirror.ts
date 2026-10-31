/**
 * Mirrors UDP datagrams that another process already receives (e.g. AeroSwarm
 * on port 2026) to a second host, without touching that process. It sniffs the
 * interface with tcpdump and re-sends each payload, so run it on the VPS as root.
 *
 *   bun scripts/udp-mirror.ts --port 2026 --to 10.72.125.50:2026 [--iface eth0]
 *
 * Needs: tcpdump on the VPS. IPv4 only; fragmented datagrams are skipped.
 */
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";

interface Args {
  port: number;
  host: string;
  toPort: number;
  iface: string;
}

function parseArgs(argv: string[]): Args | string {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(get("port"));
  const to = get("to");
  const [host, toPortText] = (to ?? "").split(":");
  const toPort = Number(toPortText ?? port);
  if (!port || !host || !toPort) {
    return "usage: bun scripts/udp-mirror.ts --port 2026 --to <ip>:<port> [--iface eth0]";
  }
  return { port, host, toPort, iface: get("iface") ?? "any" };
}

function log(text: string): void {
  process.stderr.write(`${text}\n`);
}

const PCAP_GLOBAL = 24;
const PCAP_RECORD = 16;

/** Bytes of link-layer header in front of the IP packet, by pcap link type. */
function linkHeaderSize(linkType: number): number {
  if (linkType === 1) return 14; // Ethernet
  if (linkType === 113) return 16; // Linux cooked (-i any)
  if (linkType === 276) return 20; // Linux cooked v2
  return -1;
}

/** UDP payload of one captured frame, or null if it is not a whole IPv4/UDP datagram. */
function udpPayload(frame: Buffer, linkSize: number): Buffer | null {
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
  private buf: Buffer = Buffer.alloc(0);
  private linkSize = 0;

  private readonly onPayload: (payload: Buffer) => void;

  constructor(onPayload: (payload: Buffer) => void) {
    this.onPayload = onPayload;
  }

  /** Returns false when the capture uses a link type this script cannot parse. */
  push(chunk: Buffer): boolean {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.linkSize === 0 && !this.readGlobalHeader()) {
      return this.buf.length < PCAP_GLOBAL;
    }
    this.drain();
    return true;
  }

  private readGlobalHeader(): boolean {
    if (this.buf.length < PCAP_GLOBAL) return false;
    const size = linkHeaderSize(this.buf.readUInt32LE(20));
    if (size < 0) return false;
    this.linkSize = size;
    this.buf = this.buf.subarray(PCAP_GLOBAL);
    return true;
  }

  private drain(): void {
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

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    log(args);
    return 2;
  }
  const out = createSocket("udp4");
  const tcpdump = spawn(
    "tcpdump",
    [
      "-l",
      "-U",
      "-n",
      "-i",
      args.iface,
      "-w",
      "-",
      `udp dst port ${args.port}`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  let sent = 0;
  const reader = new PcapReader((payload) => {
    out.send(payload, args.toPort, args.host);
    if (++sent % 1000 === 0) log(`mirrored ${sent} datagrams`);
  });

  tcpdump.stdout.on("data", (chunk: Buffer) => {
    if (reader.push(chunk)) return;
    log("unsupported link type; use --iface <ethernet interface>");
    process.exit(1);
  });

  tcpdump.on("exit", (code) => {
    log(`tcpdump exited (${code}) after ${sent} datagrams`);
    process.exit(code ?? 1);
  });
  log(
    `mirroring udp/${args.port} on ${args.iface} -> ${args.host}:${args.toPort}`,
  );
  return 0;
}

const code = main();
if (code !== 0) process.exit(code);
