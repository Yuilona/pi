# Technical design — Message actions: copy + edit

## Layering recap (hard rule)

pi SDK runs ONLY in the Electron **main** process; the **renderer is pi-free** and talks to main over the
typed IPC bridge in `src/shared/ipc.ts`. Copy (R1, R2) is pure renderer. Edit (R3) needs one new IPC method
because the rewind primitive lives in the SDK (main).

---

## R1 — Copy message (renderer-only)

**Where:** `UserBubble.tsx` and `AssistantBubble.tsx` (and, by extension, the `SkillInvocation` user branch).

**What:** a small reusable `CopyButton` component (new file `components/CopyButton.tsx`) that takes a
`() => string` text getter (lazy, so we don't recompute on every render) and renders an `.icon-btn`-style
button. On click: `await navigator.clipboard.writeText(text())`, then swap the icon to a check for ~1.2s via
local state + a `setTimeout` (cleared on unmount). Wrap in try/catch — clipboard can reject (focus / perms);
failure is swallowed.

**Text extraction:** join `message.content` text blocks:
`content.filter(b => b.kind === "text").map(b => b.text).join("\n")`. For assistant bubbles this is the prose
only (tool calls, thinking, images excluded — matches "copy the message"). Put the helper in
`components/toolText.ts` (e.g. `messageText(message)`) so both bubbles share it.

**Placement / hover:** the button sits in a per-row actions affordance. Reuse the existing row hover pattern:
the `.row` already exists; add a `.msg-actions` element positioned at the bubble's edge, hidden by default and
revealed on `.row:hover .msg-actions` and `:focus-within`. Keyboard-reachable (real `<button>`), so
`:focus-visible` shows it too. Styling in `chat.css`, matching `.icon-btn` tokens.

Icons: reuse `icons.tsx`; add `IconCopy` and `IconCheck` if not present (check first — `IconClose` etc. exist).

## R2 — Copy code block (renderer-only)

**Where:** `Markdown.tsx`, the `components` map. react-markdown renders fenced code as `<pre><code …>`. The
cleanest hook is overriding **`pre`** (one button per block) rather than `code` (which also matches inline
code). The `pre` renderer receives `children` = the `<code>` element; read the raw text from
`props.node` (hast) or from the code element's children text. Robust approach: walk the hast `node` passed in
`props` to collect text, OR read `children.props.children` (the code string). Prefer reading the hast node
text to avoid React child-shape fragility.

Render: `<div className="code-wrap"><CopyButton .../><pre>…</pre></div>` — the wrapper is `position:relative`
so the button can sit top-right, revealed on `.code-wrap:hover` / `:focus-within`. Reuse the same
`CopyButton` from R1.

Note: `Markdown` is `memo`'d on `text`; the override is defined once at module scope (like the existing `a`
and `img` overrides) so it does not break memoization.

## R3 — Edit last user message (IPC + main + SDK + renderer)

### SDK primitive (already verified in source)

`AgentSession.navigateTree(targetEntryId, { summarize: false })`
(`packages/coding-agent/src/core/agent-session.ts`):
- If the target entry is a user message, it sets the new leaf = the message's `parentId` (rewinds to before
  it), rebuilds `agent.state.messages` from the truncated context, and **stays in the same session file**
  (a session-tree branch). Returns `{ editorText, cancelled }` where `editorText` is the original message
  text — exactly what we prefill the composer with.
- `AgentSession.getUserMessagesForForking(): Array<{ entryId, text }>` returns user messages in order; the
  **last** element is our edit target. Because scope = last-user-message-only, main resolves the entry id
  itself — no need to thread per-entry ids through `IpcMessage`.

### IPC contract (`src/shared/ipc.ts`)

Add one channel + one `PiApi` method:
```ts
// IPC map:
editLastMessage: "pi:editLastMessage",
// PiApi:
/** Rewind the session to before the last user message; returns its original text to refill the composer
 *  (or null if there is no editable last user message / a turn is in flight). */
editLastMessage(): Promise<string | null>;
```
No DTO changes. (Deliberately NOT `editMessage(id)` — scope is last-only, and our `IpcMessage.id` is a
synthetic UI id, not a session entry id.)

### Main — `AgentManager.editLastMessage()` (`src/main/agent/manager.ts`)

```
async editLastMessage(): Promise<string | null> {
  return this.runExclusive(async () => {
    const s = this.session;
    if (!s || s.isStreaming) return null;
    const users = s.getUserMessagesForForking();
    const target = users.at(-1);
    if (!target) return null;
    const { editorText, cancelled } = await s.navigateTree(target.entryId, { summarize: false });
    if (cancelled) return null;
    return editorText ?? target.text ?? "";
  });
}
```
- Wrapped in `runExclusive` (the opChain lock) so it can't interleave with switch/new/delete/setCwd.
- Guards: no session, or streaming → return null (renderer hides the button in these cases anyway; this is
  defense in depth).
