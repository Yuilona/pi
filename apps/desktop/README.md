# pi — desktop agent

An Electron desktop app for the **pi** coding agent: a calm, warm "literary-salon" UI (parchment /
terracotta / serif, per `DESIGN.md`) over the pi SDK. The pi SDK runs only in the Electron **main** process;
the React **renderer is pi-free** and talks to main over a typed IPC bridge (`src/shared/ipc.ts`).

## Prerequisites

- **Node ≥ 22.19** and **pnpm** (Electron is pinned to 41, which needs Node ≥ 22.19).
- **Build the monorepo packages once** so the `@earendil-works/pi-*` workspace deps have a `dist/` to consume:
  from the repo root, build `packages/ai`, `packages/agent`, `packages/coding-agent`, `packages/tui`.
- China networks: `apps/desktop/.npmrc` already points npm + the Electron / electron-builder binary downloads
  at npmmirror, so `pnpm install` and packaging work without GitHub access.

```bash
cd apps/desktop
pnpm install
```

## Develop & verify

```bash
pnpm dev          # HMR dev run (electron-vite)
pnpm typecheck    # tsc for the node + web tsconfigs
pnpm lint         # Biome
pnpm test         # vitest unit tests (pure helpers + reducers)
pnpm build        # electron-vite build → out/
```

Keep `typecheck` / `lint` / `test` / `build` green before reporting done.

## Package a Windows app

```bash
pnpm package      # electron-vite build + electron-builder --win
```

Outputs to `apps/desktop/release/`:

- `pi Setup <version>.exe` — NSIS installer (per-user, lets you pick the install dir, creates desktop +
  Start-menu shortcuts).
- `win-unpacked/pi.exe` — the unpacked app (double-click to run without installing).

Config lives in `electron-builder.yml`. The brand icon is `build/icon.ico`; regenerate it with
`npx electron make-icon.mjs` (renders the terracotta serif-π tile to a multi-size `.ico`). Builds are
unsigned (no code-signing certificate), so Windows SmartScreen may warn on first run — that's expected for a
local/unsigned build.

## API keys & config (pi-citizen)

The app uses pi's **own** configuration — it never hardcodes a provider:

- Credentials: `~/.pi/agent/auth.json`; custom OpenAI-compatible endpoints: `~/.pi/agent/models.json`.
  Add or edit these in the in-app **Settings** panel (gear icon), or reuse an existing pi CLI setup.
- Chat history persists as JSONL under `~/.pi/agent/sessions/`, **shared with the pi CLI**.
- Default provider / model / thinking level resolve from `~/.pi/agent/settings.json` (+ project
  `.pi/settings.json`).

None of these live in the repo — re-enter keys via Settings on a new machine.

## Architecture (one screen)

- **Main** (`src/main/`): `agent/sessionPool.ts` (owns the live-session pool) + `agent/sessionController.ts`
  (one pi `AgentSession` each), `agent/bridge.ts` (ipcMain wiring), `agent/mappers.ts` (pi events → IPC
  DTOs), `auth.ts`, `approval.ts`, `proxy.ts`, `index.ts` (frameless window).
- **Preload** (`src/preload/index.ts`): exposes `window.pi` via `contextBridge` (built as `.cjs`).
- **Renderer** (`src/renderer/src/`): components, `state/` (per-session slices via `useSessions`), `styles/`.
- **Shared** (`src/shared/ipc.ts`): the pi-free IPC contract. Never import `@earendil-works/pi-*` from the
  renderer.

See `.trellis/tasks/06-15-desktop-app/` for the full plan and milestone log.
