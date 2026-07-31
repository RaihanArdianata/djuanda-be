import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import type z from "zod";

export const LAYER_VALUES = [
  "AERODROME",
  "AEROWAY",
  "RUNWAY",
  "TAXIWAY",
  "APRON",
  "TERMINAL",
  "PARKING",
  "BUILDING",
  "WATCH_TOWER",
  "POINT_OF_INTEREST",
  "GRASS",
  "GARDEN",
  "WATER",
] as const;

export type LayerName = (typeof LAYER_VALUES)[number];

export const layerEnum = pgEnum("layer", LAYER_VALUES);
export const importStatusEnum = pgEnum("import_status", [
  "DRAFT",
  "COMPLETED",
  "CANCELLED",
]);
export const importModeEnum = pgEnum("import_mode", ["APPEND", "REPLACE"]);
export const validationStatusEnum = pgEnum("validation_status", [
  "VALID",
  "INVALID",
]);

// Master data. Geometry & properties disimpan sebagai JSONB GeoJSON mentah
// (bukan tipe geometry PostGIS) supaya tidak butuh extension tambahan di DB.
export const aerodromeFeatures = pgTable(
  "aerodrome_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layer: layerEnum("layer").notNull(),
    name: varchar("name", { length: 255 }),
    geometry: jsonb("geometry").notNull(),
    properties: jsonb("properties").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: varchar("created_by", { length: 255 }),
    updatedBy: varchar("updated_by", { length: 255 }),
  },
  (t) => [index("aerodrome_features_layer_idx").on(t.layer)],
);

// Import session (metadata upload GeoJSON).
export const aerodromeImports = pgTable("aerodrome_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mode: importModeEnum("mode").notNull().default("APPEND"),
  status: importStatusEnum("status").notNull().default("DRAFT"),
  totalFeatures: integer("total_features").notNull().default(0),
  validFeatures: integer("valid_features").notNull().default(0),
  invalidFeatures: integer("invalid_features").notNull().default(0),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Draft feature hasil parsing import, sebelum commit ke aerodrome_features.
export const aerodromeImportFeatures = pgTable("aerodrome_import_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id")
    .notNull()
    .references(() => aerodromeImports.id, { onDelete: "cascade" }),
  layer: layerEnum("layer").notNull(),
  geometry: jsonb("geometry").notNull(),
  properties: jsonb("properties").notNull().default({}),
  validationStatus: validationStatusEnum("validation_status")
    .notNull()
    .default("INVALID"),
  validationErrors: jsonb("validation_errors")
    .$type<string[]>()
    .notNull()
    .default([]),
  isEdited: boolean("is_edited").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const aerodromeImportsRelations = relations(
  aerodromeImports,
  ({ many }) => ({
    features: many(aerodromeImportFeatures),
  }),
);

export const aerodromeImportFeaturesRelations = relations(
  aerodromeImportFeatures,
  ({ one }) => ({
    import: one(aerodromeImports, {
      fields: [aerodromeImportFeatures.importId],
      references: [aerodromeImports.id],
    }),
  }),
);

export const aerodromeFeaturesSelectSchema =
  createSelectSchema(aerodromeFeatures);
export const aerodromeImportsSelectSchema =
  createSelectSchema(aerodromeImports);
export const aerodromeImportFeaturesSelectSchema = createSelectSchema(
  aerodromeImportFeatures,
);
export const aerodromeImportWithFeaturesSelectSchema =
  aerodromeImportsSelectSchema.extend({
    features: aerodromeImportFeaturesSelectSchema.array(),
  });
export const aerodromeImportFeatureWithImportSelectSchema =
  aerodromeImportFeaturesSelectSchema.extend({
    import: aerodromeImportsSelectSchema,
  });

export type AerodromeFeature = z.infer<typeof aerodromeFeaturesSelectSchema>;
export type AerodromeImport = z.infer<typeof aerodromeImportsSelectSchema>;
export type AerodromeImportFeature = z.infer<
  typeof aerodromeImportFeaturesSelectSchema
>;
export type AerodromeImportWithFeatures = AerodromeImport & {
  features: AerodromeImportFeature[];
};
export type AerodromeImportFeatureWithImport = AerodromeImportFeature & {
  import: AerodromeImport;
};
