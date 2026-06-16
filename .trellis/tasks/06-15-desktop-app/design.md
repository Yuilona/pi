# Design — Pi desktop agent app

## 1. Architecture overview

Three-layer Electron app; the agent lives entirely in the main process.

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                   │
│  MAIN (Node, ESM)                      RENDERER (React, Vite)      │
│  ─────────────────                     ───────────────────────    │
│  pi SDK:                               Pure UI. Never imports      │
│    createAgentSession()                @earendil-works/pi-*.       │
│    AuthStorage / ModelRegistry         Holds chat reducer that     │
│    AgentSession.subscribe(ev) ───┐     mirrors pi's handleEvent.   │
│    session.prompt / abort / ...  │                                 │
│    beforeToolCall via extension  │                                 │
│         │                        │                                 │
│         ▼                        ▼                                 │
│   AgentSessionEvent  ──map──►  IpcAgentEvent (serializable DTO)    │
│                                                                   │
│            PRELOAD (contextBridge, contextIsolation:true)         │
│   window.pi = { send, abort, setModel, chooseCwd, setApiKey, ...  │
│                 onEvent(cb), onApproval(cb), resolveApproval } │
└───────────────────────────────────────────────────────────────────┘
        renderer ⇄ preload ⇄ ipcMain ⇄ AgentSession (main)
```

- **Why agent in main**: pi does fs, `child_process` (bash/fd/rg), network streaming, session I/O —
  all Node-only. The renderer is a sandboxed browser context (`contextIsolation: true`,
  `nodeIntegration: false`).
- **Boundary rule (acceptance criterion)**: the renderer imports no `@earendil-works/pi-*`. The IPC
  contract is a set of **hand-authored serializable DTOs** in `src/shared/ipc.ts` (imported by both
  sides). Main maps pi's `AgentSessionEvent` → `IpcAgentEvent`; the renderer only knows the DTOs.

## 2. Repository layout

```
apps/desktop/
  package.json            # standalone pnpm project; NOT in root workspaces
  pnpm-lock.yaml
  electron.vite.config.ts # electron-vite: main / preload / renderer builds
  electron-builder.yml    # packaging (win) — build target
  tsconfig.json           # references the three below
  tsconfig.node.json      # main + preload (Node16-ish, ES2022)
  tsconfig.web.json       # renderer (Bundler resolution, DOM, react-jsx)
  biome.json              # local: tab/width3/line120/double-quote (matches repo)
  .gitignore              # out/, dist/, node_modules/
  src/
    shared/
      ipc.ts              # channel names + DTO types (the contract; pi-free)
    main/
      index.ts            # app/window bootstrap, frameless BrowserWindow
      window.ts           # window controls + drag region IPC
      agent/
        manager.ts        # AgentSessionManager: create/replace/dispose session
        bridge.ts         # subscribe → map → webContents.send; ipcMain handlers
        approval.ts       # in-process pi extension (tool_call gate) via IPC
        mappers.ts        # AgentSessionEvent/AgentMessage → IpcAgentEvent DTO
        auth.ts           # AuthStorage + ModelRegistry wiring, API-key persistence
    preload/
      index.ts            # contextBridge: window.pi typed API
    renderer/
      index.html
      main.tsx
      App.tsx
      state/
        chatReducer.ts    # event → state (mirrors interactive-mode handleEvent)
        useAgent.ts       # subscribes to window.pi.onEvent, dispatches
      styles/
        tokens.css        # DESIGN.md colors/radius/shadow/space as CSS vars
        base.css          # resets, typography, theme[data-theme]
        fonts.css         # @font-face (serif/sans/mono, local woff2)
      components/
        Titlebar.tsx          # frameless drag region + min/max/close
        Composer.tsx          # multiline input, history, send/abort
        MessageList.tsx       # virtualized transcript
        UserBubble.tsx
        AssistantBubble.tsx   # ordered text + thinking blocks
        ThinkingBlock.tsx     # collapsible, dim/italic
        Markdown.tsx          # markdown render (warm theme)
        ToolCard.tsx          # keyed by toolCallId; pending/success/error
        DiffView.tsx          # edit/write diffs (added/removed/context)
        BashCard.tsx          # command + streamed output + exit status
        ApprovalDialog.tsx    # Allow/Deny for bash/edit/write
        SettingsPanel.tsx     # API key, model, thinking level, cwd picker
        Banners.tsx           # error / retry-countdown / compaction
        Footer.tsx            # cwd · git? · model · thinking · tokens
      assets/fonts/...
