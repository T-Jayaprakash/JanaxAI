import type { Metadata } from "next";
import Link from "next/link";
import { PricingPlans } from "@/components/marketing/PricingPlans";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";

export const metadata: Metadata = { title: "Pricing — JANUXAI" };

const FAQ = [
  {
    q: "Is it really free right now?",
    a: "Yes. During the Trichy beta every feature that exists is free, with fair-use limits. Paid plans start at launch, and beta users get an early-supporter discount.",
  },
  {
    q: "What does “AI editing usage” mean?",
    a: "It covers the work the AI editor does for you: watching and listening to your footage, cutting, captions, motion graphics and every revision. Bigger plans include more of it each month.",
  },
  {
    q: "What are AI generation credits?",
    a: "Credits for generating new video clips and images from text, for footage you didn't shoot. This is coming soon; until then, edits use your own clips, photos and animated graphics.",
  },
  {
    q: "How will I pay?",
    a: "At launch: UPI and Indian cards in rupees, and international cards in US dollars. Cancel any time; your plan runs until the end of the period you paid for.",
  },
  {
    q: "Can I use film songs?",
    a: "You can upload any song you have the rights to. Film songs added inside the video may get muted on Instagram, so for those we recommend adding the song in Instagram's music picker when you post.",
  },
  {
    q: "What happens to my footage?",
    a: "It's used only to make your videos. To edit, still frames and the transcript of your footage are sent to our AI provider (Anthropic's Claude); your video files themselves stay on JANUXAI's servers. You can delete a project, and its files, at any time.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SiteHeader />
      <main>
        <section className="kolam-bg">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
            <div className="text-center">
              <h1 className="text-balance font-display text-4xl font-medium tracking-tight sm:text-6xl">Simple plans for every creator</h1>
              <p className="text-balance mx-auto mt-4 max-w-xl text-muted">Start free in the beta. Pick a plan when we launch, and change it whenever you like.</p>
              <p className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm text-accent">
                Beta: every feature that exists today is free while we launch in Trichy.
              </p>
            </div>
            <div className="mt-10">
              <PricingPlans />
            </div>
            <p className="mt-6 text-center text-xs text-faint">Prices in US dollars. Rupee pricing with UPI arrives at launch. Features marked “soon” are on the way and not available yet.</p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-3xl font-medium tracking-tight sm:text-4xl">Questions</h2>
          <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-card/60">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-6 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span className="text-accent transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link href="/app" className="rounded-full bg-accent px-6 py-3 font-semibold text-bg transition-colors hover:bg-accent-2">
              Start editing free
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
