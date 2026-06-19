# CLAUDE.md — project memory (travels with the repo)

This file is auto-loaded by Claude Code. It captures the durable, non-obvious context for this repo so
work continues seamlessly on any machine (the per-user `~/.claude` auto-memory does NOT travel; this does).

## What this repo is

A **fork of the pi-mono monorepo** (`earendil-works/pi-mono`) — the open-source **pi** agent harness
(CLI + libraries, published as `@earendil-works/*`). On top of it we are building **our own agent**, and
the first deliverable is a **desktop app** at `apps/desktop`.

- Origin: forked on GitHub then downloaded as a ZIP (no original git history), re-`git init`'d locally
  with a fresh-history snapshot and pushed to the fork `origin` = https://github.com/Yuilona/pi.git.
  History is DISCONNECTED from upstream pi — pulling upstream later needs `--allow-unrelated-histories`.
- Monorepo packages (npm workspaces): `packages/ai` (`pi-ai`, 20+ providers), `packages/agent`
  (`pi-agent-core`, the Agent event loop), `packages/coding-agent` (`pi-coding-agent`, the `pi` CLI + SDK),
  `packages/tui`. See `AGENTS.md` for package contribution conventions and `DESIGN.md` for the visual system.

## The desktop app — `apps/desktop` (primary work)

Electron + Vite + TypeScript + React, **pnpm**, scaffolded with electron-vite. Styling follows
`DESIGN.md` **verbatim** (Anthropic warm "literary salon": parchment / terracotta / serif). Goal:
as elegant as possible. Full plan + milestone log lives in `.trellis/tasks/06-15-desktop-app/`
(`prd.md`, `design.md`, `implement.md`).

**Architecture (hard rule):** the pi SDK runs ONLY in the Electron **main** process; the React
**renderer is pi-free** and talks to main over a typed IPC bridge. The pi-free contract lives in
`src/shared/ipc.ts` — main maps pi's `AgentSessionEvent` → serializable DTOs; the renderer knows only
those DTOs. Never import `@earendil-works/pi-*` from the renderer.
- Main: `src/main/agent/manager.ts` (`AgentManager` — owns the `AgentSession`), `bridge.ts` (ipcMain
  wiring), `auth.ts`, `approval.ts`, `mappers.ts`. `src/main/index.ts` = frameless window.
- Preload: `src/preload/index.ts` exposes `window.pi` via `contextBridge` (output forced to `.cjs`).
- Renderer: `src/renderer/src/**` (components, `state/`, `styles/`).

**Pi-citizen (required):** use pi's OWN config, never hardcode a provider. `AuthStorage.create()` +
`ModelRegistry.create()` (`~/.pi/agent/auth.json` + `models.json`) and `SettingsManager.create(cwd)`
resolve default provider/model/thinking. Sessions persist as JSONL under `~/.pi/agent/sessions`, shared
with the pi CLI. This user's real setup is custom OpenAI-compatible providers (duckcoding/icoe/deepseek).

**Implemented (see implement.md for detail):** live streaming chat; all 7 tools (read/grep/find/ls
auto-run, bash/edit/write gated); approval gate = native `on("tool_call")` extension returning
`{block:true}`; 4 permission modes (ask/acceptEdits/yolo/readonly, Shift+Tab to cycle); multi-provider
settings UI + custom endpoints; cross-project multi-session sidebar grouped by project (Codex-style,
pinned-recent + "show more"); message-visibility prefs; **skill-activation card** (a skill = the model
`read`ing a SKILL.md → vivid animated `SkillCard`); **LaTeX** (remark-math + rehype-katex, with a
`normalizeMathBlocks` fix for multi-line `$$`); **slash-command menu** in the composer (builtins +
prompt templates + `/skill:`); **π brand logo** (`Logo.tsx`). Remaining milestone: **M4** = DESIGN.md
polish + `electron-builder` packaging.

