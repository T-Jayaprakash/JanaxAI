/**
 * Carries a prompt and dropped files from the landing page into the studio.
 * Client-side navigation keeps the page's memory, so File objects survive.
 */
type Handoff = { prompt: string; files: File[] };

let pending: Handoff | null = null;

export function setHandoff(h: Handoff) {
  pending = h;
}

export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  return h;
}
