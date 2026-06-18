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
- [x] **Stable project order across refreshes** (`orderRef` in SessionSidebar): project group order is
      remembered, so deleting a chat (or sending a message) never reshuffles projects — you don't have to
      hunt for where a project jumped to. Existing projects keep their slot; only brand-new projects are
      inserted (at top, by latest activity); a group drops out only when its last chat is deleted.
- [x] **Skill-activation card (pi is skill-driven)**: a skill is invoked when the model `read`s a
      SKILL.md (see coding-agent `formatSkillsForPrompt`). `skillActivation()` in `toolText.ts` detects
      `read` + path basename `SKILL.md` (or a `.md` under a `skills/` dir) → routes to a dedicated
      `SkillCard` instead of the plain `ToolChip`. Deliberately the loudest surface in the thread:
      animated conic gradient ring (`@property --skill-angle`), pulsing glow, breathing inner wash,
      shimmering gradient serif title, twinkling sparkle badge — ALL gated behind
      `@media (prefers-reduced-motion: no-preference)`; static fallback still vivid. Rich motion plays
      during `pending` (activating); `success`/`error` settle to a static vivid/red ring. `skill.css`,
      `IconSparkle`. Verified on a real session (`tavily-search`) in both light + dark themes.
- [x] **LaTeX math in markdown**: `Markdown.tsx` now uses `remark-math` + `rehype-katex`
      (`throwOnError:false`, `strict:false`) with `katex/dist/katex.min.css` imported; supports
      `$inline$`, `$$display$$`, `\( \)`, `\[ \]`. KaTeX fonts bundle into the renderer build; `.md
      .katex-display` scrolls on overflow. Deps (devDependencies): katex 0.16, rehype-katex 7,
      remark-math 6. Verified rendering inline + display equations (fractions, integrals, sums, vectors).
- [x] **Multi-line `$$` display-math fix**: LLMs glue `$$` to content over multiple lines
      (`$$J = \begin{bmatrix} … \\ … \end{bmatrix}$$`); micromark flow-math reads the opening line's
      tail as meta and never finds a lone-`$$` close, so it swallows the rest of the message into one
      broken block KaTeX paints red. `Markdown.tsx` `normalizeMathBlocks()` rewrites ONLY multi-line
      `$$` blocks so each delimiter sits on its own line (well-formed flow math); single-line `$$…$$`,
      inline `$…$`, table cells, and code spans/fences are left untouched. Verified on the real
      "搜索介绍3dgs" session — `\begin{cases}`, `\begin{bmatrix}`, `\boxed{}` now render cleanly, no red wall.
- [x] **Slash-command menu in the composer**: typing `/` opens an autocomplete popup above the input
      (↑/↓ to move, Enter/Tab to accept, Esc to dismiss, click to pick; filtered by prefix). Three kinds
      with colored tags: builtin (APP), prompt template (PROMPT, green), skill (SKILL, terracotta).
      `manager.listCommands()` returns prompt templates (`session.promptTemplates`) + skills
      (`loadSkills`); the SDK's `prompt()` already expands `/template` and `/skill:name` on send.
      7 builtins wired to desktop actions (`runCommand` in App): `/settings`,`/model` → open settings;
      `/new` → new chat; `/resume` → open sidebar; `/compact` → `session.compact()` via IPC;
      `/copy` → clipboard last reply; `/quit` → close window. handleSend guards builtins so they never
      get sent to the model. New IPC: `listCommands`, `compact`. Verified menu + prefix filter via screenshot.
- [x] **Brand logo (π mark)**: replaced the plain terracotta dot with a refined serif-flavored π in a
      terracotta→coral gradient (`components/Logo.tsx`, `useId()` gradient sanitized of `:`). Used in the
      titlebar wordmark ("π pi"), the empty-state hero tile, and the setup gate; removed dead `.dot`/
      `.glyph` CSS. Verified in light theme.
- [x] **Settings: fold unconfigured API keys**: the API-keys list now shows only providers with a key
      (`p.ready`) by default; the rest fold behind "Add a key for another provider · N" (`showAllKeys`
      toggle, `.key-more`). A fresh user with none configured sees all (no confusing toggle). Cuts the
      list from ~38 rows to the few configured. (Model picker already hid no-key providers via showAll.)
      Verified: shows "4 configured" + "· 34" fold for this user's setup.
