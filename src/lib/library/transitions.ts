/**
 * Two kinds of transition:
 * - xfade: FFmpeg's built-in blends between two clips (run_ffmpeg).
 * - overlay: a transparent animation that covers the screen at the cut
 *   (light leaks, film burns, flashes, glitches, shape wipes...). Render it
 *   with render_transition and overlay it centred on a hard cut.
 */
export interface XfadeDef {
  name: string;
  tags: string[];
  description: string;
}

const x = (name: string, description: string, tags: string[]): XfadeDef => ({ name, description, tags });

export const XFADES: XfadeDef[] = [
  x("fade", "Classic crossfade.", ["smooth", "soft", "classic"]),
  x("fadeblack", "Dip to black between clips.", ["dip", "cinematic", "dramatic"]),
  x("fadewhite", "Dip to white (flash).", ["flash", "bright", "wedding"]),
  x("fadegrays", "Crossfade through greyscale.", ["artistic", "soft"]),
  x("fadefast", "Quick crossfade.", ["fast", "snappy"]),
  x("fadeslow", "Slow, dreamy crossfade.", ["slow", "dreamy"]),
  x("dissolve", "Grainy dissolve.", ["film", "vintage"]),
  x("pixelize", "Pixelate out and in.", ["gaming", "digital", "glitch"]),
  x("distance", "Morph by colour distance.", ["artistic", "trippy"]),
  x("hblur", "Horizontal blur blend (motion feel).", ["motion", "whip"]),
  x("zoomin", "Zoom into the next clip.", ["zoom", "energetic", "punch"]),
  x("radial", "Clock-hand radial wipe.", ["radial", "playful"]),
  x("circleopen", "Iris opens from the centre.", ["iris", "reveal"]),
  x("circleclose", "Iris closes to the centre.", ["iris", "ending"]),
  x("circlecrop", "Circle crop through black.", ["iris", "retro"]),
  x("rectcrop", "Rectangle crop through black.", ["box", "retro"]),
  x("vertopen", "Vertical doors open.", ["doors", "reveal"]),
  x("vertclose", "Vertical doors close.", ["doors"]),
  x("horzopen", "Horizontal doors open.", ["doors", "reveal"]),
  x("horzclose", "Horizontal doors close.", ["doors"]),
  ...(["left", "right", "up", "down"] as const).flatMap((d) => [
    x(`wipe${d}`, `Hard-edge wipe ${d}.`, ["wipe", "clean"]),
    x(`slide${d}`, `Slide the new clip in ${d}.`, ["slide", "energetic", "reels"]),
    x(`smooth${d}`, `Soft-edge wipe ${d}.`, ["wipe", "smooth"]),
    x(`cover${d}`, `New clip covers the old one ${d}.`, ["cover", "slide"]),
    x(`reveal${d}`, `Old clip slides away ${d}, revealing the new one.`, ["reveal", "slide"]),
  ]),
  ...(["tl", "tr", "bl", "br"] as const).flatMap((d) => [x(`diag${d}`, `Diagonal wipe from ${d}.`, ["diagonal", "wipe"]), x(`wipe${d}`, `Corner wipe from ${d}.`, ["corner", "wipe"])]),
  x("hlslice", "Horizontal slices sweep left.", ["slices", "stylish"]),
  x("hrslice", "Horizontal slices sweep right.", ["slices", "stylish"]),
  x("vuslice", "Vertical slices sweep up.", ["slices", "stylish"]),
  x("vdslice", "Vertical slices sweep down.", ["slices", "stylish"]),
  x("squeezeh", "Squeeze horizontally.", ["squeeze", "playful"]),
  x("squeezev", "Squeeze vertically.", ["squeeze", "playful"]),
  x("hlwind", "Wind streaks left.", ["wind", "motion"]),
  x("hrwind", "Wind streaks right.", ["wind", "motion"]),
  x("vuwind", "Wind streaks up.", ["wind", "motion"]),
  x("vdwind", "Wind streaks down.", ["wind", "motion"]),
];

export interface OverlayTransitionDef {
  id: string;
  name: string;
  tags: string[];
  description: string;
  defaultDuration: number;
  /** Builds a transparent HTML composition; the screen is fully covered around the middle. */
  html: (w: number, h: number, d: number, color: string) => string;
}

const css = (s: string) => `<style>html,body{background:transparent}${s}</style>`;

