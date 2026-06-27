# Branch / fork / rewind from any earlier message

## Goal

Let the user rewind to — and fork a new session from — ANY earlier user message in a chat (not just the
last one), surfacing the session's branch tree, so non-destructive "what if I'd asked X instead?"
exploration becomes a first-class agent feature instead of a single last-message edit.

## Background

The desktop already does an in-place rewind, but deliberately only for the **single most recent** user
message. Two gates enforce that limit:

- **Main resolves only the last user entry.** `SessionController.editLastMessage()` rewinds via
  `session.getUserMessagesForForking().at(-1)` then `session.navigateTree(target.entryId, {summarize:false})`
  (`apps/desktop/src/main/agent/sessionController.ts:352-367`). It never accepts a caller-chosen target — it
  always picks `.at(-1)`. The IPC is `editLastMessage(sessionId)` with no entry argument
  (`apps/desktop/src/shared/ipc.ts:15,282`; preload `apps/desktop/src/preload/index.ts:32`; bridge
  `apps/desktop/src/main/agent/bridge.ts:64`; pool passthrough `apps/desktop/src/main/agent/sessionPool.ts:294`).
- **Renderer gates the edit UI to the last user bubble.** `MessageList` computes a single `lastUserId` and
  passes `editable` only to that bubble (`apps/desktop/src/renderer/src/components/MessageList.tsx:42-43,99`);
  `UserBubble` shows the edit affordance only when `editable` (`apps/desktop/src/renderer/src/components/UserBubble.tsx:28,150-164`).
  `App.submitEdit` calls `editLastMessage(id)` → `loadTranscript(id)` → `send(...)`
  (`apps/desktop/src/renderer/src/App.tsx:348-359`).

This scope was a conscious v1 decision in the precedent task: "Edit scope = last user message only … we do
NOT need to thread per-entry IDs through the transcript DTO (main resolves the last user entry id itself)"
(`.trellis/tasks/archive/2026-06/06-18-message-actions/prd.md:24-26`). The SDK, however, already supports the
full feature:

