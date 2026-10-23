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

export async function getBrandKit(workspaceId: string): Promise<BrandKit> {
  const row = await getDb().get<{ data: string }>("SELECT data FROM brand_kits WHERE workspace_id = ?", [workspaceId]);
  const parsed = BrandKitSchema.safeParse(parseJson(row?.data, {}));
  const kit = parsed.success ? parsed.data : BrandKitSchema.parse({});
  if (kit.logoAssetId && (await getAsset(kit.logoAssetId))?.workspaceId !== workspaceId) kit.logoAssetId = null;
  return kit;
}

export async function updateBrandKit(patch: Partial<BrandKit>, workspaceId: string): Promise<BrandKit> {
  const next = BrandKitSchema.parse({ ...(await getBrandKit(workspaceId)), ...patch });
  await getDb().run(
    "INSERT INTO brand_kits (workspace_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    [workspaceId, JSON.stringify(next), now()],
  );
  return next;
}

/** Human-readable summary for prompts; empty fields are omitted. */
export async function describeBrandKit(kit: BrandKit): Promise<string> {
  const logo = kit.logoAssetId ? await getAsset(kit.logoAssetId) : null;
  const logoExt = logo?.storageKey.match(/\.[a-z0-9]+$/)?.[0] ?? "";
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
    ["Logo", kit.logoAssetId ? `uploaded (in/${kit.logoAssetId}${logoExt} in the workspace)` : ""],
    ["Notes", kit.notes],
  ];
  const filled = rows.filter(([, v]) => v);
  return filled.length ? filled.map(([k, v]) => `- ${k}: ${v}`).join("\n") : "(empty — nothing saved yet)";
}
