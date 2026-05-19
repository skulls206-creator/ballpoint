# CODING-NOTES — ballpoint

## What This Project Is
Ballpoint — beautiful local-first PWA note-taking app with Lighthouse/IPFS encrypted cloud backup.

## Tech Stack
- pnpm monorepo (root package name "workspace")
- React 19 + Vite + Tailwind v4
- TypeScript (strict: false — need to enable)
- @replit/connectors-sdk at root
- Shared libs: db, api-client-react, api-zod, api-spec (all in /lib/)

## Structure
```
/
├── artifacts/
│   └── notesnook/       # Main app (React + Vite + Tailwind)
├── lib/
│   ├── db/              # Database library
│   ├── api-client-react/ # React API client
│   ├── api-zod/          # Zod schemas
│   └── api-spec/         # API spec
└── package.json         # Workspace root
```

## Build & Dev
- **Install:** `pnpm install` (preinstall enforces pnpm)
- **Build:** `pnpm run build` (runs typecheck first)
- **Typecheck:** `pnpm run typecheck`
- **Dev:** `cd artifacts/notesnook && pnpm run dev` (port 5173)
- **Typecheck libs:** `pnpm run typecheck:libs` (tsc --build)

## Deploy
- GitHub Pages via `.github/workflows/deploy-gh-pages.yml`
- Builds and deploys on push to main
- Output in `dist/`

## TypeScript
- **Root: `strict: false`** — ENABLE ME. Set `compilerOptions.strict: true` in root tsconfig and all lib tsconfigs.
- Uses project references (tsc --build)
- If typecheck fails after changes, check lib tsconfigs first

## Tests & Lint
- None configured yet
- Should add: vitest for unit tests, eslint + prettier for formatting

## Known Gotchas
- pnpm is required. npm/yarn will fail via preinstall script.
- The preinstall script deletes package-lock.json/yarn.lock.
- Shared lib changes require rebuilding the lib first (tsc --build).
- GitHub Pages uses 404.html for SPA routing — make sure vite config handles this.

## Previous Bugs / Regressions
*(Fill in as they happen)*