```

`apps/` is a new top-level dir; not referenced by root `package.json` scripts, `biome.json`
includes, or `tsconfig.json` paths, so root `npm`/`check`/`release` are unaffected.

## 3. Build & tooling

- **Scaffolder**: `electron-vite` (provides main/preload/renderer with Vite HMR and correct Electron
  externalization). React via `@vitejs/plugin-react`.
- **Package manager**: pnpm. `apps/desktop` has its own `pnpm-lock.yaml` + `node_modules`. Deps pinned
  exact (matches repo `.npmrc save-exact=true` spirit). Add an `.npmrc` with `save-exact=true`.
- **Depending on pi**: `"@earendil-works/pi-coding-agent": "file:../../packages/coding-agent"`.
  - **Prerequisite**: the monorepo packages must be built (`npm run build` at repo root) so
    `packages/coding-agent/dist` exists — the SDK is consumed from `dist`, not `src`.
  - pi is pure ESM; main process is ESM. electron-vite builds main as ESM/CJS as configured; we keep
    main ESM. pi (and its transitive `pi-agent-core`/`pi-ai`) are **externalized** (not bundled) in
    the main build so their Node deps and `child_process` work; they ship in `node_modules`.
- **tsconfigs**:
  - `tsconfig.web.json` (renderer): `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`,
    `lib: [ES2022, DOM, DOM.Iterable]`, `types: [vite/client]`. Does **not** extend
    `tsconfig.base.json` (which is Node16 + `allowImportingTsExtensions` — wrong for the browser).
  - `tsconfig.node.json` (main/preload): `module: ESNext`/`Node16`, `target: ES2022`, `types: [node]`.
- **Node/Electron**: pick an Electron whose bundled Node ≥ 22.19.0 (pi engine floor). Verify at scaffold
  time; choose latest stable Electron (Node 22+).
- **Scripts**: `pnpm dev` (electron-vite dev, HMR), `pnpm build` (electron-vite build), `pnpm package`
  (electron-builder win), `pnpm typecheck`, `pnpm lint` (local biome).
- **Windows note**: spawning bash/fd/rg happens inside pi from the main process; ensure cwd handling is
  Windows-safe. pi resolves these itself; no extra work expected beyond verifying at runtime.

## 4. Main process design

### 4.1 Session lifecycle (`agent/manager.ts`)
- `AgentSessionManager` owns the current `AgentSession`.
- Create with explicit, controlled config:
  ```
  createAgentSession({
    cwd: <chosen working dir>,
    model, thinkingLevel,
    authStorage, modelRegistry,
    tools: ["read","bash","edit","write","grep","find","ls"],
    sessionManager: SessionManager.inMemory(cwd),   // v1: single in-memory conversation
    resourceLoader: <DefaultResourceLoader with approval extensionFactory>,
  })
  ```
- **New/Clear** = dispose current session, create a fresh one (same cwd/model). (No persistence in v1.)
- **Change cwd / model** = recreate the session (simplest correct approach for v1) OR `setModel` for
  model-only change. cwd change requires a new session (tools are cwd-bound). Re-subscribe after replace.
- `dispose()` on window close.

### 4.2 Auth & models (`agent/auth.ts`)
- `AuthStorage.create()` → persists to `~/.pi/agent/auth.json` (key survives restart). Optionally use a
  custom app-scoped path (`AuthStorage.create(app.getPath('userData')+'/auth.json')`) to isolate from
  the user's CLI pi — **decision: use the default `~/.pi/agent` path** so the desktop app and CLI share
  credentials (least surprise). Revisit if isolation is wanted.
- Set key from UI: `authStorage.setRuntimeApiKey("anthropic", key)` for the live session, and persist
  via AuthStorage's API-key store so it survives restart.
- Models: `ModelRegistry.create(authStorage)`; `getAvailable()` → list to the UI; default model =
  Anthropic Opus/Sonnet if available, else first available. `getModel("anthropic", id)` for selection.

### 4.3 Approval gate (`agent/approval.ts`) — the R6 mechanism
- pi's `AgentSession` installs `agent.beforeToolCall` that **delegates to the extension runner's
  `tool_call` handlers** (verified at `agent-session.ts:404`). The intended extension point is therefore
  an **extension**, not overwriting `agent.beforeToolCall` (which would clobber that delegation).
- Implement as an **in-process extension factory** passed to `DefaultResourceLoader`:
  ```
  new DefaultResourceLoader({
    cwd, agentDir,
    extensionFactories: [(pi) => {
      pi.on("tool_call", async (event) => {
        const MUTATING = new Set(["bash","edit","write"]);
        if (!MUTATING.has(event.toolName)) return undefined;        // auto-run read-only
        const ok = await requestApprovalViaIpc(event.toolName, event.input, event.toolCallId);
        return ok ? undefined : { block: true, reason: "Denied by user" };
      });
    }],
  })
  ```
- `requestApprovalViaIpc`: main sends `pi:approval:request` to renderer with
  `{ id, toolName, input }`; renderer shows `ApprovalDialog`; user choice returns via
  `pi:approval:resolve` `{ id, allow }`. Main resolves a pending Promise keyed by `id`. Reference:
  pi's `examples/extensions` `permission-gate.ts` (same pattern, TUI confirm swapped for our IPC dialog).
- `{ block: true }` makes the loop emit an error tool result; the agent continues. Abort during a
  pending approval rejects the prompt → resolve as denied.

### 4.4 Event bridge (`agent/bridge.ts` + `mappers.ts`)
- `session.subscribe(ev => webContents.send("pi:event", mapEvent(ev)))`.
- `mapEvent` converts pi `AgentSessionEvent` → `IpcAgentEvent` DTO (JSON-safe; strips functions, keeps
  only fields the UI needs; for `message_*` includes the message id, role, and ordered content blocks).
- ipcMain handlers: `pi:prompt`, `pi:abort`, `pi:setModel`, `pi:setThinking`, `pi:newSession`,
  `pi:chooseCwd` (opens `dialog.showOpenDialog`), `pi:setApiKey`, `pi:listModels`, `pi:getState`.

## 5. IPC contract (`src/shared/ipc.ts`)

Hand-authored, pi-free DTOs. Sketch:

```ts
export type IpcContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string; redacted?: boolean }
  | { kind: "toolCall"; id: string; name: string; args: unknown };

