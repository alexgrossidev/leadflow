import {
  mysqlTable,
  int,
  varchar,
  text,
  tinyint,
  timestamp,
  decimal,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Column names are kept from the original (Italian-market) schema; the
// comments give the English meaning of the domain-specific ones.
export const businesses = mysqlTable(
  "business",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }),
    category: varchar("category", { length: 100 }).notNull(),
    subcategory: varchar("subcategory", { length: 255 }),
    // Registered legal name of the company.
    ragioneSociale: text("ragioneSociale").notNull(),
    phoneNumberPrefix: varchar("phoneNumberPrefix", { length: 10 }).notNull(),
    phoneNumber: text("phoneNumber").notNull(),
    email: text("email"),
    address: varchar("address", { length: 255 }).notNull(),
    postalCode: text("postalCode").notNull(),
    city: text("city").notNull(),
    province: text("province").notNull(),
    country: text("country").notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 8 }),
    longitude: decimal("longitude", { precision: 11, scale: 8 }),
    websiteUrl: varchar("websiteUrl", { length: 255 }),
    logoUrl: varchar("logoUrl", { length: 255 }),
    coverUrl: varchar("coverUrl", { length: 255 }),
    about: text("about").notNull(),
    ownerFirstName: varchar("ownerFirstName", { length: 100 }),
    ownerLastName: varchar("ownerLastName", { length: 100 }),
    businessTagLine: varchar("businessTagLine", { length: 255 }),
    yearOfIncorporation: int("yearOfIncorporation"),
    facebookUrl: varchar("facebookUrl", { length: 255 }),
    instagramUrl: varchar("instagramUrl", { length: 255 }),
    linkedinUrl: varchar("linkedinUrl", { length: 255 }),
    twitterUrl: varchar("twitterUrl", { length: 255 }),
    whatsapp_accounts: int("whatsapp_accounts").notNull().default(1),
    isfranchise: tinyint("isfranchise").notNull().default(0),
    locationhidden: tinyint("locationhidden").notNull().default(0),
    // Tax identifiers: personal tax code and VAT number.
    fiscalCode: varchar("fiscalCode", { length: 255 }),
    VATnumber: varchar("VATnumber", { length: 255 }),
    // Italian e-invoicing routing: SDI recipient code and certified email (PEC).
    sdi: text("sdi"),
    pec: text("pec"),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [index("idx_business_user").on(t.userId)],
);

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
