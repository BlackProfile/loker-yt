// robots.txt: izinkan crawling halaman publik, blokir API, arahkan ke sitemap.
import type { MetadataRoute } from "next";

function getBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
