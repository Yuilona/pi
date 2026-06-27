# UX enhancements (rename/pin, cost, palette, themes, tray, DnD, onboarding)

## Goal

Close the gap between the desktop app and the everyday quality-of-life affordances its users expect: rename
and pin chats, see per-message cost, summon commands from anywhere (Ctrl+K), pick a persisted named theme,
keep the agent reachable from a system tray, drop any file/folder as context, get a guided first run, and
resize the sidebar — each a small, mostly-renderer change that makes the existing power discoverable.

## Background

The app today is a near-complete pi front-end, but a cluster of standard desktop ergonomics are missing or
hardcoded. Grounded in the current code:

- **Session titles are agent-only.** A chat's title is auto-generated (the title model in
  `sessionController.ts:317-344` `maybeTitleSession` → `target.setSessionName(title)`), or falls back to the
  first user message (`sessionController.ts:443-447` `title()`). There is **no user-facing rename** and **no
  pin/favorite** — the sidebar (`SessionSidebar.tsx`) only offers select + delete, and groups are ordered by
  `modified` with no way to keep a chat at the top.
- **Cost/usage is aggregate-only.** `UsageDto` (`ipc.ts:107-118`) and the composer readout
  (`Composer.tsx:264-275`) show session totals; pi already carries **per-message** usage — every
  `AssistantMessage` has `usage.input/output/cacheRead/cacheWrite` and `usage.cost.total`
  (`agent-session.ts:2940-2944`, summed by `getSessionStats`). `IpcMessage` (`ipc.ts:120-125`) drops it, so no
  bubble can show "this reply cost $X / N tokens".
- **Slash commands hide behind a leading "/".** `BUILTIN_COMMANDS` (`App.tsx:43-51`) plus dynamic prompt/skill
  commands are only reachable by typing `/` in the composer; the menu logic is gated on
  `value.match(/^\/(\S*)$/)` (`Composer.tsx:90`). There is **no global command palette** (Ctrl+K) — the
  commands aren't summonable when the composer isn't focused or empty.
- **Theme is a hardcoded light/dark union, never persisted to pi.** `type Theme = "light" | "dark"`
  (`App.tsx:31`), toggled in memory (`App.tsx:331` `toggleTheme`) and written only to `document.dataset.theme`
  (`App.tsx:102-104`); it resets on relaunch. The pi SDK already has named-theme persistence —
  `SettingsManager.getTheme()` / `setTheme(theme)` (`settings-manager.ts:716-722`) backed by `Settings.theme`
  (`settings-manager.ts:88`), shared with the CLI. The desktop ignores it entirely.
- **No system tray / global hotkey / minimize-to-tray.** `index.ts` creates a frameless window
  (`index.ts:24-104`) and quits on all-windows-closed except darwin (`index.ts:149-151`); there is no `Tray`,
  no `globalShortcut`. Background-completion **notifications already exist** (`bridge.ts:26-38` `notify` →
  `Notification`, fired for non-focused sessions in `sessionPool.ts:97-99,106-108`) but clicking one is the
  only way back to the app, and a closed window kills the agent.
- **Drag-and-drop is image-only.** The composer drop zone accepts only images:
  `fileToAttachment` early-returns for non-`image/` files (`Composer.tsx:19-34`), and `onDrop` →
  `ingest` filters to image DTOs (`Composer.tsx:175-180,288-292`). Dropping a `.ts` file or a folder does
  nothing — even though the agent's tools could read a path handed to it as text.
- **Cold start is a bare API-key gate.** First run shows only `ApiKeyGate` (`App.tsx:413-423`,
  `ApiKeyGate.tsx`), hardcoded to Anthropic ("Paste an Anthropic API key"), with no tour of the app's
  differentiators (modes, slash commands, multi-session, custom providers). New users land with zero context.
