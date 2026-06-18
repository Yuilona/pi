# Implementation plan — Message actions: copy + edit

> Status: **planned, not started.** Do not `task.py start` until the user confirms. Context order:
> `prd.md` → `design.md` → this file. Re-grep line numbers before editing (code drifts).

## Execution order (independently shippable groups; commit per group)

### Group 1 — Shared primitives (no user-visible change yet)
1. `components/icons.tsx`: add `IconCopy` and `IconCheck` (check whether they already exist first).
2. `components/CopyButton.tsx` (NEW): `function CopyButton({ getText, label }: { getText: () => string;
   label: string })`. Local `copied` state; on click `try { await navigator.clipboard.writeText(getText());
   setCopied(true); timer = setTimeout(()=>setCopied(false), 1200) } catch {}`; clear timer on unmount.
   Renders an `.icon-btn`-style button, `aria-label={label}`, icon = `copied ? IconCheck : IconCopy`.
3. `components/toolText.ts`: add `messageText(message: IpcMessage): string` =
   text blocks joined with `\n`.

### Group 2 — R1 copy message + R2 copy code block (renderer-only)
4. `AssistantBubble.tsx`: wrap row content so a `.msg-actions` slot holds `<CopyButton
   getText={() => messageText(message)} label="Copy message" />`. Keep it static per message (don't break
   the `sameBubble` memo).
5. `UserBubble.tsx`: same copy button on the user row (both the normal branch and after the
   `SkillInvocation` early-return branch — or hoist so both paths get it).
6. `Markdown.tsx`: add a `pre` override → `<div className="code-wrap"><CopyButton getText={extract} ... />
   {defaultPre}</div>`. Extract code text from the hast node (module-scope helper).
7. `styles/chat.css`: `.msg-actions` (absolute/aligned at bubble edge, opacity 0 → 1 on `.row:hover` /
   `:focus-within`), `.code-wrap` (`position:relative`) + its button top-right reveal. Match `.icon-btn`
   tokens; quiet until hover. `npm run format`.
8. Verify: typecheck/lint/build; `PI_SHOT` light + dark — buttons appear on hover, copy works (paste-check
   manually or assert via a tiny renderer eval that calls the click and reads a stub). No API tokens.
   **Commit Group 2** ("Per-message + per-code-block copy buttons").

### Group 3 — R3 edit last user message (IPC + main + SDK)
9. `shared/ipc.ts`: add `editLastMessage: "pi:editLastMessage"` to the IPC map and `editLastMessage(): 
   Promise<string | null>` to `PiApi`.
10. `main/agent/manager.ts`: add `editLastMessage()` per design (runExclusive → guard streaming/empty →
    `getUserMessagesForForking().at(-1)` → `navigateTree(entryId, {summarize:false})` → return editorText).
11. `main/agent/bridge.ts`: `ipcMain.handle(IPC.editLastMessage, () => manager.editLastMessage())`.
12. `preload/index.ts`: expose `editLastMessage: () => ipcRenderer.invoke(IPC.editLastMessage)`.
13. Verify main compiles (`typecheck:node`).

### Group 4 — R3 renderer wiring
14. `MessageList.tsx`: compute `lastUserId` (id of last `role==="user"` message); pass
    `editable={m.id===lastUserId && !state.streaming}` and an `onEdit` callback to that `UserBubble`.
15. `UserBubble.tsx`: when `editable` AND no image block, render an edit button in `.msg-actions` next to
    copy; clicking calls `onEdit()`.
16. `App.tsx`: implement `onEdit`: `const text = await window.pi.editLastMessage(); if (text==null) return;`
    then reuse the existing transcript-hydration path (the one `switchSession` triggers) to refresh, then
    `setComposerText(text)` + focus the composer (reuse the slash-menu's composer-write/focus mechanism).
17. `styles/chat.css`: edit-button styling (shares `.msg-actions`; distinct `aria-label`).
18. Verify: full `typecheck && lint && test && build`; `PI_SHOT` light + dark. Then a real-UI behavior
    check (open a saved session, confirm only the last user bubble shows edit, not while streaming).
    **Commit Group 4** ("Edit + resend the last user message (in-place rewind)").

## Validation (run from apps/desktop)
- `npm run typecheck && npm run lint && npm run test && npm run build` — all green before each commit.
- `PI_SHOT=<png>` and `PI_SHOT=<png> PI_THEME=dark` via `npx electron .` on the built app for light/dark.
- R3 correctness: after an edit + resend, confirm the model context does not contain the old message —
  inspect transcript length / session JSONL leaf, or assert `getTranscript()` shrank by the edited turn
  before the new send.

## Review gates
- After Group 2: copy buttons styled per DESIGN, no clutter at rest, memoization intact.
- After Group 4: edit truly rewinds (AC3), button visibility rules correct (AC4), renderer still pi-free
  (AC5), all checks green (AC6).

## Rollback
- Four independent commits. Group 2 (copy) is pure renderer — revert freely. Group 3+4 (edit) revert
  together (IPC method + its callers). No data migration; navigateTree only adds an in-file tree branch,
  which the pi CLI already understands, so a half-applied edit leaves the session readable.

## Reminders
- Renderer must NOT import `@earendil-works/pi-*`. Only `manager.ts` touches the SDK.
- Biome `noExplicitAny` is OFF — never add `biome-ignore lint/suspicious/noExplicitAny`.
- Probe/diagnostic commands go ALONE; never batch a possibly-failing command with an Edit. One risky thing
  at a time. Windows GBK console: use Read, not `cat`/`python -c print`; no emoji to the terminal.
- Commit messages ASCII-only, end with the Co-Authored-By trailer; commit/push only when the user asks.
