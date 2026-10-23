/**
 * Curated Google Fonts (all SIL OFL: free for commercial use and embedding).
 * Downloaded once by `npm run setup:library` into data/library/fonts.
 */
export interface FontFamily {
  family: string;
  weights: number[];
  scripts: ("latin" | "tamil" | "devanagari" | "malayalam" | "telugu" | "kannada")[];
  style: "display" | "sans" | "serif" | "script" | "mono" | "handwriting";
  tags: string[];
}

const f = (family: string, weights: number[], style: FontFamily["style"], tags: string[], scripts: FontFamily["scripts"] = ["latin"]): FontFamily => ({
  family,
  weights,
  style,
  tags,
  scripts,
});

export const FONTS: FontFamily[] = [
  // Tamil
  f("Noto Sans Tamil", [400, 700, 900], "sans", ["tamil", "clean", "captions", "readable"], ["tamil", "latin"]),
  f("Anek Tamil", [400, 700, 800], "display", ["tamil", "bold", "headline", "modern"], ["tamil", "latin"]),
  f("Mukta Malar", [400, 700, 800], "sans", ["tamil", "friendly", "captions"], ["tamil", "latin"]),
  f("Catamaran", [400, 700, 900], "sans", ["tamil", "bold", "captions", "punchy"], ["tamil", "latin"]),
  f("Hind Madurai", [400, 700], "sans", ["tamil", "clean", "body"], ["tamil", "latin"]),
  f("Baloo Thambi 2", [400, 700, 800], "display", ["tamil", "rounded", "fun", "kids"], ["tamil", "latin"]),
  f("Meera Inimai", [400], "sans", ["tamil", "soft", "elegant"], ["tamil", "latin"]),
  f("Pavanam", [400], "sans", ["tamil", "light", "minimal"], ["tamil", "latin"]),
  f("Kavivanar", [400], "script", ["tamil", "handwritten", "poetic"], ["tamil", "latin"]),
  f("Arima", [400, 700], "display", ["tamil", "festive", "decorative"], ["tamil", "latin"]),
  f("Noto Serif Tamil", [400, 700], "serif", ["tamil", "classic", "traditional"], ["tamil", "latin"]),
  f("Coiny", [400], "display", ["tamil", "playful", "cartoon", "kids"], ["tamil", "latin"]),
  // Other Indian scripts
  f("Noto Sans Devanagari", [400, 700, 900], "sans", ["hindi", "clean"], ["devanagari", "latin"]),
  f("Mukta", [400, 700, 800], "sans", ["hindi", "friendly"], ["devanagari", "latin"]),
  f("Noto Sans Malayalam", [400, 700, 900], "sans", ["malayalam", "clean"], ["malayalam", "latin"]),
  f("Baloo Chettan 2", [400, 700, 800], "display", ["malayalam", "rounded", "fun"], ["malayalam", "latin"]),
  f("Noto Sans Telugu", [400, 700, 900], "sans", ["telugu", "clean"], ["telugu", "latin"]),
  f("Ramabhadra", [400], "display", ["telugu", "bold", "headline"], ["telugu", "latin"]),
  f("Noto Sans Kannada", [400, 700, 900], "sans", ["kannada", "clean"], ["kannada", "latin"]),
  f("Baloo Tamma 2", [400, 700, 800], "display", ["kannada", "rounded", "fun"], ["kannada", "latin"]),
  // Display / headline
  f("Bebas Neue", [400], "display", ["condensed", "bold", "headline", "youtube", "cinematic"]),
  f("Anton", [400], "display", ["condensed", "impact", "headline", "reels", "meme"]),
  f("Oswald", [400, 700], "display", ["condensed", "news", "headline"]),
  f("Archivo Black", [400], "display", ["heavy", "bold", "captions", "punchy"]),
  f("Bangers", [400], "display", ["comic", "fun", "meme", "cartoon"]),
  f("Luckiest Guy", [400], "display", ["comic", "fun", "kids", "bold"]),
  f("Bungee", [400], "display", ["urban", "signage", "bold"]),
  f("Rubik Mono One", [400], "display", ["heavy", "geometric", "bold"]),
  f("Black Ops One", [400], "display", ["military", "gaming", "stencil"]),
  f("Monoton", [400], "display", ["retro", "neon", "80s"]),
  f("Righteous", [400], "display", ["retro", "rounded", "groovy"]),
  f("Fredoka", [400, 700], "display", ["rounded", "friendly", "kids"]),
  f("Lilita One", [400], "display", ["bold", "rounded", "fun", "captions"]),
  f("Titan One", [400], "display", ["bubbly", "fun", "bold"]),
  f("Passion One", [400, 700], "display", ["bold", "sports", "punchy"]),
  f("Russo One", [400], "display", ["tech", "sports", "bold"]),
  f("Teko", [400, 700], "display", ["condensed", "sports", "tech"]),
  f("Barlow Condensed", [400, 700, 800], "display", ["condensed", "clean", "titles"]),
  f("Big Shoulders Display", [700, 900], "display", ["condensed", "urban", "bold"]),
  f("Unbounded", [400, 700, 900], "display", ["wide", "modern", "tech", "startup"]),
  f("Syne", [400, 700, 800], "display", ["artsy", "fashion", "modern"]),
  f("Space Grotesk", [400, 700], "sans", ["tech", "modern", "startup"]),
  // Sans
  f("Inter", [400, 600, 800], "sans", ["clean", "ui", "minimal", "subtitles"]),
  f("Montserrat", [400, 700, 900], "sans", ["geometric", "popular", "captions", "bold"]),
  f("Poppins", [400, 600, 800], "sans", ["geometric", "friendly", "captions"]),
  f("Plus Jakarta Sans", [400, 700, 800], "sans", ["modern", "clean", "startup"]),
  f("DM Sans", [400, 700], "sans", ["clean", "minimal"]),
  f("Manrope", [400, 700, 800], "sans", ["modern", "clean"]),
  f("Outfit", [400, 700, 900], "sans", ["geometric", "modern"]),
  f("Sora", [400, 700, 800], "sans", ["tech", "modern"]),
  f("Urbanist", [400, 700, 900], "sans", ["geometric", "fashion"]),
  f("Raleway", [400, 700, 900], "sans", ["elegant", "thin", "luxury"]),
  f("Nunito", [400, 800, 900], "sans", ["rounded", "friendly"]),
  f("Lexend", [400, 700], "sans", ["readable", "clean"]),
  f("Kanit", [400, 700, 900], "sans", ["bold", "sports", "thai"]),
  f("Rubik", [400, 700, 900], "sans", ["rounded", "bold", "captions"]),
  // Serif
  f("Playfair Display", [400, 700, 900], "serif", ["elegant", "luxury", "wedding", "editorial"]),
  f("DM Serif Display", [400], "serif", ["elegant", "headline", "fashion"]),
  f("Fraunces", [400, 700, 900], "serif", ["editorial", "warm", "soft"]),
  f("Cormorant Garamond", [400, 700], "serif", ["luxury", "classic", "wedding"]),
  f("Libre Baskerville", [400, 700], "serif", ["classic", "book", "documentary"]),
  f("Abril Fatface", [400], "serif", ["heavy", "fashion", "poster"]),
  f("Prata", [400], "serif", ["luxury", "elegant"]),
  f("Bodoni Moda", [400, 700, 900], "serif", ["fashion", "vogue", "luxury"]),
  f("Instrument Serif", [400], "serif", ["editorial", "modern", "minimal"]),
  // Script / handwriting
  f("Pacifico", [400], "script", ["retro", "beach", "fun"]),
  f("Dancing Script", [400, 700], "script", ["elegant", "wedding", "signature"]),
  f("Caveat", [400, 700], "handwriting", ["handwritten", "notes", "casual"]),
  f("Great Vibes", [400], "script", ["wedding", "luxury", "calligraphy"]),
  f("Satisfy", [400], "script", ["casual", "signature"]),
  f("Lobster", [400], "script", ["retro", "bold", "food"]),
  f("Permanent Marker", [400], "handwriting", ["marker", "street", "bold", "meme"]),
  f("Kaushan Script", [400], "script", ["brush", "sports", "energetic"]),
  f("Sacramento", [400], "script", ["thin", "elegant", "wedding"]),
  f("Yellowtail", [400], "script", ["retro", "signature"]),
  f("Shadows Into Light", [400], "handwriting", ["handwritten", "casual", "notes"]),
  // Mono / pixel
  f("JetBrains Mono", [400, 700], "mono", ["code", "tech"]),
  f("Space Mono", [400, 700], "mono", ["retro", "tech"]),
  f("VT323", [400], "mono", ["terminal", "retro", "glitch"]),
  f("Press Start 2P", [400], "mono", ["pixel", "gaming", "8bit"]),
  f("Silkscreen", [400, 700], "mono", ["pixel", "gaming"]),
];

export function fontId(family: string) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function fontFile(family: string, weight: number) {
  return `fonts/${fontId(family)}-${weight}.ttf`;
}
