/**
 * FFmpeg and the frame renderer poll `shouldCancel()` synchronously while
 * they work, but the cancel flag lives in the database. This keeps a local
 * copy refreshed in the background, so a Stop reaches a running render
 * within about a second without blocking it.
 */
export function watchCancel(check: () => Promise<boolean>, intervalMs = 1000): { shouldCancel: () => boolean; refresh: () => Promise<boolean>; stop: () => void } {
  let cancelled = false;
  let busy = false;
  const refresh = async () => {
    if (busy) return cancelled;
    busy = true;
    try {
      cancelled = cancelled || (await check());
    } catch {
      // A failed check keeps the last known state; the next one retries.
    } finally {
      busy = false;
    }
    return cancelled;
  };
  const timer = setInterval(() => void refresh(), intervalMs);
  timer.unref?.();
  return { shouldCancel: () => cancelled, refresh, stop: () => clearInterval(timer) };
}
