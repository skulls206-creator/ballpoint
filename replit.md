# Workspace — Ballpoint.one

## App Overview

**Ballpoint.one** is a beautiful, local-first PWA note-taking app (Notesnook/Notion-inspired).

### Key Features
- Email/password accounts (JWT auth, no email confirmation)
- Each account has its own isolated vault (folder) stored separately in IndexedDB
- Notes are plain `.md` / `.txt` files read/written directly to the user's local filesystem via File System Access API
- Markdown editor with live split preview (marked + DOMPurify)
- **Right-click context menus** on notes: Open, Rename, Favorite, Duplicate, Archive, Trash, Restore, Delete Forever
- Command palette (Ctrl+K), keyboard shortcuts (Ctrl+N new note, Ctrl+S save)
- 6 accent color themes (Violet, Blue, Teal, Green, Rose, Orange) × dark/light mode
- **Dynamic PWA toolbar color**: `<meta name="theme-color">` updates per accent × dark/light via `applyTheme()` in store.ts
- **PWA install prompt**: `usePWAInstall` hook captures `beforeinstallprompt`; Install button shown in Sidebar
- Manifest includes `display_override: window-controls-overlay`, `shortcuts` (New Note), `launch_handler`
- Offline-capable service worker (stale-while-revalidate), SW update detection via `sw-update-available` event
- Favorites/pinning, Trash/Archive, Tags, Reminders (60s scheduler + SW notifications)
- **Lighthouse IPFS Cloud Backup**: opt-in encrypted backup to Lighthouse IPFS/Filecoin
  - Kavach encryption: BLS master key + key shards stored on Kavach nodes (access-controlled by ETH wallet)
  - Browser uses `@lighthouse-web3/sdk` directly for upload/decrypt; server only signs Kavach auth challenge
  - ETH private key (`ETH_PRIVATE_KEY` env) never leaves the server; Lighthouse API key returned to browser
  - `GET /api/sync/wallet` → wallet address + actual Lighthouse API key (browser uses SDK directly)
  - `POST /api/sync/sign` → signs Kavach challenge message with server ETH key
  - Per-note `remoteStatus`: `neverSynced` | `pendingUpload` | `synced` — shown as cloud badge in note list
  - Storage & Sync settings panel (cloud icon in sidebar) — wallet address, backup now, last backup, version history with per-entry Restore button
- **KHURK OS proxy vault mode**: `khurk:vault-open` postMessage receives file contents; writes back via `ballpoint:*` postMessages

### Auth
- `POST /api/auth/register` — email + password (min 6 chars), returns JWT
- `POST /api/auth/login` — returns JWT
- `GET /api/auth/me` — returns current user (requires Bearer token)
- JWT stored in localStorage; per-user vault key in IndexedDB



## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
