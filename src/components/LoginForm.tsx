"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/client/auth";
import { LogoMark } from "./Logo";

/** Only same-site paths are allowed as the post-sign-in destination. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
}

export function LoginForm({ google }: { google: boolean }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't send the code. Check the email and try again.");
    setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
    if (error) {
      setBusy(false);
      return setError(error.message ?? "That code didn't work. Check it, or send a new one.");
    }
    router.replace(next);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">{step === "email" ? "Sign in to JANUXAI" : "Check your email"}</h1>
          <p className="mt-1.5 text-sm text-muted">{step === "email" ? "We'll email you a 6-digit code. No password needed." : `We sent a code to ${email}.`}</p>
        </div>

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-3">
            <label className="block">
              <span className="sr-only">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-line bg-bg-2 px-4 py-3 text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
              />
            </label>
            <button type="submit" disabled={busy || !email} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 font-semibold text-bg disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} Email me a code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <label className="block">
              <span className="sr-only">6-digit code</span>
              <input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-xl border border-line bg-bg-2 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 font-semibold text-bg disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} Sign in
            </button>
            <button type="button" onClick={() => (setStep("email"), setCode(""), setError(null))} className="w-full py-2 text-sm text-muted hover:text-ink">
              Use a different email
            </button>
          </form>
        )}

        {google && step === "email" && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
              className="w-full rounded-xl border border-line-strong px-4 py-3 font-medium text-ink hover:bg-bg-2"
            >
              Continue with Google
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-8 text-center text-xs text-faint">By signing in you agree to use JANUXAI only with footage and music you have the rights to.</p>
      </div>
    </main>
  );
}
