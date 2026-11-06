/** Memecah isi berkas SQL menjadi pernyataan satu per satu: komentar `--` dibuang, dipisah pada `;`. */
export function splitStatements(sqlText: string): string[] {
  const withoutComments = sqlText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
