# Test and devex debt: jsdom hooks + SessionPool↔SessionController lifecycle integration test

## Goal

Pay down the test/devex debt left after the 0.2.0 "5-in-1" audit fix: lock the park/unpark/LRU/dispose/revive
invariants of `SessionPool`↔`SessionController` behind a real integration test against a fake `AgentSession`,
and add a jsdom vitest project so renderer hooks/reducers can be tested under a real React render instead of
re-implementing their logic by hand.

## Background

The desktop app already has a small, fast unit suite (`apps/desktop/vitest.config.ts:8-19`) that runs in a
plain Node env over the **pure** helpers and framework-free reducers (math/title/schema normalization, the
event id factory, the per-session slice reducer). Two structural gaps remain:

1. **No real lifecycle integration test for the pool.** The 0.2.0 audit fix hardened
   `SessionPool.setActive()`'s unpark path — it now serializes on the pool lock, calls `parkForCapacity()`,
   awaits `ensureLive`, and forwards an `error` DTO on failure (`sessionPool.ts:205-228`) — and added a
   `disposed` flag to `SessionController` so a late rebuild no-ops (`sessionController.ts:88, 144, 233, 250,
   420, 469-473`). But the only test added in 0.2.0 (`sessionPool.test.ts:113-170`) is a deliberately
   "best-effort" cap + revive-error check. It mocks `./sessionController.js` entirely with a `FakeCtl`
   (`sessionPool.test.ts:35-90`), so it never exercises the **real** `SessionController` state machine
   (`buildSession`/`teardownRuntime`/`park`/`ensureSession`/`dispose`, `sessionController.ts:142-288`) against
   a fake `AgentSession`. The audited invariants — LRU victim selection (`parkForCapacity`,
   `sessionPool.ts:124-137`), never-park-the-running-session, the disposed-controller no-op, dedup-by-file in
   `openSession` (`sessionPool.ts:170-199`), revive-from-JSONL — have no end-to-end coverage tying the two
   classes together.

2. **Renderer hooks can't be rendered in the test env.** `vitest.config.ts` pins `environment: "node"` with
   no jsdom and no `@testing-library/react` (none in `apps/desktop/package.json:29-51`). As a result
   `useSessions.test.ts` cannot mount the actual hook: it tests `metaReducer` directly (fine — that's a pure
   function) but for the `send` target-resolution contract it **re-implements** the hook's logic in a local
   `resolveSendTarget` helper (`useSessions.test.ts:72-88`) rather than rendering `useSessions` and asserting
   that `window.pi.send` is called with the right id. The comment there says so explicitly: "The hook itself
   can't be rendered here (vitest runs in a plain `node` env with no jsdom/testing-library)". This means the
   edit-then-switch race fix (REACT-1) is only verified against a copy of the logic, not the real
   `useCallback`/`useRef` closure in `useSessions.ts:114-118`.

This child task owns closing both gaps. It is test/devex only — no product code change is required (the source
under test is already correct; the goal is to lock it in and make future hook tests possible).

## Requirements

- **R1 (PERF-10) — SessionPool↔SessionController lifecycle integration test.** A new integration test that
  drives the **real** `SessionPool` against the **real** `SessionController`, with only the pi SDK leaf
  (`AgentSession` + `SessionManager`/auth/createAgentSession) replaced by in-memory fakes, asserting the
  audited invariants end-to-end:
  - filling past `MAX_LIVE` (6) parks the **least-recently-used idle** controller, never the active or a
    running one (`parkForCapacity`, `sessionPool.ts:124-137`);
  - `setActive` on a parked controller revives it (rebuilds a live `AgentSession`), enforces the cap first,
    and the renderer's `getTranscript` sees the rebuilt session (`sessionPool.ts:205-228` →
    `sessionController.ts:248-265, 385-387`);
  - a revive whose JSONL fails to reopen forwards a `Couldn't resume session: …` `error` DTO and does **not**
    throw an unhandled rejection (`sessionPool.ts:219-226`);
  - `dispose()` (or `closeSession`) before a queued rebuild leaves no live session — the `disposed` no-op
    holds end-to-end (`sessionController.ts:144, 233, 469-473`);
  - `openSession` dedups by file (same path → same controller id, parked one is revived rather than
    duplicated) (`sessionPool.ts:170-199`).
  - **Value (dev):** locks in the most expensive defect class this app ever shipped (the 5-in-1 audit bug)
    so a future refactor of either class can't silently regress park/revive/cap/dispose.
  - **Evidence:** `sessionPool.ts:124-137, 170-199, 205-228`; `sessionController.ts:142-288, 469-473`;
    current best-effort-only coverage at `sessionPool.test.ts:113-170`.
  - **sdkSupport:** the fake mirrors the SDK leaf the controller touches:
    `createAgentSession({...}) → { session }` (`packages/coding-agent/src/index.ts:182`,
    `sessionController.ts:153-161`), `AgentSession` surface used by the controller
    (`session.subscribe`/`dispose`/`sessionFile`/`model`/`messages`/`thinkingLevel`/`isStreaming`,
    `agent-session.ts:256`), and `SessionManager.create`/`.open`/`.listAll`
    (`session-manager.ts:1393, 1404, 1516`). Same `vi.hoisted()` doubles pattern already proven in
    `sessionPool.test.ts:31-111`, but mocking `@earendil-works/pi-coding-agent`/`@earendil-works/pi-ai`
    instead of `./sessionController.js` so the real controller runs.
  - **Effort:** L.

