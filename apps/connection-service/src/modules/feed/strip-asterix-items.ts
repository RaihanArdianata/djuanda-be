/**
 * Dengan ASTERIX_RAW_ITEMS, event track membawa semua nilai item hasil dekode di `meta.asterix` (puluhan field per pesan).
 * Itu hanya untuk topik Kafka `asmgcs.tracks.full`. Peta live (WebSocket ke klien) dan kolom jsonb database tidak boleh
 * ikut menerimanya: bandwidth dan ukuran barisnya membengkak berkali lipat.
 *
 * Mengembalikan event yang sama bila tidak ada `meta.asterix`; selain itu salinan dangkal tanpa kunci itu (event asli tidak diubah).
 */
export function withoutAsterixItems<T extends object>(event: T): T {
  const meta = (event as { meta?: Record<string, unknown> }).meta;
  if (!meta || typeof meta !== "object" || !("asterix" in meta)) return event;
  const { asterix: _items, ...rest } = meta;
  return { ...event, meta: rest };
}
