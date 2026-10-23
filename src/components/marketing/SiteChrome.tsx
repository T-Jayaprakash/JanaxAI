import Link from "next/link";
import { Wordmark } from "../Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="JANUXAI home">
          <Wordmark />
        </Link>
        <nav className="ml-4 hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Main">
          <Link href="/#how" className="hover:text-ink">How it works</Link>
          <Link href="/#features" className="hover:text-ink">Features</Link>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/pricing" className="rounded-full px-3 py-2 text-sm text-muted hover:text-ink md:hidden">
            Pricing
          </Link>
          <Link href="/app" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-2">
            Open studio
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:px-6">
        <div>
          <Wordmark />
          <p className="mt-2 max-w-xs text-xs text-faint">Just tell it. It&apos;ll make the video. Made in Trichy, Tamil Nadu.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 sm:ml-auto" aria-label="Footer">
          <Link href="/app" className="hover:text-ink">Studio</Link>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/#features" className="hover:text-ink">Features</Link>
        </nav>
      </div>
    </footer>
  );
}
