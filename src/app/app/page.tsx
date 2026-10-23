import type { Metadata } from "next";
import { JanuxApp } from "@/components/JanuxApp";

export const metadata: Metadata = { title: "Studio — JANUXAI" };

export default function StudioPage() {
  return <JanuxApp />;
}
