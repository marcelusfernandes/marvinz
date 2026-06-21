// Canonical site origin used for metadataBase, OG/Twitter image URLs, canonical
// links, robots and the sitemap. Set NEXT_PUBLIC_SITE_URL to the production
// domain; on Vercel it falls back to the deployment URL, else localhost in dev.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