- **R2 (PERF-9) — jsdom vitest project + Testing Library for renderer hooks.** Split the vitest config into
  two projects/environments — a **node** project for the existing main-process + pure-helper tests, and a
  **jsdom** project for renderer hooks/components — and add `@testing-library/react` (+ `jsdom`, and
  `@testing-library/jest-dom` if asserting DOM) as devDeps, so hooks can be tested under a real render.
  Migrate the `send` target-resolution assertions in `useSessions.test.ts:72-88` to actually `renderHook`
  `useSessions`, stub `window.pi`, and assert `window.pi.send`/`setActive` are called with the captured id —
  removing the hand-copied `resolveSendTarget` helper.
  - **Value (dev):** future renderer state (chatReducer-driven slices, unread routing, `useModalFocus`,
    `useSmoothedText`) becomes testable for real; the REACT-1 edit-then-switch race is verified against the
    actual closure, not a copy.
  - **Evidence:** node-only env at `vitest.config.ts:9-12`; the re-implementation workaround + its own
    comment at `useSessions.test.ts:70-88`; no testing-library/jsdom in `package.json:29-51`; renderer hooks
    that would benefit live in `src/renderer/src/state/` (useSessions, useModalFocus, useSmoothedText).
  - **sdkSupport:** none (renderer is pi-free); vitest's projects/workspace + the `jsdom` environment +
    `@testing-library/react`'s `renderHook`. The `@`/`@shared` aliases must carry over to both projects
    (`vitest.config.ts:13-18`).
  - **Effort:** M.

## Acceptance Criteria

- [ ] **AC1.** A new integration test (e.g. `apps/desktop/src/main/agent/sessionLifecycle.test.ts`) drives the
      real `SessionPool` + real `SessionController` against an in-memory fake `AgentSession`/`SessionManager`
      and asserts: LRU-idle parking at the cap (never the active/running one); `setActive`-revive of a parked
      controller (cap re-enforced, transcript visible); revive-failure forwards a `Couldn't resume session: …`
      error DTO with no unhandled rejection; dispose/close-before-rebuild leaves no live session; `openSession`
      dedups by file. (PERF-10)
- [ ] **AC2.** `vitest.config.ts` defines two projects/environments — `node` (existing main + pure-helper
      tests) and `jsdom` (renderer hooks/components) — with the `@`/`@shared` aliases applied to both;
      `@testing-library/react` + `jsdom` are added to `apps/desktop/package.json` devDependencies. (PERF-9)
- [ ] **AC3.** `useSessions.test.ts` (or a new renderer test) renders `useSessions` via `renderHook` under
      jsdom with a stubbed `window.pi`, asserting `send`/`setActive` address the captured/active id; the
      hand-copied `resolveSendTarget` helper is removed. (PERF-9)
- [ ] **AC4.** No `@earendil-works/pi-*` import appears under `src/renderer/**` (including the new/edited
      renderer test); the renderer test suite stubs `window.pi`, never the pi SDK directly.
- [ ] **AC5.** `npm run typecheck && npm run lint && npm run test && npm run build` are all green (the
      jsdom project is picked up by `vitest --run`; lint/Biome covers the new test files).

## Design hints (for the later design.md)