- **Sidebar width is fixed; no shortcuts cheatsheet.** `.sidebar` has no resize handle and no persisted width;
  the only keyboard help is the three static hints in the composer footer (`Composer.tsx:370-380`). There is no
  "?" overlay listing the app's real shortcuts (Enter/Shift+Enter/Shift+Tab/"/").

The `viewPrefs` + `localStorage` pattern for persisted UI prefs already exists
(`App.tsx:86,143-146` `expandTools`; `viewPrefs.ts`), giving a clean precedent for pin lists and sidebar width.

## Requirements

- **(SDK-12 + UX-2) User-facing session rename + pin/favorite.** Add an inline rename action on each sidebar
  row (and/or an active-chat title) that calls a new `renameSession(sessionId|path, name)` IPC → `setSessionName`,
  and a pin toggle that keeps favorited chats at the top of the list. *User value:* chats become organizable,
  findable, and durable instead of disposable. *Evidence:* rename has full SDK support —
  `AgentSession.setSessionName(name)` (`agent-session.ts:2682-2685`, already used for auto-titles at
  `sessionController.ts:339`); sidebar today is select+delete only (`SessionSidebar.tsx:199-231`). Pin/favorite
  is a renderer-only localStorage set keyed by session path (mirrors `expandTools`, `App.tsx:86`).
  *sdkSupport:* rename = yes-already-in-sdk (needs an IPC channel); pin = pure-ui. *Effort:* M.

- **(SDK-9) Per-message token/cost detail.** Carry per-assistant-message usage across IPC so a bubble (or a
  hover/expander on it) can show that reply's tokens + cost. *User/dev value:* cost transparency at the unit
  that incurs it; debugging expensive turns. *Evidence:* every `AssistantMessage` already holds
  `usage.input/output/cacheRead/cacheWrite` + `usage.cost.total` (`agent-session.ts:2940-2944`); `IpcMessage`
  (`ipc.ts:120-125`) and `mappers.ts` `toIpcMessage` (`mappers.ts:64-71`) currently discard it. Add an optional
  `usage?` field to `IpcMessage` and populate it in `toIpcMessage`/`mapTranscript`. *sdkSupport:* yes-already-in-sdk
  (tiny DTO + mapper change). *Effort:* S.

- **(UX-4) Global command palette (Ctrl+K).** A modal palette that fuzzy-lists `BUILTIN_COMMANDS` + the active
  session's dynamic prompt/skill commands, summonable from anywhere — not only behind a leading "/" in the
  composer. *User value:* the app's actions become discoverable and keyboard-first without memorizing slashes.
  *Evidence:* `BUILTIN_COMMANDS` (`App.tsx:43-51`), dynamic commands via `refreshCommands` →
  `window.pi.listCommands` (`App.tsx:152-156`), and `runCommand` (`App.tsx:227-264`) already exist; the "/"
  gating lives in `Composer.tsx:90-93`. The palette reuses the same `CommandDto[]` + `runCommand` path; a global
  keydown listener mirrors the existing Shift+Tab one (`App.tsx:278-287`). *sdkSupport:* pure-ui. *Effort:* M.

- **(UX-7) Multiple named themes persisted to pi.** Replace the in-memory light/dark union with a small named
  theme set (light/dark + at least one extra on-brand palette) persisted via the SDK so it survives relaunch and
  is shared with the CLI. *User value:* the chosen look sticks; aligns with pi's own theming. *Evidence:*
  `type Theme = "light" | "dark"` + in-memory `toggleTheme` writing only `dataset.theme`
  (`App.tsx:31,73,102-104,331`); the SDK persists themes via `SettingsManager.getTheme()` / `setTheme(theme)`
  (`settings-manager.ts:716-722`, backed by `Settings.theme` at `settings-manager.ts:88`), already read by the
  TUI (`main.ts:311,753`). Needs new IPC (`getTheme`/`setTheme`) + the pool's `globalSettings` SettingsManager
  (`sessionPool.ts:77,334-336` is the precedent for a global-settings write+flush). *sdkSupport:* yes-already-in-sdk
  for persistence (palettes themselves are renderer CSS). *Effort:* M.

