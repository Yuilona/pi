# Design — Desktop audit fixes

All line numbers are against `HEAD` (branch `fix/desktop-audit`, base `main`) at planning time and are
anchors, not contracts — the implement step reads the live code. Illustrative code sketches show intent.

## 0. Principles

- **Minimal, surgical fixes.** The audit confirmed the pool/mutex design is sound; we tighten `setActive`
  and a handful of error/contract paths — no re-architecture.
- **Funnel failures into `error` events**, never let a rejection cross IPC unhandled (the house pattern:
  `prompt`/`compact` already `try/catch → deps.onEvent({type:'error'})`).
- **Token-free verifiable.** Every behavioral fix gets a pure unit test or a static guarantee; no
  API-spending run is needed.

---

## 1. Batch P0 — the `setActive` root cause (+ ERR-4)

### 1.1 `SessionPool.setActive` → async, locked, capacity-enforced, error-surfacing

Today (`sessionPool.ts:181-189`):

```ts
setActive(sessionId: string | null): void {
  this.activeId = sessionId ?? undefined;
  if (sessionId) {
    this.touch(sessionId);
    const c = this.controllers.get(sessionId);
    if (c?.isParked()) void c.ensureLive(c.sessionFile()); // fire-and-forget, no lock, no cap, no catch
  }
}
```

Target:

