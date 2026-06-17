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

- [ ] AC1. Start a turn in A, switch to B before A finishes, start a turn in B → both stream to completion;
      switching A↔B shows each session's own live/finished output; both transcripts persist correctly.
- [ ] AC2. While B streams in the background, the sidebar shows B as "running"; on completion an OS
      notification fires if B isn't the focused session.
- [ ] AC3. A background session that hits a tool-approval gate surfaces a badge/notification and does NOT
      block input or streaming in the active session; approving/denying it resumes only that session.
- [ ] AC4. Deleting a running session aborts it with no console errors, no leaked subscription/timer, and the
      active view is unaffected (unless you deleted the active one, which falls back like today).
- [ ] AC5. With the live-session cap reached, opening another session parks an idle one (resumable) rather
      than dropping a running one; the behavior is visible/logged, never silent.
- [ ] AC6. `npm run typecheck && npm run lint && npm run test && npm run build` all green; no
      `@earendil-works/pi-*` import appears anywhere under `src/renderer/**`.

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
