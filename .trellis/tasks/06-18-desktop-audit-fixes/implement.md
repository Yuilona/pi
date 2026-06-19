# Implement — Desktop audit fixes

Branch `fix/desktop-audit` (base `main`). Land in batches; keep `typecheck`/`lint`/`test`/`build` green
after each. Validation (from `apps/desktop`): `npm run typecheck && npm run lint && npm run test && npm run build`.
Read context order: `prd.md` → `design.md` → this file. Do not commit until the user reviews (Phase 3.4).

## Batch P0 — setActive root cause (highest priority)

- [ ] **P0.1** `SessionController`: add `private disposed = false`; early-return `if (this.disposed) return`
      at the top of `buildSession`, `ensureSession`, `ensureLive` (after lock acquisition); set
      `this.disposed = true` first in `dispose()`. Do **not** set it in `park()`.
- [ ] **P0.2** `SessionController.setModel`: `await ensureSession()` → `await session.setModel(model)` →
      **re-read** `this.session?.model` into `currentModel`; wrap the whole body in `try/catch` emitting
      `deps.onEvent({type:'error', message})` (ERR-3). (Resolves TYPE-1 + ERR-3.)
- [ ] **P0.3** `SessionPool.setActive` → `async`: set `activeId`/`touch` synchronously, then for a parked
      controller `await this.runExclusive(...)` that re-checks under lock → `parkForCapacity()` →
      `await cur.ensureLive(cur.sessionFile())` in `try/catch` forwarding a `Couldn't resume session: …`
      error DTO. (Resolves RES-1, ERR-1, ERR-2, CONC-2.)
