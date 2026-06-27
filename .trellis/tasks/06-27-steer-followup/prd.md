# Streaming steer / follow-up while a turn is running

## Goal

Let the user keep typing while the agent is mid-turn: a message sent during streaming becomes either a
**steer** (course-correction injected before the next LLM call) or a **follow-up** (queued to run after the
current turn finishes), instead of being silently dropped. The pending queue renders as clearable chips, and
an impatient same-session double-send no longer throws the raw `"Agent is already processing"` string.

## Background

The pi SDK already implements steering/follow-up end to end, but the desktop never wires the trigger across
IPC, so the capability is dark:

- `AgentSession.prompt(text, options)` accepts `streamingBehavior?: "steer" | "followUp"` in `PromptOptions`
  (agent-session.ts:199-210). When the session is streaming, `prompt()` branches on it: with no behavior set it
  **throws** `"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the
  message."` (agent-session.ts:1031-1044); with a behavior it queues via `_queueSteer` / `_queueFollowUp`.
- Public queue API exists: `AgentSession.steer()` (agent-session.ts:1207), `followUp()` (agent-session.ts:1227),
  `clearQueue()` (agent-session.ts:1381, returns the drained `{steering, followUp}` so they can be restored to
  the editor), plus read accessors `getSteeringMessages()` / `getFollowUpMessages()` / `pendingMessageCount`
  (agent-session.ts:1392-1404).
- The SDK emits `queue_update` whenever a queue changes — on enqueue (`_emitQueueUpdate` in `_queueSteer`/
  `_queueFollowUp`, agent-session.ts:1245/1262), on dequeue when a queued user message starts
  (agent-session.ts:484-494), and on clear (agent-session.ts:1387). The event carries
  `{steering: readonly string[]; followUp: readonly string[]}` (agent-session.ts:131-135).
- **The DTO + mapper are already in place but never fire.** `IpcAgentEvent` has
  `{type:"queue_update"; steering: string[]; followUp: string[]}` (ipc.ts:153) and `mapEvent` maps it
  (mappers.ts:147-148) — so the event already crosses IPC tagged with its sessionId. It is always empty because
  **nothing on the desktop ever queues a message**: `SessionController.prompt` calls
  `session.prompt(text, imgs ? { images } : undefined)` with **no `streamingBehavior`** (sessionController.ts:308),
  and the renderer guards against ever calling `send` while streaming.
- **The renderer drops the event.** `chatReducer` has no `queue_update` case, so it hits `default` and returns
  state unchanged (chatReducer.ts:122-123); `ChatState` has no `steering`/`followUp` fields (chatReducer.ts:13-20).