export interface IpcMessage {
  id: string;
  role: "user" | "assistant";
  content: IpcContentBlock[];
  ts: number;
}

export interface IpcToolResult {
  toolCallId: string; toolName: string;
  content: Array<{ kind: "text"; text: string } | { kind: "image"; dataUrl: string }>;
  details?: { diff?: string; patch?: string; exitCode?: number; [k: string]: unknown };
  isError: boolean;
}

export type IpcAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; willRetry: boolean }
  | { type: "turn_start" } | { type: "turn_end" }
  | { type: "message_start"; message: IpcMessage }
  | { type: "message_update"; message: IpcMessage }   // FULL partial → replace
  | { type: "message_end"; message: IpcMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partial: unknown }
  | { type: "tool_execution_end"; toolResult: IpcToolResult }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number }
  | { type: "auto_retry_end"; success: boolean }
  | { type: "compaction_start" } | { type: "compaction_end" }
  | { type: "error"; message: string };

export interface ApprovalRequest { id: string; toolName: string; input: unknown }
export interface PiApi {
  send(text: string): Promise<void>;
  abort(): Promise<void>;
  newSession(): Promise<void>;
  setModel(provider: string, id: string): Promise<void>;
  setThinking(level: ThinkingLevelDto): Promise<void>;
  chooseCwd(): Promise<string | null>;
  setApiKey(provider: string, key: string): Promise<void>;
  listModels(): Promise<ModelInfoDto[]>;
  getState(): Promise<AppStateDto>;
  onEvent(cb: (e: IpcAgentEvent) => void): () => void;
  onApproval(cb: (r: ApprovalRequest) => void): () => void;
  resolveApproval(id: string, allow: boolean): void;
  window: { minimize(): void; toggleMaximize(): void; close(): void };
}
```

## 6. Renderer state model (`state/chatReducer.ts`)

Mirrors `interactive-mode.ts handleEvent`:
- State: `{ messages: IpcMessage[], tools: Map<toolCallId, ToolCardState>, streaming: boolean,
  error?, retry?, compacting?, queue? }`.
- `message_start(assistant)` → push streaming bubble. `message_update` → **replace** that message's
  content (event carries full partial — never append). `message_end` → finalize.
- `message_start(user)` → push user bubble.
- `tool_execution_start` → upsert `ToolCardState{status:"pending", name, args}` keyed by `toolCallId`.
  `tool_execution_update` → merge partial. `tool_execution_end` → set status from `isError`, attach
  `toolResult` (diff/exit/images). Tool cards render **inline within the assistant bubble** at the
  position of their `toolCall` block (matched by id); `toolResult` is never a standalone bubble.
- Banners from `auto_retry_*`, `compaction_*`, `error`. Composer disabled (abort-enabled) while `streaming`.

## 7. Design system (DESIGN.md is the law) — `styles/tokens.css`

All values copied **verbatim** from `DESIGN.md`. CSS variables, theme-switched via `[data-theme]`.

- **Color** (light defaults): `--bg:#f5f4ed` (Parchment), `--surface:#faf9f5` (Ivory),
  `--surface-2:#e8e6dc` (Warm Sand), `--brand:#c96442` (Terracotta), `--coral:#d97757`,
  `--text:#141413`, `--text-2:#5e5d59` (Olive), `--text-3:#87867f` (Stone), `--text-link:#3d3d3a`,
  `--border:#f0eee6` (Cream), `--border-strong:#e8e6dc`, `--ring:#d1cfc5`, `--ring-deep:#c2c0b6`,
  `--error:#b53333`, `--focus:#3898ec`.
  Dark theme: `--bg:#141413`, `--surface:#30302e`, `--text:#faf9f5`, `--text-2:#b0aea5`,
  `--border:#30302e`. Tool states reuse warm tints (pending sand, success faint green, error crimson@low).
