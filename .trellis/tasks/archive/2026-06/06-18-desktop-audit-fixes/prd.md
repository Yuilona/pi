# Desktop audit fixes: setActive concurrency root cause + correctness/security/a11y

## Goal

Fix the defects found by the post-`b96c6f5` multi-dimensional re-audit of `apps/desktop` (the
concurrent-session layer, in-place message editor, sidebar restructuring, dev hooks, and packaging added
in `b96c6f5..HEAD`). The audit confirmed **10** findings and flagged **2** uncertain + **18** minor; the
overall risk was rated **elevated**, dominated by a single root cause in `SessionPool.setActive()`.

This task lands the fixes on branch `fix/desktop-audit` (PR target `main`), in priority batches that are
each independently verifiable, keeping `typecheck` / `lint` / `test` / `build` green throughout.

## Background

`SessionPool.setActive()` (`apps/desktop/src/main/agent/sessionPool.ts:181-189`) revives a parked session
with a synchronous fire-and-forget `void c.ensureLive(c.sessionFile())` that runs **outside `poolLock`,
without `parkForCapacity()`, and without a `.catch`**. That one line is the root cause of five distinct
user-visible defects (cap defeated, swallowed errors, blank-transcript race, disposed-controller rebuild
leak, wrong model pill). The remaining findings are independent correctness, security, and a11y issues.
Architecture boundary (renderer pi-free) and XSS were checked and found clean.

## Scope (decided)

- **Full scope: P0 + P1 + P2.** P2 (a11y / polish / dead-code) items are best-effort but in scope.
- **MAINT-1**: restore the background-approval OS notification (fix the regression), not delete the path.
- **Branch**: `fix/desktop-audit`, PR base `main`.

## Requirements

### P0 — Concurrency root cause (highest priority)

- **R0.1 (RES-1, high)** Focusing a previously-parked session must enforce `MAX_LIVE`: `setActive`'s unpark
  path must call `parkForCapacity()` so live-controller count stays bounded under normal session switching.
- **R0.2 (ERR-1, high)** Reviving a parked session must not throw an unhandled main-process rejection: a
  failed `ensureLive` (corrupt/removed/permission-denied JSONL) must forward a `Couldn't resume session: …`
  error DTO to the renderer, mirroring `openSession`.
- **R0.3 (ERR-2, medium)** Focusing a parked session must not render a blank transcript: the renderer's
  `getTranscript` must observe the rebuilt session (main awaits the rebuild before resolving `setActive`,
  or the renderer routes parked rows through an awaited open).
- **R0.4 (CONC-2, medium)** A `setActive` unpark must not race `close/deleteSession`: the unpark must
  serialize on `poolLock`, and `SessionController` must carry a `disposed` flag that makes a post-dispose
  `ensureLive/ensureSession/buildSession` a no-op (no rebuilt-on-removed-controller leak).
- **R0.5 (TYPE-1, medium)** A model pick that triggers a rebuild must not show the old model: after
  `setModel`, `currentModel` (hence `summary().model`) must reflect the model actually applied.
- **R0.6 (ERR-4, medium)** The `openSession` dedup-revive branch must be `try/catch`-guarded like the
  fresh-open branch (forward the same error DTO).

### P1 — Correctness & security

- **R1.1 (REACT-1, medium)** Editing a message then switching sessions before the awaits resolve must NOT
  deliver the edited text to the wrong session: the rewind and the resend must address the same captured
  `sessionId`.
- **R1.2 (ERR-3, medium)** `setModel` failures must surface as an `error` event/DTO (like `compact`), not
  an unhandled rejection across IPC.
- **R1.3 (MAINT-1, medium)** A background session hitting an approval gate fires an **OS notification**
  (restore the old single-session behavior); the `notify('approval')` path is no longer dead.
- **R1.4 (SEC-1, medium)** The `PI_SHOT` / `PI_JS` / `PI_JS_FILE` dev hooks must be gated on dev
  (`!app.isPackaged`), so a packaged build cannot be coerced via env vars into running arbitrary renderer
  JS / reading arbitrary files.
- **R1.5 (SEC-2, medium · uncertain)** Destructive/opening IPC paths (`deleteSessionFile`, `deleteSession`,
  `openSession`) must confine the renderer-supplied path to the pi sessions dir before `rmSync`/`open`.

### P2 — a11y, DESIGN fidelity, robustness, dead code (best-effort, in scope)

- **R2.1 (UX-1, medium)** Sidebar delete button revealed on keyboard focus (`:focus-within`/`:focus-visible`),
  not `:hover` only.
- **R2.2 (UX-2/3/5)** In-place editor hint meets WCAG AA contrast; sidebar status badges get
  screen-reader text + the approval badge a distinct (non-color-only) form; the in-place editor restores
  focus to its trigger on close.
