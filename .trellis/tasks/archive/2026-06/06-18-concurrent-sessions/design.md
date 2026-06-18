# Design — Concurrent multi-session support

## 1. Architecture overview

Turn the single live session into a **pool of live sessions**, and thread a **session id** through the IPC
boundary and the renderer.

```
                 main process                                  renderer (pi-free)
  ┌─────────────────────────────────────────┐      ┌────────────────────────────────────┐
  │ SessionPool                              │      │ useSessions()                      │
  │  - shared: AuthBundle, ModelRegistry,    │ IPC  │  - Map<sessionId, ChatState>       │
  │    SettingsManager cache, permission mode│◄────►│  - activeId (focused view)         │
  │  - Map<sessionId, SessionController>     │ +id  │  - running/unread flags per id     │
  │  - cap + park/evict policy               │      │ ChatView renders state[activeId]   │
  │                                          │      │ Sidebar shows per-id running badge │
  │  SessionController (one per live session)│      │ ApprovalTray routes by sessionId   │
  │   - AgentSession, unsubscribe            │      └────────────────────────────────────┘
  │   - per-session coalescer (timer+flush)  │
  │   - per-session opChain, approvals,      │
  │     sessionAllow, cwd/settings/model     │
  └─────────────────────────────────────────┘
```

Core move: extract today's per-session logic from `AgentManager` into a **`SessionController`** class, and
make `AgentManager` (or a new `SessionPool`) a thin owner of `Map<sessionId, SessionController>` + the shared,
process-wide resources. This keeps each session's invariants (the audit's `opChain` serialization, the
streaming coalescer ordering/flush, subscription/timer cleanup) **intact but scoped per controller**.

## 2. Session identity (Q1)

- Each live session gets a stable **`sessionId: string`** assigned by the pool at creation (e.g.
  `s${++seq}` — deterministic, no `Math.random`/`Date.now` concerns in main are fine, but a simple counter is
  enough and test-friendly).
- pi writes the JSONL only on the first `message_end`, so `sessionFile` starts undefined. The controller
  tracks `sessionFile` and the pool maintains `path → sessionId` so `listSessions` / opening an on-disk
  session can resolve to an existing live controller or create one.
- The renderer keys everything by `sessionId` (NOT by file path, which is late-bound). DTOs that today use a
  path (e.g. `SessionInfoDto.path`, `activePath`) gain a `sessionId` and the renderer prefers it.

## 3. IPC contract changes (`src/shared/ipc.ts`)

Make session-scoped channels carry `sessionId`, and tag every event with the session it came from.

- **Requests** (preload `window.pi.*` + `bridge.ts` handlers): `send(sessionId, text, images?)`,
  `abort(sessionId)`, `getStats(sessionId)`, `getTranscript(sessionId)`, `setModel(sessionId,…)`,
  `setThinking(sessionId,…)`, `compact(sessionId)`, `listCommands(sessionId)`. New:
  `openSession(pathOrId) → sessionId` (ensures a live controller, returns its id — replaces today's
  `switchSession`, which conflated "make live" with "focus"), `newChatInCwd(cwd) → sessionId`,
  `closeSession(sessionId)` (park/dispose without deleting the file), `deleteSession(sessionId)`.
- **Events** (`IPC.event`): wrap as `{ sessionId, event: IpcAgentEvent }` (or add `sessionId` to each variant).
  Same for `IPC.approvalRequest` → `{ sessionId, request }` and the resolve channel
  `approvalResolve(sessionId, id, decision)` and `session_renamed` (already has `path`; add `sessionId`).
- **App/global** stays global: `getState` (app-level: model defaults, mode, hasModel, appDir), settings,
  proxy, provider/key management, window controls. `AppStateDto` gains `sessions: SessionSummaryDto[]`
  (id, title, cwd, project, running, sessionFile?, hasPendingApproval, unread) and `activeId`.

Renderer routing: a single `window.pi.onEvent` subscription dispatches `{sessionId, event}` to the matching
per-session reducer slice; `onApproval` routes to a per-session approvals queue.

## 4. Main process

### 4.1 `SessionController` (new — most of current `manager.ts` per-session code)
Owns exactly one session and everything tied to it:
- `session: AgentSession`, `unsubscribe`, `sessionFile`.
- Streaming coalescer: `updateTimer`, `flushPendingUpdate`, `pendingUpdate` (today single fields → now
  per-controller instance fields; this directly fixes the "single coalescer" limitation).
- `opChain` (per-session serialization lock) + `buildSession`/`teardown`/`prompt` (build under lock, turn
  outside — unchanged logic, just per controller).
- Approvals: `pendingApprovals`, `sessionAllow`, `requestApproval` — per controller.
- cwd + `SettingsManager` for that session; current model/thinking for that session.
- Emits up to the pool via a callback `(sessionId, IpcAgentEvent)` and `(sessionId, ApprovalRequest)`.
- `getStats()`, `getTranscript()`, `dispose()`.

### 4.2 `SessionPool` (new — replaces the single-session ownership in `AgentManager`)
- Holds `Map<sessionId, SessionController>` + shared `AuthBundle` / `ModelRegistry` / a `SettingsManager`
  cache keyed by cwd + the global permission `mode`.
- `ensure(pathOrCwd, opts) → sessionId`: returns an existing controller for a known path, else creates one
  (respecting the cap). `running(sessionId)`, `close(sessionId)` (dispose controller, keep file),
  `delete(sessionId)` (abort+dispose+rm file).
