import type { MetadataRoute } from "next";

const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${site}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${site}/sign-up`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${site}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
