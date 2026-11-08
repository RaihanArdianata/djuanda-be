const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nama fitur aerodrome yang bisa dibaca orang, atau undefined. Fitur tanpa nama (poligon taxiway atau apron dari data OSM) hanya punya ID,
 * dan ID itu tidak boleh dipakai sebagai nama: alert menampilkannya di peta dan di pesan ("TWY be78e0d8-57ab-..."). ID tetap ada di
 * `aerodromeFeatureId` dan di data alert untuk yang butuh mencarinya.
 */
export function readableName(
  name: string | null | undefined,
): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || UUID.test(trimmed)) return undefined;
  return trimmed;
}