- **(UX-8) System tray + global hotkey + minimize-to-tray.** Add an Electron `Tray` (show/hide, new chat, quit),
  an optional `globalShortcut` to summon/focus the window, and minimize-to-tray so closing the window keeps the
  agent alive in the background. *User value:* the agent stays reachable while running background sessions; pairs
  with the notifications that already fire for non-focused sessions. *Evidence:* no `Tray`/`globalShortcut`
  today; window is created in `index.ts:24-104` and `window-all-closed` quits except darwin
  (`index.ts:149-151`); background notifications already exist and re-focus on click (`bridge.ts:26-38`,
  `sessionPool.ts:97-108`). *sdkSupport:* pure-ui (Electron main-process API; no pi SDK involvement). *Effort:* M.

- **(UX-10) Drag-and-drop non-image files/folders as context.** Extend the composer drop zone to accept
  arbitrary files and folders: a dropped path becomes context (e.g. an attached-path chip or inserted
  `@path`/file reference the agent's read/ls/grep tools then operate on), while images keep their existing
  inline-attachment behavior. *User value:* the natural "drag this file in" gesture works for code, not just
  screenshots. *Evidence:* `fileToAttachment` early-returns for non-image files (`Composer.tsx:19-34`); `onDrop`
  → `ingest` filters to image DTOs only (`Composer.tsx:175-180,288-292`); the drop hint says "Drop images to
  attach" (`Composer.tsx:367`). Electron drop events expose `File.path` for real OS paths. *sdkSupport:* pure-ui
  (path handed to the agent as text; no new SDK surface — the existing tools consume it). *Effort:* M.

- **(UX-11) First-run onboarding.** Replace/augment the bare API-key gate with a short guided first run that
  surfaces the app's differentiators (permission modes, slash commands, multi-session sidebar, custom
  OpenAI-compatible providers) and isn't hardcoded to Anthropic. *User value:* new users discover what makes the
  app worth using instead of bouncing off a single password field. *Evidence:* cold start renders only
  `ApiKeyGate` (`App.tsx:413-423`), which hardcodes "Paste an Anthropic API key" and `setApiKey("anthropic", …)`
  (`ApiKeyGate.tsx:14,29-32`); `ready === false` is the only pre-model state in `App.tsx`. Onboarding shows once
  (a localStorage seen-flag, mirroring `expandTools`). *sdkSupport:* pure-ui (reuses existing
  `setApiKey`/`addCustomProvider`/`listProviders` IPC). *Effort:* M.

- **(UX-12) Resizable + persisted sidebar width and a "?" shortcuts cheatsheet.** Add a drag handle to the
  sidebar that persists its width to localStorage, and a "?" overlay listing the real keyboard shortcuts.
  *User value:* a comfortable, remembered layout and one place to learn the keys. *Evidence:* `.sidebar` is
  fixed-width with no resize handle (`SessionSidebar.tsx:88`, `styles/app.css`); the only shortcut help is the
  three static composer hints (`Composer.tsx:370-380`); real shortcuts exist but are undocumented (Shift+Tab
  cycle `App.tsx:278-287`; Enter/Shift+Enter/"/" `Composer.tsx:153-172`). Width persistence mirrors the
  `expandTools` localStorage precedent (`App.tsx:86,143-146`). *sdkSupport:* pure-ui. *Effort:* S.

## Acceptance Criteria

- [ ] AC1. A sidebar row can be renamed by the user; the new name persists (survives relaunch / shows in the pi
      CLI) via `setSessionName`, and a renamed chat keeps its name through the per-streaming-tick sidebar refresh.
- [ ] AC2. A chat can be pinned/favorited and pinned chats sort to the top of the list; the pin set persists in
      localStorage across relaunch.
