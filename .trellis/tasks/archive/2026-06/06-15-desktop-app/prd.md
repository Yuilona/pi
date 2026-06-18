# Pi desktop agent app (Electron + React)

## Goal

Build the user's own agent on top of the **pi** harness, starting with a **desktop application**.
The first deliverable is a beautiful, elegant desktop chat UI — strictly faithful to `DESIGN.md`
(Anthropic/Claude warm "literary salon" aesthetic) — that is **actually wired to the pi agent**
(not a mockup): paste an Anthropic API key and have a real, streaming agent conversation with
tool execution rendered live.

User value: a gorgeous, on-brand desktop home for a pi-based agent, and a clean architecture the
user can extend into their own custom agent later.

## Confirmed facts (from research + repo inspection)

- Monorepo `pi-mono` (`@earendil-works/*`): pure ESM, npm workspaces, Node ≥ 22.19.0, TS 5.9.3,
  Biome (Tab indent, width 3, line width 120, double quotes). Packages: `ai`, `agent`,
  `coding-agent`, `tui` (the old `web-ui` package no longer exists).
- `@earendil-works/pi-coding-agent` ships a first-class SDK explicitly intended for building custom
  desktop UIs:
  - `createAgentSession({ model, authStorage, modelRegistry, tools, cwd, ... }) -> { session }`
  - `session.subscribe(event => ...)`, `session.prompt(text, { images, streamingBehavior })`,
    `session.steer/followUp/abort/setModel/setThinkingLevel/dispose`, `session.messages`,
    `session.isStreaming`.
  - Auth via `AuthStorage` (resolves `ANTHROPIC_API_KEY` / OAuth / `auth.json` / runtime
    `setRuntimeApiKey()`). Models via `getModel("anthropic", "...")` / `ModelRegistry`.
  - Built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`; custom via `defineTool`.
- Event model (`AgentSessionEvent`, superset of core `AgentEvent`):
  `agent_start/end` · `turn_start/end` · `message_start/update/end` ·
  `tool_execution_start/update/end` · `queue_update` · `compaction_*` · `auto_retry_*`.
- Critical rendering rules:
  - `message_update` carries the **full** partial `AssistantMessage` → **replace, never append**.
  - `toolResult` messages are not standalone → merge into the tool card by `toolCallId`.
  - `AssistantMessage.content` is an ordered heterogeneous array: `text` / `thinking` / `toolCall`.
  - Tools run **in parallel** by default → index all tool state by `toolCallId`.
  - pi has **no built-in per-tool approval UI**; an approval gate must be added via the
    `beforeToolCall` hook if desired.

## Decisions locked (user)

1. **Process model**: full Trellis planning (this PRD + `design.md` + `implement.md` before start).
2. **First-version scope**: beautiful UI shell **and** real pi integration (paste API key → live chat).
3. **Location**: `apps/desktop` inside this repo as a **standalone pnpm project** (not joined to the
   npm workspace); depend on `@earendil-works/pi-coding-agent` via the built `dist`.
4. **Window chrome**: custom **frameless** window with a warm self-drawn titlebar + window controls.
5. **Tool safety**: **approval gate** via `beforeToolCall` — `bash`/`edit`/`write` prompt the user to
   Allow/Deny; read-only tools (`read`/`grep`/`find`/`ls`) auto-run.
6. **Conversation model**: single conversation with New/Clear; multi-session sidebar is out of scope.
7. **Multi-provider (v1)**: support ALL pi built-in key-based providers **and** custom OpenAI-compatible
   endpoints (custom base URL via `models.json`). NOT OAuth login flows (later).
8. **Full pi citizen**: the app shares pi's config dir `~/.pi/agent` — `auth.json`, `models.json`,
   `settings.json` (default provider/model/thinking, shellPath, retry), extensions/skills/prompts/
   sessions. Drive defaults via pi's own `SettingsManager` + `ModelRegistry`; do NOT hardcode a
   provider. (Discovered: this user's real setup is `deepseek` key + 3 custom `models.json` providers,
   default `duckcoding/deepseek-v4-flash` — anthropic-only would have been useless to them.)

## Requirements

### R1 — Project scaffold
- `apps/desktop`: Electron + Vite + TypeScript + React, managed by **pnpm**, scaffolded with
  `electron-vite` (main / preload / renderer, HMR in dev).
- Standalone: own `pnpm-lock.yaml` and `node_modules`; **not** added to root `workspaces`; root
  npm scripts unaffected. Pin deps exactly (match `.npmrc save-exact=true` spirit).
- Renderer tsconfig uses Bundler resolution + DOM libs + `react-jsx` (does **not** extend
  `tsconfig.base.json`). Main/preload tsconfig may follow repo Node conventions.
- `pnpm dev` launches the app with HMR; `pnpm build` produces a runnable packaged app.

### R2 — pi integration (main process)
- pi SDK runs in the **Electron main process** (Node). Renderer is pure UI and never imports the agent.
- A typed IPC bridge (preload `contextBridge`) exposes: send prompt, abort, set model, set thinking
  level, set/choose working directory, set API key, list available models; and streams every
  `AgentSessionEvent` from main → renderer.
- API key entry persists via `AuthStorage` (so it survives restarts) and/or runtime override.
- Agent operates in a user-selected working directory (folder picker), defaulting to the user's home
  or last-used folder.

### R3 — Chat experience (faithful to pi UX)
- Multiline composer: send on Enter, newline on Shift+Enter; prompt history (Up/Down); disabled/abort
  affordance while streaming.
- Live streaming assistant rendering: ordered text (Markdown) + collapsible "thinking" blocks.
- Tool cards keyed by `toolCallId`: pending / success / error states; expand/collapse; specialized
  renderers for `edit`/`write` (diff view), `bash` (command + streamed output + exit status),
  `read`/`grep`/`find`/`ls` (concise summaries). Inline images rendered as data URLs.
- Abort current run; status/error banners; auto-retry countdown and compaction indicators surfaced.
- User and assistant message bubbles; correct merge of tool results into their call cards.

### R4 — Controls & settings (multi-provider)
- Settings surface: model picker, per-provider API key entry, custom OpenAI-compatible endpoint form,
  thinking level, working directory.
- **Model picker** lists ALL models from `ModelRegistry.getAll()` grouped by provider, each marked
  ready (key configured) or locked; selecting a locked model prompts for that provider's key.
- **Per-provider keys**: enter/update/remove a key for any built-in provider (`AuthStorage.set`).
- **Custom endpoint**: a form (id, name, baseUrl, api, apiKey, model) writes `~/.pi/agent/models.json`
  and refreshes the registry (covers self-hosted / proxy / OpenAI-compatible URLs).
- Defaults come from pi's `SettingsManager` (`defaultProvider`/`defaultModel`/`defaultThinkingLevel`);
  no provider is hardcoded. App is usable the moment any model is available.
- New conversation / clear; (session list/persistence is a stretch goal, see Out of scope).

### R5 — Design fidelity (DESIGN.md is the law)
- Strict adherence to `DESIGN.md`: Parchment (`#f5f4ed`) canvas, Ivory (`#faf9f5`) surfaces,
  Terracotta (`#c96442`) only for primary CTA/brand, exclusively warm neutrals, ring-based shadows
  (`0 0 0 1px`), whisper shadows, generous border-radius (8–32px), serif headlines (weight 500) +
  sans UI, body line-height ~1.60.
