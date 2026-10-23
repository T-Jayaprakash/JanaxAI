/** Every library asset carries its licence so exports can credit it correctly. */
export interface License {
  name: string;
  url: string;
  /** Credit line to show with videos that use it, when the licence asks for one. */
  attribution?: string;
  commercialUse: boolean;
}

export const ASSET_KINDS = ["font", "transition", "caption_style", "sticker", "emoji", "sfx", "meme_format", "look", "logo", "image", "overlay", "music", "style"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface LibraryEntry {
  id: string;
  kind: AssetKind;
  name: string;
  tags: string[];
  description: string;
  license: License;
  /** How the editor uses it (shown to Claude in search results). */
  usage: string;
  /** "kit" = imported by the user (My Kit). */
  source?: "library" | "kit";
}

export const LICENSES = {
  ofl: { name: "SIL Open Font License 1.1", url: "https://openfontlicense.org", commercialUse: true },
  notoEmoji: {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Animated emoji: Noto Emoji by Google, CC BY 4.0",
    commercialUse: true,
  },
  janux: { name: "JANUXAI original (included with the app)", url: "https://github.com/T-Jayaprakash/JanaxAI", commercialUse: true },
  ffmpeg: { name: "FFmpeg built-in (LGPL)", url: "https://ffmpeg.org/legal.html", commercialUse: true },
} satisfies Record<string, License>;
