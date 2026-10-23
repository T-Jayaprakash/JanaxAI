/**
 * Caption style presets and the overlay builder. Words are never split
 * into letters, so Tamil (and other Indic) conjuncts stay intact.
 */
export interface CaptionStyle {
  id: string;
  name: string;
  tags: string[];
  description: string;
  font: string;
  tamilFont: string;
  weight: number;
  /** Font size as a fraction of video width. */
  size: number;
  color: string;
  activeColor: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  box: string | null;
  activeBox: string | null;
  uppercase: boolean;
  maxWords: number;
  position: "bottom" | "center" | "top" | "lower";
  animation: "pop" | "karaoke" | "highlight" | "bounce" | "fade" | "typewriter" | "slide" | "none";
}

const base: Omit<CaptionStyle, "id" | "name" | "tags" | "description"> = {
  font: "Montserrat",
  tamilFont: "Catamaran",
  weight: 900,
  size: 0.085,
  color: "#ffffff",
  activeColor: "#ffffff",
  stroke: "#000000",
  strokeWidth: 0.09,
  shadow: "0 6px 0 rgba(0,0,0,.55)",
  box: null,
  activeBox: null,
  uppercase: true,
  maxWords: 3,
  position: "lower",
  animation: "pop",
};

const s = (id: string, name: string, description: string, tags: string[], o: Partial<CaptionStyle>): CaptionStyle => ({ ...base, ...o, id, name, description, tags });

