# Fix Summary — 2026-05-19

## Issue 1 (HIGH) — AuthContext stub → real implementation
**File:** `artifacts/notesnook/src/lib/authContext.tsx`

**Before:** A complete stub — all values hardcoded to `null`/`false`/no-ops, no actual API calls. The `useAuth()` hook was also detached from the provider context.

**After:** Full auth context with:
- `useState`/`useEffect`/`useCallback` state management
- `VITE_API_URL`-based API configuration
- Token persistence in `localStorage` (`ballpoint_token`)
- Token validation on mount via `GET /api/auth/me`
- `login()` and `register()` functions hitting the API
- `logout()` clearing token and user state
- Proper `useAuth()` hook that reads from context and throws if used outside provider

## Issue 2 (MEDIUM) — PBKDF2 iteration count too low
**File:** `artifacts/notesnook/src/lib/crypto.ts`

**Before:** `iterations: 200_000` (below OWASP 2023 minimum recommendation)
**After:** `iterations: 600_000` (OWASP 2023 recommended minimum for PBKDF2-HMAC-SHA256)

## Issue 3 — .gitignore additions
**File:** `.gitignore` (repo root)

Added entries:
- `.env`, `.env.local` — environment/secret files
- `dev-dist/` — development build output
- `.generated/` — generated code artifacts
- `*.log` — log files

(Note: `node_modules/`, `dist/`, and `.DS_Store` were already present.)

## Issue 4 — CSP headers
**File:** `artifacts/api-server/src/app.ts`

**Status:** Already implemented. `helmet` is imported and `app.use(helmet(...))` is configured with `crossOriginResourcePolicy` set and explicit `contentSecurityPolicy: false` (intentional — CSP is handled at the reverse proxy/CDN layer for the notesnook app). No changes needed.
