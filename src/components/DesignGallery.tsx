"use client";

import { Download, Expand, Images } from "lucide-react";
import { formatBytes, type PublicAsset } from "@/lib/client/api";

const KIND_LABEL: Record<string, string> = {
  poster: "Poster",
  carousel: "Carousel",
  thumbnail: "Thumbnail",
  story: "Story",
  flyer: "Flyer",
  banner: "Banner",
};

/** Rendered posters / carousel slides with per-image download. */
export function DesignGallery({
  design,
  assets,
}: {
  design: { title: string; kind: string; format: string; assetIds: string[] };
  assets: Record<string, PublicAsset>;
}) {
  const slides = design.assetIds.map((id) => assets[id]).filter(Boolean);
  if (!slides.length) return null;
  const multi = slides.length > 1;
  const [w, h] = design.format.split(":").map(Number);
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-line bg-card animate-rise" aria-label={design.title}>
      <header className="flex items-center gap-2 px-4 py-3">
        <Images size={15} className="text-accent" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{design.title}</h3>
        <span className="shrink-0 text-xs text-muted">
          {KIND_LABEL[design.kind] ?? design.kind} · {design.format}
          {multi ? ` · ${slides.length} slides` : ""}
        </span>
      </header>
      <div className={multi ? "flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4" : "px-4 pb-4"}>
        {slides.map((a, i) => (
          <figure key={a.id} className={multi ? "w-[72%] max-w-[300px] shrink-0 snap-start" : "mx-auto max-w-[420px]"}>
            <div className="overflow-hidden rounded-xl border border-line bg-black" style={{ aspectRatio: `${w} / ${h}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={`${design.title}${multi ? ` slide ${i + 1}` : ""}`} className="h-full w-full object-contain" loading="lazy" />
            </div>
            <figcaption className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="mr-auto">
                {multi ? `Slide ${i + 1}` : `${a.width}×${a.height}`} · {formatBytes(a.size)}
              </span>
              <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label="Open full size" className="rounded-md p-1 hover:text-ink">
                <Expand size={14} />
              </a>
              <a
                href={`${a.url}?download=1`}
                download
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-medium text-bg hover:bg-accent-2"
              >
                <Download size={12} /> PNG
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