export const CAPTION_STYLES: CaptionStyle[] = [
  s("bold-yellow-pop", "Bold yellow pop", "Heavy white words, the spoken word pops in yellow. The classic reels look.", ["reels", "bold", "popular", "talking"], { activeColor: "#ffd60a" }),
  s("clean-white", "Clean white", "Simple white sentence case with a soft shadow. Calm and readable.", ["minimal", "clean", "vlog"], { uppercase: false, weight: 700, size: 0.062, strokeWidth: 0, shadow: "0 3px 12px rgba(0,0,0,.8)", maxWords: 6, animation: "fade", font: "Inter", tamilFont: "Noto Sans Tamil" }),
  s("karaoke-gold", "Karaoke gold", "The whole line shows; words fill gold as they're spoken.", ["karaoke", "music", "lyrics"], { activeColor: "#ffc94d", maxWords: 5, animation: "karaoke", size: 0.07 }),
  s("boxed-black", "Boxed black", "White text on solid black boxes, like modern subtitles.", ["boxed", "subtitles", "news"], { uppercase: false, weight: 700, size: 0.06, strokeWidth: 0, shadow: "none", box: "rgba(0,0,0,.85)", maxWords: 6, animation: "fade", font: "Inter", tamilFont: "Noto Sans Tamil" }),
  s("highlight-box", "Highlight box", "The active word gets a bright rounded box behind it.", ["highlight", "trendy", "talking"], { activeBox: "#7c3aed", strokeWidth: 0, shadow: "0 4px 10px rgba(0,0,0,.4)", animation: "highlight" }),
  s("green-highlight", "Green highlight", "Active word on a lime box, black text. Energetic.", ["highlight", "energetic", "gym"], { activeBox: "#a3e635", activeColor: "#111111", strokeWidth: 0, animation: "highlight" }),
  s("neon-glow", "Neon glow", "Glowing cyan/pink words for night and party vibes.", ["neon", "party", "night", "music"], { color: "#e0fbff", activeColor: "#ff3dc8", stroke: "#00e5ff", strokeWidth: 0.02, shadow: "0 0 18px #00e5ff, 0 0 40px #ff3dc8", font: "Righteous", weight: 400, animation: "pop" }),
  s("tamil-mass", "Tamil mass", "Big Tamil-first caption with orange active word. Built for Tamil speech.", ["tamil", "mass", "bold", "reels"], { font: "Anek Tamil", tamilFont: "Anek Tamil", weight: 800, activeColor: "#ff8c1a", uppercase: false, size: 0.09 }),
  s("tamil-clean", "Tamil clean", "Readable Tamil subtitles in boxes.", ["tamil", "clean", "subtitles"], { font: "Noto Sans Tamil", tamilFont: "Noto Sans Tamil", weight: 700, uppercase: false, size: 0.058, strokeWidth: 0, shadow: "none", box: "rgba(0,0,0,.75)", maxWords: 5, animation: "fade" }),
  s("word-by-word-big", "One big word", "A single huge word at a time, centre screen.", ["impact", "hype", "single word"], { maxWords: 1, size: 0.15, position: "center", font: "Anton", weight: 400, strokeWidth: 0.05, animation: "bounce" }),
  s("bounce-color", "Bounce colour", "Words bounce in and cycle through bright colours.", ["fun", "kids", "colorful"], { font: "Luckiest Guy", weight: 400, activeColor: "#4cc9f0", animation: "bounce" }),
  s("typewriter", "Typewriter", "Words type on one after another, monospace.", ["typewriter", "story", "documentary"], { font: "Space Mono", tamilFont: "Noto Sans Tamil", weight: 700, uppercase: false, size: 0.055, strokeWidth: 0, shadow: "0 2px 8px rgba(0,0,0,.9)", maxWords: 7, animation: "typewriter" }),
  s("cinematic-subtitle", "Cinematic subtitle", "Small, elegant, lowercase serif subtitles near the bottom.", ["cinematic", "film", "elegant"], { font: "Cormorant Garamond", tamilFont: "Noto Serif Tamil", weight: 700, uppercase: false, size: 0.05, strokeWidth: 0, shadow: "0 2px 6px rgba(0,0,0,.9)", maxWords: 8, position: "bottom", animation: "fade" }),
  s("podcast-two-line", "Podcast two-line", "Two lines, active word underlined in brand colour.", ["podcast", "interview", "clean"], { font: "Plus Jakarta Sans", weight: 800, uppercase: false, size: 0.06, strokeWidth: 0.04, maxWords: 7, activeColor: "#38bdf8", animation: "karaoke" }),
  s("comic-pop", "Comic pop", "Comic font with a thick outline and a little wobble.", ["comic", "meme", "funny"], { font: "Bangers", weight: 400, size: 0.1, activeColor: "#ff4d6d", strokeWidth: 0.12, animation: "bounce" }),
  s("outline-only", "Outline only", "Hollow outlined words; the active one fills in.", ["outline", "stylish", "fashion"], { color: "transparent", activeColor: "#ffffff", stroke: "#ffffff", strokeWidth: 0.03, shadow: "none", font: "Anton", weight: 400, animation: "pop" }),
  s("retro-pixel", "Retro pixel", "8-bit pixel captions for gaming content.", ["gaming", "pixel", "retro"], { font: "Press Start 2P", weight: 400, size: 0.045, activeColor: "#22c55e", strokeWidth: 0.12, maxWords: 3, animation: "typewriter" }),
  s("elegant-serif", "Elegant serif", "Italic-feel serif for weddings and luxury.", ["wedding", "luxury", "elegant"], { font: "Playfair Display", tamilFont: "Noto Serif Tamil", weight: 700, uppercase: false, size: 0.065, strokeWidth: 0, shadow: "0 3px 14px rgba(0,0,0,.7)", activeColor: "#f5d38a", maxWords: 4, animation: "fade" }),
  s("sticker-tags", "Sticker tags", "Each word on a tilted white sticker. Playful.", ["sticker", "playful", "fun"], { color: "#111111", activeColor: "#111111", strokeWidth: 0, shadow: "0 6px 0 rgba(0,0,0,.35)", box: "#ffffff", activeBox: "#ffd60a", animation: "bounce", font: "Lilita One", weight: 400 }),
  s("slide-up-modern", "Slide up modern", "Lines slide up smoothly, active word bold white over grey.", ["modern", "smooth", "corporate"], { color: "#cfcfcf", activeColor: "#ffffff", font: "Outfit", weight: 800, uppercase: false, size: 0.068, strokeWidth: 0, shadow: "0 4px 16px rgba(0,0,0,.6)", maxWords: 4, animation: "slide" }),
];

export interface CaptionWord {
  w: string;
  s: number;
  e: number;
  emoji?: string;
}

const TAMIL = /[஀-௿]/;
const INDIC = /[ऀ-෿]/;

/** Groups words into caption lines by count and pauses. */
export function groupWords(words: CaptionWord[], maxWords: number): CaptionWord[][] {
  const groups: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= maxWords || w.s - prev.e > 0.6)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/**
 * Builds a transparent HTML overlay. Emoji pops use data-janux-emoji
 * elements, which the renderer turns into animated Noto emoji.
 */
