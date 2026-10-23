/** Compiles the Apple Vision subject tracker used by reframe_subject (macOS only). */
import { ensureTracker, trackingSupported } from "../src/lib/studio/track";

if (!trackingSupported()) {
  console.log("Subject tracking needs macOS with the Swift compiler (xcode-select --install). Skipping.");
  process.exit(0);
}
ensureTracker()
  .then((bin) => console.log(`Tracker ready: ${bin}`))
  .catch((err) => {
    console.error("Couldn't build the tracker:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