- [x] **Network proxy (Settings)** + **strict tool-schema fix** (`src/main/agent/proxy.ts`): a toggle
      routes the main process's outbound fetch through an HTTP proxy by swapping `globalThis.fetch` for
      undici's own `fetch` + `ProxyAgent` (same npm undici pkg — Node's bundled fetch + a standalone undici
      ProxyAgent throws a dispatcher version mismatch). Config in `userData/proxy.json`, applied at startup
      + on toggle (IPC `getProxyConfig`/`setProxyConfig`); empty-URL falls back to env proxy with an
      on-but-no-URL warning. **Bug fixed while debugging "proxy on → no reply":** the proxy was fine — the
      real cause was duckcoding's new-api gateway STRICT-validating tool JSON Schemas. pi's `ls` tool has
      all-optional params so it omits `required`; the gateway reads the missing field as null → HTTP 400
      `Invalid schema for function 'ls': null is not of type "array"` → pi silently turns the 400 into an
      empty assistant message (no error event). (Proxy-off only "retried" because the direct request never
      reached the server.) FIX: `normalizeToolSchemas()` in the outbound fetch wrapper adds `required: []`
      to any object tool schema missing it — runs proxy on OR off, keeps all 7 tools, pi untouched.
      Verified end-to-end (home cwd + all 7 tools + proxy → full reply).
- [x] **Codex-parity batch (image input / notifications / usage / model switch)**:
      • **Image input** — composer drag-drop, paste, and an attach button; thumbnails with remove; sent
        via `session.prompt(text, { images })` (`ImageContent` = base64+mimeType). User image blocks now
        map (`mappers.ts`) + render in `UserBubble`. New `ImageAttachmentDto`; `send(text, images?)`.
      • **Task notifications** — `bridge.ts` fires an Electron `Notification` on `agent_end` (and on
        approval requests) when the window isn't focused; click focuses the window.
      • **Token usage readout** — `manager.getStats()` → `session.getSessionStats()` (`UsageDto`); a
        compact "N% ctx ↑in ↓out [$cost]" in the composer bar, refreshed when a turn ends / session
        changes. New IPC `getStats`.
      • **Composer model switcher** — model pill + dropdown of ready models (id + provider) next to the
        mode pill; reuses `listModels`/`setModel`; closes on outside-click / Escape. Verified via screenshots.
- [x] **Per-project + and app-dir general chat** (Codex chat-mode parity): each project group header has a
      hover "+" → new chat in THAT project's cwd; the "Chats"/titlebar "+" now start a chat in the app's
      own dir (Electron `userData`, the "no specific project" bucket). New IPC `newChatInCwd(cwd)` →
      `manager.setCwd(cwd)` (fresh session in that dir); `AppStateDto.appDir` exposes the app dir to the
      renderer; `newChatInCwd` in App routes all new-chat entry points. Verified per-project "+" renders.

## Multi-dimensional code audit + fixes (batches A–D)  ✅ DONE
Ran a Workflow-orchestrated review of the whole `apps/desktop` (~6.6k lines): first a per-commit review of
the freshly-pulled work, then a 9-dimension audit (security/Electron, architecture/IPC boundary, concurrency,
React correctness, resources/perf, error handling, type safety, UX/a11y/DESIGN, maintainability) with **every
medium+ finding adversarially verified against the live code** (default-skeptic, file:line evidence). 26
findings confirmed (2 high, ~10 medium, ~14 low after severity re-calibration — most "scary" security items
dropped to low because they require a renderer compromise, and the renderer is trusted + pi-free). Each batch
kept typecheck/lint/build (and tests from D2) green before commit.

- [x] **Pre-audit commit review** (`f2ad2ca`): reviewing the 5 pulled commits found two confirmed bugs +
      one cosmetic mismatch, all in `MessageList.tsx`/`App.tsx`: (1) per-token `scrollIntoView` had no
      scroll-position guard so scrolling up mid-stream got yanked back — now follows only when near the
      bottom, except a just-sent user message / transcript load still scrolls; (2) `hasVisibleContent`
      counted thinking text even when "show thinking" is off, so a reasoning model streaming thinking-only
      left a blank bubble — now takes `showThinking`; (3) the retitle reveal class cleared at 1300ms while
      the CSS sweep runs 2.5s → held to 2600ms.
- [x] **Batch A — surface agent failures** (`b96c6f5`): H1 a failed turn (assistant `stopReason:"error"` +
      `errorMessage`) mapped to a blank bubble and dropped the error — `mappers.ts` `assistantErrorText()`
      now suppresses the empty `message_start` bubble and emits an `error` event at `message_end` (`aborted`
      left alone). H2 the error/retry/compaction banners lived only inside `MessageList` (unmounted when no
      messages) → extracted `StatusBanners` rendered in the thread AND the empty state. M2 `switchSession`
      try/catches a missing/corrupt file (keeps the live session, `ensureSession` fallback) + `existsSync`
      cwd guard. M3 `applyProxy` validates the scheme and builds the new `ProxyAgent` BEFORE swapping, so a
      bad URL can't leave `globalThis.fetch` half-swapped/unset. M4 `auto_retry_end.finalError` /
      `compaction_end.errorMessage,aborted` now flow through the DTOs and the reducer shows them.