- **Typography**: serif headlines weight **500 only** (Fraunces/Newsreader → "Anthropic Serif/Georgia"),
  Inter for UI sans, warm mono for code. Sizes/line-heights from DESIGN.md §3 table (hero 64/1.10,
  section 52/1.20, body 16–17/1.60, etc.). Body line-height 1.60. Label letter-spacing 0.12px.
- **Radius scale**: 4 / 6 / 8 / 12 / 16 / 24 / 32 (DESIGN.md §5). Buttons 8–12, cards 8/16, hero 32.
- **Shadows**: ring `0 0 0 1px var(--ring)`; whisper `rgba(0,0,0,0.05) 0 4px 24px`; **no** generic drop
  shadows. Inputs focus: ring + `--focus` border (the only cool moment).
- **Spacing**: 8px base; scale 3/4/6/8/10/12/16/20/24/30. Container max ~1200px. Generous section
  rhythm. Card padding 24–32.
- **Buttons**: Brand Terracotta (primary CTA, ivory text, ring), Warm Sand (secondary), White Surface,
  Dark Charcoal — per DESIGN.md §4.
- **Do/Don't enforced**: no cool blue-grays, no bold serif, no saturated colors beyond terracotta, no
  sharp corners (<6px) on buttons/cards, no pure-white page bg, body line-height ≥1.4.
