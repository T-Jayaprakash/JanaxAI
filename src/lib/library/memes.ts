/**
 * Meme FORMATS: editing patterns built from JANUXAI's own effects and the
 * user's footage. No copyrighted meme clips are bundled; if the user wants a
 * specific film clip, they must upload it themselves.
 */
export interface MemeFormat {
  id: string;
  name: string;
  tags: string[];
  description: string;
  recipe: string;
}

export const MEME_FORMATS: MemeFormat[] = [
  {
    id: "zoom-punch-boom",
    name: "Zoom punch + boom",
    tags: ["reaction", "shock", "dramatic", "funny"],
    description: "Sudden zoom into a face with a deep boom: the classic dramatic reaction.",
    recipe:
      "At the reaction moment: run_ffmpeg crop/scale zoom to ~1.6x on the face for 0.8-1.5s (scale=iw*1.6:-2,crop=W:H:x:y), optional shake (crop x offset varying with sin(t*40)), and slight desaturate; generate_sound_effect meme-boom at that time; optional emoji 'skull' or 'mind-blown' sticker.",
  },
  {
    id: "freeze-wait-for-it",
    name: "Freeze + 'Wait for it…'",
    tags: ["suspense", "setup", "payoff"],
    description: "Freeze a frame before the payoff with 'Wait for it…' and a drumroll.",
    recipe:
      "Freeze the frame before the payoff for 1.5-2s (trim + tpad=stop_mode=clone:stop_duration=2), overlay sticker 'wait-for-it' via render_animation, generate_sound_effect drumroll under the freeze, then a drum-hit as the action resumes.",
  },
  {
    id: "to-be-continued",
    name: "To be continued",
    tags: ["ending", "cliffhanger", "funny"],
    description: "Freeze on the funniest frame, sepia tint, retro arrow and a record scratch.",
    recipe:
      "Freeze the last frame for 2-3s with colorchannelmixer sepia or lut3d=lib/looks/vintage-fade.cube, overlay sticker 'to-be-continued' (text 'To be continued'), generate_sound_effect record-scratch at the freeze.",
  },
  {
    id: "record-scratch-intro",
    name: "Record scratch: 'Yep, that's me'",
    tags: ["intro", "storytime", "funny"],
    description: "Freeze on an awkward moment with a record scratch and a caption.",
    recipe: "Freeze frame + record-scratch SFX + caption 'Yep, that's me. You're probably wondering how I got here.' (or a Tamil/Tanglish version), then rewind or cut to the start of the story.",
  },
  {
    id: "pov-caption",
    name: "POV: caption",
    tags: ["pov", "relatable", "text"],
    description: "Big 'POV:' line on top describing the situation.",
    recipe: "render_animation a top caption 'POV: <situation>' in Anton or Archivo Black, white with black stroke, at the top 12%, visible the whole clip; keep the clip's audio or a trending song the user uploads.",
  },
  {
    id: "top-bottom-text",
    name: "Top/bottom text",
    tags: ["classic", "image macro", "funny"],
    description: "Classic meme text above and below the clip.",
    recipe: "Letterbox the video in black (pad) and render_animation white Anton text: setup line on top, punchline at the bottom appearing a beat later with a pop SFX.",
  },
  {
    id: "expectation-reality",
    name: "Expectation vs reality",
    tags: ["comparison", "split", "funny"],
    description: "Two clips side by side or one after the other with labels.",
    recipe: "Stack two clips (vstack for 9:16, hstack for 16:9) or play them in sequence; label each with render_animation ('Expectation' / 'Reality'); add a record-scratch or meme-boom on 'Reality'.",
  },
  {
    id: "slow-mo-dramatic",
    name: "Slow-mo dramatic",
    tags: ["dramatic", "slow motion", "epic"],
    description: "Over-the-top slow motion with a riser for an ordinary moment.",
    recipe: "setpts=2*PTS (or 3x) on the moment, minterpolate if choppy, lut3d moody-green or bw-contrast, riser SFX building into a boom; caption with dramatic serif text.",
  },
  {
    id: "speed-chaos",
    name: "Speed-up chaos",
    tags: ["fast", "funny", "cleaning", "routine"],
    description: "Speed a long routine to 4-8x with a ticking clock.",
    recipe: "setpts=PTS/6 (drop audio or atempo chain), tick-tock SFX, a progress-bar sticker, and a 'Speedrun' style caption.",
  },
  {
    id: "glitch-stutter",
    name: "Glitch stutter",
    tags: ["glitch", "repeat", "beat"],
    description: "Repeat a word or move 3 times in a stutter with glitch flashes.",
    recipe: "Cut the same 0.2-0.3s segment three times in a row (concat), add render_transition 'glitch' on each repeat and glitch SFX; caption the repeated word growing each time.",
  },
  {
    id: "before-after",
    name: "Before / after reveal",
    tags: ["transformation", "makeover", "product"],
    description: "Before clip, a wipe on the beat, then the after clip.",
    recipe: "Before clip, then a hard cut covered by render_transition (circle-wipe or flash-white) on a beat from analyze_audio, then the after clip; 'Before'/'After' labels and a sparkle SFX on the reveal.",
  },
  {
    id: "reaction-split",
    name: "Reaction split screen",
    tags: ["reaction", "split", "commentary"],
    description: "The main clip on top, the creator's reaction below.",
    recipe: "vstack: main clip scaled to 1080x960 on top, reaction clip 1080x960 below (crop to faces); keep the reaction audio louder; add emoji pops on big reactions.",
  },
];
