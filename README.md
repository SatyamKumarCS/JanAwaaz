# Jan Awaaz

Mobile-first civic complaint app for five Uttar Pradesh districts. **Independent project — not a government service.**
Complaints are not registered in IGRS, and resolution is not guaranteed.

> Scaffold stage (I-01). Feature slices land in later issues.

## Layout

| Path | What |
| --- | --- |
| `apps/mobile` | Expo SDK 58 (React Native 0.88, TypeScript, NativeWind 4.2.7) citizen app |
| `apps/dashboard` | Next.js 16 staff dashboard (+ public tracking page later) |
| `services/api` | Express 5 + TypeScript API (Prisma 7.10.1 from I-02) |
| `services/ai` | FastAPI (Python 3.13, uv) — outside the pnpm workspace |
| `packages/shared` | zod enums + inferred types; exports the committed `enums.json` |
| `packages/routing` | pure `route()` (I-23) |

## Prerequisites

- Node **24.22.0** (`nvm use`), pnpm via Corepack (`corepack enable`)
- Python 3.13 + [uv](https://docs.astral.sh/uv/)
- Xcode (iOS Simulator) for the mobile dev build; Android builds are manual EAS cloud builds
- `gitleaks` for the pre-push secret scan

## Run locally

```bash
pnpm install
uv sync --directory services/ai

pnpm --filter @janawaaz/api dev                 # API on http://127.0.0.1:4000/health
uv run --directory services/ai uvicorn app.main:app --port 8000   # AI on :8000/health
pnpm --filter @janawaaz/dashboard dev           # dashboard on http://localhost:3000
pnpm --filter @janawaaz/mobile ios              # iOS Simulator dev build
```

## Checks

```bash
pnpm check:pins && pnpm check:images && pnpm lint && pnpm typecheck && pnpm test && pnpm secrets:scan
```

## Zero-secrets rules

- **Never commit secrets.** Only `*.example` files with placeholders are tracked; `.env` and `.env.*` are ignored.
- Neon URLs live only in the git-ignored `.env.neon`, loaded solely by explicit `db:neon:*` scripts.
- A Lefthook pre-push hook runs Gitleaks; CI scans the full history.
- **If a secret ever leaks, revoke or rotate it immediately.** Rewriting history alone is not enough.
- Real citizen data, real photos and model files never go in this repository.
