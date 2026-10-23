/**
 * Animated sticker components (original to JANUXAI, so no licence issues).
 * Each returns an HTML+CSS snippet the editor drops into a render_animation
 * composition. Animations are CSS keyframes, so frames can be seeked.
 * Placeholders: {{text}}, {{color}}, {{accent}}, {{delay}} (seconds).
 */
export interface StickerDef {
  id: string;
  name: string;
  tags: string[];
  description: string;
  snippet: string;
}

export const STICKERS: StickerDef[] = [
  {
    id: "subscribe-button",
    name: "Subscribe button",
    tags: ["youtube", "subscribe", "cta", "button"],
    description: "Red pill button that pops in and gets clicked by a cursor.",
    snippet: `<div style="position:absolute;left:50%;top:70%;transform:translate(-50%,-50%);animation:jx-pop .5s cubic-bezier(.2,1.4,.4,1) {{delay}}s both">
<div style="display:flex;align-items:center;gap:18px;background:#e62117;color:#fff;font:800 54px Montserrat,sans-serif;padding:26px 54px;border-radius:999px;box-shadow:0 18px 40px rgba(0,0,0,.35);animation:jx-press .25s ease-in calc({{delay}}s + .9s) both">🔔 {{text}}</div>
<div style="position:absolute;right:-40px;bottom:-60px;font-size:90px;animation:jx-cursor .6s ease-out calc({{delay}}s + .3s) both">👆</div></div>
<style>@keyframes jx-pop{from{transform:translate(-50%,-50%) scale(0)}to{transform:translate(-50%,-50%) scale(1)}}@keyframes jx-press{50%{transform:scale(.9);background:#666}to{transform:scale(1);background:#666}}@keyframes jx-cursor{from{transform:translate(120px,120px);opacity:0}to{transform:none;opacity:1}}</style>`,
  },
  {
    id: "price-tag",
    name: "Price tag",
    tags: ["price", "offer", "sale", "shop"],
    description: "Swinging price tag with a big number.",
    snippet: `<div style="position:absolute;right:8%;top:18%;transform-origin:50% 0;animation:jx-swing 1.6s ease-out {{delay}}s both">
<div style="width:6px;height:80px;background:#ddd;margin:0 auto"></div>
<div style="background:{{color}};color:#fff;font:900 96px Anton,sans-serif;padding:30px 50px 36px;border-radius:24px 24px 40px 40px;box-shadow:0 20px 50px rgba(0,0,0,.4);text-align:center">{{text}}</div></div>
<style>@keyframes jx-swing{0%{transform:rotate(-35deg) scale(0)}30%{transform:rotate(18deg) scale(1)}55%{transform:rotate(-9deg)}75%{transform:rotate(4deg)}to{transform:rotate(0)}}</style>`,
  },
  {
    id: "sale-burst",
    name: "Sale starburst",
    tags: ["sale", "offer", "discount", "badge"],
    description: "Spinning starburst badge for discounts (e.g. 50% OFF).",
    snippet: `<div style="position:absolute;left:10%;top:12%;width:360px;height:360px;animation:jx-burst .6s cubic-bezier(.2,1.6,.4,1) {{delay}}s both">
<svg viewBox="0 0 100 100" style="position:absolute;inset:0;animation:jx-spin 8s linear infinite"><polygon fill="{{color}}" points="50,0 59,18 79,10 76,31 97,36 82,52 96,69 75,72 77,93 58,84 50,100 42,84 23,93 25,72 4,69 18,52 3,36 24,31 21,10 41,18"/></svg>
<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:900 70px/0.95 Anton,sans-serif;text-align:center">{{text}}</div></div>
<style>@keyframes jx-burst{from{transform:scale(0) rotate(-90deg)}to{transform:scale(1)}}@keyframes jx-spin{to{transform:rotate(360deg)}}</style>`,
  },
  {
    id: "new-badge",
    name: "NEW badge",
    tags: ["new", "launch", "badge"],
    description: "Pill badge that slides in with a shine sweep.",
    snippet: `<div style="position:absolute;left:8%;top:10%;overflow:hidden;border-radius:14px;animation:jx-slidein .5s ease-out {{delay}}s both"><div style="background:{{color}};color:#fff;font:900 58px Montserrat,sans-serif;padding:14px 34px;letter-spacing:.06em;position:relative">{{text}}<span style="position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.6),transparent 70%);animation:jx-shine 1s ease-in-out calc({{delay}}s + .5s) both"></span></div></div>
<style>@keyframes jx-slidein{from{transform:translateX(-140%)}to{transform:none}}@keyframes jx-shine{from{transform:translateX(-100%)}to{transform:translateX(100%)}}</style>`,
  },
  {
    id: "location-pin",
    name: "Location pin",
    tags: ["location", "address", "shop", "map"],
    description: "Dropping map pin with the place name.",
    snippet: `<div style="position:absolute;left:50%;bottom:16%;transform:translateX(-50%);text-align:center;animation:jx-drop .7s cubic-bezier(.3,1.5,.5,1) {{delay}}s both">
<div style="font-size:120px;line-height:1">📍</div><div style="margin-top:10px;background:rgba(0,0,0,.65);color:#fff;font:700 50px Poppins,sans-serif;padding:16px 34px;border-radius:999px;white-space:nowrap">{{text}}</div></div>
<style>@keyframes jx-drop{from{transform:translate(-50%,-400px);opacity:0}to{transform:translateX(-50%);opacity:1}}</style>`,
  },
  {
    id: "swipe-up",
    name: "Swipe up / link below",
    tags: ["cta", "swipe", "link", "below"],
    description: "Bouncing chevrons with a call to action.",
    snippet: `<div style="position:absolute;left:50%;bottom:8%;transform:translateX(-50%);text-align:center;color:#fff;font:800 48px Montserrat,sans-serif;animation:jx-fadeup .5s ease-out {{delay}}s both">
<div style="font-size:70px;line-height:.7;animation:jx-bob 1s ease-in-out infinite">⌃<br>⌃</div>{{text}}</div>
<style>@keyframes jx-fadeup{from{opacity:0;transform:translate(-50%,40px)}to{opacity:1;transform:translateX(-50%)}}@keyframes jx-bob{50%{transform:translateY(-18px)}}</style>`,
  },
  {
    id: "lower-third",
    name: "Lower third name card",
    tags: ["name", "title", "interview", "lower third", "speaker"],
    description: "Name and role card sliding in at the bottom left.",
    snippet: `<div style="position:absolute;left:6%;bottom:14%;animation:jx-lt .6s cubic-bezier(.2,.9,.3,1) {{delay}}s both">
<div style="background:{{color}};height:10px;width:120px;margin-bottom:12px;animation:jx-grow .5s ease-out {{delay}}s both;transform-origin:left"></div>
<div style="background:rgba(10,10,10,.85);color:#fff;font:800 60px Montserrat,sans-serif;padding:18px 32px">{{text}}</div></div>
<style>@keyframes jx-lt{from{transform:translateX(-120%)}to{transform:none}}@keyframes jx-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}</style>`,
  },
  {
    id: "speech-bubble",
    name: "Speech bubble",
    tags: ["comic", "talk", "bubble", "meme"],
    description: "Comic speech bubble that pops in with text.",
    snippet: `<div style="position:absolute;left:12%;top:16%;max-width:70%;animation:jx-bub .45s cubic-bezier(.2,1.6,.4,1) {{delay}}s both;transform-origin:20% 100%">
<div style="background:#fff;color:#111;font:900 56px Bangers,'Luckiest Guy',sans-serif;letter-spacing:.03em;padding:28px 40px;border-radius:40px;border:6px solid #111;position:relative">{{text}}<span style="position:absolute;left:60px;bottom:-46px;border:22px solid transparent;border-top:30px solid #111"></span></div></div>
<style>@keyframes jx-bub{from{transform:scale(0)}to{transform:scale(1)}}</style>`,
  },
  {
    id: "circle-highlight",
    name: "Hand-drawn circle",
    tags: ["highlight", "focus", "circle", "annotate"],
    description: "Marker circle drawn around a point of interest (set left/top).",
    snippet: `<svg style="position:absolute;left:30%;top:40%;width:420px;height:260px;overflow:visible" viewBox="0 0 420 260"><path d="M210 20 C 360 15 410 90 390 150 C 370 220 230 250 130 235 C 40 222 5 160 25 100 C 45 40 150 18 260 30" fill="none" stroke="{{color}}" stroke-width="12" stroke-linecap="round" stroke-dasharray="1300" stroke-dashoffset="1300" style="animation:jx-draw .8s ease-out {{delay}}s forwards"/></svg>
<style>@keyframes jx-draw{to{stroke-dashoffset:0}}</style>`,
  },
  {
    id: "arrow-point",
    name: "Pointing arrow",
    tags: ["arrow", "point", "look", "annotate"],
    description: "Curved arrow that draws itself and nudges toward a spot.",
    snippet: `<svg style="position:absolute;left:55%;top:30%;width:300px;height:300px;overflow:visible;animation:jx-nudge 1s ease-in-out calc({{delay}}s + .8s) infinite" viewBox="0 0 300 300"><path d="M260 30 C 200 40 90 80 60 220" fill="none" stroke="{{color}}" stroke-width="14" stroke-linecap="round" stroke-dasharray="400" stroke-dashoffset="400" style="animation:jx-draw .6s ease-out {{delay}}s forwards"/><path d="M25 180 L60 230 L100 190" fill="none" stroke="{{color}}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0" style="animation:jx-show .1s linear calc({{delay}}s + .55s) forwards"/></svg>
<style>@keyframes jx-draw{to{stroke-dashoffset:0}}@keyframes jx-show{to{opacity:1}}@keyframes jx-nudge{50%{transform:translate(-10px,10px)}}</style>`,
  },
  {
    id: "underline-scribble",
    name: "Underline scribble",
    tags: ["underline", "highlight", "emphasis"],
    description: "Marker underline that draws under a word (position it under your text).",
    snippet: `<svg style="position:absolute;left:20%;top:62%;width:600px;height:60px;overflow:visible" viewBox="0 0 600 60"><path d="M10 40 C 150 10 300 55 590 25" fill="none" stroke="{{color}}" stroke-width="14" stroke-linecap="round" stroke-dasharray="700" stroke-dashoffset="700" style="animation:jx-draw .5s ease-out {{delay}}s forwards"/></svg>
<style>@keyframes jx-draw{to{stroke-dashoffset:0}}</style>`,
  },
  {
    id: "confetti-burst",
    name: "Confetti burst",
    tags: ["celebrate", "party", "launch", "win"],
    description: "Burst of confetti pieces from the centre.",
    snippet: `<div style="position:absolute;left:50%;top:45%">${Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const d = 300 + (i % 5) * 70;
      const colors = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#f72585", "#ffffff"];
      return `<i style="position:absolute;width:22px;height:12px;background:${colors[i % 6]};border-radius:3px;--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d)}px;--r:${i * 47}deg;animation:jx-conf 1.4s cubic-bezier(.1,.8,.3,1) {{delay}}s both"></i>`;
    }).join("")}</div>
<style>@keyframes jx-conf{from{transform:translate(0,0) rotate(0);opacity:1}80%{opacity:1}to{transform:translate(var(--x),calc(var(--y) + 260px)) rotate(var(--r));opacity:0}}</style>`,
  },
  {
    id: "rating-stars",
    name: "Rating stars",
    tags: ["review", "rating", "stars", "testimonial"],
    description: "Five stars filling one by one.",
    snippet: `<div style="position:absolute;left:50%;top:30%;transform:translateX(-50%);display:flex;gap:16px;font-size:110px">${[0, 1, 2, 3, 4]
      .map((i) => `<span style="animation:jx-star .35s cubic-bezier(.2,1.6,.4,1) calc({{delay}}s + ${i * 0.15}s) both">⭐</span>`)
      .join("")}</div>
<style>@keyframes jx-star{from{transform:scale(0) rotate(-60deg)}to{transform:scale(1)}}</style>`,
  },
  {
    id: "countdown",
    name: "Countdown 3-2-1",
    tags: ["countdown", "timer", "intro", "suspense"],
    description: "Big 3, 2, 1 numbers, one per second.",
    snippet: `<div style="position:absolute;inset:0;display:grid;place-items:center;font:900 420px Anton,sans-serif;color:#fff">${["3", "2", "1"]
      .map((n, i) => `<span style="position:absolute;opacity:0;animation:jx-count 1s ease-out calc({{delay}}s + ${i}s) both">${n}</span>`)
      .join("")}</div>
<style>@keyframes jx-count{0%{opacity:0;transform:scale(1.8)}15%{opacity:1;transform:scale(1)}85%{opacity:1}100%{opacity:0;transform:scale(.6)}}</style>`,
  },
  {
    id: "checklist",
    name: "Animated checklist",
    tags: ["list", "tips", "features", "steps"],
    description: "List items appearing with ticks (edit the items).",
    snippet: `<div style="position:absolute;left:10%;top:30%;color:#fff;font:700 60px Poppins,sans-serif;display:grid;gap:30px">${["{{text}}", "Item two", "Item three"]
      .map((t, i) => `<div style="display:flex;gap:24px;align-items:center;animation:jx-item .4s ease-out calc({{delay}}s + ${i * 0.5}s) both"><span style="background:{{color}};width:70px;height:70px;border-radius:50%;display:grid;place-items:center">✓</span>${t}</div>`)
      .join("")}</div>
<style>@keyframes jx-item{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:none}}</style>`,
  },
  {
    id: "progress-bar",
    name: "Progress / loading bar",
    tags: ["progress", "loading", "timer"],
    description: "Bar filling across the bottom over the clip.",
    snippet: `<div style="position:absolute;left:6%;right:6%;bottom:5%;height:16px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden"><div style="height:100%;background:{{color}};transform-origin:left;animation:jx-fill 5s linear {{delay}}s both"></div></div>
<style>@keyframes jx-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}</style>`,
  },
  {
    id: "follow-cta",
    name: "Follow for more",
    tags: ["follow", "cta", "end", "outro"],
    description: "Rounded card with a plus button for an outro call to action.",
    snippet: `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:24px;background:#fff;color:#111;font:800 56px Poppins,sans-serif;padding:24px 44px;border-radius:999px;animation:jx-pop2 .5s cubic-bezier(.2,1.5,.4,1) {{delay}}s both"><span style="background:{{color}};color:#fff;width:80px;height:80px;border-radius:50%;display:grid;place-items:center;font-size:60px">+</span>{{text}}</div>
<style>@keyframes jx-pop2{from{transform:translate(-50%,-50%) scale(0)}to{transform:translate(-50%,-50%) scale(1)}}</style>`,
  },
  {
    id: "wait-for-it",
    name: "Wait for it…",
    tags: ["meme", "suspense", "wait"],
    description: "Bold typed 'Wait for it…' meme caption with blinking dots.",
    snippet: `<div style="position:absolute;left:0;right:0;top:12%;text-align:center;color:#fff;font:400 96px Anton,sans-serif;text-shadow:0 6px 0 #000,0 0 20px #000;animation:jx-fadeup2 .4s ease-out {{delay}}s both">{{text}}<span style="animation:jx-blink 1s steps(1) infinite">…</span></div>
<style>@keyframes jx-fadeup2{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}@keyframes jx-blink{50%{opacity:0}}</style>`,
  },
  {
    id: "to-be-continued",
    name: "To be continued arrow",
    tags: ["meme", "ending", "freeze"],
    description: "Retro arrow sliding in at the bottom left with text (pair with a sepia freeze frame).",
    snippet: `<div style="position:absolute;left:4%;bottom:8%;animation:jx-tbc .5s ease-out {{delay}}s both"><div style="background:#d8c27a;color:#3b2a10;font:700 52px 'Bebas Neue',sans-serif;letter-spacing:.06em;padding:18px 70px 18px 34px;clip-path:polygon(0 0,85% 0,100% 50%,85% 100%,0 100%,6% 50%)">{{text}}</div></div>
<style>@keyframes jx-tbc{from{transform:translateX(-120%)}to{transform:none}}</style>`,
  },
];
