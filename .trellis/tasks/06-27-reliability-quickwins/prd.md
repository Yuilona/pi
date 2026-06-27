# Reliability quick wins (retry, draft, single-instance, recovery)

## Goal

Make the desktop app forgiving of the things that actually go wrong day-to-day — a flaky network turn,
a closed window with text half-typed, a relaunch, a corrupt session file, a misconfigured provider, a
second app instance — so a transient failure is recoverable in one click instead of losing work or
silently doing the wrong thing.

## Background

The desktop app already streams turns, persists sessions to the shared `~/.pi/agent/sessions` JSONL, and
surfaces failures as a single red banner. But the failure/recovery paths are thin:

- A failed turn is a dead end. `mappers.ts:118-124` turns an assistant `stopReason:"error"` (and
  `auto_retry_end` with `finalError`, `chatReducer.ts:106-111`) into `state.error`, rendered as a static
  `banner-error` (`StatusBanners.tsx:11`). There is no "Retry" affordance; the user must retype. The SDK
  already classifies network/offline/timeout/proxy errors with a regex (`agent-session.ts:2482-2483`) for
  its own auto-retry decision, but the renderer only ever sees the raw `finalError` string — offline vs.
  timeout vs. proxy-down all read as one opaque line.
- The composer is fully transient. `input` and `attachments` live in `App.tsx` `useState`
  (`App.tsx:79,88`) and are wiped on send (`App.tsx:342-343`); nothing persists them. Close the window
  mid-compose and the draft (and any pasted images) are gone. The `expandTools` toggle already shows the
  localStorage pattern this should follow (`App.tsx:86,145`).
- The open-session set is not restored. On launch the pool creates exactly one fresh controller
  (`sessionPool.ts:141-151`) and the renderer adopts `s.activeId` (`App.tsx:135`); the set of sessions the
  user had open last run, and which one was focused, are not remembered.
- A corrupt/unreadable session fails silently into a fresh one. `ensureSession` (`sessionController.ts:236-244`)
  wraps `buildSession(SessionManager.open(file))` in a `try { … } catch { /* fall through to a fresh session */ }`
  — and even `SessionManager.setSessionFile` itself truncates an empty/corrupt file and starts fresh
  (`session-manager.ts:797-806`). The user opens a chat and silently gets a blank one with no error.
- Provider config is validated only by use. `setApiKey`/`addCustomProvider` (`sessionPool.ts:407-420,456-488`)
  persist + `modelRegistry.refresh()` + `warmActiveIfNeeded()`; a bad base URL or key isn't detected until
  the next turn fails mid-conversation. The SDK exposes `getApiKeyAndHeaders(model)` (`model-registry.ts:684`,
  used by `agent-session.ts:_getRequiredRequestAuth:357-381`) which can be probed up front.
- A crash-interrupted turn isn't offered for continuation. After an abnormal exit a session's last entry
  can be a user message with no assistant reply (`session.messages` getter, `agent-session.ts:828-830`);
  on resume the app just shows the transcript with no prompt to continue.
- No single-instance lock. `index.ts` never calls `app.requestSingleInstanceLock()`; a second launched
  process gets its own `SessionPool` writing the same `~/.pi` JSONL / `models.json` / `proxy.json`
  (`proxy.ts:16`), so two instances can clobber the shared state.
- Deleting the last chat can leave a dead pane. `closeSession`/`deleteSession` set the active id from
  `fallbackActive()` (`sessionPool.ts:276-280`), which returns `undefined` when no controller remains; the
  renderer then has no active session and shows an empty, actionless main area until the user manually
  starts a new chat.
- `openSession(path)` is not path-confined. `deleteSession`/`deleteSessionByPath` already gate destructive
  paths with `isInSessionsDir` (`sessionPool.ts:39-43,252,268`), finishing the audit's SEC-2 for deletes —
  but `openSession` (`sessionPool.ts:170-199`) opens any renderer-supplied path without that guard.

All of these are small, independently verifiable, main-process-or-localStorage changes that respect the
pi-free renderer boundary.

## Requirements

