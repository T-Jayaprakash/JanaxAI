import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { JanuxApp } from "@/components/JanuxApp";
import { getAccess } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Studio — JANUXAI" };

/** Signed-out visitors go to the sign-in page (accounts on), then come back here. */
async function SignedInStudio() {
  const access = await getAccess(await headers());
  if (!access) redirect("/login?next=/app");
  return <JanuxApp />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <SignedInStudio />
    </Suspense>
  );
}
