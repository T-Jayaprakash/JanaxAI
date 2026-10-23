"use client";

import { Download, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "janux-install-dismissed";

function dismissedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < 14 * 86400_000;
  } catch {
    return false;
  }
}

/**
 * Registers the service worker and offers "Install app" in the studio:
 * Chrome/Android get the native prompt, iPhone gets the Add to Home Screen hint.
 */
export function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || dismissedRecently()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    const t = ios ? window.setTimeout(() => setIosHint(true), 4000) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) window.clearTimeout(t);
    };
  }, []);

  if (!pathname?.startsWith("/app") || (!deferred && !iosHint)) return null;

  const close = (remember: boolean) => {
    setDeferred(null);
    setIosHint(false);
    if (remember) {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {}
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install JANUXAI"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line-strong bg-bg-2/95 p-3 shadow-2xl backdrop-blur sm:bottom-5"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">Install JANUXAI</p>
        {deferred ? (
          <p className="text-muted">Edit from your home screen, like an app.</p>
        ) : (
          <p className="text-muted">
            Tap <Share size={13} className="-mt-0.5 inline" aria-label="Share" /> then <span className="text-ink">Add to Home Screen</span>.
          </p>
        )}
      </div>
      {deferred && (
        <button
          type="button"
          onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice.catch(() => undefined);
            close(false);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-sm font-semibold text-bg"
        >
          <Download size={14} /> Install
        </button>
      )}
      <button type="button" aria-label="Not now" onClick={() => close(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink">
        <X size={16} />
      </button>
    </div>
  );
}