- **R1 (REL-1) Retry a failed turn.** When a turn ends in an error state, show a "Retry" action that
  re-sends the last user message as a fresh turn. Reuse the existing rewind machinery:
  `editLastMessage` already calls `session.getUserMessagesForForking().at(-1)` + `navigateTree`
  (`sessionController.ts:352-367`), and `App.submitEdit` already does rewind-then-resend
  (`App.tsx:348-359`); retry is the same flow without an edit. User value: a flaky-network failure is one
  click to recover instead of a retype. Evidence: `getUserMessagesForForking` (`agent-session.ts:2892`);
  `editLastMessage` IPC (`ipc.ts:282`); `App.submitEdit` (`App.tsx:348-359`); error banner
  (`StatusBanners.tsx:8-19`). sdkSupport: full (existing path). effort: S.

- **R2 (REL-8) Friendly error classification.** Map the raw `finalError`/error message into a friendly,
  categorized message (offline / timed out / proxy unreachable / provider error / generic) instead of the
  opaque banner string, and pair it with the R1 Retry where retryable. The SDK already owns the canonical
  retryable-network regex (`agent-session.ts:2482-2483`) — port/mirror that classification in main
  (renderer stays pi-free) and ship a category via the error DTO. User value: the banner says what's wrong
  and whether retrying will help. Evidence: error classifier regex (`agent-session.ts:2482-2483`);
  `auto_retry_end.finalError` (`mappers.ts:151-152`, `chatReducer.ts:106-111`); `IpcAgentEvent` error
  variant (`ipc.ts:160`). sdkSupport: partial (classification logic exists; expose a category over IPC).
  effort: S.

- **R3 (REL-5) Persist composer draft + attachments per session.** Save the per-session composer text and
  image attachments to `localStorage` (keyed by sessionId) and restore them on relaunch / session switch,
  so a half-typed message survives a window close. Follow the `pi.expandTools` localStorage pattern
  (`App.tsx:86,145`). User value: no lost drafts. Evidence: transient `input`/`attachments` state
  (`App.tsx:79,88`) cleared on send (`App.tsx:342-343`); `ImageAttachmentDto` (`ipc.ts:102-105`);
  localStorage precedent (`App.tsx:86,145`). sdkSupport: n/a (renderer-only). effort: S.

- **R4 (REL-6) Restore the open-session set + active session on relaunch.** Remember the set of open
  session paths and the focused id across restarts (persisted in main or via localStorage of paths), and
  re-open them on launch instead of the single fresh controller. User value: the workspace comes back the
  way it was left. Evidence: single-controller startup (`sessionPool.ts:141-151`); `activeId` adoption
  (`App.tsx:135`); `openSession` lifecycle (`sessionPool.ts:170-199`, `ipc.ts:286`). sdkSupport: full
  (`openSession` + `SessionManager.open`). effort: S.

