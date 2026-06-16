# Implementation plan — Pi desktop agent app

> **Standing rule (user feedback):** before building any feature, first check
> `packages/coding-agent/examples/extensions/` and the cookbook table in
> `packages/coding-agent/docs/extensions.md` (~line 2595+) for an existing reference pattern, and
> base the implementation on it. Each milestone below names the references to consult.

## Prerequisites (do first)
- [ ] Build the monorepo so the SDK `dist` exists: `npm run build` at repo root (or at least
      `npm --prefix packages/tui run build && ... ai ... agent ... coding-agent`). Confirm
      `packages/coding-agent/dist/index.js` exists.
- [ ] Confirm pnpm is installed (`pnpm -v`). Confirm an Anthropic API key is available for the
      end-to-end test (entered in-app, not committed).

## Milestone M0 — Scaffold + frameless window + design tokens  ✅ DONE (verified light+dark)
Goal: `pnpm dev` opens an empty, on-brand Parchment window with a custom warm titlebar.
- [ ] Create `apps/desktop` standalone pnpm project; scaffold with `electron-vite` (react-ts template).
      Add `.npmrc` (`save-exact=true`). Do NOT add to root `workspaces`.
- [ ] Add dep `"@earendil-works/pi-coding-agent": "file:../../packages/coding-agent"`; `pnpm install`.
- [ ] tsconfigs: `tsconfig.web.json` (Bundler/DOM/react-jsx, no extend of base), `tsconfig.node.json`
      (main/preload). Local `biome.json` (tab, width 3, line 120, double quotes).
- [ ] Frameless `BrowserWindow({frame:false, titleBarStyle:"hidden", backgroundColor:"#f5f4ed",
      contextIsolation:true, nodeIntegration:false})`. Preload registered.
- [ ] `styles/tokens.css` (all DESIGN.md vars), `base.css`, `fonts.css` with bundled woff2
      (serif + Inter + mono). `[data-theme="light|dark"]`.
- [ ] `Titlebar.tsx` with drag region + min/max/close via IPC (`window.ts`).
- Reference: `mac-system-theme.ts` (theme switching), `custom-header.ts` (header concept).
- Validate: `pnpm dev` → parchment window, draggable titlebar, working window controls; `pnpm typecheck`.