- `navigateTree` mutates the in-memory session + the JSONL leaf, but emits no `message_*` events the desktop
  subscription maps — so the renderer must re-fetch the transcript after this resolves (see below).

Wire in `bridge.ts`: `ipcMain.handle(IPC.editLastMessage, () => manager.editLastMessage())`, and expose in
`preload/index.ts` as `editLastMessage: () => ipcRenderer.invoke(IPC.editLastMessage)`.

### Renderer — orchestration

The last-user-message edit button lives on the `UserBubble` for the last user message. The bubble needs to
know it is "the editable one". Compute in `MessageList`: find the id of the last `role==="user"` message and
pass `editable={m.id === lastUserId && !state.streaming}` to that `UserBubble`. (Image-containing messages:
`UserBubble` itself suppresses the edit button when `message.content` has an `image` block — Constraint C3.)

On click, the renderer orchestrates (likely via a callback threaded from `App.tsx`, where send/composer state
lives):
1. `const text = await window.pi.editLastMessage();`
2. if `text == null` → no-op (stale click).
3. refresh the transcript: re-run the same path used on session switch (`getTranscript()` → dispatch a
   `hydrate`/`reset` to `chatReducer`) so the truncated thread renders.
4. set the composer value to `text` and focus the composer.

Find the existing transcript-hydration action in `chatReducer.ts` + the App-level loader (the same one
`switchSession` uses) and reuse it — do not invent a second hydration path. The composer value is controlled
state in `App.tsx`/`Composer.tsx`; setting it + a focus ref is the same mechanism the slash-menu already uses
to write into the composer.

### Data-flow summary (R3)

```
[UserBubble edit btn] --onEdit--> App handler
   -> window.pi.editLastMessage()            (IPC invoke)
        -> AgentManager.editLastMessage()    (runExclusive)
             -> session.navigateTree(lastUserEntryId, {summarize:false})  (SDK rewind, same file)
             <- editorText
   <- editorText
   -> refresh transcript (getTranscript -> chatReducer hydrate)   // thread truncates
   -> setComposerText(editorText); focusComposer()
[user edits, presses Send] -> window.pi.send(newText) -> normal turn from rewound point
```

## Components / files touched

| File | Change |
|---|---|
| `components/CopyButton.tsx` | NEW — reusable copy button (lazy text getter, check-on-success) |
| `components/toolText.ts` | add `messageText(message)` helper |
| `components/icons.tsx` | add `IconCopy`, `IconCheck` if missing |
| `components/UserBubble.tsx` | copy button; edit button on the editable last user message; suppress edit when images present |
| `components/AssistantBubble.tsx` | copy button on the row |
| `components/MessageList.tsx` | compute `lastUserId`; pass `editable` + `onEdit` down |
| `components/Markdown.tsx` | `pre` override wrapping code blocks with a CopyButton |
| `App.tsx` | edit handler: call IPC, refresh transcript, set+focus composer |
| `shared/ipc.ts` | `editLastMessage` channel + `PiApi.editLastMessage` |
| `main/agent/manager.ts` | `editLastMessage()` (runExclusive + navigateTree) |
| `main/agent/bridge.ts` | `ipcMain.handle` for the new channel |
| `preload/index.ts` | expose `editLastMessage` on `window.pi` |
| `styles/chat.css` | `.msg-actions`, `.code-wrap` + copy-button hover/focus reveal |

## Tradeoffs & alternatives considered

- **navigateTree vs fork:** chose in-place rewind (user decision). fork would create a new session file per
  edit (sidebar clutter). navigateTree keeps history as an in-file tree branch — the pi-native behavior the
  CLI uses.
- **editLastMessage() vs editMessage(entryId):** scope is last-only, and the transcript DTO has no entry
  ids. Resolving the last user entry in main avoids changing the DTO and the hydration path. If we later want
  "edit any user message", we add `entryId` to `IpcMessage` (sourced from `sessionManager.getEntries()`) and
  generalize to `editMessage(entryId)` — a clean, additive extension.
- **`pre` vs `code` override for R2:** `pre` matches only fenced blocks (not inline code) and gives one
  button per block; reading text from the hast node avoids React child-shape fragility.
- **Re-hydrate vs incremental truncation event:** navigateTree emits `session_tree` (not mapped). Rather than
  add a new `truncate` IPC event + reducer branch, reuse the existing full-transcript hydration (one extra
  `getTranscript` round-trip; negligible, and it is the already-proven session-switch path).

## Risks

- **Stale click during stream:** guarded twice (renderer hides button while streaming; main returns null if
  `isStreaming`).
- **Clipboard API rejection** (focus/permission): swallowed; copy is best-effort.
- **Image messages on edit:** hidden for v1 (C3) to avoid silently dropping attachments.
- **Memoization regression:** keep Markdown overrides at module scope; `CopyButton` cheap and local-state
  only, so historical bubbles don't re-render on stream ticks (AssistantBubble's `sameBubble` memo unaffected
  because the actions element is static per message).