- [ ] AC3. Per-message usage (tokens + cost) is available on the relevant message bubble; `IpcMessage` carries
      an optional `usage` field populated by both live mapping and transcript hydration, and bubbles with no
      usage render unchanged (no blank "$0.000").
- [ ] AC4. Ctrl+K opens a command palette from anywhere (composer focused or not), lists builtins + the active
      session's prompt/skill commands, runs the selected one through the existing `runCommand` path, and closes
      on Escape / selection / outside click.
- [ ] AC5. The selected theme persists across relaunch via the pi SDK (`SettingsManager` theme) and is reflected
      in `document.dataset.theme`; at least one named theme beyond light/dark is selectable.
- [ ] AC6. A system tray icon is present with show/hide + new-chat + quit; closing the window minimizes to tray
      (the agent keeps running) rather than killing the process, and a global hotkey re-focuses the window. (macOS
      keeps its existing dock/`activate` behavior.)
- [ ] AC7. Dropping a non-image file or a folder onto the composer attaches it as context (path/reference the
      agent can act on); dropping an image still attaches it inline as before; the drop hint reflects both.
- [ ] AC8. First launch (no model configured, and an unset onboarding flag) shows the onboarding flow with the
      app's differentiators and a non-Anthropic-hardcoded provider entry; completing it reaches the chat view and
      it does not reappear on the next launch.
- [ ] AC9. The sidebar is drag-resizable and its width persists across relaunch; a "?" overlay lists the app's
      real shortcuts.
- [ ] AC10. The renderer stays pi-free: no `@earendil-works/pi-*` import under `src/renderer/**`; all new
      capabilities (rename, theme get/set) are new `ipc.ts` channels/DTOs wired in preload + bridge (+ mappers
      for the per-message usage field).
- [ ] AC11. `npm run typecheck && npm run lint && npm run test && npm run build` all stay green; visual changes
      verified with the dev screenshot hooks (no API tokens spent).

## Design hints (for the later design.md)

- **Rename / pin (SDK-12+UX-2):** new IPC `renameSession` in `ipc.ts` + preload + `bridge.ts` →
  `SessionPool.renameSession(sessionId|path, name)`; route through the controller's `runExclusive` if it touches
  a live `AgentSession`, and call `setSessionName` (resume a parked/on-disk session via `SessionManager.open` if
  it isn't live, mirroring `openSession`). Emit/return so the sidebar re-fetches (reuse the `session_renamed`
  refresh path, `App.tsx:306-314`). Inline rename UI in `SessionSidebar.tsx` (an editable title, like the
  delete-confirm flow). Pin = a `localStorage` Set<path> in `App.tsx`/sidebar, applied in the `groups`
  sort/order (`SessionSidebar.tsx:63-82`); keep pinned chats above the project-order list.
- **Per-message usage (SDK-9):** add `usage?: { input; output; cacheRead; cacheWrite; cost }` (or reuse a subset
  of `UsageDto`) to `IpcMessage` (`ipc.ts:120-125`); populate in `toIpcMessage` (`mappers.ts:64-71`) from
  `message.usage` (read `usage.cost.total` per `agent-session.ts:2940-2944`) and in `mapTranscript`
  (`mappers.ts:173-205`); render on `AssistantBubble.tsx` (hover/expander, formatted like the composer readout's
  `fmtTokens`).
- **Command palette (UX-4):** a new `CommandPalette` component fed the same `commands` + `runCommand` from
  `App.tsx`; for prompt/skill kinds insert `/name ` into the composer (mirror `Composer.tsx accept`,
  `Composer.tsx:131-139`). Global Ctrl+K keydown listener alongside the Shift+Tab one (`App.tsx:278-287`).
