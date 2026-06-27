# Surface existing SDK knobs (export/share, OAuth, memory editor, tool toggles)

## Goal

Expose, in the desktop UI, capabilities the pi SDK *already ships* but the app never wires up — session
export / import / share, OAuth provider login, an in-app project-memory (CLAUDE.md / AGENTS.md) editor,
per-session tool toggles, a manual bash console, scoped-model quick-cycle, custom compaction instructions
with auto-compaction / auto-retry toggles, and per-project default model/thinking/mode — so the desktop
agent reaches parity with the official CLI/TUI without inventing new agent behaviour.

## Background

The renderer↔main capability surface is the closed contract in `apps/desktop/src/shared/ipc.ts`
(the `PiApi` interface, lines 266-328, and the `IPC` channel map, lines 5-48). Every renderer capability is
exactly one entry there, wired in `preload`, handled in `bridge.ts`, and routed through `SessionPool` →
`SessionController`. Today that surface covers send/abort/edit/setModel/setThinking/getTranscript/getStats/
compact/listCommands and lifecycle/auth/proxy — but it stops well short of what the SDK offers.

Concretely, what the SDK exposes and the desktop does NOT surface:

- **Export / import / share.** `AgentSession.exportToHtml()` (`packages/coding-agent/src/core/agent-session.ts:3019`),
  `exportToJsonl()` (`:3043`), `AgentSessionRuntime.importFromJsonl()`
  (`packages/coding-agent/src/core/agent-session-runtime.ts:353`), and `getShareViewerUrl()`
  (`packages/coding-agent/src/config.ts:491`) all exist and are used by the TUI (`/export`, `/import`, `/share`
  at `interactive-mode.ts:5154/5213/5244`). `ipc.ts` has none of these.
- **OAuth login.** `AuthStorage.login(providerId, callbacks)` exists
  (`packages/coding-agent/src/core/auth-storage.ts:388`) with real providers anthropic / openai-codex /
  github-copilot (`packages/ai/src/utils/oauth/{anthropic,openai-codex,github-copilot}.ts`). The desktop only
  has API-key auth: `setApiKey`/`removeApiKey`/`hasApiKey` (`ipc.ts:300-304`), persisted via
  `persistApiKey` (`apps/desktop/src/main/agent/auth.ts:17`). No OAuth path.
- **Project-memory editor.** `loadProjectContextFiles({cwd, agentDir})` resolves the global + ancestry chain of
  CLAUDE.md/AGENTS.md (`packages/coding-agent/src/core/resource-loader.ts:79`, exported at
  `packages/coding-agent/src/index.ts:169`). The desktop never reads or edits those files.
- **Per-session tool toggles.** `AgentSession.getAllTools()` (`agent-session.ts:781`) and
  `setActiveToolsByName(names)` (`:801`) exist. The desktop hardcodes the full set
  (`apps/desktop/src/main/agent/sessionController.ts:32` `TOOLS = [...]`) and only offers the 4 coarse
  permission modes (`ipc.ts:59` `PermissionMode`).
- **Manual bash console.** `AgentSession.executeBash(command, onChunk, {excludeFromContext})`
  (`agent-session.ts:2580`) runs a command in the session cwd, optionally excluded from LLM context (the `!!`
  semantics). The desktop has no shell console.
- **Scoped models + quick-cycle.** `setScopedModels([{model, thinkingLevel}])` (`agent-session.ts:863`) +
  `cycleModel("forward"|"backward")` returning `ModelCycleResult` (`agent-session.ts:1465`) power the TUI's
  model hotkey. The desktop only has `setModel(provider,id)` (`ipc.ts:272`).
- **Compaction instructions + toggles.** `compact(customInstructions?)` accepts a focus string
  (`agent-session.ts:1641`); `SettingsManager.setCompactionEnabled()` (`settings-manager.ts:750`) and
  `setRetryEnabled()` (`:790`) gate auto-compaction / auto-retry. The desktop calls bare `compact()`
  (`sessionController.ts:411`) and never exposes the toggles.