### Run & verify (from `apps/desktop`)
- `npm run typecheck` · `npm run lint` (Biome) · `npm run build` — keep all three green before reporting done.
- `npm run dev` for live dev. Package (M4): `npm run package`.
- **Visual checks without spending API tokens:** dev-only screenshot hooks in `src/main/index.ts` —
  `PI_SHOT=<png>` captures then quits; `PI_JS=<code>` or `PI_JS_FILE=<path>` runs renderer JS first;
  `PI_WAIT=<ms>`, `PI_THEME=dark`. Drive the REAL UI (e.g. click a `.sess` row by an ASCII substring of
  its title, or open a real session) — you CANNOT monkeypatch `window.pi` (it's a frozen contextBridge object).

## Gotchas (learned the hard way)

- **`window.pi` is frozen** (contextBridge) — reassigning `window.pi.listSessions` etc. silently fails;
  for tests/screenshots drive the real UI instead.
- **pi streaming:** `message_update` delivers a NEW object each tick (not the same ref) carrying the FULL
  partial — replace, don't append, and track message id by event sequence+role, not object identity
  (see `mappers.ts` `makeIdFactory`).
- **Electron pinned to 41** (Node ≥22.19); Electron 33's Node 20.18 broke undici 8's `markAsUncloneable`.
- **pnpm 10 blocks dependency build scripts** → electron's binary download was skipped; fixed via
  `pnpm.onlyBuiltDependencies` in `apps/desktop/package.json`.
- **China network:** `apps/desktop/.npmrc` uses npmmirror (registry + electron mirrors). Build the
  monorepo `dist` once at repo root before consuming pi from `apps/desktop`.
- **A skill is invoked by the model `read`ing its SKILL.md** (see coding-agent `formatSkillsForPrompt`);
  the SDK's `session.prompt()` already expands `/prompt-template` and `/skill:name` on send.
- Before building a pi feature, check `packages/coding-agent/examples/extensions` for an existing pattern.
- **Main-process session lifecycle ops must serialize + await + funnel errors — never fire-and-forget.**
  `setActive`/`openSession`/`ensureLive`/`setModel` route through the per-class `runExclusive` serializer
  (`agent/serialize.ts`), `await` the (re)build, and emit `{type:"error"}` to the renderer on failure. A
  `void controller.ensureLive(...)` *outside* the pool lock was the root cause of a 5-in-1 audit bug (live cap
  defeated, errors swallowed as unhandled rejections, blank-transcript race, a disposed controller rebuilt).
  A disposed `SessionController` carries a `disposed` flag that no-ops any late rebuild.
- **vitest `vi.mock(factory)` is hoisted above all top-level code** — referencing a class/const declared later
  throws "Cannot access X before initialization" (TDZ). Put the mock's helpers (fake classes, shared mutable
  test state) inside `vi.hoisted(() => ({ ... }))` and reference them via that result (see `sessionPool.test.ts`).

## Environment & working norms (Windows / CN)

Developed on **Windows 11, CN locale → the console + Python stdout are GBK**. Do NOT print emoji or
non-ASCII to the terminal (`UnicodeEncodeError`): use the Read tool (not `cat`/`python -c print`), or
write to a file and Read it back, or set `PYTHONUTF8=1`/`chcp 65001`. Use forward slashes / `/dev/null`
(the shell is bash). Tool-call discipline: send probe/diagnostic commands ALONE; never batch a
possibly-failing command (or an Edit whose match might miss) with other calls — one failure
cascade-cancels the whole batch. One risky thing at a time.

## Workflow & pointers

- **Trellis** drives planning/execution; state is injected by `.claude/hooks/*` each turn. Task artifacts
  live in `.trellis/tasks/`; guide in `.trellis/workflow.md`. Context order for implement/check:
  jsonl entries → `prd.md` → `design.md` → `implement.md`.
- `DESIGN.md` is the source of truth for all styling. `AGENTS.md` = package-level conventions
  (no `any`, never edit `packages/ai/src/models.generated.ts`, per-package CHANGELOG, etc.).
- Git: commit/push only when asked. Branch off `main` for PRs. This is the user's own fork.

## NOT in the repo (re-supply manually on a new machine)

- `~/.pi/agent/auth.json` (API keys) and `models.json` (custom providers) — secrets; re-enter via the
  desktop app Settings. `~/.pi/agent/sessions/` (chat history) — copy if you want it.
- `~/.claude/CLAUDE.md` (personal global rules) — copy to the new machine's home if desired.
- Claude auto-memory (`~/.claude/projects/<path-hash>/memory/`) — per-user, path-dependent; durable
  project knowledge is mirrored here instead.