- **R2.3 (UX-4)** Lightbox scrim/close-button colors reference the `--scrim` / DESIGN tokens, not magic rgba.
- **R2.4 (ERR-7)** `isRefusalTitle` also catches `not able to` / spaced `can not` refusal phrasings.
- **R2.5 (REACT-2)** `ApprovalDialog` re-traps focus for each queued approval (`key`/dep on `request.id`).
- **R2.6 (REACT-3)** `cycleMode` performs its `setMode` IPC side effect outside the `setState` updater.
- **R2.7 (TYPE-2)** A thinking-level chosen while parked is re-applied on rebuild, not silently dropped.
- **R2.8 (CONC-5/CONC-3)** Same-session double-send coalesces instead of surfacing a raw
  "Agent is already processing"; `park()` runs through the controller op-lock.
- **R2.9 (S0-FALLBACK)** Global auth/provider errors are not routed to a fabricated `s0` id that the UI
  never renders (surface via the boolean return or a named system channel).
- **R2.10 (SEC-4)** Add a restrictive CSP to the renderer (defense-in-depth).
- **R2.11 (MAINT-2/3, RES-2)** Remove dead `cwdPath()`; extract the duplicated `runExclusive` mutex into
  one shared helper; `dispose()` clears `lastActive`.

## Constraints

- **C1.** Preserve the hard architecture rule: pi SDK in main only; renderer stays pi-free (no
  `@earendil-works/pi-*` import under `src/renderer/**`); IPC stays the typed DTO contract.
- **C2.** Preserve the concurrency invariants the audit confirmed good: per-controller coalescer, never
  park the active/running session, `prompt()` runs outside the op-lock. Fixes tighten `setActive`, not the
  mutex design.
- **C3.** No regression to the verified concurrent-session acceptance criteria (AC1–AC6 of
  `06-18-concurrent-sessions`).
- **C4.** Windows/CN dev norms; no emoji to the GBK console; commit messages ASCII-only.

## Acceptance Criteria

- [ ] **AC1 (P0).** `setActive` is async, routes the unpark through `poolLock`, calls `parkForCapacity()`
      first, awaits `ensureLive`, and forwards an error DTO on failure. `SessionController` has a `disposed`
      flag honored by `ensureLive/ensureSession/buildSession`. A new unit test exercises: focus-parked keeps
      live count ≤ `MAX_LIVE`; a revive failure forwards an error (not an unhandled rejection); dispose
      before a scheduled rebuild yields no live session.
- [ ] **AC2 (P0).** Switching to a parked session shows its real transcript (no blank-then-refresh); the
      model/thinking pill reflects the applied value after a parked-session model/thinking change (TYPE-1/2).
- [ ] **AC3 (P1).** Edit-then-switch-before-resolve delivers the edited message to the edited session only
      (REACT-1); covered by a renderer reducer/helper test where feasible.
- [ ] **AC4 (P1).** `setModel`/`editLastMessage`/`openSession`-revive failures surface as error DTOs, not
      unhandled rejections (ERR-3/ERR-4/ERR-6).
- [ ] **AC5 (P1).** A background session's approval fires an OS `Notification` when it is not the active
      session; `notify('approval')` is reached (MAINT-1). Verified token-free by unit-testing the
      notify-trigger predicate / dead-code removal of the unreachable branch.
- [ ] **AC6 (P1 security).** Packaged build: the `PI_*` hooks are compiled out of the production path
      (gated on `!app.isPackaged`) (SEC-1). Destructive IPC paths reject out-of-tree paths (SEC-2);
      covered by a unit test on the path-confinement guard.
- [ ] **AC7 (P2).** The a11y/DESIGN/robustness items (R2.*) are addressed or explicitly deferred with a
      one-line note in `implement.md`; no half-done item left undocumented.
- [ ] **AC8.** `npm run typecheck && npm run lint && npm run test && npm run build` all green;
      `grep` confirms no `@earendil-works/pi-*` import under `src/renderer/**`; new tests pass.

## Out of scope

- Re-architecting the session pool / mutex design (the audit found it sound).
- Tabs / split-pane multi-view, cross-session hand-off (already out of scope for concurrent-sessions).
- Code-signing the packaged build (SmartScreen warning is expected for an unsigned local build).
- Any change to upstream pi packages (`packages/**`).

## Notes

- Single task (not a parent/child tree): the P0/P1 fixes are tightly coupled in
  `sessionPool.ts` / `sessionController.ts` and share files; batched ordering lives in `implement.md`.
- Source of requirements: the re-audit report (workflow `wf_3cdf7c6d-b28`), summarized in this conversation.
- Verification is token-free (static + unit tests + screenshot hooks); no live API-spending run is required
  to validate these fixes.