- **Per-project defaults.** `SettingsManager` already loads/writes a project scope (`withLock(scope, ...)` at
  `settings-manager.ts:219`, project writers `setProject*` at `:942-1006`), but the convenience setters for the
  things users care about — `setDefaultModelAndProvider` (`:688`), `setDefaultThinkingLevel` (`:730`),
  `setCompactionEnabled`/`setRetryEnabled` — all write `this.globalSettings.*` (global only). There is no
  project-scoped setter for default model/thinking/mode, so the desktop cannot offer "this project always uses
  model X."

Architecture is fixed: the SDK runs only in the Electron main process; the renderer is pi-free and speaks only
`ipc.ts` DTOs. Each new capability = a new channel + DTO in `ipc.ts`, wired in `preload/index.ts` + `bridge.ts`,
routed through `SessionPool`/`SessionController`, mapped (where it streams) in `mappers.ts`.

## Requirements

Each requirement is independently shippable; ordering hints are in **Dependencies / sequencing**.

- **(R1) Export & import a session.** Add IPC to export the active session to HTML or JSONL (file-save dialog
  destination) and to import a JSONL file into a new live session. *Value:* users can archive, hand off, or
  re-ingest a chat — table-stakes parity with the CLI's `/export` + `/import`.
  Evidence: `AgentSession.exportToHtml()` `agent-session.ts:3019`, `exportToJsonl()` `:3043`,
  `AgentSessionRuntime.importFromJsonl()` `agent-session-runtime.ts:353`; TUI usage
  `interactive-mode.ts:5154/5213`. sdkSupport: full (methods exported; runtime needed for import — see hints).
  Effort: **M**.

- **(R2) Share a session as a link.** Add IPC to produce a shareable URL from the current session, mirroring the
  TUI's `/share` (export HTML → create a secret GitHub gist via `gh` → `getShareViewerUrl(gistId)`), surfacing
  graceful errors when `gh` is missing/not-logged-in. *Value:* one-click "send someone this conversation."
  Evidence: `getShareViewerUrl()` `config.ts:491`; full share flow `interactive-mode.ts:5244-5329` (uses `gh gist
  create --public=false`). sdkSupport: partial — `getShareViewerUrl` is SDK; gist creation is a `gh` subprocess
  the desktop must run itself (the SDK does not bundle gist upload). Effort: **M**.

- **(R3) OAuth provider login.** Add IPC + a Settings affordance to log in to an OAuth provider
  (anthropic / openai-codex / github-copilot) via `AuthStorage.login`, surfacing the device-code / auth-URL /
  prompt / select callbacks to the renderer (the renderer shows the code/URL and "open browser" / paste-code
  affordances). *Value:* users on Claude/Codex/Copilot subscriptions can sign in without pasting raw API keys.
  Evidence: `AuthStorage.login(providerId, callbacks)` `auth-storage.ts:388`; `OAuthLoginCallbacks`
  (`onAuth`/`onDeviceCode`/`onPrompt`/`onSelect`/`onProgress`) `packages/ai/src/utils/oauth/types.ts:43`;
  providers `packages/ai/src/utils/oauth/{anthropic.ts:386,openai-codex.ts:568,github-copilot.ts:337}`;
  enumerate via `getOAuthProviders()` (`packages/ai/src/utils/oauth/index.ts:94`). sdkSupport: full (main drives
  the callbacks; renderer renders prompts over IPC). Effort: **L** (interactive multi-step callback bridge).

- **(R4) In-app project-memory editor.** Add IPC to list the resolved CLAUDE.md/AGENTS.md ancestry chain for a
  session's cwd (global + each ancestor), read a chosen file, and write it back; a Settings/side-panel editor
  edits the project memory the agent actually loads. *Value:* steer the agent's standing instructions without
  leaving the app. Evidence: `loadProjectContextFiles({cwd, agentDir})` `resource-loader.ts:79` (exported
  `index.ts:169`), used by the loader at `resource-loader.ts:455`. sdkSupport: partial — `loadProjectContextFiles`
  resolves the chain; writing back is plain `fs` in main (no SDK setter), and edits take effect on the session's
  next rebuild/resource reload. Effort: **M**.

