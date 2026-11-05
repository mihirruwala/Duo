import type { MetadataRoute } from "next";

const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

/** Only the public pages are for search engines; rooms, invites and accounts never are. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/privacy", "/sign-up"],
      disallow: ["/home", "/r/", "/settings", "/join", "/api/", "/auth/", "/sign-in", "/forgot-password", "/reset-password"],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