export const OVERLAY_TRANSITIONS: OverlayTransitionDef[] = [
  {
    id: "light-leak",
    name: "Light leak",
    tags: ["warm", "film", "dreamy", "wedding", "travel"],
    description: "Warm orange-pink light sweeps across and flares at the cut.",
    defaultDuration: 1.2,
    html: (w, h, d) =>
      css(`.l{position:absolute;inset:-30%;mix-blend-mode:screen;filter:blur(60px);animation:sweep ${d}s ease-in-out both}
.a{background:radial-gradient(40% 50% at 30% 50%,#ffb36b,transparent 70%)}.b{background:radial-gradient(35% 45% at 70% 40%,#ff5e7e,transparent 70%);animation-delay:${d * 0.08}s}
.f{position:absolute;inset:0;background:#fff3e0;animation:flash ${d}s ease-in-out both}
@keyframes sweep{0%{transform:translateX(-80%);opacity:0}50%{opacity:1}100%{transform:translateX(80%);opacity:0}}
@keyframes flash{0%,35%{opacity:0}50%{opacity:.95}65%,100%{opacity:0}}`) + `<div class="l a"></div><div class="l b"></div><div class="f"></div>`,
  },
  {
    id: "film-burn",
    name: "Film burn",
    tags: ["film", "vintage", "retro", "cinematic"],
    description: "Orange film burn blooms from the edge and whites out the cut.",
    defaultDuration: 1.4,
    html: (w, h, d) =>
      css(`.b{position:absolute;width:${Math.max(w, h) * 1.6}px;height:${Math.max(w, h) * 1.6}px;left:-40%;top:-30%;border-radius:50%;
background:radial-gradient(circle,#fff 0%,#ffe2a8 20%,#ff8a2a 45%,#8a1c00 70%,transparent 75%);filter:blur(30px);animation:burn ${d}s ease-in-out both}
@keyframes burn{0%{transform:scale(.05);opacity:0}45%{transform:scale(1);opacity:1}60%{opacity:1}100%{transform:scale(1.4) translate(20%,10%);opacity:0}}`) + `<div class="b"></div>`,
  },
  {
    id: "flash-white",
    name: "White flash",
    tags: ["flash", "beat", "energetic", "photo"],
    description: "Bright camera-flash hit on the beat.",
    defaultDuration: 0.5,
    html: (w, h, d) => css(`.f{position:absolute;inset:0;background:#fff;animation:f ${d}s ease-out both}@keyframes f{0%{opacity:0}40%{opacity:1}100%{opacity:0}}`) + `<div class="f"></div>`,
  },
  {
    id: "dip-color",
    name: "Dip to colour",
    tags: ["brand", "clean", "dip"],
    description: "Fade through a solid brand colour.",
    defaultDuration: 0.8,
    html: (w, h, d, c) => css(`.f{position:absolute;inset:0;background:${c};animation:f ${d}s ease-in-out both}@keyframes f{0%{opacity:0}45%,55%{opacity:1}100%{opacity:0}}`) + `<div class="f"></div>`,
  },
  {
    id: "glitch",
    name: "Glitch",
    tags: ["glitch", "digital", "gaming", "tech", "energetic"],
    description: "RGB-split bars and noise blocks jitter over the cut.",
    defaultDuration: 0.6,
    html: (w, h, d) => {
      const bars = Array.from({ length: 14 }, (_, i) => {
        const top = ((i * 37) % 100) / 100;
        const hh = 3 + ((i * 13) % 9);
        const color = ["#ff004c", "#00e5ff", "#ffffff", "#111"][i % 4];
        return `<i style="top:${(top * 100).toFixed(1)}%;height:${hh}%;background:${color};animation-delay:${((i * 0.037) % 0.2).toFixed(3)}s"></i>`;
      }).join("");
      return (
        css(`i{position:absolute;left:-10%;right:-10%;opacity:0;mix-blend-mode:screen;animation:g ${d}s steps(6) both}
@keyframes g{0%{opacity:0}20%{opacity:.9;transform:translateX(-6%)}40%{transform:translateX(5%)}60%{opacity:.9;transform:translateX(-3%)}80%{opacity:.6}100%{opacity:0;transform:none}}
.n{position:absolute;inset:0;background:#000;animation:n ${d}s steps(2) both}@keyframes n{0%,40%{opacity:0}50%{opacity:1}60%,100%{opacity:0}}`) + `<div class="n"></div>${bars}`
      );
    },
  },
  ...(["circle", "diamond", "star", "heart"] as const).map<OverlayTransitionDef>((shape) => ({
    id: `${shape}-wipe`,
    name: `${shape[0].toUpperCase()}${shape.slice(1)} wipe`,
    tags: ["shape", "wipe", "playful", shape === "heart" ? "love" : "fun"],
    description: `A ${shape} grows to cover the screen, then opens to reveal the next clip.`,
    defaultDuration: 0.9,
    html: (w: number, h: number, d: number, c: string) => {
      const size = Math.hypot(w, h) * 1.25;
      const path =
        shape === "circle"
          ? `<circle cx="50" cy="50" r="50" fill="${c}"/>`
          : shape === "diamond"
            ? `<polygon points="50,0 100,50 50,100 0,50" fill="${c}"/>`
            : shape === "star"
              ? `<polygon points="50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35" fill="${c}"/>`
              : `<path d="M50 90 C 10 60 0 35 18 20 C 33 8 47 18 50 28 C 53 18 67 8 82 20 C 100 35 90 60 50 90 Z" fill="${c}"/>`;
      const scale = shape === "circle" ? 1 : 1.8;
      return (
        css(`svg{position:absolute;left:50%;top:50%;width:${size * scale}px;height:${size * scale}px;margin:-${(size * scale) / 2}px 0 0 -${(size * scale) / 2}px;animation:s ${d}s cubic-bezier(.7,0,.3,1) both}
@keyframes s{0%{transform:scale(0) rotate(-30deg)}48%,52%{transform:scale(1) rotate(0)}100%{transform:scale(0) rotate(30deg)}}`) + `<svg viewBox="0 0 100 100">${path}</svg>`
      );
    },
  })),
  {
    id: "brush-wipe",
    name: "Brush stroke wipe",
    tags: ["brush", "artistic", "paint", "creative"],
    description: "A painted brush stroke sweeps across, covering the cut.",
    defaultDuration: 1.0,
    html: (w, h, d, c) =>
      css(`svg{position:absolute;inset:0;width:100%;height:100%}path{fill:none;stroke:${c};stroke-width:${Math.round(Math.max(w, h) * 0.55)};stroke-linecap:round;stroke-dasharray:3000;animation:p ${d}s cubic-bezier(.6,0,.4,1) both}
@keyframes p{0%{stroke-dashoffset:3000}50%{stroke-dashoffset:0}100%{stroke-dashoffset:-3000}}`) +
      `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="M-200 300 C 200 100 400 600 700 350 S 1100 500 1300 700"/></svg>`,
  },
  {
    id: "split-slats",
    name: "Split slats",
    tags: ["slats", "stylish", "modern", "fashion"],
    description: "Vertical slats drop in to cover, then lift away.",
    defaultDuration: 0.9,
    html: (w, h, d, c) =>
      css(`.s{position:absolute;top:0;bottom:0;width:20.5%;background:${c};animation:s ${d}s cubic-bezier(.7,0,.3,1) both}
@keyframes s{0%{transform:translateY(-101%)}45%,55%{transform:none}100%{transform:translateY(101%)}}`) +
      Array.from({ length: 5 }, (_, i) => `<div class="s" style="left:${i * 20}%;animation-delay:${(i * 0.04).toFixed(2)}s"></div>`).join(""),
  },
  {
    id: "grid-squares",
    name: "Grid squares",
    tags: ["grid", "tech", "modern", "mosaic"],
    description: "Squares pop in across a grid, then vanish.",
    defaultDuration: 1.0,
    html: (w, h, d, c) => {
      const cols = 6;
      const rows = Math.ceil((cols * h) / w);
      const cells = [];
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < cols; k++) cells.push(`<i style="left:${(k / cols) * 100}%;top:${(r / rows) * 100}%;width:${100 / cols + 0.3}%;height:${100 / rows + 0.3}%;animation-delay:${(((r + k) % 7) * 0.035).toFixed(3)}s"></i>`);
      return css(`i{position:absolute;background:${c};animation:q ${d}s cubic-bezier(.6,0,.4,1) both}@keyframes q{0%{transform:scale(0)}45%,55%{transform:scale(1)}100%{transform:scale(0)}}`) + cells.join("");
    },
  },
  {
    id: "whip-streak",
    name: "Whip-pan streaks",
    tags: ["whip", "motion", "fast", "energetic", "travel"],
    description: "Motion-blur streaks fly across like a fast camera whip (pair with xfade slideleft).",
    defaultDuration: 0.5,
    html: (w, h, d) =>
      css(`i{position:absolute;left:-60%;height:6%;width:60%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.9),transparent);filter:blur(6px);animation:w ${d}s ease-in both}
@keyframes w{from{transform:translateX(0)}to{transform:translateX(${w * 2.6}px)}}`) +
      Array.from({ length: 12 }, (_, i) => `<i style="top:${(i * 8.3).toFixed(1)}%;animation-delay:${((i * 0.017) % 0.12).toFixed(3)}s"></i>`).join(""),
  },
  {
    id: "spotlight-iris",
    name: "Spotlight iris",
    tags: ["iris", "spotlight", "vintage", "ending"],
    description: "Black closes in to a spotlight and reopens on the next clip.",
    defaultDuration: 1.0,
    html: (w, h, d) => {
      const r = Math.hypot(w, h);
      return (
        css(`@property --r{syntax:'<length>';inherits:false;initial-value:0px}
.m{position:absolute;inset:0;background:#000;-webkit-mask:radial-gradient(circle,transparent var(--r),#000 calc(var(--r) + 2px));mask:radial-gradient(circle,transparent var(--r),#000 calc(var(--r) + 2px));animation:iris ${d}s cubic-bezier(.7,0,.3,1) both}
@keyframes iris{0%{--r:${r}px}50%{--r:0px}100%{--r:${r}px}}`) + `<div class="m"></div>`
      );
    },
  },
];