- **Cap + park policy (C3, Q4):** `MAX_LIVE` (e.g. 6) controllers. Opening beyond the cap **parks** the
  least-recently-used **idle, non-running** controller (dispose its `AgentSession` but remember its
  `sessionFile` so re-opening resumes from JSONL). A **running** controller is never parked/evicted; if all
  live are running and the cap is hit, refuse to open a new live one and surface a clear message (never drop a
  run). `log()`/event the park so it's visible (AC5).
- Forwards each controller's events to the renderer tagged with `sessionId` (the existing `notify()` OS-
  notification logic moves here, firing on a background session's `agent_end` / approval when that session
  isn't the focused one — needs the renderer to report `activeId`, or the pool tracks "focused" via an IPC
  `setActive(sessionId)`).

### 4.3 `bridge.ts`
Thin wiring updated to pass `sessionId` to the pool/controller and to wrap forwarded events/approvals with
their `sessionId`. Adds `setActive(sessionId)` so the main process knows which session is focused (drives
notification suppression and could drive cap "recently-used").

## 5. Renderer (pi-free)

- **State:** replace the single `useAgent` reducer with `useSessions()` — a registry of per-session
  `ChatState` (reducer slices keyed by `sessionId`) + `activeId`. Each `{sessionId,event}` updates that
  session's slice even when it's not active, so switching shows current state (R3). The main `ChatView`
  renders `slices[activeId]`.
- **Sidebar:** per-session **running spinner** + an **unread dot** for a background session whose slice
  advanced since last focus (R4). Clicking a session → `setActive(id)` (+ `openSession` if not live).
- **Composer:** sends to `activeId`. Token usage / model pill / mode reflect the active session.
- **Approvals:** a per-session approval queue. The active session's pending approval shows inline
  (`ApprovalDialog`); background sessions with a pending approval show a sidebar **badge** + fire a
  notification; focusing such a session presents its queued approval (R6, Q3). Decision routes back with
  `sessionId`.

## 6. Lifecycle, locks, and the audit invariants (C2)

- Each `SessionController` keeps its **own** `opChain`; the pool's create/park/delete operations are
  serialized at the pool level (a small pool-level lock) so the map mutations don't race.
- The streaming coalescer is now per controller, so there is no cross-session timer/flush interference — this
  is the concrete fix for today's single-instance `updateTimer`/`flushPendingUpdate`.
- `teardown`/`dispose` per controller clears its timer, unsubscribes, disposes the session, clears its
  approvals (resolving pending ones to "deny") — same cleanup as today, scoped.

## 7. Edge cases & failure modes

- **Delete the active running session:** abort+dispose it, then fall back to another live session or a fresh
  one (mirror today's `deleteSession → newSession`), update `activeId`.
- **Park a session that later receives a (late) event:** parked controllers are disposed → no events; on
  re-open, rebuild from JSONL. Ensure no forwarded event references a disposed controller (guard by id).
- **Approval starvation:** a background session blocked on approval should not hold resources indefinitely;
  the existing "no approval timeout" is acceptable, but the badge/notification must make it discoverable.
- **Same session opened twice:** `path → sessionId` map dedups; opening an already-live session just focuses
  it.
- **Model/thinking/mode:** model + thinking are per controller; permission **mode** stays a global setting but
  the **allowlist** is per controller (already is).

## 8. Compatibility / rollout / rollback

- Additive under `apps/desktop`; the JSONL/session format is unchanged (pi-citizen), so files stay compatible
  with the pi CLI and with the current single-session build.
- **Rollback:** the change is contained in `manager.ts → SessionController/SessionPool`, `ipc.ts`, `bridge.ts`,
  `preload`, and the renderer state/sidebar/composer. Reverting the commit restores single-session. Suggest a
  feature branch.
- **Migration of the IPC contract is breaking within the app** (renderer⇄main move together in one change);
  no external consumers.

## 9. Tradeoffs / alternatives considered

- **`SessionController` + pool (chosen)** vs. **key every `AgentManager` field by id**: the controller extract
  is more code up-front but keeps each session's invariants encapsulated and testable, and avoids a forest of
  `Map<id, T>` fields that are easy to desync. 
- **Single chat view + running sidebar (chosen for v1)** vs. **tabs/split view**: tabs are a bigger UI lift and
  orthogonal; the background-run capability is the valuable core. Tabs can come later on top of `useSessions`.
- **Unbounded pool** vs. **cap + park (chosen)**: unbounded risks memory blow-up with many live model
  contexts; the cap with park-idle/never-evict-running bounds it without dropping work.

## 10. Touch list (anticipated)

- `src/main/agent/`: new `sessionController.ts`, `sessionPool.ts` (or refactor `manager.ts`); `bridge.ts`,
  `mappers.ts` (event wrapping), maybe `approval.ts`.
- `src/shared/ipc.ts`: session-scoped channels + event/approval `sessionId` + `AppStateDto.sessions/activeId`
  + DTOs (`SessionSummaryDto`).
- `src/preload/index.ts`: id-carrying methods + `setActive`/`closeSession`.
- `src/renderer/src/state/`: `useSessions.ts` (replaces single `useAgent`), `chatReducer.ts` (unchanged per
  slice), approvals queue.
- `src/renderer/src/components/`: `SessionSidebar` (running/unread badges), `App` (active-session wiring),
  `Composer` (sends to active), approval routing.
- Tests: pool cap/park policy, `path→id` dedup, per-controller coalescer isolation (pure-ish units where
  possible).
