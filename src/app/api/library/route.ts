import { requireAccess } from "@/lib/auth/access";
import { dynamic } from "@/lib/http";
import { catalog, libraryInstalled, searchLibrary } from "@/lib/library";
import { CAPTION_STYLES } from "@/lib/library/captions";
import { EMOJIS } from "@/lib/library/emoji";
import { FONTS } from "@/lib/library/fonts";
import type { AssetKind } from "@/lib/library/types";

const KINDS: AssetKind[] = ["font", "caption_style", "transition", "sticker", "emoji", "sfx", "look", "meme_format"];

/** Browsable library for the studio's Library panel. */
export async function GET(req: Request) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 100);
  const kindParam = url.searchParams.get("kind") as AssetKind | null;
  const kind = kindParam && KINDS.includes(kindParam) ? kindParam : undefined;
  // My Kit has its own tab (/api/kit); this lists the shared library only.
  const shared = (await catalog(access.workspaceId)).filter((e) => e.source !== "kit");
  const entries = q ? (await searchLibrary(q, access.workspaceId, kind, 160)).filter((e) => e.source !== "kit") : shared.filter((e) => !kind || e.kind === kind);
  const counts = Object.fromEntries(KINDS.map((k) => [k, shared.filter((e) => e.kind === k).length]));
  return Response.json({
    installed: libraryInstalled(),
    counts,
    entries: entries.slice(0, 200).map((e) => {
      const key = e.id.split(":")[1];
      const font = e.kind === "font" ? FONTS.find((f) => e.name === f.family) : undefined;
      const cap = e.kind === "caption_style" ? CAPTION_STYLES.find((c) => c.id === key) : undefined;
      const emoji = e.kind === "emoji" ? EMOJIS.find((x) => x.name === key) : undefined;
      return {
        id: e.id,
        kind: e.kind,
        name: e.name,
        description: e.description,
        tags: e.tags.slice(0, 6),
        license: e.license.name,
        preview: font
          ? { type: "font", family: font.family, weight: Math.max(...font.weights), tamil: font.scripts.includes("tamil") }
          : cap
            ? { type: "caption", font: cap.font, weight: cap.weight, color: cap.color, activeColor: cap.activeColor, box: cap.activeBox ?? cap.box, uppercase: cap.uppercase }
            : emoji
              ? { type: "emoji", char: emoji.char }
              : { type: "none" },
      };
    }),
  });
}