- **Vitest project split:** use vitest's `test.projects` (or a workspace file) — one entry
  `{ test: { environment: "node", include: ["src/main/**/*.test.ts", <pure-helper globs> ] } }` and one
  `{ test: { environment: "jsdom", include: ["src/renderer/**/*.test.{ts,tsx}"], setupFiles: [...] } }`.
  Keep the `resolve.alias` block (`@`, `@shared`, `vitest.config.ts:13-18`) shared across both so module
  imports keep resolving. Confirm the installed vitest (`3.2.4`, `package.json:50`) projects API shape before
  writing (Context7/vitest docs) rather than guessing the field name.
- **Integration-test doubles (PERF-10):** reuse the `vi.hoisted()` template from
  `sessionPool.test.ts:31-111`, but instead of mocking `./sessionController.js`, mock
  `@earendil-works/pi-coding-agent` (`createAgentSession`, `SessionManager`, `SettingsManager`,
  `DefaultResourceLoader`, `loadSkills`, `getAgentDir`) and `@earendil-works/pi-ai` (`complete`) so the real
  `SessionController` (`sessionController.ts:1-10` imports) runs against a fake `AgentSession`. The fake
  `AgentSession` needs the surface the controller actually reads: `subscribe(cb)→unsub`, `dispose()`,
  `sessionFile`, `model`, `messages`, `thinkingLevel`, `isStreaming`, `prompt()`, `setThinkingLevel()`
  (`sessionController.ts:163-212, 267-288`). Inject the `PoolDeps` (`forward`/`forwardApproval`/`notify`,
  `sessionPool.ts:45-52`) as spies to assert forwarded `error` DTOs. Drive a revive failure by making the
  fake `createAgentSession`/`SessionManager.open` throw for a flagged file (mirror the existing
  `failingFiles` set, `sessionPool.test.ts:32, 53-54`).
- **Renderer hook test (PERF-9):** `renderHook(() => useSessions())` from `@testing-library/react`; set
  `window.pi` to a stub (a plain object of spies) before render — note `window.pi` is real (frozen) only in
  the app; in jsdom you assign your own stub. Assert `act(() => result.current.send("hi", undefined, "sX"))`
  calls `window.pi.send("sX", ...)` and the default path uses `activeId` (`useSessions.ts:114-118`). The
  `onEvent` subscription (`useSessions.ts:77`) needs a stub that returns an unsubscribe fn.
- **Touch list:** `apps/desktop/vitest.config.ts` (split), `apps/desktop/package.json` (devDeps + possibly a
  `test` script note), new `src/main/agent/sessionLifecycle.test.ts`, edited
  `src/renderer/src/state/useSessions.test.ts` (rename to `.test.tsx` if it renders JSX), optional
  `src/renderer/test-setup.ts`. No product source change.

## Dependencies / sequencing

**Roadmap wave: Wave 3 (of 4)** — recommended execution slot ~#13 of 14 (but can be pulled forward anytime).

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after:** nothing — independent; pull it forward if you want to lock in the audited lifecycle invariants sooner.
- **Blocks / do before:** nothing.
- **Note:** PERF-10 (pool/controller lifecycle integration test) is the one genuine debt item; PERF-9 (jsdom + testing-library) enables real hook/reducer tests.

## Out of scope

- Any change to product/source code under `src/main/**` or `src/renderer/src/**` (other than test files and
  config). The audited invariants are already implemented and correct; this task only locks them in.
- E2E / Playwright / Spectron-style full-app driving (the existing `PI_SHOT`/`PI_JS` screenshot hooks in
  `src/main/index.ts` remain the token-free visual check; this task is unit/integration only).
- Coverage thresholds / CI gating config, snapshot testing, and component visual-regression tests.
- Any change to upstream pi packages (`packages/**`).

## Notes

- State: **planning-only.** This is a child of `06-27-desktop-roadmap`. Implement only on the user's
  go-ahead.
- Verification is fully token-free: typecheck/lint/test/build + the existing screenshot hooks; the
  integration test uses in-memory fakes and never touches a real model/network/disk session.
- The `vi.hoisted()` mock-factory hoisting gotcha (TDZ on classes/consts referenced from a hoisted
  `vi.mock`) is already documented in `apps/desktop/CLAUDE.md` and demonstrated in
  `sessionPool.test.ts:31-111` — the new integration test should follow that pattern.
