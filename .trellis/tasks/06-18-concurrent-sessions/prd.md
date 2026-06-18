# Concurrent multi-session support

## Goal

Let the desktop app run **multiple chat sessions at the same time** — e.g. start a turn in session A, switch
to session B and start a turn there, and have both stream and complete independently in the background —
instead of today's single-active-session model where switching sessions disposes the current one and aborts
its in-flight turn.

## Background (current state — why this is non-trivial)

The app is single-active-session by construction:
- One `AgentManager` (`src/main/agent/manager.ts`) owns a single `this.session` plus single-instance
  per-session state: `unsubscribe`, the streaming coalescer (`updateTimer` / `flushPendingUpdate`),
  `currentSessionFile`, `pendingApprovals`, `sessionAllow`, and the `opChain` lifecycle lock.
- `switchSession` calls `teardown()` (disposes the session, unsubscribes) then `buildSession()` — so opening
  another chat destroys the live one; a torn-down session's in-flight `prompt()` rejection is swallowed.
- The renderer holds **one** `ChatState` (`chatReducer` via `useAgent`); IPC events are global (no session
  id); the `ApprovalDialog` is a single global overlay.

Concurrency therefore requires turning "the one live session" into "a pool of live sessions" and threading a
**session id** through IPC and the renderer.

## Requirements

### Functional
- R1. Multiple sessions can be **live (in memory) and running concurrently**. A turn started in one session
  keeps running when the user switches the active view to another session.
- R2. The user can **start a new turn in session B while session A is still streaming**; both progress
  independently and persist correctly to their own JSONL files (shared with the pi CLI).
- R3. Switching the active view to a session shows its **current, up-to-date** state (live partials included),
  whether it was running in the background or idle.
- R4. The sidebar shows a **per-session running indicator** (and ideally an "updated/unread" hint for a
  background session that produced new output since you last viewed it).
- R5. **Background completion** fires an OS notification when the window/that session isn't focused (reuse the
  existing `Notification` path); clicking focuses the app and that session.
- R6. A **tool approval requested by a background session** does not block the active session; it is surfaced
  (badge + notification) and presented when the user focuses that session (or via an approvals queue).
- R7. **Deleting / closing a running session aborts it** cleanly (no leaked subscription, no wrong-session
  paint, no dangling timers).

### Non-functional / constraints
- C1. **Preserve the hard architecture rule**: pi SDK stays in main only; the renderer stays pi-free and talks
  over the typed IPC contract in `src/shared/ipc.ts`. The session id and per-session DTOs are plain
  serializable values.
- C2. **Preserve the concurrency invariants** from the audit: per-session serialization (no interleaved
  build/teardown), the streaming coalescer's ordering/flush guarantees, and no subscription/timer leaks — now
  enforced **per session** rather than globally.
- C3. **Bounded resource use**: N live sessions = N subscriptions + N model contexts in memory. Cap the number
  of concurrently *live* sessions and define what happens beyond the cap (park idle/non-running sessions;
  resumable from JSONL). Never silently drop a running session.
- C4. Keep `typecheck` / `lint` / `build` / `test` green; keep the pi-citizen config model (per-session cwd,
  shared auth/model registry/settings) intact.

## Acceptance Criteria

> Status legend: [x] = verified; [~] = implemented + smoke-verified token-free, but the live streaming path
> needs an API-spending two-stream run to fully confirm (deferred to avoid spending the user's tokens).

- [~] AC1. Concurrent streaming: per-session controllers (own coalescer/op-lock) + a useSessions slice per
      sessionId routed by the wrapped event stream. Token-free verified: boot adopts the active session,
      switching A↔B loads each session's own transcript. The two-simultaneous-streams path is in place by
      construction; a live run needs API tokens.
- [~] AC2. Sidebar shows a per-session running spinner (driven by the live slice's `streaming`); the pool
      fires an OS notification on a background session's `agent_end`. Badge verified token-free; notification
      firing needs a live background turn.
- [~] AC3. Background approvals: per-session approval queues; only the ACTIVE session's first approval shows
      inline (ApprovalDialog), background ones show a sidebar badge — so a background gate never blocks the
      active view; resolve routes back with sessionId. Needs a live bash gate to confirm end-to-end.
- [~] AC4. Deleting a session aborts + disposes its controller (clears timer/subscription/approvals) and
      removes its slice; if active, the renderer adopts main's fallback. Token-free path verified.
- [~] AC5. Cap + park: MAX_LIVE=6; opening beyond the cap parks the LRU idle, non-running, non-active
      controller (disposes its AgentSession, keeps `sessionFile` to resume); a running session is never
      parked; if all are running it stays over-cap and logs. Logic in `sessionPool.parkForCapacity`.
- [x] AC6. `npm run typecheck && npm run lint && npm run test && npm run build` all green (30 tests, incl. the
      slice-routing reducer); grep confirms no `@earendil-works/pi-*` import under `src/renderer/**`.

## Out of scope (this iteration)

- Tabbed / split-pane UI or multiple windows — v1 keeps the single chat view + a "running" sidebar; multi-view
  layout is a possible follow-up.
- Cross-session shared context or hand-off between sessions.
- Unlimited concurrency (the cap is intentional).
- Per-session permission *mode* divergence if it complicates the model — mode may stay a global app setting
  while the **approval allowlist** is already per-session.

## Open questions (resolve in design)

- Q1. Session identity for not-yet-persisted chats: generate a stable in-memory id at creation and map it to
  the JSONL path once pi writes it (pi persists on first `message_end`).
- Q2. Refactor shape: extract a `SessionController` (per-session) + `SessionPool` (owns the map + shared
  resources), vs. key every field of `AgentManager` by id. (Design leans `SessionController` + pool.)
- Q3. Approval UX for background sessions: queue-and-present-on-focus vs. a global approvals tray.
- Q4. Live-session cap value and the park/evict policy (LRU over idle non-running sessions).

## Notes
- Child of `06-15-desktop-app`. **Planned now but intentionally NOT implemented yet** — other polish work
  proceeds first. Do not `task.py start` until the user asks to execute it.
