# Implementation plan — Concurrent multi-session support

> Status: **planned, not started.** Do not `task.py start` until the user asks to execute. Build on a feature
> branch off `main`. Keep `typecheck`/`lint`/`test`/`build` green at every step.

Context order for implement/check: jsonl entries → `prd.md` → `design.md` → this file.

## Phase 0 — Scaffolding the boundary (no behavior change yet)
- [ ] 0.1 Add `sessionId` to the IPC contract (`src/shared/ipc.ts`): wrap forwarded events as
      `{ sessionId, event }`, tag `ApprovalRequest`, add `SessionSummaryDto`, extend `AppStateDto` with
      `sessions: SessionSummaryDto[]` + `activeId`. Add request methods `openSession`, `closeSession`,
      `setActive`, and `sessionId` params to `send/abort/getStats/getTranscript/setModel/setThinking/compact/
      listCommands`.
- [ ] 0.2 Mirror the new surface in `src/preload/index.ts`.
- Validate: `npm run typecheck` (renderer/main will have type errors until wired — keep this commit on a WIP
  branch or land 0.x together with Phase 1/3).

## Phase 1 — Extract `SessionController` (main)
- [ ] 1.1 Create `src/main/agent/sessionController.ts`: move per-session state out of `AgentManager` —
      `session`, `unsubscribe`, the coalescer (`updateTimer`/`flushPendingUpdate`/`pendingUpdate`), `opChain`,
      `pendingApprovals`, `sessionAllow`, cwd + `SettingsManager`, current model/thinking, `buildSession`,
      `teardown`, `prompt` (build-under-lock/turn-outside), `abort`, `getStats`, `getTranscript`,
      `maybeTitleSession`, `setModel`, `setThinking`, `compact`, `listCommands`, `dispose`.
- [ ] 1.2 Controller emits via injected callbacks `onEvent(sessionId, e)` / `onApproval(sessionId, req)`.
- [ ] 1.3 Unit-test what's pure-ish (coalescer flush ordering with a fake clock; `maybeTitleSession` apply
      guard). Reuse the extracted `titleUtils`/`mappers` tests as the model.
- Validate: `npm run typecheck && npm run test`.

## Phase 2 — `SessionPool` (main) + bridge wiring
- [ ] 2.1 Create `src/main/agent/sessionPool.ts`: `Map<sessionId, SessionController>`, shared
      `AuthBundle`/`ModelRegistry`/`SettingsManager` cache + global `mode`; `seq`-based id; `path → id` map.
- [ ] 2.2 Methods: `ensure(pathOrCwd) → id`, `newInCwd(cwd) → id`, `running(id)`, `close(id)`, `delete(id)`,
      `setActive(id)`, `listSessions()` (merge on-disk via `SessionManager.listAll` with live controllers),
      `getState()` (app-level + `sessions`/`activeId`).
- [ ] 2.3 **Cap + park policy**: `MAX_LIVE`; on overflow park LRU idle non-running controller (dispose
      session, keep `sessionFile`); never park/evict a running one; if all live are running, refuse + emit a
      visible message. Serialize pool map mutations behind a pool-level lock.
- [ ] 2.4 Move OS `notify()` here: fire on a controller's `agent_end`/approval when its id ≠ focused id.
- [ ] 2.5 Rewrite `bridge.ts` to route id-carrying IPC to the pool/controller and forward
      `{sessionId, event}` / `{sessionId, request}`; add `setActive`, `closeSession`.
- [ ] 2.6 `index.ts`: construct the pool (was `AgentManager`); `dispose()` tears down all controllers.
- Validate: `npm run typecheck && npm run lint && npm run build`. Manual: single-session flows still work
  (regression — the pool with one entry must behave like today).

## Phase 3 — Renderer multi-state
- [ ] 3.1 `src/renderer/src/state/useSessions.ts`: registry of per-`sessionId` `ChatState` slices (reuse
      `chatReducer` per slice) + `activeId`; one `onEvent` subscription dispatches `{sessionId,event}` to the
      right slice (even when inactive). `send` targets `activeId`.
- [ ] 3.2 `App.tsx`: replace `useAgent` with `useSessions`; wire `setActive` on session select; render
      `ChatView` for `slices[activeId]`; keep `StatusBanners`/empty-state per active slice.
- [ ] 3.3 `SessionSidebar`: per-session **running spinner** + **unread dot** (slice advanced while inactive);
      click → `setActive` (+`openSession`); keep stable project ordering + the retitle sweep.
- [ ] 3.4 Composer/usage/model-pill/mode read the active session.
- Validate: `npm run typecheck && npm run lint && npm run build`.

## Phase 4 — Approvals across sessions
- [ ] 4.1 Per-session approvals queue in the renderer; active session's pending approval → inline
      `ApprovalDialog`; background pending → sidebar badge + notification.
- [ ] 4.2 Focusing a session with a queued approval presents it; decision routes back with `sessionId`.
- [ ] 4.3 Edge: deleting/closing a session resolves its pending approvals to "deny" and clears its badge.
- Validate: manual — background session hits a bash gate; active session keeps streaming; badge+notification
  appear; focusing presents it.

## Phase 5 — Hardening + acceptance
- [ ] 5.1 Walk every AC in `prd.md`; add/adjust tests where pure.
- [ ] 5.2 Confirm no `@earendil-works/pi-*` import under `src/renderer/**` (grep).
- [ ] 5.3 Confirm no leaked subscription/timer across park/delete/switch (instrument counts in dev).
- [ ] 5.4 Full gate: `npm run typecheck && npm run lint && npm run test && npm run build` green.
- [ ] 5.5 Update `06-15-desktop-app/implement.md` feature log + the auto-memory with the final shape.

## Validation commands
- `cd apps/desktop`
- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build`
- `npm run dev` for manual concurrency checks (two sessions streaming).

## Review gates
- After Phase 2: confirm the single-session regression (pool-of-one behaves like today) before building the
  renderer multi-state.
- After Phase 4: confirm approval UX across sessions with the user (security-sensitive surface).

## Rollback points
- Each phase is a separate commit on the feature branch; revert to the prior phase if a regression appears.
- The IPC `sessionId` change (Phase 0) lands together with Phases 1–3 (renderer+main move in lockstep);
  keep them on the branch until green so `main` is never half-migrated.
- Whole feature reverts by dropping the branch; JSONL session files are untouched/compatible.

## Risky files
- `manager.ts` → `sessionController.ts`/`sessionPool.ts`: the audit's per-session invariants (opChain,
  coalescer ordering/flush, cleanup) must be preserved per controller — re-verify they hold after the extract.
- `bridge.ts`/`ipc.ts`/`preload`: the id must be threaded consistently; a missing `sessionId` silently routes
  to the wrong slice.
- Renderer `useSessions`: background slices must update without re-rendering the whole app each tick (keep the
  per-bubble memo + `ViewContext` memo wins from the audit).
