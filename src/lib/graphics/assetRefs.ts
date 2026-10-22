import fs from "node:fs";
import { getAsset } from "../assets";
import { getStorage } from "../storage";

const MAX_INLINE_BYTES = 8 * 1024 * 1024;

/**
 * Designs reference uploaded images (logo, product photos, video thumbnails)
 * as janux-asset://<id>. Rendering swaps those for data URIs so the page
 * never needs network or file access. Unknown ids become transparent.
 */
export function resolveAssetRefs(html: string): string {
  return html.replace(/janux-asset:\/\/(ast_[a-f0-9]{32})(\/thumb)?/g, (_m, id: string, thumb?: string) => {
    const a = getAsset(id);
    const storage = getStorage();
    const key = a ? (thumb || a.mediaType === "video" ? a.thumbKey : a.mediaType === "image" ? a.storageKey : null) : null;
    if (!key || !storage.exists(key)) return TRANSPARENT;
    const p = storage.absolutePath(key);
    if (fs.statSync(p).size > MAX_INLINE_BYTES) return TRANSPARENT;
    const mime = key.endsWith(".jpg") ? "image/jpeg" : a!.mime;
    return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
  });
}

const TRANSPARENT = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