- Design tokens encoded centrally (CSS variables) sourced verbatim from `DESIGN.md`.
- Fonts: literary serif (Fraunces/Newsreader as Anthropic-Serif/Georgia substitute) + Inter
  (sans) + a warm monospace for code — bundled locally, no FOUT.
- Light theme (parchment) is the default; dark theme (Near Black `#141413`) supported per DESIGN.md.
- Custom **frameless** window with a warm self-drawn titlebar + window controls (min/max/close),
  draggable region, on-brand.

### R6 — Tool approval gate
- A `beforeToolCall` hook intercepts mutating tools (`bash`, `edit`, `write`) and surfaces an
  Allow/Deny prompt in the UI; read-only tools (`read`, `grep`, `find`, `ls`) auto-run.
- Denying returns a tool error result so the agent continues gracefully. A per-session "always allow"
  toggle is a stretch goal.

## Acceptance Criteria

- [ ] `cd apps/desktop && pnpm install && pnpm dev` launches the Electron app on Windows with HMR.
- [ ] App is a **standalone pnpm project**; running `npm install`/scripts at repo root is unaffected
      (root `workspaces` does not include `apps/desktop`).
- [ ] With a valid Anthropic API key entered in-app, sending a message produces a **live streaming**
      assistant response (text appears token-by-token).
- [ ] At least one real tool call (e.g. `read`/`ls`/`bash`) executes and renders as a tool card with
      pending → success/error state; an `edit`/`write` renders a diff.
- [ ] Streaming can be aborted mid-run from the UI.
- [ ] A `bash`/`edit`/`write` tool call triggers an in-UI Allow/Deny prompt; Deny is handled
      gracefully; read-only tools auto-run.
- [ ] Working directory is user-selectable; the agent's tools operate in that directory.
- [ ] A design-token review confirms colors/typography/radius/shadows match `DESIGN.md` values
      verbatim (no cool grays, no bold serifs, no harsh drop shadows, no pure-white page bg).
- [ ] The renderer never imports `@earendil-works/pi-*`; all agent access is via the IPC bridge.
- [ ] `pnpm build` produces a packaged, launchable app.

## Out of scope (v1)

- Multi-session history browser, fork/clone/tree navigation, session import/export.
- Extensions/skills/prompt-template management UI, MCP, sub-agents.
- OAuth login flows (API key entry is sufficient for v1; OAuth is a later add).
- Auto-update, code signing, cross-platform installers (focus: runs on the user's Windows 11).
- Custom agent identity/branding/personas (generic chat shell first; brand later).

## Open questions

- None blocking. All planning decisions resolved (see "Decisions locked"). Acceptance criteria are
  the contract for v1.