export function buildCaptionHtml(opts: { words: CaptionWord[]; style: CaptionStyle; width: number; height: number; color?: string; activeColor?: string }): {
  html: string;
  fonts: string[];
} {
  const st = { ...opts.style, ...(opts.color ? { color: opts.color } : {}), ...(opts.activeColor ? { activeColor: opts.activeColor } : {}) };
  const hasTamil = opts.words.some((w) => TAMIL.test(w.w));
  const hasIndic = opts.words.some((w) => INDIC.test(w.w));
  const family = hasTamil ? st.tamilFont : st.font;
  const fontSize = Math.round(opts.width * st.size * (hasIndic ? 0.85 : 1));
  const strokePx = Math.max(0, Math.round(fontSize * st.strokeWidth));
  const groups = groupWords(opts.words, st.maxWords);
  const top = st.position === "top" ? "14%" : st.position === "center" ? "50%" : st.position === "bottom" ? "86%" : "70%";
  const data = groups.map((g) => ({ s: g[0].s, e: g[g.length - 1].e, w: g.map((w) => ({ t: st.uppercase && !hasIndic ? w.w.toUpperCase() : w.w, s: w.s, e: w.e, emoji: w.emoji ?? null })) }));
  const html = `<style>
html,body{background:transparent}
#cap{position:absolute;left:6%;right:6%;top:${top};transform:translateY(-50%);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:${Math.round(fontSize * 0.18)}px ${Math.round(fontSize * 0.28)}px;
font-family:'${family}','${st.tamilFont}',sans-serif;font-weight:${st.weight};font-size:${fontSize}px;line-height:1.15;text-align:center}
.w{display:inline-block;color:${st.color};-webkit-text-stroke:${strokePx}px ${st.stroke};paint-order:stroke fill;text-shadow:${st.shadow};padding:${st.box || st.activeBox ? `${Math.round(fontSize * 0.08)}px ${Math.round(fontSize * 0.2)}px` : "0"};border-radius:${Math.round(fontSize * 0.18)}px;${st.box ? `background:${st.box};` : ""}transition:none}
.w.on{color:${st.activeColor};${st.activeBox ? `background:${st.activeBox};` : ""}}
.w.done{color:${st.animation === "karaoke" ? st.activeColor : st.color}}
.w.hide{opacity:0}
.emo{position:absolute;left:50%;bottom:100%;width:${Math.round(fontSize * 1.8)}px;height:${Math.round(fontSize * 1.8)}px;margin-left:-${Math.round(fontSize * 0.9)}px}
</style>
<div id="cap"></div>
<script>
const G=${JSON.stringify(data)};const A="${st.animation}";const box=document.getElementById('cap');let shown=-1;
function ease(x){return 1-Math.pow(1-Math.min(Math.max(x,0),1),3)}
function back(x){x=Math.min(Math.max(x,0),1);const c=1.70158;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)}
window.__januxSeek=function(t){
  let gi=-1;for(let i=0;i<G.length;i++){if(t>=G[i].s-0.05&&t<=G[i].e+0.25){gi=i;break}}
  if(gi!==shown){box.innerHTML='';shown=gi;if(gi<0)return;
    G[gi].w.forEach((w,k)=>{const s=document.createElement('span');s.className='w';s.textContent=w.t;s.style.position='relative';box.appendChild(s);
      if(w.emoji){const e=document.createElement('div');e.className='emo';e.setAttribute('data-janux-emoji',w.emoji);e.setAttribute('data-start',w.s);s.appendChild(e);if(window.__januxEmojiScan)window.__januxEmojiScan()}})}
  if(gi<0)return;const g=G[gi];const spans=box.querySelectorAll('.w');const lt=t-g.s;
  box.style.opacity=A==='fade'?String(ease(lt/0.2)):'1';
  box.style.transform='translateY(-50%)'+(A==='slide'?' translateY('+((1-ease(lt/0.3))*40)+'px)':'');
  spans.forEach((sp,k)=>{const w=g.w[k];const on=t>=w.s&&t<w.e+0.05;const past=t>=w.e;
    sp.classList.toggle('on',on||(A==='karaoke'&&past));sp.classList.toggle('done',past&&!on);
    const local=t-w.s;let sc=1,op=1,y=0,rot=0;
    if(A==='pop'){sc=on?1+0.18*Math.max(0,1-local/0.15):1}
    if(A==='bounce'){if(t<w.s){op=0}else{sc=back(local/0.25);y=0}}
    if(A==='typewriter'){op=t>=w.s?1:0}
    if(A==='highlight'){sc=on?1.06:1}
    if(${st.box ? "true" : "false"}&&A==='bounce'){rot=(k%2?-3:3)}
    sp.style.opacity=String(op);sp.style.transform='translateY('+y+'px) scale('+sc+') rotate('+rot+'deg)';});
};
</script>`;
  return { html, fonts: [family, st.tamilFont] };
}