```ts
async setActive(sessionId: string | null): Promise<void> {
  this.activeId = sessionId ?? undefined;
  if (!sessionId) return;
  this.touch(sessionId);
  const c = this.controllers.get(sessionId);
  if (!c?.isParked()) return;
  await this.runExclusive(async () => {
    // Re-check under the lock: a concurrent close/delete may have removed it.
    const cur = this.controllers.get(sessionId);
    if (!cur || !cur.isParked()) return;
    this.parkForCapacity();                  // RES-1: keep live count ≤ MAX_LIVE
    try {
      await cur.ensureLive(cur.sessionFile()); // ERR-2: awaited, so the renderer's getTranscript sees it
    } catch (e) {
      this.deps.forward(sessionId, {          // ERR-1: surface instead of unhandled-reject
        type: "error",
        message: `Couldn't resume session: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });
}
```

This single change resolves **RES-1, ERR-1, ERR-2, and CONC-2** (the unpark now serializes on `poolLock`
against `closeSession`/`deleteSession`). `parkForCapacity()` already excludes the active id and running
sessions, so it never parks the row being focused.

**IPC impact (none breaking):** `IPC.setActive` is already an `ipcMain.handle` (`bridge.ts:72`) and the
preload type is `setActive(...): Promise<void>` (`ipc.ts:296`); the renderer already
`await window.pi.setActive(id)` then `await loadTranscript(id)` (`useSessions.ts:88-89`). Change the bridge
handler to **return** the promise so the await actually waits:

```ts
ipcMain.handle(IPC.setActive, (_e, sessionId: string | null) => pool.setActive(sessionId));
```

`init()` (`sessionPool.ts:128`) sets `activeId` directly and stays sync — fine; it builds the first
controller itself.

### 1.2 `SessionController` disposed flag (CONC-2 belt-and-suspenders)

Even with the lock, add a hard guard so a rebuild can never resurrect a disposed controller:

```ts
private disposed = false;
// top of ensureLive(), ensureSession(), buildSession():
if (this.disposed) return;
// dispose():
dispose(): void { this.disposed = true; this.teardownRuntime(); this.currentSessionFile = undefined; }
```

`ensureLive` already runs inside `runExclusive`; the `if (this.disposed) return` after lock acquisition
makes a post-dispose rebuild a no-op. (`park()` must NOT set `disposed` — a parked controller is revivable.)

### 1.3 TYPE-1 — model pill reflects the applied model

`setModel` (`sessionController.ts:407-415`) sets `currentModel`, then `ensureSession()` may rebuild and
`buildSession` overwrites `currentModel` from the persisted model (`:167-170`). Fix: re-read after applying.

```ts
async setModel(provider: string, id: string): Promise<void> {
  return this.runExclusive(async () => {
    if (this.disposed) return;
    const model = this.auth.modelRegistry.find(provider, id);
    if (!model) return;
    await this.ensureSession();
    await this.session?.setModel(model);
    const m = this.session?.model;            // re-read what was actually applied
    this.currentModel = m
      ? { provider: m.provider, id: m.id, label: m.name, available: true }
      : { provider: model.provider, id: model.id, label: model.name, available: true };
  });
}
```

### 1.4 ERR-4 — guard the `openSession` dedup-revive branch

`sessionPool.ts:159` — the already-known-controller branch isn't wrapped like the fresh branch
(`:165-172`). Wrap it identically:

```ts
if (existing.isParked()) {
  try { await existing.ensureLive(path); }
  catch (e) {
    this.deps.forward(existing.id, {
      type: "error",
      message: `Couldn't resume session: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
```

---

## 2. Batch P1 — correctness & security

### 2.1 REACT-1 — `send` takes an explicit target id

`useSessions.ts:114-118` hard-wires `send` to `activeRef.current`. Make the target explicit so an
edit-then-resend always addresses the captured session:

```ts
const send = useCallback((text: string, images?: ImageAttachmentDto[], sessionId?: string) => {
  const id = sessionId ?? activeRef.current;
  if (!id) return;
  void window.pi.send(id, text, images);
}, []);
```

`App.tsx submitEdit` (≈350-361) captures `const id = activeIdRef.current` for `editLastMessage(id)` +
`loadTranscript(id)`; change its final `send(trimmed)` → `send(trimmed, undefined, id)`. Default-arg keeps
all existing `send(text)` / `send(text, images)` call sites working.

### 2.2 ERR-3 — `setModel` surfaces failures as an error event

Wrap the `setModel` body (now in 1.3) so `ensureSession`/`session.setModel` throwing emits an error event
instead of rejecting across IPC (mirror `compact`, `sessionController.ts:399-405`):

```ts
async setModel(provider, id) {
  return this.runExclusive(async () => {
    try { /* find + ensureSession + setModel + re-read (from 1.3) */ }
    catch (err) { this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) }); }
  });
}
```

(Optionally also wrap `editLastMessage`'s `navigateTree` — ERR-6, P2 — same pattern, returning `null` on
throw so the renderer's `original == null` no-op path catches it.)

### 2.3 MAINT-1 — background approval fires an OS notification (restore regression)

The `notify` dep + the bridge `"approval"` arm already exist; only the call is missing. Route approvals
through a pool method that mirrors `onControllerEvent`:

```ts
// createController():
onApproval: (req) => this.onControllerApproval(id, req),

private onControllerApproval(id: string, req: ApprovalRequest): void {
  this.deps.forwardApproval(id, req);
  if (id !== this.activeId) {
    this.deps.notify(id, "approval", this.controllers.get(id)?.summary().title ?? "Chat");
  }
}
```

Now a background session that hits a bash/edit/write gate both badges the sidebar AND fires the OS
notification; the active session keeps the inline `ApprovalDialog` with no duplicate toast.

### 2.4 SEC-1 — dev-gate the `PI_*` screenshot hooks

`index.ts:72` gates only on `process.env.PI_SHOT`. Add a packaged-build guard (the import `app` is already
in scope; `isDev` at `:8` is renderer-URL-based and dev-server-only, so prefer `!app.isPackaged` which also
covers `electron .` from a built `out/`):

```ts
if (!app.isPackaged && process.env.PI_SHOT) { /* …existing block… */ }
```

This compiles the arbitrary-JS / arbitrary-file-read capability out of any shipped build while keeping the
dev tooling for `npm run dev` / `PI_SHOT` runs.

### 2.5 SEC-2 — confine destructive/opening IPC paths to the sessions dir

`deleteSessionByPath` (`:225`), `deleteSession`'s `rmSync` (`:215`), and `openSession`'s path
(`:155-166`) take a renderer-supplied string straight into `rmSync(force)` / `SessionManager.open`. Add a
guard that resolves the path and confirms it is inside pi's sessions directory before any rm/open:

```ts
// derive ONCE from pi (must equal the dir SessionManager.listAll() enumerates):
private sessionsDir = join(getAgentDir(), "sessions"); // implement: CONFIRM the exact subdir against pi
private inSessionsDir(p: string): boolean {
  const root = resolve(this.sessionsDir);
  const r = resolve(p);
  return r === root || r.startsWith(root + sep);
}
```

`deleteSessionByPath` / `deleteSession`(file) / `openSession` early-return (and forward a benign error or
no-op) when `!inSessionsDir(path)`. **Implement note:** verify the exact sessions dir from pi's API rather
than hardcoding `"sessions"` — if pi exposes a `getSessionsDir()`/equivalent, use it (research point).

---

## 3. Batch P2 — a11y, DESIGN fidelity, robustness, dead code (best-effort)

| Item | File(s) | Approach |
|---|---|---|
| **UX-1** delete btn keyboard reveal | `styles/app.css:127-136` | add `.sess-wrap:focus-within .sess-del` + `.sess-del:focus-visible { opacity:1 }` |
| **UX-2** editor hint contrast | `styles/chat.css:99-103` | `.bubble-edit-hint` color `--text-3` → `--text-2` (AA on surface-2) |
| **UX-3** sidebar badges SR/colorblind | `SessionSidebar.tsx:201-203` | add visually-hidden text per state; give approval badge a distinct shape/icon (not red-vs-terracotta only) |
| **UX-4** lightbox scrim token | `styles/chat.css:584` | reference `--scrim` (or a named lightbox token) instead of raw rgba |
| **UX-5** editor focus restore | `UserBubble.tsx:54-100` | remember trigger (or `document.activeElement`) on open; `.focus()` it when `editing` → false |
| **ERR-7** refusal-title gaps | `titleUtils.ts:52-56` (+ test) | extend regex: `not able`, spaced `can not`; add unit cases |
| **ERR-6** editLastMessage error | `sessionController.ts:346-356` | try/catch `navigateTree`; return `null` on throw |
| **REACT-2** approval re-trap | `App.tsx:485` | `key={activeApproval.id}` on `ApprovalDialog` (remounts → re-runs `useModalFocus`) |
| **REACT-3** impure updater | `App.tsx:271-277` | compute `next` outside, then `setMode(next)` + `void window.pi.setMode(next)` (mirror `applyMode`) |
| **TYPE-2** parked thinking lost | `sessionController.ts:171,417-420,448` | after `buildSession`, re-apply remembered `thinkingLevel` instead of reading it back; run `setThinking` consistently |
| **CONC-5** double-send raw error | `sessionController.ts:285-309` | if already streaming, pass `{streamingBehavior:'followUp'}` or no-op the 2nd prompt (verify pi API) |
| **CONC-3** park bypasses op-lock | `sessionController.ts:275-282` | run `park()` through `runExclusive` (largely closed by P0 routing unpark under poolLock) |
| **S0-FALLBACK** ghost id | `sessionPool.ts:373,441` | drop the `?? "s0"` forward; surface the failure via the existing boolean return (Settings UI) or a named `SYSTEM_SESSION_ID` |
| **SEC-4** no CSP | `renderer/index.html` or main `onHeadersReceived` | add a restrictive CSP (`script-src 'self'`; `img-src 'self' https: data:`; etc.) |
| **MAINT-2** dead `cwdPath()` | `sessionController.ts:433-435` | delete (callers use `summary().cwd`) |
| **MAINT-3** duplicated mutex | `sessionPool.ts:71-78`, `sessionController.ts:135-142` | extract `agent/serialize.ts` (`createSerializer()`); both hold an instance |
| **RES-2** dispose leaks map | `sessionPool.ts:463-466` | `this.lastActive.clear(); this.activeId = undefined;` |

Any P2 item that proves riskier than its payoff (e.g. CONC-5 if the pi streaming-behavior API doesn't fit,
or SEC-4 if a CSP breaks the markdown image gallery) is **deferred with a one-line note in `implement.md`**,
not silently dropped (AC7).

---

## 4. Testing strategy (token-free)

- **Pool unit tests** (`sessionPool.test.ts`, new or extend): fake controllers / inject `SessionController`
  test doubles to assert: focusing parked sessions keeps live ≤ `MAX_LIVE`; a revive throw forwards an
  `error` (no unhandled rejection); a `dispose()` before a queued `ensureLive` yields no live session;
  `inSessionsDir` rejects out-of-tree paths.
- **Controller unit tests**: `disposed` no-ops `ensureLive`; `setModel` leaves `currentModel` = applied
  model after a rebuild (TYPE-1); MAINT-1 notify predicate (`id !== activeId`).
- **`titleUtils.test.ts`**: add ERR-7 phrasings.
- **Reducer/helper test**: REACT-1 — `send(text, undefined, id)` targets `id` not the active ref (test the
  `send` wiring at the seam, or assert `window.pi.send` is called with the captured id via a mock).
- **Static**: `grep` no `@earendil-works/pi-*` under `src/renderer/**`; `app.isPackaged` gate present;
  `typecheck`/`lint`/`build` green.

Mocking pi: tests construct controllers with a fake `AuthBundle` / stub the `@earendil-works/pi-*` modules
(vitest `vi.mock`) so no real SDK/model is needed. Where mocking the SDK is heavy, prefer testing the pure
seams (predicates, path guard, reducer wiring) rather than the whole controller.

---

## 5. Compatibility / rollout / rollback

- **Additive + behavior-preserving.** JSONL/session format unchanged (pi-citizen); the only contract touch
  is `setActive` now genuinely awaits (already typed `Promise<void>`), and `send` gains an optional 3rd
  arg (default-compatible). No renderer↔main shape break.
- **Branch `fix/desktop-audit` → PR to `main`.** Each batch (P0 / P1-correctness / P1-security / P2) is a
  logical commit, so a single batch can be reverted independently.
- **Risk-ranked landing order:** P0 first (highest impact, most coupled), then P1, then P2. Re-run
  `typecheck`/`lint`/`test`/`build` after each batch.

---

## 6. Touch list

- **Main:** `sessionPool.ts` (setActive, openSession guard, onControllerApproval, SEC-2 guard, S0 fallback,
  dispose, mutex extract), `sessionController.ts` (disposed flag, setModel re-read+try/catch, TYPE-2,
  CONC-3/5, ERR-6, drop `cwdPath`), `bridge.ts` (return setActive promise), `index.ts` (SEC-1 gate), new
  `agent/serialize.ts` (MAINT-3).
- **Shared:** `ipc.ts` — no shape change expected (setActive already `Promise<void>`); update a doc comment
  if `notify('approval')` semantics are clarified.
- **Renderer:** `useSessions.ts` (`send` 3rd arg), `App.tsx` (submitEdit target, REACT-2 key, REACT-3
  updater), `UserBubble.tsx` (UX-5), `SessionSidebar.tsx` (UX-3), `titleUtils.ts` (ERR-7),
  `styles/app.css` + `styles/chat.css` (UX-1/2/4), `renderer/index.html` or main (SEC-4 CSP).
- **Tests:** `sessionPool.test.ts`, `sessionController.test.ts` (new), `titleUtils.test.ts` (extend),
  `useSessions.test.ts` (extend for REACT-1 seam).
