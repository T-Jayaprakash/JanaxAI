import type { MetadataRoute } from "next";

/** Lets phones install JANUXAI to the home screen as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "JANUXAI — AI video editor",
    short_name: "JANUXAI",
    description: "Tell it what you want in Tamil, Tanglish or English, and get a finished video.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["photo", "productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "New video", url: "/app", icons: [{ src: "/icon-192.png", sizes: "192x192" }] }],
  };
}
