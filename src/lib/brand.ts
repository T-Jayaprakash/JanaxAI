import { z } from "zod";
import { getAsset } from "./assets";
import { getDb, now, parseJson } from "./db";

/** One brand kit for the local user; used by designs and the AI assistant. */
export const BrandKitSchema = z.object({
  businessName: z.string().max(120).default(""),
  tagline: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  whatsapp: z.string().max(60).default(""),
  email: z.string().max(200).default(""),
  website: z.string().max(200).default(""),
  instagram: z.string().max(100).default(""),
  address: z.string().max(300).default(""),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  logoAssetId: z.string().regex(/^ast_[a-f0-9]{32}$/).nullable().default(null),
  /** Free-form notes: audience, location, tone, languages. */
  notes: z.string().max(1000).default(""),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

export function getBrandKit(): BrandKit {
  const row = getDb().prepare("SELECT data FROM brand_kit WHERE id = 1").get() as { data: string } | undefined;
  const parsed = BrandKitSchema.safeParse(parseJson(row?.data, {}));
  const kit = parsed.success ? parsed.data : BrandKitSchema.parse({});
  if (kit.logoAssetId && !getAsset(kit.logoAssetId)) kit.logoAssetId = null;
  return kit;
}

export function updateBrandKit(patch: Partial<BrandKit>): BrandKit {
  const next = BrandKitSchema.parse({ ...getBrandKit(), ...patch });
  getDb()
    .prepare("INSERT INTO brand_kit (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(JSON.stringify(next), now());
  return next;
}

/** Human-readable summary for prompts; empty fields are omitted. */
export function describeBrandKit(kit: BrandKit): string {
  const rows: [string, string][] = [
    ["Business name", kit.businessName],
    ["Tagline", kit.tagline],
    ["Phone", kit.phone],
    ["WhatsApp", kit.whatsapp],
    ["Email", kit.email],
    ["Website", kit.website],
    ["Instagram", kit.instagram],
    ["Address", kit.address],
    ["Primary color", kit.primaryColor],
    ["Secondary color", kit.secondaryColor],
    ["Logo", kit.logoAssetId ? `uploaded (in/${kit.logoAssetId}${(getAsset(kit.logoAssetId)?.storageKey.match(/\.[a-z0-9]+$/) ?? [""])[0]} in the workspace)` : ""],
    ["Notes", kit.notes],
  ];
  const filled = rows.filter(([, v]) => v);
  return filled.length ? filled.map(([k, v]) => `- ${k}: ${v}`).join("\n") : "(empty — nothing saved yet)";
}
