import type { MetadataRoute } from "next";

/** Web app manifest: installable on Android/desktop, and on iOS via "Add to Home Screen" (needed for push on iOS). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NGB LOGISTICS Cargo Tracking",
    short_name: "NGB Cargo",
    description: "Track your cargo from bill of lading to delivery, empty-container return and payment.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1d3557",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