## Milestone M1 — IPC bridge + live streaming chat (text only)  ✅ DONE
Goal: enter API key, send a message, see token-by-token assistant text.
Status: pi loads in Electron 41 main; IPC pipeline (events→reducer→render) verified via synthetic
events (user bubble, thinking, markdown, ls tool card) and entry API-key gate. Electron bumped
33→41 (Node 20.18 lacked undici 8's `markAsUncloneable`). M1 uses read-only tools; live streaming
with a real Anthropic key is the user's end-to-end test. lint/typecheck/build all green.
- [ ] `src/shared/ipc.ts`: channel names + DTO types (pi-free) per design §5.
- [ ] `preload/index.ts`: `contextBridge.exposeInMainWorld("pi", PiApi)`.
- [ ] `agent/auth.ts`: `AuthStorage` + `ModelRegistry`; `setApiKey` (runtime + persist); `listModels`
      via `getAvailable()`.
- [ ] `agent/manager.ts`: `createAgentSession` (in-memory session, default tools, chosen cwd).
- [ ] `agent/mappers.ts` + `agent/bridge.ts`: subscribe → map `AgentSessionEvent` → `IpcAgentEvent` →
      `webContents.send`. ipcMain handlers: `prompt/abort/newSession/setModel/setThinking/setApiKey/
      listModels/getState/chooseCwd`.
- [ ] Renderer `state/chatReducer.ts` + `useAgent.ts`: `message_start/update(REPLACE)/end`; streaming flag.
- [ ] `Composer.tsx` (Enter send, Shift+Enter newline, history, Stop while streaming),
      `MessageList.tsx`, `UserBubble.tsx`, `AssistantBubble.tsx`, `Markdown.tsx`, `ThinkingBlock.tsx`,
      first-run API-key prompt.
- Reference: SDK `examples/sdk/01-minimal.ts`, `09-api-keys-and-oauth.ts`; `hidden-thinking-label.ts`
  (thinking display), `working-indicator.ts` (streaming indicator).
- Validate (acceptance): API key → send → live streaming text; abort works.

## Milestone M2 — Tool rendering + approval gate  ✅ DONE
Goal: tools execute and render; bash/edit/write prompt Allow/Deny.
Status: all 7 tools enabled; approval gate is an in-process extension via DefaultResourceLoader
extensionFactories + `on("tool_call")` (pattern from permission-gate.ts), Allow/Deny IPC dialog
(Enter/Esc), Deny → `{block:true}` so the agent continues; abort/teardown auto-deny pending. BashCard
(command + streaming stdout + status), DiffView for edit (auto-expand, warm add/del/hunk), live
tool output via tool_execution_update. Verified via synthetic events (bash card, edit diff, approval).
Permission modes (Claude-Code-like): Ask / Auto-accept edits / Auto-run all / Read-only in
manager.requestApproval; 3-state approval (deny/allow/always → per-session allowlist); mode pill above
composer + Shift+Tab cycle + Permissions section in Settings. typecheck/lint/build green.
- [ ] Extend reducer/IPC for `tool_execution_start/update/end`; `tools: Map<toolCallId,...>`.
- [ ] `ToolCard.tsx` (pending/success/error, expand/collapse, inline images), `DiffView.tsx`
      (added/removed/context + intra-line), `BashCard.tsx` (command + streamed output + exit code).
      Render tool cards inline at their `toolCall` block position; never render `toolResult` standalone.
- [ ] `agent/approval.ts`: in-process extension via `DefaultResourceLoader.extensionFactories`,
      `pi.on("tool_call", ...)`; mutating set {bash,edit,write} → IPC approval round-trip → allow
      (`undefined`) / deny (`{block:true,reason}`). read-only auto-run.
- [ ] `ApprovalDialog.tsx`; `onApproval`/`resolveApproval` wiring; abort cancels pending approval.
- Reference (REQUIRED): `permission-gate.ts` (the gate), `protected-paths.ts`, `timed-confirm.ts`
  (dialog w/ timeout/signal); `built-in-tool-renderer.ts` + `message-renderer.ts` +
  `core/tools/edit.ts` (diff details `{diff,patch}`) for rendering fidelity.
- Validate (acceptance): a `read`/`ls` auto-runs and shows a card; an `edit`/`write` shows Allow/Deny
  then a diff; Deny is handled gracefully.

## Milestone M1.5 — Pi-citizen defaults (multi-provider core)  ✅ DONE
Goal: no hardcoded provider; the app uses pi's own config so any provider/custom URL just works.
- [x] `manager` uses `SettingsManager.create(cwd)` → defaults from `~/.pi/agent/settings.json`
      (`defaultProvider`/`defaultModel`/`defaultThinkingLevel`, shellPath, retry). No forced model.
- [x] `ModelRegistry` reads `~/.pi/agent/models.json` (custom providers/base URLs) — already default.
- [x] Gate shows only when zero models available (`getAvailable().length === 0`); `hasModel` replaces
      the anthropic-specific `hasApiKey` in `AppStateDto`.
- [x] `listModels` → `getAll()` (all providers) with per-model `available` via `hasConfiguredAuth`.
- [x] `setApiKey(provider)` / `removeApiKey(provider)` / `setModel(provider,id)` are provider-generic.
- Verified: with this user's real config, resolves `duckcoding/deepseek-v4-flash` @ xhigh; 975 models
  listable; 6 available across their 3 custom providers. Entry shows chat (no gate).

## Milestone M3.6 — Message visibility controls  ✅ DONE
- [x] Settings "Message visibility": **Show thinking process** (mapped to pi's `hideThinkingBlock`
      via SettingsManager, shared with CLI) + **Expand tool & command output by default**.
- [x] Renderer ViewContext (`state/viewPrefs.ts`): `showThinking` (ThinkingBlock returns null when off),
      `expandTools` (tool cards use `open = override ?? expandTools`; localStorage-persisted, per-card override).
- [x] Manager keeps a persistent `SettingsManager` (recreated on cwd/session change); `setShowThinking`
      writes `hideThinkingBlock` + flush; `getState.showThinking` reflects it.

## Milestone M3.5 — Multi-session + tool-card collapse  ✅ DONE
- [x] Persistent sessions via pi `SessionManager.create/open/list` (shared with the CLI under
      ~/.pi/agent/sessions, lazy file on first message). Left **sessions sidebar** (titlebar toggle):
      lists real sessions (title=name/firstMessage, relative time, msg count), active highlight,
      new chat, delete-on-hover.
- [x] Resume loads full history: `getTranscript` → `mapTranscript` reconstructs bubbles + tool cards
      from saved messages (tool results rebuilt from toolResult entries); reducer `_load` hydrates.
      Verified by resuming a real CLI session (read/bash cards + markdown restored).
- [x] Tool cards now **default collapsed & consistent** (removed BashCard open-by-default and the
      edit-diff auto-expand). Grid layout: titlebar / [sidebar | main].
- [x] **Cross-project sessions, grouped by project**: sidebar always lists `SessionManager.listAll()`
      grouped under per-project headers; no scope toggle. Opening any session adopts that project's cwd.
- [x] **Codex-style grouping polish**: prominent serif + folder-icon project headers with a count badge;
      groups in a STABLE order by latest activity (no longer reorders when you switch projects — sort
      ignores currentCwd); current project shown only via a terracotta "current" badge + brand folder icon;
      each group pins the 4 most-recent chats (`ProjectGroup` subcomponent), the rest fold under a
      "Show N more…/Show less" toggle. Verified across 3 projects (overflow + expand screenshotted).

## Milestone M3 — Multi-provider settings UI  ✅ DONE (model picker / keys / custom endpoint)
- [x] Settings slide-over (`SettingsPanel`): model picker over `listModels()` (975 grouped by provider,
      ready/locked + custom badges, current highlighted, search + "show providers without a key").
- [x] Per-provider API-key entry (`setApiKey`/`removeApiKey`, source shown: stored/env/models.json).
- [x] Custom OpenAI-compatible endpoint form → writes `~/.pi/agent/models.json` + `modelRegistry.refresh()`
      (preserves existing providers). Thinking-level segmented, working-dir change, theme toggle.
- [x] `manager.init()` warm-up so the resolved default model shows immediately.
- Verified via screenshots (current model highlighted; xhigh active; 3 custom providers shown).
- Remaining for M3-later: footer with live model/tokens; session list (out of scope v1).
Goal: full v1 control surface.
- [ ] `SettingsPanel.tsx` slide-over: API key, model picker (available only), thinking level, cwd
      picker (`dialog.showOpenDialog`), New/Clear conversation (recreate session; confirm on cwd change).
- [ ] `Footer.tsx`: cwd · model · thinking · token/cost stats. `Banners.tsx`: error, auto-retry
      countdown, compaction indicator from `auto_retry_*`/`compaction_*`/`error`.
- Reference: `tools.ts` (settings list pattern), `model-status.ts`, `status-line.ts`/`custom-footer.ts`.
- Validate: switch model/thinking/cwd; banners appear on retry/compaction/error.

## Milestone M4 — DESIGN.md fidelity polish + packaging
Goal: the "wow", and a packaged app.
- [ ] Empty-state hero (serif greeting + subtle organic flourish), micro-interactions (ring hover,
      button states), reading-column rhythm, dark theme parity.
- [ ] Design-token audit vs DESIGN.md (colors/typography/radius/shadows verbatim; Do/Don'ts enforced).
- [ ] `electron-builder.yml` (win target); `pnpm build` + `pnpm package` produce a launchable app.
- [ ] App README: prerequisite build, dev/build/package commands, API-key note.
- Validate (acceptance): token review passes; `pnpm build` packages a runnable app.

## Validation commands
- `cd apps/desktop && pnpm install`
- `pnpm dev`            # HMR dev run
- `pnpm typecheck`      # tsc -b / vue-tsc-equivalent for the three tsconfigs
- `pnpm lint`           # local biome
- `pnpm build`          # electron-vite build
- `pnpm package`        # electron-builder (win)
- Root unaffected check: from repo root `npm run check` still scopes only to `packages/**`.

## Risky files / rollback points
- `electron.vite.config.ts` (externalize pi packages in main; ESM correctness) — most likely to need
  iteration on Windows. Rollback: tweak `build.rollupOptions.external` / `resolve`.
- `agent/manager.ts` cwd-change → session recreate (transcript loss; confirm first).
- `agent/approval.ts` must NOT overwrite `session.agent.beforeToolCall` (clobbers extension
  delegation) — use the extension factory route only.
- Whole feature is additive under `apps/desktop`; deleting the dir fully reverts. No edits to existing
  packages or root config.

## Review gates
- After M0: confirm scaffold/window/tokens with user before wiring the agent.
- After M2: confirm tool rendering + approval UX (security-sensitive) with user.
- Before `task.py start`: this plan + `prd.md` + `design.md` reviewed/approved.