- **R5 (REL-7) Surface a corrupt/unreadable session as a recoverable error.** Replace the silent
  fresh-session fallback for a damaged file with an explicit error DTO ("Couldn't open this chat — the
  session file is unreadable") so the user knows the original wasn't lost-and-blanked. User value: no
  silent data confusion; the user can choose to start fresh or restore a backup. Evidence: empty catch
  fall-through (`sessionController.ts:236-244`); SDK's own truncate-on-corrupt
  (`session-manager.ts:797-806`); the existing "Couldn't resume session" error DTO precedent in the pool
  (`sessionPool.ts:178-182,191-196,222-225`). sdkSupport: partial (detect the failure; don't rely on the
  SDK's silent truncation). effort: S.

- **R6 (REL-9) Misconfigured-provider preflight.** When a custom endpoint/key is added (or a key set),
  probe credentials/reachability up front and report a clear failure instead of letting the first turn fail
  mid-conversation. Use `getApiKeyAndHeaders(model)` (the same check `_getRequiredRequestAuth` runs,
  `agent-session.ts:357-381`) and/or a lightweight reachability check in main. User value: fail fast at
  config time, not mid-turn. Evidence: `addCustomProvider`/`setApiKey` persist-then-warm with no probe
  (`sessionPool.ts:407-420,456-488`); `getApiKeyAndHeaders` (`model-registry.ts:684`); friendly auth
  messages (`agent-session.ts:362-380`). sdkSupport: full (auth resolution exists). effort: S.

- **R7 (REL-10) Offer to continue a crash-interrupted turn on resume.** On opening a session whose last
  message is a user turn with no assistant reply (an interrupted turn), detect it and offer a "Continue"
  action that resends/continues that turn. User value: a crash mid-answer doesn't strand the conversation.
  Evidence: `session.messages` getter exposes the entry list (`agent-session.ts:828-830`); transcript
  hydration maps roles (`mappers.ts:173-205`); resume path (`sessionController.ensureLive`/`ensureSession`,
  `sessionController.ts:231-265`). sdkSupport: partial (detection composed from `messages`; reuse the R1
  resend path). effort: S.

- **R8 (REL-11) Single-instance lock.** Call `app.requestSingleInstanceLock()` at startup; on the second
  instance, focus the existing window (via `second-instance`) and quit the new process, so two instances
  can't clobber the shared `~/.pi` JSONL / `models.json` / `proxy.json`. User value: no corrupted shared
  state from an accidental double-launch. Evidence: no lock in `index.ts` (`index.ts:119-147`); shared
  proxy config path (`proxy.ts:16`); shared models.json path (`sessionPool.ts:394-396`). sdkSupport: n/a
  (Electron). effort: S.

- **R9 (REL-12) Auto-create a fresh chat when no controller remains.** When `fallbackActive()` returns
  `undefined` after close/delete (`sessionPool.ts:276-280`), create a fresh live controller in the app dir
  and make it active, so deleting the last chat leaves a usable empty composer rather than a dead blank
  pane. User value: there is always a chat to type into. Evidence: `fallbackActive()` returns `undefined`
  (`sessionPool.ts:276-280`); set as active in close/delete (`sessionPool.ts:238,259`); renderer adopts
  `activeId` (`App.tsx:135`, `deleteSession` `App.tsx:201-224`). sdkSupport: full (`createController`/
  `ensureLive` already exist). effort: S.

- **R10 (DIST-10 / SEC-2 finish) Confine `openSession(path)` to the sessions dir.** Gate the
  renderer-supplied path in `openSession` with the existing `isInSessionsDir(path, sessionsRoot())` guard
  before opening, mirroring `deleteSession`/`deleteSessionByPath` — finishing the audit's deferred SEC-2 so
  no destructive/opening IPC path trusts an arbitrary renderer path. User value (dev/security): the renderer
  can't coax main into reading arbitrary files via a forged path. Evidence: `isInSessionsDir`
  (`sessionPool.ts:39-43`); guarded deletes (`sessionPool.ts:252,268`); unguarded `openSession`
  (`sessionPool.ts:170-199`). sdkSupport: n/a (already in-repo helper). effort: S.

## Acceptance Criteria

- [ ] A failed turn shows a Retry action that resends the last user message as a fresh turn (R1), and the
      banner shows a friendly, categorized message (offline/timeout/proxy/provider/generic) rather than the
      raw error string (R2).
- [ ] Composer draft text + image attachments persist across a window close/relaunch, keyed per session,
      and clear correctly on a successful send (R3).
- [ ] On relaunch the previously open sessions are re-opened and the previously focused session is active
      (R4).
- [ ] Opening a corrupt/unreadable session surfaces an explicit recoverable error DTO instead of silently
      substituting a fresh blank session (R5).
- [ ] Adding a custom provider / setting a key with a bad base URL or key reports a clear failure at
      config time (preflight), not only on the next turn (R6).
- [ ] Resuming a session whose last turn was interrupted (user message, no assistant reply) offers a
      Continue action that resends/continues that turn (R7).
- [ ] A second app instance focuses the existing window and exits without creating a second `SessionPool`
      (R8).
- [ ] Deleting the last remaining chat leaves a fresh, usable chat active (no dead blank pane) (R9).
- [ ] `openSession(path)` rejects (or refuses to open) a path outside pi's sessions dir, via
      `isInSessionsDir`; covered by a unit test on the guard (R10).
- [ ] New main-side logic (error classifier, preflight, single-instance) is unit-tested where it's a pure
      function; renderer-only changes (draft persistence) verified via the screenshot/JS hooks where
      practical.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` all green.
- [ ] The renderer stays pi-free: no `@earendil-works/pi-*` import under `src/renderer/**`; all new
      capabilities cross IPC as `ipc.ts` DTOs.

## Design hints (for the later design.md)

- **R1/R2 (retry + classification):** add a `retry(sessionId)` IPC channel + `PiApi` method (`ipc.ts`,
  preload, `bridge.ts`) routing to a controller method that reuses the
  `getUserMessagesForForking().at(-1)` + resend pattern from `editLastMessage`/`submitEdit`
  (`sessionController.ts:352-367`, `App.tsx:348-359`). For classification, lift the SDK's retryable regex
  (`agent-session.ts:2482-2483`) into a small main-side `classifyError(message)` → category and add an
  optional `category`/`retryable` field to the error DTO (`ipc.ts` error variant + `mappers.ts`
  `assistantErrorText`/`auto_retry_end` mapping). Render the Retry button + friendly copy in
  `StatusBanners.tsx` / `chatReducer.ts` (`error`/`retry` state).
- **R3 (draft persistence):** keep it renderer-only. Persist `input` + `attachments` to
  `localStorage["pi.draft.<sessionId>"]` in `App.tsx` (mirror `pi.expandTools`, `App.tsx:86,145`); hydrate
  on `setActive`/mount; clear on successful send (`App.tsx:342-343`).
- **R4 (restore open set):** persist the open session paths + active id (localStorage of paths, or a small
  JSON in `userData` written from main). On launch, replace the single `init()` controller
  (`sessionPool.ts:141-151`) by re-opening each saved path via `openSession`/`SessionManager.open`
  (respecting `MAX_LIVE` / `parkForCapacity`) and setting the saved active id.
- **R5 (corrupt session):** in `ensureSession`/`ensureLive` (`sessionController.ts:231-265`) distinguish a
  genuine open failure from a normal fresh-session path and forward a `{type:"error", …}` DTO (like the
  pool's "Couldn't resume session", `sessionPool.ts:178-182`) instead of the silent `catch` fall-through;
  consider validating the file has a session header before building.
- **R6 (preflight):** add a `verifyProvider`/preflight step invoked from `addCustomProvider`/`setApiKey`
  (`sessionPool.ts:407,456`) that resolves a model and calls `modelRegistry.getApiKeyAndHeaders(model)`
  (`model-registry.ts:684`) — optionally a minimal reachability ping — and returns/forwards a clear
  failure; surface it in the Settings UI (it already consumes the boolean return).
- **R7 (continue interrupted):** detect a trailing user-only turn from `session.messages`
  (`agent-session.ts:828-830`) when building/opening; expose a flag on `SessionSummaryDto`/transcript or a
  one-shot event, and reuse the R1 resend path for the Continue action.
- **R8 (single-instance):** in `index.ts` (`119-147`) call `app.requestSingleInstanceLock()`; if not
  acquired, `app.quit()`; register `app.on("second-instance", …)` to `show()`/`focus()` the existing
  `mainWindow`.
- **R9 (fresh chat on empty):** in `closeSession`/`deleteSession`, when `fallbackActive()` is `undefined`
  (`sessionPool.ts:276-280`) create a fresh controller (`createController(this.appDir)` + `ensureLive`,
  inside the pool lock) and set it active.
- **R10 (confine openSession):** add `if (!isInSessionsDir(path, this.sessionsRoot())) return …` at the top
  of `openSession` (`sessionPool.ts:170`), matching the delete guards; cover with a unit test like the
  existing `isInSessionsDir` tests.

## Dependencies / sequencing

**Roadmap wave: Wave 1 (of 4)** — recommended execution slot ~#3 of 14.

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after:** nothing — freely orderable within Wave 1.
- **Blocks / do before:** nothing.
- **Why Wave 1:** a batch of small, low-risk reliability wins (retry, draft persistence, single-instance lock, recovery, fresh-chat-on-empty, openSession guard) with strong felt quality.

## Out of scope

- A general retry/backoff policy or changing the SDK's own auto-retry behavior (we only surface + re-trigger).
- Multi-window / tabs / split-pane (single-instance lock in R8 explicitly keeps one window).
- Cloud/remote session sync or session-file repair tooling beyond surfacing the corrupt-file error (R5).
- Any change to upstream pi packages (`packages/**`); main-side classification mirrors, not edits, the SDK.
- Encrypting or relocating the shared `~/.pi` state.

## Notes

- State: planning-only. This is a child of `06-27-desktop-roadmap`. Implement only on the user's
  go-ahead; do not write design.md / implement.md or touch code yet.
- Every Rn is S effort and independently verifiable; group them as a single batched task (shared files:
  `ipc.ts`, `bridge.ts`, `sessionPool.ts`, `sessionController.ts`, `mappers.ts`, `App.tsx`,
  `StatusBanners.tsx`, `index.ts`).
- Verification is token-free where possible: pure-function unit tests (classifier, path guard,
  interrupted-turn detector) + typecheck/lint/build + the dev screenshot hooks. The preflight (R6) may
  need a real endpoint to fully exercise; its failure-message path can be unit-tested with a stub.