- **(R5) Per-session tool enable/disable toggles.** Add IPC to read the session's full tool set + which are
  active, and to set the active subset by name — a finer control than the 4 permission modes (e.g. disable
  `bash` for this session only). *Value:* precise, per-session capability scoping; pairs with the
  extensibility work (AGENT-1). Evidence: `getAllTools(): ToolInfo[]` `agent-session.ts:781`,
  `setActiveToolsByName(names)` `:801` (rebuilds the system prompt; effective next turn). sdkSupport: full.
  Effort: **M**.

- **(R6) Manual bash console.** Add IPC to run a bash command in the session's cwd via `executeBash`, streaming
  output back, with the `!` (output added to context) vs `!!` (`excludeFromContext`) distinction surfaced as a
  toggle. *Value:* a quick shell decoupled from the agent loop, with the same context semantics as the CLI.
  Evidence: `AgentSession.executeBash(command, onChunk, {excludeFromContext})` `agent-session.ts:2580`;
  `recordBashResult` `:2614`; TUI bash bar `interactive-mode.ts:5694`. sdkSupport: full (streaming via the
  `onChunk` callback → a new streamed IPC event). Effort: **M**.

- **(R7) Scoped models + quick-cycle hotkey.** Add IPC to set a list of "scoped" models (with optional thinking
  levels) and to cycle to the next/previous via a renderer hotkey, reflecting the new model in the composer.
  *Value:* fast model A/B switching without opening Settings. Evidence: `setScopedModels(...)`
  `agent-session.ts:863`, `cycleModel(direction)` `:1465` returning `ModelCycleResult` (exported `index.ts:11`).
  sdkSupport: full. Effort: **M**.

- **(R8) Custom compaction instructions + auto-compaction / auto-retry toggles.** Extend the compact IPC to pass
  an optional `customInstructions` focus string, and add IPC to read/set the auto-compaction and auto-retry
  toggles. *Value:* steer what a summary keeps, and turn off background compaction/retry when undesired.
  Evidence: `compact(customInstructions?)` `agent-session.ts:1641` (desktop currently calls bare `compact()`
  `sessionController.ts:411`); `SettingsManager.setCompactionEnabled()` `settings-manager.ts:750`,
  `setRetryEnabled()` `:790`, getters `getCompactionSettings()` `:767` / `getRetrySettings()` `:799`.
  sdkSupport: full. Effort: **M**.

- **(R9) Per-project default model / thinking / mode.** Add IPC + Settings UI to set a project-scoped default
  model, thinking level, and permission mode, so a project re-opens with its own defaults. This needs a small
  SDK addition: project-scoped setters (the existing convenience setters write global only). *Value:* "this
  repo always uses model X at thinking Y in acceptEdits." Evidence: `setDefaultModelAndProvider`
  `settings-manager.ts:688` and `setDefaultThinkingLevel` `:730` both write `this.globalSettings.*`; project
  infra exists — `withLock(scope, ...)` `:219`, project writers `setProject*` `:942-1006` — but no project-scoped
  default-model/thinking/mode setter. sdkSupport: **partial — needs a small upstream SDK setter** (e.g.
  `setDefaultModelAndProvider(provider, id, {scope:"project"})` or sibling `setProjectDefault*`). Effort: **M**
  (mostly the SDK setter; desktop wiring is small).

## Acceptance Criteria

- [ ] Each shipped requirement adds its channel(s) + DTO(s) to `apps/desktop/src/shared/ipc.ts`, wired in
      `src/preload/index.ts` and handled in `src/main/agent/bridge.ts`, routed through `SessionPool`/
      `SessionController` (and `mappers.ts` for anything that streams).