- **Themes (UX-7):** new IPC `getTheme`/`setTheme` → `SessionPool` using its `globalSettings` SettingsManager
  (`sessionPool.ts:77`), `setTheme` + `flush` like `setShowThinking` (`sessionPool.ts:333-336`). Load the saved
  theme into `App.tsx` state at startup (extend `refreshState`/`getState` or a dedicated getter); add the named
  palettes as CSS in `styles/tokens.css` keyed by `data-theme`. Replace the boolean `toggleTheme` with a theme
  picker (Settings "Appearance" section, `SettingsPanel.tsx:571-577`).
- **Tray / hotkey (UX-8):** in `index.ts`, create a `Tray` after `app.whenReady` (`index.ts:119-147`) with a
  context menu; intercept window `close` to hide instead of destroy (track a real-quit flag for `before-quit`,
  `index.ts:153-155`); register `globalShortcut` to show/focus; reuse `notify`'s focus-on-click pattern
  (`bridge.ts:32-37`). Tray asset in build resources; respect macOS conventions.
- **Drag-drop files/folders (UX-10):** in `Composer.tsx onDrop`/`ingest` (`Composer.tsx:175-180,288-292`), split
  images (keep `fileToAttachment`) from other paths; for non-images use the dropped `File.path` (Electron) to
  build a path-context chip or insert a file reference into the composer text. Update the drop hint
  (`Composer.tsx:367`). No new SDK surface — the agent's read/ls/grep tools consume the path.
- **Onboarding (UX-11):** a new `Onboarding` component shown when `ready === false` AND a localStorage
  `pi.onboarded` flag is unset (`App.tsx:413-423`); reuse `listProviders`/`setApiKey`/`addCustomProvider` so it
  isn't Anthropic-only (drop the hardcoding in `ApiKeyGate.tsx:14,29-32` or supersede the gate). Set the flag on
  completion.
- **Sidebar resize + cheatsheet (UX-12):** drag handle on `.sidebar` writing width to localStorage
  (precedent: `expandTools`, `App.tsx:86,143-146`) and applied as a CSS var/inline width; a "?" overlay
  component listing shortcuts (Enter / Shift+Enter / Shift+Tab / "/" / Ctrl+K), opened from the titlebar or a
  global "?" keybinding.

## Dependencies / sequencing

- None hard. This is Wave-3 in the roadmap (`06-27-desktop-roadmap` prd, line 50). Soft note: UX-4's command
  palette reuses the same `CommandDto` + `runCommand` surface the composer already has, so it's cleanest after no
  command-related churn is pending; otherwise the eight findings are independent and can land in any order.

## Out of scope

- Tabs / split view over the concurrent pool (UX-3 → `06-27-tabs-split-view`).
- Per-session permission mode + project-trust gate (UX-9 → `06-27-session-safety`).
- Branch/fork/rewind from any message (UX-6 → `06-27-branch-fork-tree`).
- Global content search across sessions (UX-1 → `06-27-global-search`).
- Export/share, scoped models, per-project defaults, etc. (UX-5 → `06-27-sdk-surfacing`).
- Authoring brand-new pi theme *files* / a theme editor — this child only persists a chosen named theme via the
  SDK and ships a small built-in palette set; it does not build a theme-authoring UI.
- Designing the actual extra color palettes to DESIGN.md polish depth (that polish lives with the visual track);
  this child establishes the mechanism + at least one extra palette.

## Notes

- State: **planning-only.** Child of `06-27-desktop-roadmap`. Do not `task.py start` / write `design.md` or
  `implement.md` until the user gives the go-ahead for this specific child.
- Every requirement is grounded in code read for this PRD (file:line / SDK symbol cited inline). sdkSupport is
  stated honestly per finding: SDK-9 and the rename half of SDK-12 + UX-7's persistence are yes-already-in-sdk;
  everything else is pure-ui (renderer or Electron main, no pi SDK).
- Verification is token-free (typecheck/lint/test/build + screenshot hooks); the renderer stays pi-free and all
  new capabilities cross the `ipc.ts` DTO boundary.
