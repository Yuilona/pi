# Message actions: copy + edit

## Goal

Add the three message-level affordances a chat UI is currently missing, so the desktop app feels complete:

1. **Copy a whole message** — a hover button on every message bubble (user AND assistant) that copies the
   message's text to the clipboard.
2. **Copy a code block** — a hover button on each fenced code block in assistant markdown that copies just
   that block's source.
3. **Edit the last user message + resend** — an "edit" affordance on the most recent user message that
   rewinds the conversation to before it, drops the AI reply that followed, restores the original text into
   the composer for editing, and lets the user re-send from that point.

The hard part is (3): editing text in the UI alone is wrong, because the old message would still be in the
model's context on re-send. Edit MUST genuinely rewind the session history. pi's SDK supports this natively
(`AgentSession.navigateTree`), so we wire to it rather than hand-editing JSONL.

## Decisions (locked with the user)

- **Edit mechanism = in-place rewind** (`navigateTree`, `summarize:false`): discard the edited message and
  everything after it, continue in the SAME session file (a pi session-tree branch). NOT fork-to-new-session.
  Keeps the session list clean — no proliferation of branch files.
- **Edit scope = last user message only.** Only the most recent `role==="user"` bubble is editable. This
  matches "最新消息", keeps the rewind target unambiguous, and means we do NOT need to thread per-entry IDs
  through the transcript DTO (main resolves the last user entry id itself).
- This is a child of `06-15-desktop-app`. Complex (crosses IPC + main + SDK + renderer) → full
  prd/design/implement before `task.py start`.

## Requirements

### R1 — Copy message
- Every message bubble (user and assistant) shows a copy button on hover (and on keyboard focus).
- Clicking copies the concatenated **text** content of that message (text blocks joined with `\n`; tool
  calls / thinking / images are not part of the copied text).
- Brief visual confirmation on success (icon swaps to a check for ~1.2s). Clipboard failure is silent /
  non-fatal.
- Renderer-only (no IPC, no main changes); uses `navigator.clipboard.writeText`.

### R2 — Copy code block
- Each fenced code block in assistant markdown shows a copy button (top-right, on hover/focus of the block).
- Clicking copies the raw code text of that block only (no surrounding prose, no backticks).
- Same success-confirmation + silent-failure behavior as R1.
- Implemented in `Markdown.tsx` (a `pre`/`code` renderer override); renderer-only.

### R3 — Edit last user message
- The most recent user message shows an "edit" affordance (alongside its copy button) **only when**:
  - it is genuinely the last user message in the thread, AND
  - the session is **not** currently streaming, AND
  - the message has **no image attachments** (text-only — see Constraint C3).
- **In-place editing** (updated UX): activating edit turns the bubble itself into a roomy, scrollable edit
  field at its original position (pre-filled with the message text), with Cancel / Save&send actions. The
  session is NOT touched until save, so Cancel is a pure no-op.
  1. Edit click → the bubble becomes an in-place `<textarea>` editor (auto-grows to its content, caps at
     ~50vh then scrolls internally — long messages stay comfortable). Keys: Esc cancels, Ctrl/⌘+Enter saves.
  2. Save → main rewinds the session to before that message via `navigateTree(entryId, {summarize:false})`,
     the thread re-hydrates to the truncated history (the edited message and the AI reply after it vanish),
     and the edited text is resent as a fresh turn continuing from the rewound point (same session file).
  3. Cancel → the editor closes and the bubble returns unchanged; the session was never mutated.
- Edit (the rewind) is serialized with other session lifecycle ops (cannot interleave with switch/new/delete).

## Acceptance Criteria

- [x] AC1. Every user + assistant bubble has a hover/focus copy button that copies its text; shows a check
      on success; does nothing harmful on clipboard failure. (CopyButton; verified in light+dark shots.)
- [x] AC2. Every assistant code block has its own copy button that copies exactly that block's source.
      (Markdown.tsx `pre` override + hastText; verified — button floats top-right of the block.)
- [x] AC3. The last user message (text-only, not streaming) shows an edit button; clicking it turns the
      bubble into an in-place, scrollable editor pre-filled with the text; Save rewinds the session,
      truncates the visible thread, and resends the edited text as a new turn; Cancel restores the bubble
      with no session change. Verified end-to-end via a fabricated session: edit opened the in-place editor
      (light + dark), and an earlier composer-refill build confirmed the rewind drops the last user turn
      (thread 3→2) before resend.
- [x] AC4. The edit button is absent while streaming, on non-last user messages, on assistant messages, and
      on user messages that contain images. (MessageList passes editable only to the last user id when not
      streaming; UserBubble suppresses edit when images present; verified — first user bubble showed 1
      button, last showed 2.)
- [x] AC5. The renderer stays pi-free (no `@earendil-works/pi-*` import); the IPC contract change lives in
      `src/shared/ipc.ts` (`editLastMessage`). Only `manager.ts` touches the SDK (`navigateTree`).
- [x] AC6. `npm run typecheck && npm run lint && npm run test && npm run build` all green; light + dark
      screenshots (via `PI_SHOT` / `PI_THEME=dark`, no API tokens) confirm the buttons styled per DESIGN.md.

## Implementation note (post-build)
- Edit UX changed from "refill the composer" to **in-place bubble editing** (per user request): the editor
  lives in `UserBubble` (local `editing`/`draft` state, auto-grow textarea capped at 50vh), and the session
  is only mutated on Save. `App.submitEdit(text)` does `editLastMessage()` (rewind) → `loadTranscript()`
  (truncate) → `send(text)` (resend). The `editLastMessage` IPC/main/preload (rewind + return original
  text) is unchanged; the renderer now ignores the returned text since the draft comes from the bubble.
- New files: `components/CopyButton.tsx`. New icons: `IconCopy`, `IconEdit`. New `toolText.messageText`.

## Constraints

- DESIGN.md is the source of truth: the buttons are quiet, warm, hover-revealed — they must not clutter the
  reading column. Match the existing `.icon-btn` / tool-card hover idiom.
- Pi-citizen: use `navigateTree` (the SDK's own rewind), never hand-edit the session JSONL.
- Keep the renderer pi-free; the only cross-process addition is one IPC method.
- Biome `noExplicitAny` is OFF here — do NOT add `biome-ignore lint/suspicious/noExplicitAny` (it is flagged
  as an unused suppression). Run `npm run format` after CSS edits.
- C3 (image edit, deferred): restoring base64 image attachments back into the composer's File-based attach
  state is out of scope for v1; if the last user message has images, the edit button is hidden (copy still
  works). Revisit later if needed.

## Notes

- Source request: user noted three missing affordances — per-message copy, edit on the latest message,
  per-code-block copy.
- Sibling tasks (planned, not started): `06-18-concurrent-sessions`, `06-18-polish-quickwins`.
- Planned now; **do not `task.py start` until the user reviews the artifacts and confirms.**
