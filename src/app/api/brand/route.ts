import { getAsset, toPublicAsset } from "@/lib/assets";
import { BrandKitSchema, getBrandKit, updateBrandKit } from "@/lib/brand";
import { dynamic, jsonError } from "@/lib/http";

function view() {
  const kit = getBrandKit();
  const logo = kit.logoAssetId ? getAsset(kit.logoAssetId) : null;
  return { brand: kit, logo: logo ? toPublicAsset(logo) : null };
}

export async function GET() {
  await dynamic();
  return Response.json(view());
}

export async function PUT(req: Request) {
  const parsed = BrandKitSchema.partial().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Some brand details are invalid. Colors must look like #F2A33A.");
  if (parsed.data.logoAssetId) {
    const a = getAsset(parsed.data.logoAssetId);
    if (!a || a.mediaType !== "image") return jsonError(400, "The logo must be an uploaded image.");
  }
  updateBrandKit(parsed.data);
  return Response.json(view());
}
