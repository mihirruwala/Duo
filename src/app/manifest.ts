import type { MetadataRoute } from "next";

/**
 * Makes DUO installable ("Add to Home Screen") and is the basis of the Android app, which opens
 * duoforyou.cv full screen (a Trusted Web Activity). It opens on your rooms; signed-out people are
 * sent to sign in first.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "DUO",
    short_name: "DUO",
    description: "A private space for two: video calls, chat, watching together and screen sharing.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1a1420",
    theme_color: "#1a1420",
    categories: ["social", "communication"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
