import { aerodromeFeatures, db } from "./index";

async function main(): Promise<void> {
  const result = await db.update(aerodromeFeatures).set({ airportId: "WARR" });

  process.stdout.write(
    `Updated ${String(result.rowCount ?? 0)} aerodrome_features rows to airportId=WARR\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