- [x] **Batch B — accessibility** (`90b2643`): M5 a single `:focus-visible` ring (DESIGN `--focus`) for
      keyboard users; M6 a `useModalFocus` hook (focus-on-open, Tab trap with capture-phase stopPropagation,
      focus restore) + `role="dialog"/aria-modal/tabIndex` on ApprovalDialog/ConfirmDialog/SettingsPanel
      (+Escape on Settings); M7 a global `prefers-reduced-motion: reduce` reset in `base.css`; M8 `aria-label`
      on all icon-only buttons (Titlebar/SessionSidebar/Composer/SettingsPanel); M9 `--text-3` darkened
      `#87867f → #6f6e68` to clear WCAG AA on warm-sand.
- [x] **Batch C — concurrency** (`ffae7ed`): M1 added an `opChain` serialization lock (`runExclusive`) so all
      build/teardown lifecycle ops (newSession/switchSession/deleteSession/setCwd/setApiKey/setModel/
      addCustomProvider/init + prompt's ensure step) can't interleave and leak a subscription or paint into
      the wrong session. **prompt builds UNDER the lock but runs the turn OUTSIDE it** (a long stream never
      blocks switching; a rejection from a torn-down session is swallowed). `deleteSession` calls the unlocked
      `newSessionImpl` to avoid deadlocking the chain. `teardown` clears `currentSessionFile`.
- [x] **Batch D1 — hardening + robustness** (`9517084`): `setWindowOpenHandler` opens only http/https/mailto
      via a shared `openExternalSafe` + a `will-navigate` guard pins the app document; the session
      subscription's dispatch body is wrapped in try/catch (a mapping failure degrades to an error event, not
      a throw back into pi's loop); `getState` reports the live `session.thinkingLevel`; the `ViewContext`
      value is `useMemo`'d (no re-render of every consumer each streaming tick).
- [x] **Batch D2 — unit tests (M10)** (`bd9da1a`): added **vitest** (`test` script, `vitest.config.ts`, node
      env, `src/**/*.test.ts`). Extracted the pure helpers into dependency-free sibling modules so they test
      without an Electron/pi/React runtime — `mathNormalize.ts` (from Markdown.tsx), `schemaNormalize.ts`
      (from proxy.ts), `titleUtils.ts` (firstUserText/assistantText/cleanTitle, from manager.ts); mappers was
      already importable (type-only pi imports). **25 tests / 4 files** lock the known-hard cases: LaTeX
      `\[ \]`/`\( \)` conversion + glued multi-line `$$` fixing (code protected), tool-schema `required:[]`
      injection + pass-through, title cleanup + first-user-text, and the streaming id factory + transcript
      tool-folding.
- **Deferred (low value / behavior-changing / breakage risk — revisit on request):** strict CSP (could break
  KaTeX fonts / dev HMR / `data:` images on a trusted pi-free renderer); constraining session paths to the
  sessions dir (risk of breaking switch/delete if pi's layout differs); bundle code-splitting (negligible for
  a local desktop load); image downscaling (changes user image quality); approval timeout (an indefinite wait
  for user approval is intended); tightening proxy.ts `any` plumbing / forwarding session_info_changed.

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

## Milestone M4 — DESIGN.md fidelity polish + packaging  ✅ DONE
Goal: the "wow", and a packaged app.
- [x] Empty-state hero, micro-interactions, reading-column rhythm, dark-theme parity — shipped across
      `86cc50a` (DESIGN fidelity) + the `06-18-polish-quickwins` task (token fidelity, pressed states,
      smooth collapse, wider empty state).
- [x] Design-token audit vs DESIGN.md — done in `06-18-polish-quickwins` (off-scale values snapped to tokens).
- [x] `electron-builder.yml` (win/nsis x64) + `pnpm package` produce a launchable app. Verified: the packaged
      `release/win-unpacked/pi.exe` boots and renders (externalized pi + ESM + asar work at runtime); NSIS
      installer `release/pi Setup <ver>.exe` builds. `npmRebuild: false` (no native addons); China binary
      mirrors via `.npmrc`.
- [x] Brand icon: `build/icon.ico` (terracotta serif-π on a warm ivory→parchment tile, matching `.mark`),
      generated by `make-icon.mjs` (Electron render → multi-size .ico); auto-picked up via buildResources.
- [x] App README (`apps/desktop/README.md`): prerequisites, dev/build/package commands, pi-citizen API-key note.
- Acceptance: ✅ `pnpm package` produces a runnable Windows app (launch-verified token-free); token review
      passed in the polish task.

## Validation commands
- `cd apps/desktop && pnpm install`
- `pnpm dev`            # HMR dev run
- `pnpm typecheck`      # tsc -b / vue-tsc-equivalent for the three tsconfigs
- `pnpm lint`           # local biome
- `pnpm test`           # vitest unit tests (pure helpers: math/schema/title/mappers)
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
