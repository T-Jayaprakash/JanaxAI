/**
 * Renders the app icons (PWA + Apple touch) from the logo mark:  npx tsx scripts/make-icons.ts
 * Output goes to public/; re-run after changing the logo.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { chromePath } from "../src/lib/graphics/render";

const BUBBLE =
  "M8 10.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v8c0 1.4-1.1 2.5-2.5 2.5H15l-4 3.5V21h-.5C9.1 21 8 19.9 8 18.5v-8Z";
const PLAY = "M14 11.2v6.6c0 .5.5.8.9.5l5-3.3c.4-.3.4-.8 0-1.1l-5-3.3c-.4-.2-.9.1-.9.6Z";

/** `inset` = share of the canvas the speech bubble fills (maskable icons need a safe zone). */
function svg(size: number, inset: number, rounded: boolean) {
  // The bubble spans x 8–24, y 8–24.5 of the logo's 32-unit box.
  const vb = 17 / inset;
  const x0 = 16 - vb / 2;
  const y0 = 16.4 - vb / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${x0} ${y0} ${vb} ${vb}">
<rect x="${x0}" y="${y0}" width="${vb}" height="${vb}" ${rounded ? `rx="${vb * 0.22}"` : ""} fill="#0A0A0A"/>
<path d="${BUBBLE}" fill="#F5F5F5"/><path d="${PLAY}" fill="#0A0A0A"/></svg>`;
}

async function main() {
  const exe = chromePath();
  if (!exe) throw new Error("Google Chrome is needed to render icons.");
  const out = path.join(process.cwd(), "public");
  fs.mkdirSync(out, { recursive: true });
  const icons = [
    { file: "icon-192.png", size: 192, inset: 0.66, rounded: false },
    { file: "icon-512.png", size: 512, inset: 0.66, rounded: false },
    { file: "icon-maskable-512.png", size: 512, inset: 0.5, rounded: false },
    { file: "apple-touch-icon.png", size: 180, inset: 0.66, rounded: false },
  ];
  fs.writeFileSync(path.join(out, "icon.svg"), svg(64, 0.7, true));
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    for (const i of icons) {
      await page.setViewport({ width: i.size, height: i.size });
      await page.setContent(`<html><body style="margin:0">${svg(i.size, i.inset, i.rounded)}</body></html>`);
      await page.screenshot({ path: path.join(out, i.file) as `${string}.png`, clip: { x: 0, y: 0, width: i.size, height: i.size } });
      console.log("wrote", i.file);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