- [ ] The renderer stays **pi-free**: no `@earendil-works/pi-*` import in `src/renderer/**`; the renderer touches
      only `ipc.ts` DTOs (grep proves it).
- [ ] Pi-citizen preserved: auth/models/settings flow through `AuthStorage`/`ModelRegistry`/`SettingsManager`
      (no hardcoded provider); R1/R2 reuse the SDK's own export/share, R4 edits the same files the loader reads.
- [ ] R1: a session exports to a user-chosen HTML and JSONL path and re-imports from JSONL into a live session.
- [ ] R2: share produces a viewer URL on success and a clear, non-fatal error when `gh` is absent / logged out.
- [ ] R3: an OAuth login completes end-to-end for at least one provider, persisting an `oauth` credential to
      `auth.json`, with the device-code / URL surfaced in the UI; the renderer never imports the SDK.
- [ ] R4: the memory editor lists the resolved ancestry chain for the active cwd, and a save round-trips to disk
      and is picked up on the session's next rebuild.
- [ ] R5: disabling a tool for a session removes it from that session's next turn (verified via tool set);
      other sessions are unaffected.
- [ ] R6: a manual command runs in the session cwd and streams output; the `!!` variant is excluded from context.
- [ ] R7: cycling scoped models updates the active model and the composer reflects it.
- [ ] R8: `compact` accepts and applies a custom-instructions string; the auto-compaction/auto-retry toggles
      persist and read back via `SettingsManager`.
- [ ] R9: a project-scoped default model/thinking/mode persists to the project settings file (not global) and a
      newly-opened session in that cwd picks it up; the SDK setter change is upstreamed cleanly.
- [ ] `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` (from `apps/desktop`) stay green;
      any monorepo SDK change (R9) keeps the repo `dist` building.
- [ ] Token-free visual checks where UI is added: light + dark screenshots via the dev hooks (`PI_SHOT`,
      `PI_THEME=dark`) per `apps/desktop/CLAUDE.md`.

## Design hints (for the later design.md)

- **IPC surface:** add channels + `PiApi` methods + DTOs in `src/shared/ipc.ts`; wire each in
  `src/preload/index.ts` (contextBridge) and `src/main/agent/bridge.ts`. Session-scoped ones take a
  `sessionId` first arg and route via `SessionPool` → `SessionController` (mirror existing passthroughs at
  `sessionPool.ts:287-326`). App-global ones (OAuth, project defaults, memory list/read/write) live on the pool
  alongside `setApiKey`/`addCustomProvider`.
- **R1 export:** thin `SessionController` methods over `session.exportToHtml(path)` / `session.exportToJsonl(path)`;
  destination chosen via `dialog.showSaveDialog` in `bridge.ts` (compare the `chooseCwd` dialog at
  `bridge.ts:95`). **Import** needs `AgentSessionRuntime.importFromJsonl` — the desktop currently builds via
  `createAgentSession` (`sessionController.ts:153`), not a runtime; either adopt `createAgentSessionRuntime`
  (exported `index.ts:178`) for the importing controller, or import by copying the JSONL into the sessions dir
  and `openSession` it. Decide in design.md.
- **R2 share:** main runs `gh gist create --public=false <html>` (subprocess; see the exact flow at
  `interactive-mode.ts:5294-5329`), then `getShareViewerUrl(gistId)`; surface a typed error DTO when `gh` is
  missing/logged-out (probe `gh auth status` first, as the TUI does at `:5247`).
- **R3 OAuth:** main calls `auth.authStorage.login(providerId, callbacks)`; bridge each `OAuthLoginCallbacks`
  member (`onAuth`/`onDeviceCode`/`onPrompt`/`onSelect`/`onProgress`, types at
  `packages/ai/src/utils/oauth/types.ts:43`) across IPC — push events to the renderer for display, and resolve
  `onPrompt`/`onSelect` promises from renderer replies (a request/response IPC pair keyed by an id, like the
  approval bridge at `bridge.ts:45`). Enumerate providers with `getOAuthProviders()`. On success call
  `modelRegistry.refresh()` + `warmActiveIfNeeded()` (`sessionPool.ts:492`).
