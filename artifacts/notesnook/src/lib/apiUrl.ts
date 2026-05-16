/**
 * API base URL — configurable via VITE_API_URL env var.
 *
 * When running as a full-stack app (Replit), the API is served from
 * the same origin as the frontend via a relative /api path.
 *
 * When the frontend is deployed separately (GitHub Pages, etc.),
 * set VITE_API_URL to point at the running API server, e.g.:
 *   VITE_API_URL=https://ballpointone.replit.app
 *
 * The env var is baked in at build time. For local dev, create a
 * .env file or set it in your shell.
 */

export function getApiUrl(): string {
  const override = import.meta.env.VITE_API_URL as string | undefined;
  const root = override ?? (import.meta.env.BASE_URL as string);
  return `${root.replace(/\/$/, '')}/api`;
}
