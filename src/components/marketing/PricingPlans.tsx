"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PLANS } from "@/lib/plans";

export function PricingPlans() {
  const [annual, setAnnual] = useState(true);
  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-bg-2 p-1 text-sm">
          {[
            { v: false, label: "Monthly" },
            { v: true, label: "Annual · save 20%" },
          ].map((o) => (
            <button
              key={o.label}
              role="radio"
              aria-checked={annual === o.v}
              onClick={() => setAnnual(o.v)}
              className={`rounded-full px-4 py-1.5 transition-colors ${annual === o.v ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`relative flex flex-col rounded-3xl border p-6 ${p.highlight ? "border-accent/60 bg-card shadow-[0_20px_60px_-25px_rgba(255,255,255,0.18)]" : "border-line bg-card/60"}`}
          >
            {p.highlight && (
              <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-bg">Most popular</span>
            )}
            <h3 className="font-display text-2xl font-medium">{p.name}</h3>
            <p className="mt-1 text-sm text-muted">{p.tagline}</p>
            <p className="mt-6 flex items-baseline gap-1">
              <span className="font-display text-5xl font-medium">${annual ? p.annual : p.monthly}</span>
              <span className="text-sm text-muted">/month</span>
            </p>
            <p className="mt-1 h-4 text-xs text-faint">{annual ? `Billed yearly · $${p.annual * 12}/year` : "Billed monthly"}</p>
            <Link
              href="/app"
              className={`mt-6 rounded-full px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                p.highlight ? "bg-accent text-bg hover:bg-accent-2" : "border border-line-strong text-ink hover:border-accent/50"
              }`}
            >
              Start free in beta
            </Link>
            <ul className="mt-6 space-y-2.5 text-sm">
              {p.features.map((f) => (
                <li key={f.text} className="flex gap-2">
                  <Check size={16} className={`mt-0.5 shrink-0 ${f.soon ? "text-faint" : "text-accent"}`} />
                  <span className={f.soon ? "text-muted" : "text-ink"}>
                    {f.text}
                    {f.soon && <span className="ml-1.5 rounded bg-line px-1.5 py-px align-middle text-[10px] uppercase tracking-wide text-muted">soon</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
