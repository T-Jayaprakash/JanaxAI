# Asset library

The library holds the professional resources the AI editor uses. It's defined in `src/lib/library/`. Binary files live in `data/library/`, which isn't committed. Set it up with:

```bash
npm run setup:library   # about 35 MB, about 1 minute; safe to re-run
```

The studio's **Library** panel lets you browse it. The agent searches it with `search_library` and pulls items with `get_asset`.

## What's included

| Kind | Count | Source | Licence | Credit needed? |
| --- | --- | --- | --- | --- |
| Fonts | 82 families (159 files) | Google Fonts: Tamil (Anek Tamil, Catamaran, Mukta Malar, Baloo Thambi 2, Noto Sans/Serif Tamil, …), other Indian scripts, display, sans, serif, script, mono | SIL Open Font License 1.1 | No |
| Animated emoji | 59 | Noto Emoji animations by Google (Lottie) | CC BY 4.0 | **Yes**: "Animated emoji: Noto Emoji by Google, CC BY 4.0" |
| Lottie player | n/a | lottie-web (npm) | MIT | No |
| Transitions (blend) | 58 | FFmpeg `xfade` | FFmpeg (LGPL) | No |
| Transitions (overlay) | 14 | Original to JANUXAI (light leak, film burn, flash, dip, glitch, circle/diamond/star/heart wipe, brush wipe, slats, grid, whip streaks, spotlight iris) | Included with the app | No |
| Caption styles | 20 | Original to JANUXAI | Included with the app | No |
| Stickers | 19 | Original HTML/CSS components (price tag, sale burst, subscribe, lower third, arrows, scribbles, confetti, stars, countdown, checklist, …) | Included with the app | No |
| Sound effects | 30 | Synthesised by FFmpeg (whoosh, pop, riser, impact, meme-boom, record-scratch, ka-ching, level-up, …) | Included with the app | No |
| Colour looks | 10 | Generated 3D LUTs (teal-orange, Tamil cinema warm, golden hour, vintage fade, …) | Included with the app | No |
| Meme formats | 12 | Editing recipes (zoom punch, freeze "wait for it", to be continued, POV, …) | Included with the app | No |

## Licence tracking

- Every catalog entry carries its licence (`src/lib/library/types.ts`).
- Renders record the library assets they used in the conversation workspace (`cache/used-assets.json`).
- When a video is delivered, `deliver` adds the credit lines that licences require. The chat shows them under the video ("Credits to include when posting").
- Only assets whose licences allow commercial use are included.

## Memes and copyright

JANUXAI ships meme **formats**, not meme clips. Film and TV clips, including popular Tamil meme templates, are copyrighted, so the library never bundles or downloads them. If a user wants a particular clip, they upload it themselves and are responsible for having the rights.

## Adding assets

1. Add an entry to the relevant module (`fonts.ts`, `emoji.ts`, `stickers.ts`, `transitions.ts`, `captions.ts`, `looks.ts`, `memes.ts`) with an honest licence.
2. If it needs a file, extend `scripts/setup-library.ts` to download or generate it into `data/library/`.
3. Run `npm test`. The library tests check counts, unique ids and commercial-use licences.

Before adding a third-party pack, read its licence. "Free to use" packs often forbid redistributing the files inside an app (Pixabay, Mixkit and Envato Elements, for example). Prefer CC0, CC BY, OFL, MIT, or a paid licence that explicitly covers SaaS and app use.
