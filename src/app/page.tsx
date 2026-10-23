import { AudioLines, Captions, Clapperboard, Languages, MessageSquareText, Music4, Scissors, Sparkles, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroPrompt } from "@/components/marketing/HeroPrompt";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { StudioDemo } from "@/components/marketing/StudioDemo";
import { PLANS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "JANUXAI — The AI video editor you talk to, in Tamil or English",
};

const FEATURES = [
  { icon: Scissors, title: "Cuts the boring parts", body: "Pauses, “um”s, false starts and repeated takes are found from your words and cut cleanly. Your best take stays." },
  { icon: Captions, title: "Captions that hit", body: "Word-by-word animated captions in Tamil script, Tanglish or English, with emojis on the words that matter." },
  { icon: Music4, title: "Cut to the beat", body: "Bring your song. JANUXAI finds the beat, lands the cuts on it, and lowers the music whenever you speak." },
  { icon: Sparkles, title: "Motion graphics from a sentence", body: "Animated intros, titles, lower thirds and end cards with your name, colours and contact, built for each video." },
  { icon: Clapperboard, title: "Any format", body: "Vertical reels and shorts, square posts, YouTube landscape. Reframed so the subject stays in the shot." },
  { icon: MessageSquareText, title: "Change it by chatting", body: "“Make it shorter.” “Captions in yellow.” “Drop the second clip.” Every revision is a new version you can go back to." },
];

const STEPS = [
  { n: "01", title: "Drop your footage", body: "Raw clips from your phone, a song if you want one, and a reference if you have a style in mind." },
  { n: "02", title: "Say what you want", body: "Type it, or send a voice note in Tamil, Tanglish, English, Malayalam, Telugu or Hindi." },
  { n: "03", title: "Watch it edit", body: "See each step as it happens: watching, listening, cutting, animating, checking. Then preview and download." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="kolam-bg relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-bg-2/80 px-3 py-1 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Now in beta in Trichy · free while we launch
            </p>
            <h1 className="text-balance mx-auto mt-6 max-w-4xl font-display text-[44px] font-medium leading-[1.02] tracking-tight sm:text-7xl">
              Just tell it.
              <br />
              <span className="italic text-muted">It&apos;ll make the video.</span>
            </h1>
            <p className="text-balance mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
              The AI video editor you talk to. Drop your raw footage, say what you want in your own language, and get a finished reel with captions, music and motion graphics.
            </p>
            <div className="mt-9">
              <HeroPrompt />
            </div>
          </div>
        </section>

        {/* Demo */}
        <section className="border-y border-line/60 bg-bg-2/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mb-10 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">The studio</p>
              <h2 className="text-balance mt-3 font-display text-3xl font-medium tracking-tight sm:text-5xl">An editor that watches, listens and cuts.</h2>
              <p className="text-balance mx-auto mt-4 max-w-2xl text-muted">
                JANUXAI looks at your footage, hears every word, finds the beat of your song, and edits the way a good editor would. It checks its own work before you see it.
              </p>
            </div>
            <StudioDemo />
          </div>
        </section>

        {/* Language */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Your language</p>
              <h2 className="text-balance mt-3 font-display text-3xl font-medium tracking-tight sm:text-5xl">Say it the way you say it.</h2>
              <p className="mt-4 text-muted">
                No editing words to learn. Talk in Tamil, mix in English, or send a voice note while you&apos;re still at the shop. JANUXAI understands, and replies in your language.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-sm">
                {["தமிழ்", "Tanglish", "English", "മലയാളം", "తెలుగు", "हिन्दी"].map((l) => (
                  <span key={l} className="rounded-full border border-line px-3 py-1 text-muted">
                    {l}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {[
                { lang: "Tamil", text: "இந்த வீடியோவை 15 வினாடியா குறைச்சு, கடைசியில என் WhatsApp நம்பர் போடு" },
                { lang: "Tanglish", text: "Second clip venam, music konjam kammi pannu, captions yellow-la podu" },
                { lang: "English", text: "Make the first 3 seconds punchier and add a zoom on the price" },
              ].map((v) => (
                <div key={v.lang} className="animate-float rounded-2xl border border-line bg-card p-4" style={{ animationDelay: `${v.lang.length * 0.3}s` }}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                    <AudioLines size={13} className="text-accent" /> Voice note · {v.lang}
                  </p>
                  <p className="text-[15px] leading-relaxed">“{v.text}”</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-line/60 bg-bg-2/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-balance text-center font-display text-3xl font-medium tracking-tight sm:text-5xl">From raw clip to reel in three steps</h2>
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-3xl border border-line bg-card p-6">
                  <span className="font-display text-4xl italic text-accent">{s.n}</span>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">What it does</p>
            <h2 className="text-balance mt-3 font-display text-3xl font-medium tracking-tight sm:text-5xl">Everything a reel needs. None of the timeline.</h2>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-bg p-6 transition-colors hover:bg-card">
                <f.icon size={22} className="text-accent" />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-line bg-card p-6">
              <Wand2 size={20} className="text-accent" />
              <h3 className="mt-3 font-semibold">For creators</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Shoot once, talk freely. JANUXAI keeps your best takes, adds captions that keep people watching, and cuts to your song.
              </p>
            </div>
            <div className="rounded-3xl border border-line bg-card p-6">
              <Languages size={20} className="text-accent" />
              <h3 className="mt-3 font-semibold">For businesses</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Film your shop, your product, your offer. Get a ready-to-post ad with your name, colours and WhatsApp number, without an agency.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="border-t border-line/60 bg-bg-2/40">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="text-balance font-display text-3xl font-medium tracking-tight sm:text-5xl">Less than one agency video a month.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">
              Plans from ${PLANS[0].annual}/month at launch. During the Trichy beta, everything is free.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/app" className="rounded-full bg-accent px-6 py-3 font-semibold text-bg transition-colors hover:bg-accent-2">
                Start editing free
              </Link>
              <Link href="/pricing" className="rounded-full border border-line-strong px-6 py-3 font-medium text-ink hover:border-accent/50">
                See pricing
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