- **R4 memory editor:** main exposes `loadProjectContextFiles({cwd: controller.cwd, agentDir: getAgentDir()})`
  (`resource-loader.ts:79`) to list `{path}`s; read/write via `node:fs` in main (confine writes to the listed
  paths, the way destructive ops are confined by `isInSessionsDir` at `sessionPool.ts:39`). After a save, the
  next `buildSession`/`resourceLoader.reload()` (`sessionController.ts:143-151`) re-reads it.
- **R5 tool toggles:** `SessionController` methods over `session.getAllTools()` / `session.setActiveToolsByName()`;
  expose a `ToolInfoDto[]` (name/description/active) — do not leak the SDK `ToolInfo` shape to the renderer.
- **R6 bash console:** `SessionController.runBash(cmd, excludeFromContext)` over `session.executeBash(cmd, onChunk,
  {excludeFromContext})`; stream `onChunk` text as a new tagged IPC event (model the coalescer/forward pattern in
  `sessionController.ts:177-212`). It records a `bashExecution` entry — decide whether/how that surfaces in the
  transcript (`mappers.ts`).
- **R7 scoped models:** `setScopedModels` takes `Model` objects — resolve them via `modelRegistry.find(...)`
  (as `setModel` does at `sessionController.ts:421`) before passing; cycle with `session.cycleModel(direction)`
  and re-emit the resulting model into `SessionSummaryDto`/state. Hotkey lives renderer-side (Shift+Tab is taken
  by mode cycling — pick another).
- **R8 compaction:** widen `compact` IPC to `compact(sessionId, customInstructions?)` →
  `session.compact(customInstructions)`; add global `get/setCompaction`/`get/setRetry` IPC over
  `globalSettings` (mirror `setShowThinking` at `sessionPool.ts:333`).
- **R9 per-project defaults:** the small SDK piece — add a project-scoped path for default model/thinking/mode in
  `packages/coding-agent/src/core/settings-manager.ts` (the storage already supports `withLock("project", ...)`
  at `:219`; follow the `setProject*` writers at `:942-1006`). Then a per-controller `SettingsManager` (already
  `SettingsManager.create(cwd)` at `sessionController.ts:106`) reads/writes the project scope; expose
  read/write IPC and a Settings section. Keep the change additive (don't break existing global setters).

## Dependencies / sequencing

- **None hard-blocking.** R5 pairs with the extensibility child (AGENT-1) but does not depend on it. R9 carries a
  small upstream SDK change; sequence it after a green baseline so the repo `dist` rebuild is isolated. R1/R2
  share an HTML-export step (R2 builds on R1's export plumbing) — do R1 first. R3 is the heaviest (interactive
  callback bridge) and can land independently.

## Out of scope

- New agent behaviour or new tools (this child only *surfaces* existing SDK knobs).
- Renderer importing pi or bypassing the IPC contract.
- A full settings-versioning / migration system; R9 only adds project-scoped default model/thinking/mode.
- A hosted share service — R2 reuses the SDK's `gh`-gist + viewer-URL flow as-is.
- Extension/MCP authoring (owned by the extensibility child, AGENT-1).

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap`. Write `design.md`/`implement.md` and
  implement **only on the user's explicit go-ahead**.
- Findings owned by this child: SDK-5 + UX-5 (R1/R2), DIST-7 (R3), AGENT-5 (R4), SDK-7 (R5), SDK-8 (R6),
  SDK-10 (R7), SDK-11 (R8), AGENT-6 (R9).
- Every cited SDK symbol was verified present in this tree before listing; R2 (gist upload) and R9 (project-scope
  setter) are the only two with a non-trivial gap beyond pure wiring — flagged as partial sdkSupport above.