- **Fonts bundled** as local `woff2` (no FOUT, offline). `fonts.css` `@font-face` + `font-display:swap`.

### Frameless window (R4)
- `BrowserWindow({ frame:false, titleBarStyle:"hidden", backgroundColor:"#f5f4ed" })`.
- `Titlebar.tsx`: full-width warm bar, `-webkit-app-region: drag`, controls `no-drag`; min/max/close via
  `window.pi.window.*` IPC. Height ~40px; brand wordmark left, settings/cwd right.

## 8. Visual layout (the "wow")

Single-column editorial chat on Parchment, centered ~760px reading column:
- Frameless warm titlebar (drag) with wordmark + working-dir chip + settings.
- Transcript: user bubbles (Warm Sand, right-aligned compact) vs assistant (no bubble, serif-tinged
  editorial text on parchment with generous line-height — like reading an essay). Thinking blocks dim
  italic, collapsed by default. Tool cards = Ivory cards with ring shadow, terracotta accent on the
  tool name, monospace body, diff in warm green/crimson tints.
- Composer: Ivory rounded-16 input with ring shadow, terracotta send button; turns into "Stop" while
  streaming. Empty state: a centered serif greeting + subtle organic flourish.
- Settings as a slide-over panel (Ivory, whisper shadow), not a modal jarring the canvas.

## 9. Sequence: a prompt with an approved edit

1. Renderer `pi.send(text)` → ipcMain → `session.prompt(text)`.
2. Events stream: `agent_start` → `message_start(assistant)` → `message_update`×N (text/thinking) →
   `message_update` adds a `toolCall` block (edit) → `tool_execution_start`.
3. Approval extension `tool_call` fires (edit ∈ mutating) → main sends `pi:approval:request` →
   renderer `ApprovalDialog` → user Allow → `resolveApproval(id,true)` → handler returns `undefined`.
4. Tool executes → `tool_execution_end` with `details.diff` → `DiffView` in the tool card.
5. `turn_end` → model may continue or `agent_end`. Composer re-enabled.
(If Deny: handler returns `{block:true,reason}` → error tool result card → agent continues.)

## 10. Tradeoffs, risks, rollback

- **In-process SDK vs RPC subprocess**: chose in-process for type safety + direct state + simpler
  streaming. Risk: an agent crash can affect main. Mitigation acceptable for v1; RPC (`RpcClient`) is a
  documented fallback if isolation becomes necessary (swap `agent/manager.ts` impl; IPC contract stays).
- **cwd change recreates session**: simple + correct (tools are cwd-bound); loses in-memory transcript.
  Acceptable for v1 single-conversation model; surface a confirm before recreating.
- **Shared `~/.pi/agent` auth**: convenient but couples to CLI pi. Switchable to app-scoped path later.
- **DefaultResourceLoader discovery**: with cwd = a pi repo, project `.pi/extensions` would load. For a
  generic agent this is usually fine; if undesired, pass a minimal custom `ResourceLoader` (still adding
  our approval factory). v1 uses DefaultResourceLoader for capability; note as a knob.
- **Prerequisite build**: requires `packages/coding-agent/dist`. Document in app README; `pnpm dev`
  should fail fast with a clear message if dist is missing.
- **Rollback**: the app is additive (`apps/desktop` only); deleting the dir fully reverts. No changes to
  existing packages or root config.