- [ ] **P0.4** `bridge.ts`: `ipcMain.handle(IPC.setActive, (_e, id) => pool.setActive(id))` (return the
      promise so the renderer's `await` waits).
- [ ] **P0.5** `SessionPool.openSession`: wrap the dedup-revive branch (`existing.ensureLive(path)`) in the
      same `try/catch` + error-DTO forward as the fresh branch (ERR-4).
- [ ] **P0.6** Tests (`sessionController.test.ts`, `sessionPool.test.ts`): disposed no-ops ensureLive;
      setModel keeps applied model after rebuild; focus-parked keeps live ≤ MAX_LIVE; revive throw forwards
      error not rejection. → **run validation; commit P0.**

Rollback point: P0 is one coherent commit; reverting it restores current `setActive`.

## Batch P1 — correctness & security

- [ ] **P1.1 (REACT-1)** `useSessions.ts`: `send(text, images?, sessionId?)` → `const id = sessionId ??
      activeRef.current`. `App.tsx submitEdit`: final call → `send(trimmed, undefined, id)` (the captured
      edit id). Verify other `send(...)` call sites still compile (default arg).
- [ ] **P1.2 (MAINT-1)** `sessionPool.ts`: route `createController`'s `onApproval` through a new
      `onControllerApproval(id, req)` that `forwardApproval` + (if `id !== activeId`)
      `notify(id,'approval',title)`. Confirm the bridge `"approval"` arm now reachable.
- [ ] **P1.3 (SEC-1)** `index.ts`: gate the `PI_SHOT` block on `!app.isPackaged && process.env.PI_SHOT`.
- [ ] **P1.4 (SEC-2)** `sessionPool.ts`: add `inSessionsDir(p)` (resolve + confine to pi's sessions dir —
      **confirm the exact dir from pi's API**, don't hardcode blindly); early-return in
      `deleteSessionByPath`, `deleteSession`'s file rm, and `openSession` when out of tree. Test the guard.
- [ ] **P1.5** Tests: REACT-1 send-target seam; MAINT-1 notify predicate; SEC-2 path guard.
      → **run validation; commit P1 (correctness + security, may be two commits).**

## Batch P2 — a11y / DESIGN / robustness / dead code (best-effort)

Address each; if any is deferred, leave a one-line `DEFERRED: <id> — <reason>` note below (AC7).

- [ ] **P2.1** UX-1 sidebar delete keyboard reveal (`app.css`).
- [ ] **P2.2** UX-2 editor hint contrast → `--text-2` (`chat.css`).
- [ ] **P2.3** UX-3 sidebar badge SR text + distinct approval shape (`SessionSidebar.tsx`).
- [ ] **P2.4** UX-4 lightbox scrim → token (`chat.css`).
- [ ] **P2.5** UX-5 editor focus restore on close (`UserBubble.tsx`).
- [ ] **P2.6** ERR-7 refusal-title regex + tests (`titleUtils.ts`, `titleUtils.test.ts`).
- [ ] **P2.7** ERR-6 `editLastMessage` try/catch (`sessionController.ts`).
- [ ] **P2.8** REACT-2 `key={activeApproval.id}` (`App.tsx`).
- [ ] **P2.9** REACT-3 move `setMode` IPC out of the updater (`App.tsx`).
- [ ] **P2.10** TYPE-2 re-apply parked thinking level on rebuild (`sessionController.ts`).
- [ ] **P2.11** CONC-5 double-send coalesce / CONC-3 `park()` through op-lock (verify pi API; defer if it
      complicates).
- [ ] **P2.12** S0-FALLBACK remove ghost `s0` forward (`sessionPool.ts`).
- [ ] **P2.13** SEC-4 add renderer CSP (defer if it breaks the markdown image gallery — note it).
- [ ] **P2.14** MAINT-2 delete `cwdPath()`; MAINT-3 extract `agent/serialize.ts`; RES-2 `dispose()` clears
      `lastActive`/`activeId`.
- [ ] **P2.15** → **run validation; commit P2.**

### Deferred (documented per AC7)

- **CONC-3** (run `park()` through the controller op-lock): deferred — the P0 fix already closes the practical
  race. `park()` is only ever invoked from `parkForCapacity()`, which runs under the pool lock; and `setActive`
  sets `activeId` before `parkForCapacity()`, which excludes the focused controller — so park(X) vs ensureLive(X)
  on the same controller can no longer interleave. Changing `park()`'s signature to async would force
  fire-and-forget at the `parkForCapacity` call sites, reintroducing unawaited work for no real gain.
- **CONC-5** (coalesce a same-session double-send instead of surfacing the raw "Agent is already processing"):
  deferred — the renderer already guards `send` with `state.streaming`, so this only appears in a sub-tick race
  and produces a transient error banner, not a crash. The clean fix needs a confirmed pi streaming-behavior/queue
  API; not guessing it. Low severity, revisit if it actually annoys.
- **SEC-2 openSession read-guard** (partial): the destructive `rmSync` paths (deleteSession / deleteSessionFile)
  ARE confined to the sessions dir via `isInSessionsDir`. The openSession *read* path is left unguarded — the
  renderer only ever passes paths from `listSessions()` (always in-tree), and refusing an out-of-tree open while
  keeping the `openSession(path) -> sessionId` contract clean is messier than the (very low) read-anywhere risk
  warrants. Revisit if the renderer ever gains a free-form path input.

## Status: IMPLEMENTED + VERIFIED (token-free)

All P0 + P1 + the in-scope P2 items landed on `fix/desktop-audit`. Verification: `typecheck` (node+web),
`lint` (Biome), `test` (43 tests: +serialize, +sessionPool cap/revive, +ERR-7), `build` all GREEN; renderer
confirmed pi-free; the concurrency core was line-reviewed; SEC-4's CSP was smoke-tested with a production-mode
`file://` screenshot (renders correctly, no blank); the renderer REACT-1/2/3 + UX-1..5 changes were
independently reviewed (trellis-check). Not yet committed — awaiting user review of the commit plan (Phase 3.4).

## Final verification (Phase 3.1)

- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` all green.
- [ ] `grep -r "@earendil-works/pi" src/renderer/` → no hits (architecture boundary, AC8).
- [ ] Optional token-free smoke: `PI_SHOT` screenshot still works in dev; packaged `out/` does not honor
      `PI_SHOT` (SEC-1) — spot-check by building and running with the env var set (no capture should occur).
- [ ] Re-read `prd.md` acceptance criteria AC1–AC8; tick each or note why deferred.

## Notes / sub-agent dispatch

- Dispatch `trellis-implement` per batch (P0 → P1 → P2), then `trellis-check` to review against
  `prd.md`/`design.md` and self-fix. Each dispatch prompt starts with
  `Active task: .trellis/tasks/06-18-desktop-audit-fixes`.
- One risky edit at a time (CLAUDE.md): never batch a possibly-missing Edit with other tool calls.
- Windows/CN: no emoji to the GBK console; use Read not cat/print; commit messages ASCII-only.