- `AgentSession.navigateTree(targetId, {summarize?})` navigates to **any** node in the session tree (user
  message, custom message, or any entry), returns `{editorText, cancelled, aborted}`, and stays in the SAME
  file — no events are emitted, so the caller re-reads the transcript (`packages/coding-agent/src/core/agent-session.ts:2702`,
  user-message branch at `:2819-2822`). This is the exact pattern the TUI uses after navigation: clear the
  chat and re-render (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1582-1601`).
- `AgentSession.getUserMessagesForForking()` returns **ALL** user messages as `{entryId, text}[]`
  (`packages/coding-agent/src/core/agent-session.ts:2892-2907`) — the desktop today throws away everything but
  the last element.
- Forking to a NEW file is supported via `SessionManager.createBranchedSession(leafId)`, which writes a new
  JSONL containing only root→leaf (`packages/coding-agent/src/core/session-manager.ts:1286`); the runtime
  wrapper `AgentSessionRuntime.fork(entryId, {position})` orchestrates it
  (`packages/coding-agent/src/core/agent-session-runtime.ts:259-344`). The TUI ships `/fork` + `/tree` +
  `/clone` and an ASCII `tree-selector` component
  (`packages/coding-agent/src/modes/interactive/components/tree-selector.ts`).
- The full tree is reachable for surfacing: `AgentSession.sessionManager` is public
  (`agent-session.ts:258`) and `SessionManager.getTree()` returns `SessionTreeNode[]`
  (`packages/coding-agent/src/core/session-manager.ts:1191`).

One real wiring gap drives the design: the renderer's `IpcMessage.id` is a **synthetic sequence id**
(`h1`,`h2`… for transcripts, `u1`/`a2`… for live), produced by `makeIdFactory` / `mapTranscript`
(`apps/desktop/src/main/agent/mappers.ts:22-34,196`). It is NOT the SDK `entryId`. So today the renderer
cannot name a target entry; the last-message-only design sidestepped that. To rewind/fork from any bubble we
must give the renderer entry ids — either by a separate "branch points" list keyed by `entryId`, or by
threading `entryId` onto the transcript DTO. Architecture is fixed: the SDK runs only in main; the renderer
is pi-free and speaks only `ipc.ts` DTOs; each new capability = a new channel + DTO in `ipc.ts`, wired in
`preload` + `bridge.ts`, routed through `SessionPool`/`SessionController`.

## Requirements

- **(R1) Rewind to any earlier user message (in-place, same file).** Generalize the existing last-only edit
  so the user can rewind the active session to before ANY prior user message — the thread truncates to that
  point (later turns discarded) and the chosen message's text is restored for editing/resend, all in the same
  session file (a pi session-tree branch). *Value:* the marquee "back up and try again from here" move,
  not just from the bottom of the chat. Evidence: `navigateTree(targetId, {summarize:false})` handles any node
  (`agent-session.ts:2702`, user branch `:2819-2822`); the desktop hard-codes `.at(-1)`
  (`sessionController.ts:356`). Today's no-event-then-refetch contract is documented at `ipc.ts:277-282`.
  sdkSupport: full (already in SDK). Effort: **M**.

- **(R2) List a session's branch points.** Add an IPC that returns all of a session's user messages as
  `{entryId, text}[]` (plus the current leaf, so the UI can mark "you are here"), so the renderer can map each
  user bubble to a real entry id and offer per-bubble rewind/fork without leaking the SDK. *Value:* the data
  spine that R1/R3/R4 ride on, closing the entryId gap. Evidence: `getUserMessagesForForking()`
  (`agent-session.ts:2892`); current-leaf via `session.sessionManager.getLeafId()`
  (`session-manager.ts:1085`); the renderer's ids are synthetic and unusable as targets (`mappers.ts:22-34,196`).
  sdkSupport: full. Effort: **S**.

- **(R3) Fork a new session from any earlier message.** Add an IPC that, given an `entryId`, creates a NEW
  session file containing root→(before that message) and opens it as a fresh live controller in the pool —
  leaving the original session untouched — then returns the new `sessionId` (and the forked message's text to
  seed the composer). *Value:* non-destructive branching — explore an alternative without losing the original
  thread. Evidence: `SessionManager.createBranchedSession(leafId)` (`session-manager.ts:1286`) and the runtime
  `fork` flow (`agent-session-runtime.ts:259-344`, esp. the persisted branch at `:309-324`); the pool already
  has `openSession(path)` to adopt an on-disk file (`sessionPool.ts:170`). sdkSupport: full (the SDK's own
  `fork` replaces the live session in place, so the desktop instead uses the lower-level
  `createBranchedSession` on a separately-opened `SessionManager` and `openSession`s the new file — see hints).
  Effort: **L**.

- **(R4) Per-bubble rewind / fork affordances + a branch picker.** Replace the last-only edit gate with
  per-user-bubble actions: a "rewind here" (R1) and "fork into a new session" (R3) control on every user
  bubble (gated off mid-stream), plus a branch/tree picker (a list of branch points from R2, "you are here"
  marked) reachable from a single entry point for sessions with many turns. *Value:* makes branching
  discoverable and ergonomic; matches TUI parity (`/tree` + `/fork` + the `tree-selector`). Evidence: the gate
  to drop — `MessageList.tsx:42-43,99` (`lastUserId` / `editable`), `UserBubble.tsx:28,150-164`; the TUI's
  tree UI (`tree-selector.ts`; commands wired at `interactive-mode.ts:1569-1601`); reuse the post-navigate
  refetch already in `App.submitEdit` (`App.tsx:348-359`). sdkSupport: n/a (renderer/UX). Effort: **M**.

## Acceptance Criteria

- [ ] AC1 (R1). With the session idle, choosing "rewind here" on any earlier user bubble rewinds the active
      session to before that message (same file), the visible thread truncates to that point, and the chosen
      text is restored for editing and resends as a fresh turn from the rewound point.
- [ ] AC2 (R2). A `listBranchPoints(sessionId)` IPC returns every user message as `{entryId, text}` in thread
      order plus the current leaf id; the renderer can map each user bubble to its entry id (no synthetic-id
      collisions; verified against a multi-turn session).
- [ ] AC3 (R3). "Fork into a new session" on any earlier user bubble creates a new on-disk session and opens
      it as a new live controller (a new sidebar row / `sessionId`); the original session remains intact and
      unchanged on disk and in the pool; the new session's composer is seeded with the forked message's text.
- [ ] AC4 (R4). Every user bubble (not just the last) shows rewind + fork affordances when the session is
      idle; the affordances are hidden while streaming; a branch/tree picker lists branch points with "you are
      here" marked. (Verify via the dev screenshot hooks — light + dark — no API tokens.)
- [ ] AC5. Lifecycle safety preserved: rewind and fork route through the per-class `runExclusive` serializer
      and `await` their (re)build, surfacing failures as `{type:"error"}` DTOs — never fire-and-forget (per
      `apps/desktop/CLAUDE.md` lifecycle rule; mirror `editLastMessage`'s serializer use at
      `sessionController.ts:353`).
- [ ] AC6. New capabilities = new channels + DTOs in `apps/desktop/src/shared/ipc.ts`, wired in
      `src/preload/index.ts` and `src/main/agent/bridge.ts`, routed through `SessionPool`/`SessionController`.
      The renderer stays **pi-free**: no `@earendil-works/pi-*` import in `src/renderer/**` (grep proves it).
- [ ] AC7. Pi-citizen preserved: rewind uses the SDK's own `navigateTree`; fork uses
      `createBranchedSession` + the existing `openSession` path; no hand-edited JSONL, no hardcoded provider.
- [ ] AC8. `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` (from `apps/desktop`) all
      stay green.

## Design hints (for the later design.md)

- **New IPC (in `src/shared/ipc.ts`, wired in `preload/index.ts` + `bridge.ts`, all session-scoped → take
  `sessionId` first and route via the `sessionPool.ts:287-326` passthroughs):**
  - `listBranchPoints(sessionId): Promise<{ points: {entryId, text}[]; leafId: string | null }>` over
    `session.getUserMessagesForForking()` + `session.sessionManager.getLeafId()`. Add a `BranchPointDto`
    (and a small wrapper DTO) to `ipc.ts` — do NOT leak `SessionEntry`/`SessionTreeNode` to the renderer.
  - `rewindTo(sessionId, entryId): Promise<string | null>` — generalize `editLastMessage`: have
    `SessionController.rewindTo(entryId)` run inside `runExclusive`, call
    `session.navigateTree(entryId, {summarize:false})`, return `editorText` (keep `editLastMessage` as a thin
    `rewindTo(lastEntryId)` shim or retire it once the renderer no longer calls it). After it resolves the
    renderer re-fetches the transcript (no events — same as today's edit path at `App.tsx:353-355`).
  - `forkFrom(sessionId, entryId): Promise<{ sessionId: string; text: string } | null>` — see fork note.
- **Fork without disturbing the original (R3).** The SDK's `AgentSessionRuntime.fork` REPLACES the runtime's
  current session in place (`agent-session-runtime.ts:296-324`), which is wrong here — we want a NEW desktop
  session and the original kept live. And `createBranchedSession` MUTATES the `SessionManager` it's called on
  (it reassigns `this.sessionFile`/`fileEntries`, `session-manager.ts:1346-1348`). So in main: open a SEPARATE
  `SessionManager.open(originalFile)` (`session-manager.ts:1404`), resolve the fork target leaf (parent of the
  chosen user entry, mirroring runtime fork `position:"before"` at `agent-session-runtime.ts:282`), call
  `createBranchedSession(targetLeafId)` to get the new file path, then `pool.openSession(newPath)` to adopt it
  as a fresh controller — never touching the live controller's own `SessionManager`. Return the new
  `sessionId` + the forked message text for the composer. Do this inside the pool's `runExclusive`.
- **Renderer (R4).** Drop the single-`lastUserId` gate in `MessageList.tsx:42-43,99`; pass each user bubble
  its `entryId` (from R2's `listBranchPoints`, matched to bubbles by thread order) and an `idle` flag. In
  `UserBubble.tsx`, add a "rewind here" and a "fork" action next to the existing edit/copy (`:150-164`),
  shown when idle. A branch picker can reuse the TUI tree-selector concept (`tree-selector.ts`) as a simple
  React list of branch points with the current leaf marked; render it as a popover/panel, not ASCII art.
- **Glue already present:** post-rewind refetch (`App.submitEdit`, `App.tsx:348-359`), `openSession`
  adoption (`sessionPool.ts:170`), and the serializer pattern (`sessionController.ts:98,353`,
  `sessionPool.ts:70`) — reuse them rather than inventing new flows.

## Dependencies / sequencing

**Roadmap wave: Wave 3 (of 4)** — recommended execution slot ~#8 of 14.

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after:** nothing hard (generalizes the already-shipped last-message edit; the 06-18-message-actions precedent).
- **Blocks / do before:** nothing.
- **Why Wave 3:** high-value but L effort (new IPC channels + a branch/tree picker UI).

## Out of scope

- Branch **summarization** on navigate (`navigateTree`'s `summarize:true` + the branch-summary model call,
  `agent-session.ts:2782-2813`): v1 uses `summarize:false`, matching the existing edit path.
- Restoring **image attachments** into the composer on rewind/fork — same deferral as the original edit
  feature's constraint C3 (`06-18-message-actions/prd.md:99-101`); messages with images stay copy-only for
  the edit/rewind affordance.
- A full graphical tree-graph visualization; v1 surfaces branch points as a flat picker, not a rendered
  DAG.
- `/clone` (whole-session duplicate) and JSONL import/export — owned by the SDK-surfacing child
  (`06-27-sdk-surfacing`, R1).
- Renderer importing pi or bypassing the `ipc.ts` contract.

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap` (row #4: SDK-3 + UX-6,
  `.trellis/tasks/06-27-desktop-roadmap/prd.md:27`). Write `design.md`/`implement.md` and implement **only on
  the user's explicit go-ahead**.
- Findings owned by this child: **SDK-3** (the SDK already ships `navigateTree`/`getUserMessagesForForking`/
  `createBranchedSession` for any node) + **UX-6** (per-bubble rewind/fork + a branch tree picker).
- Every cited SDK symbol was verified present in this tree. The one non-trivial nuance is R3's fork: the
  SDK's `fork` replaces the live session in place, so the desktop must compose the lower-level
  `createBranchedSession` + `openSession` to keep the original session intact (flagged in Design hints).