- **The renderer can't even reach the path.** `handleSend` early-returns when `state.streaming` is true
  (App.tsx:335); the Composer disables the send button and ignores Enter while `streaming` (Composer.tsx:171,194).
  So today a user who types during a turn is blocked at the UI; if the guard were merely removed they'd hit the
  raw SDK throw surfaced as an `error` banner (REL-2/REL-3). This is exactly the deferred **CONC-5** ("queue a
  message while a turn is running") from the concurrent-sessions work.

The plumbing chain is `PiApi.send` (ipc.ts:268) → preload (preload/index.ts:22) → `IPC.send` handler
(bridge.ts:50) → `pool.prompt` (sessionPool.ts:287) → `SessionController.prompt` (sessionController.ts:291) →
`session.prompt`. The `streamingBehavior` argument must be threaded through every hop.

## Requirements

- **(SDK-1) Queue a message while a turn is streaming via steer or follow-up.** Thread a
  `streamingBehavior?: "steer" | "followUp"` argument from the renderer's `send` down to
  `AgentSession.prompt({ streamingBehavior })` so a message typed during streaming is enqueued rather than
  dropped or thrown. Value: unlocks the SDK's core interactive capability that the TUI/CLI already have; users
  can redirect a long turn or stack the next task without aborting. Evidence: `PromptOptions.streamingBehavior`
  (agent-session.ts:205), the streaming branch (agent-session.ts:1031-1044), `SessionController.prompt` drops it
  today (sessionController.ts:308), `PiApi.send` signature (ipc.ts:268). sdkSupport: yes-already-in-sdk. Effort: M.

- **(REL-2) Render the pending steer/follow-up queue as clearable chips.** Consume the already-mapped
  `queue_update` event in `chatReducer` (store `steering: string[]` and `followUp: string[]` on `ChatState`),
  and show the pending entries as chips near the composer with a clear control that calls `clearQueue()` (a new
  IPC path), restoring the drained text. Value: the queue is currently invisible — users can't see what they've
  stacked or undo it. Evidence: `queue_update` DTO + mapper exist (ipc.ts:153, mappers.ts:147-148) but
  `chatReducer` has no case (chatReducer.ts:122) and `ChatState` lacks the fields (chatReducer.ts:13-20);
  `clearQueue()` returns the drained queues (agent-session.ts:1381-1389). sdkSupport: yes-already-in-sdk
  (event + clearQueue); needs a new `clearQueue` IPC channel. Effort: M.

- **(REL-3) Default an impatient same-session double-send to follow-up, never the raw throw.** When the user
  hits send while that session is streaming, default the behavior to `"followUp"` (queue the next message) so
  the user is never shown the raw `"Agent is already processing…"` string. Steer remains available as an
  explicit alternative (e.g. a modifier or a small toggle). Value: turns a confusing error into the expected
  "your message is queued" behavior; matches user mental model of a chat box that always accepts input.
  Evidence: the bare throw with no behavior (agent-session.ts:1033-1035); `handleSend` blocks the path entirely
  today (App.tsx:335) and `error` would surface the throw as a banner (chatReducer.ts:120-121). sdkSupport:
  yes-already-in-sdk. Effort: S (sits on SDK-1's plumbing).

## Acceptance Criteria

- [ ] A message sent while the active session is streaming is **queued, not dropped or errored**: it appears in
      the pending chips and is delivered by the SDK (a `queue_update` with the new entry arrives, then a later
      `queue_update` removes it as it is consumed).
- [ ] **Default-to-follow-up:** an ordinary send during streaming enqueues as a follow-up; the raw
      `"Agent is already processing…"` string never reaches the renderer / error banner.
- [ ] **Steer is reachable** as an explicit choice (course-correct before the next LLM call), distinct from
      follow-up.
- [ ] Pending steer + follow-up messages render as **clearable chips**; clearing them calls `clearQueue` over
      IPC and the drained text is restored to the composer input (so nothing is lost).
- [ ] The composer **accepts input while streaming** (Enter / send button no longer hard-blocked) for queueing,
      while still keeping the Stop affordance available.
- [ ] `streamingBehavior` is threaded through every hop: `PiApi.send` (ipc.ts) → preload → `bridge.ts` handler →
      `pool.prompt` → `SessionController.prompt` → `session.prompt(...)`; the new `clearQueue` path is wired the
      same way (ipc.ts channel + DTO if needed, preload, bridge, pool, controller).
- [ ] **Renderer stays pi-free**: no `@earendil-works/pi-*` import under `src/renderer/**`; the new args/fields
      are plain serializable values in `ipc.ts`.
- [ ] Per-session correctness: queueing/clearing routes by `sessionId`; a queue for a background session updates
      its slice only (the `queue_update` already crosses IPC tagged by sessionId via the pool's `forward`).
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` all green (from `apps/desktop`).
- [ ] A `chatReducer` unit test covers the new `queue_update` case (enqueue, dequeue, clear).

## Design hints (for the later design.md)

- **IPC surface (`src/shared/ipc.ts`):** add `streamingBehavior?: "steer" | "followUp"` to `PiApi.send`
  (ipc.ts:268) and the `IPC.send` mapping; add a `clearQueue` channel to `IPC`, a `PiApi.clearQueue(sessionId)`
  method, and decide whether it returns the drained `{steering, followUp}` (mirror `AgentSession.clearQueue`'s
  return at agent-session.ts:1381) so the renderer can restore the text. `queue_update` DTO already exists
  (ipc.ts:153) — no change needed there.
- **Preload (`src/preload/index.ts`):** forward the new arg on `send` (preload/index.ts:22) and add the
  `clearQueue` invoke.
- **Bridge (`src/main/agent/bridge.ts`):** extend the `IPC.send` handler to pass `streamingBehavior` to
  `pool.prompt` (bridge.ts:50-52); add an `ipcMain.handle(IPC.clearQueue, …)` calling `pool.clearQueue`.
- **Pool (`src/main/agent/sessionPool.ts`):** add the arg to `pool.prompt` (sessionPool.ts:287) and a
  `clearQueue(sessionId)` passthrough to the controller.
- **Controller (`src/main/agent/sessionController.ts`):** pass `streamingBehavior` into
  `session.prompt(text, { images, streamingBehavior })` (sessionController.ts:308); add
  `clearQueue()` calling `session.clearQueue()` (agent-session.ts:1381) and return its result. `AgentSession`
  is already imported (sessionController.ts:3), so `steer`/`followUp`/`clearQueue` are reachable typed. Note:
  `prompt` runs through `runExclusive`/`ensureSession` (sessionController.ts:294); queueing during streaming
  does NOT need a fresh build — `session.prompt` short-circuits to the queue while `isStreaming`
  (agent-session.ts:1031), so keep funnelling errors to `onEvent` as today (sessionController.ts:310-313).
- **Reducer (`src/renderer/src/state/chatReducer.ts`):** add `steering: string[]` + `followUp: string[]` to
  `ChatState` (init `[]`), add a `case "queue_update"` that replaces both arrays from the event
  (mirror the `message_update` replace-not-append pattern), and clear them on `_reset`/`_load`.
- **Renderer wiring:** `useSessions.send` (useSessions.ts:114) should accept/forward `streamingBehavior`;
  `App.handleSend` (App.tsx:333) should stop early-returning on `state.streaming` and instead choose
  `streamingBehavior` (default `"followUp"`, REL-3) when streaming. `Composer` (Composer.tsx:171,194) must allow
  Enter/send while streaming for queueing (keep the Stop button visible), and render the chips + a steer/follow
  toggle; chips read from the active slice's new `steering`/`followUp`.
- **Steer-vs-follow-up affordance:** keep it simple — e.g. default Enter = follow-up, a modifier (or a small
  inline toggle) = steer; the SDK distinction is purely the `streamingBehavior` value passed to `send`.
- **Extension-command guard:** `steer()`/`followUp()` throw on `/extension-command` text
  (`_throwIfExtensionCommand`, agent-session.ts:1277-1287); builtins are already intercepted client-side in
  `handleSend` (App.tsx:336) before `send`, so this is a non-issue, but the design should not route a builtin
  command into the queue path.

## Dependencies / sequencing

None hard. This is **Wave 1** in the parent roadmap (06-27-desktop-roadmap, prd.md:45) and is mostly plumbing
on top of the existing concurrent-sessions pool; it builds on `06-18-concurrent-sessions` (the per-session
`SessionController`/`SessionPool` and the sessionId-tagged event stream) which is already shipped. It closes the
deferred CONC-5 finding.

## Out of scope

- Reordering or editing individual queued chips (only enqueue + clear-all this iteration; `clearQueue` is
  all-or-nothing in the SDK).
- Queue UI for background (non-active) sessions beyond the slice already storing it (no sidebar queue badge).
- Per-message images on queued sends if it complicates the composer (images can be follow-up'd later; the SDK
  supports `images` on steer/followUp but the chip UI need not preview them).
- Aborting/Stop behavior changes (Stop still aborts the in-flight turn; the queue-on-abort restore is covered by
  `clearQueue` returning drained text, not by a Stop redesign).
- `sendCustomMessage`/`nextTurn` delivery modes (agent-session.ts:1301) — not user-facing here.

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap`. Do NOT write `design.md` / `implement.md`
  and do NOT change any code until the user gives the explicit go-ahead to start this child.
- The DTO + mapper for `queue_update` already exist (ipc.ts:153, mappers.ts:147) — this task is dark plumbing,
  not new event design. The smallest end-to-end slice is: thread `streamingBehavior` (SDK-1) → reducer case +
  chips (REL-2) → default-to-follow-up + unblock composer (REL-3).
