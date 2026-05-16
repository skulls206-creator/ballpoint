/**
 * API base URL — resolved in this order:
 *
 *   1. `VITE_API_URL` env var (baked in at build time) — highest priority,
 *      lets you point any deploy at any API server.
 *   2. Hostname auto-detection — if the page is being served from a known
 *      static host (GitHub Pages, ballpoint.khurk.xyz, etc.) that obviously
 *      can't serve `/api`, fall back to the Replit-hosted API.
 *   3. Same-origin `/api` — the default for full-stack deploys (Replit).
 *
 * Whichever URL we pick, the caller-facing string always ends in `/api`.
 */

const REPLIT_API = "https://ballpointone.replit.app";

const STATIC_HOSTS = new Set([
  "skulls206-creator.github.io",
  "ballpoint.khurk.xyz",
]);

function isStaticHost(hostname: string): boolean {
  if (STATIC_HOSTS.has(hostname)) return true;
  // Catch any *.github.io fork
  if (hostname.endsWith(".github.io")) return true;
  return false;
}

export function getApiUrl(): string {
  const override = import.meta.env.VITE_API_URL as string | undefined;
  if (override && override.trim()) {
    return `${override.replace(/\/$/, "")}/api`;
  }

  if (typeof window !== "undefined" && isStaticHost(window.location.hostname)) {
    return `${REPLIT_API}/api`;
  }

  const base = (import.meta.env.BASE_URL as string) || "/";
  return `${base.replace(/\/$/, "")}/api`;
}
