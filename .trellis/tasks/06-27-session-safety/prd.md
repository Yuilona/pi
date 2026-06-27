# Per-session permission mode + project-trust gate

## Goal

Make concurrent code-execution safe in the desktop app: give each live session its own
ask/acceptEdits/yolo/readonly permission mode (instead of one process-wide switch that silently de-gates
every session), and gate the first open of an untrusted project folder behind an explicit trust prompt
(instead of silently auto-loading its `.pi` settings / extensions / skills / `SYSTEM.md`).

## Background

The app now runs up to **6 concurrent live sessions** (`MAX_LIVE = 6`, `sessionPool.ts:35`), each its own
`SessionController` with its own approval gate. Two safety gaps remain:

**Permission mode is process-wide, not per-session.** The approval gate is already evaluated per controller:
`requestApproval` reads `this.deps.getMode()` on every tool call and short-circuits on `yolo`/`readonly`
(`sessionController.ts:110-115`). But the source of truth is a single field on the pool —
`SessionPool.mode` (`sessionPool.ts:67`), read fresh by every controller via the shared
`getMode: () => this.mode` closure (`sessionPool.ts:87`) — and `setMode` takes no `sessionId`
(`ipc.ts:33,302`; `bridge.ts:79-81`; `sessionPool.ts:329-331`). The renderer keeps one global `mode`
(`App.tsx:76`) and `cycleMode` flips it for the whole process (`App.tsx:271-275`,
`window.pi.setMode(next)`). Consequence: cycling the active session to `yolo` (Shift+Tab, `App.tsx:277-287`)
silently auto-runs `bash`/`edit`/`write` in **all** other live sessions too — including background ones the
user isn't watching — and `readonly` likewise blocks every session at once. `SessionSummaryDto`
(`ipc.ts:240-251`) carries per-session `model`/`thinkingLevel` but **no** mode, so a per-session badge isn't
even expressible today.

**There is no project-trust gate.** Opening a folder builds a controller whose `DefaultResourceLoader`
(`sessionController.ts:145-151`) and `SettingsManager.create(cwd)` (`sessionController.ts:106`, also `:258`
on resume) load that project's `.pi` resources with **no trust check**. The desktop never passes
`projectTrusted`, and the SDK defaults it to `true` (`settings-manager.ts:289,313`; the resource loader
builds its own trusting `SettingsManager` at `resource-loader.ts:213` because the desktop doesn't pass one
in). The resource loader gates project `SYSTEM.md` / `APPEND_SYSTEM.md` purely on `isProjectTrusted()`
(`resource-loader.ts:953,967`), so with the default-true flag a hostile repo's `.pi/SYSTEM.md` (prompt
injection), auto-activating project skill, or project extension takes effect **the instant you open the
folder**. The SDK already has the whole machinery — `hasTrustRequiringProjectResources(cwd)`
(`trust-manager.ts:184`), `ProjectTrustStore` persisting `~/.pi/agent/trust.json` (`trust-manager.ts:208`),
`getProjectTrustOptions(cwd)` (`trust-manager.ts:65`), `SettingsManager(...projectTrusted)`
(`settings-manager.ts:289,313`), and a `resourceLoader.reload({ resolveProjectTrust })` callback hook
(`resource-loader.ts:335-338`) — all re-exported from the package (`index.ts:291-297`). The TUI drives it
via `components/trust-selector` and `renderProjectTrustWarningIfNeeded` (`interactive-mode.ts:3296-3299`,
`4252-4258`). But **no "trust" string exists anywhere under `apps/desktop/src`** — the desktop simply
ignores it.

These two findings are independent (each its own AC) but share the theme: make concurrent
code-execution safe.

## Requirements

- **R1 (UX-9) — Per-session permission mode.** Each live session carries its own
  `ask`/`acceptEdits`/`yolo`/`readonly` mode rather than one process-wide setting. Value: a user can run one
  trusted session in `yolo` without silently de-gating `bash`/`edit`/`write` in the other 5 live sessions
  (and `readonly`/`acceptEdits` likewise scope to one session). The active session's mode is what Shift+Tab
  cycles and what the composer shows; each session can display its own mode badge.
  *Evidence:* gate is already per-controller (`sessionController.ts:110-115`, reads `deps.getMode()`); the
  only global is `SessionPool.mode` (`sessionPool.ts:67`, closure at `:87`) and the `sessionId`-less
  `setMode` (`ipc.ts:33,302`; `bridge.ts:79`; `sessionPool.ts:329`); renderer flips it globally
  (`App.tsx:76,271-275`); `SessionSummaryDto` has no mode field (`ipc.ts:240-251`).
  *sdkSupport:* partial / pure-plumbing — no SDK change; move the source of truth onto the controller and
  thread `sessionId` through the IPC.
  *Effort:* S.

- **R2 (DIST-3) — Project-trust gate on first open.** On the first open of a folder that has
  trust-requiring project resources and no saved decision, prompt the user to Trust / Do-not-trust (and
  remember the choice), then pass the chosen `projectTrusted` to the `SettingsManager` and resource loader —
  instead of silently auto-loading the project's `.pi` settings / extensions / skills / `SYSTEM.md`.
  Untrusted (or undecided-declined) folders load only user/global resources, never project-local ones.
  Value: opening an untrusted repo can no longer inject a project `SYSTEM.md` (prompt injection),
  auto-activate a project skill, or execute a project extension without the user's explicit consent —
  closing a real code-execution attack surface.
  *Evidence:* desktop builds resources/settings with no trust check (`sessionController.ts:106,145-151,258`);
  SDK defaults `projectTrusted` true (`settings-manager.ts:289,313`) and the resource loader builds its own
  trusting `SettingsManager` (`resource-loader.ts:213`); project `SYSTEM.md`/`APPEND_SYSTEM.md` gate only on
  `isProjectTrusted()` (`resource-loader.ts:953,967`); SDK exports `hasTrustRequiringProjectResources`,
  `ProjectTrustStore`, `getProjectTrustOptions`, `SettingsManager(projectTrusted)`, and the
  `reload({ resolveProjectTrust })` hook (`trust-manager.ts:65,184,208`; `settings-manager.ts:289,313`;
  `resource-loader.ts:335-338`; `index.ts:291-297`); no "trust" string under `apps/desktop/src`.
  *sdkSupport:* yes — entirely in the SDK; the desktop only has to round-trip the decision to the renderer
  and feed it in.
  *Effort:* L.

## Acceptance Criteria

- [ ] **AC1 (R1).** Permission mode is per-session: each `SessionController` owns its own mode (default
      inherited from the pool's mode at creation), `requestApproval` reads the controller's own mode (not a
      shared pool field), and `setMode` is `sessionId`-scoped end-to-end (`ipc.ts` channel + `PiApi`
      signature, preload, bridge, pool passthrough to the addressed controller).
- [ ] **AC2 (R1).** `SessionSummaryDto` carries the session's `mode`; the renderer reads/cycles the
      **active** session's mode (Shift+Tab and the composer act on `activeId`, not a process-wide value), and
      a sibling session in `yolo`/`readonly` does not change another live session's gating. (Verifiable
      token-free: a unit test that two controllers with different modes gate the same tool differently;
      screenshot of two sidebar rows with distinct mode badges.)
- [ ] **AC3 (R2).** Opening a folder with trust-requiring resources and no saved decision emits a trust
      request over a new IPC channel and **awaits** the renderer's choice before the project's `.pi`
      settings / extensions / skills / `SYSTEM.md` are loaded; the choice is persisted via `ProjectTrustStore`
      (`~/.pi/agent/trust.json`) and the chosen `projectTrusted` is passed to the `SettingsManager` and
      resource loader.
- [ ] **AC4 (R2).** A folder with **no** trust-requiring resources (the common case, incl. the app dir)
      opens with **no** prompt (gate short-circuits via `hasTrustRequiringProjectResources` returning false);
      a previously-decided folder reuses its saved decision with no re-prompt; a declined/untrusted folder
      loads only user/global resources (no project `SYSTEM.md`/extensions/skills). (Verifiable token-free by
      a unit test on the gate predicate + the untrusted resource-load path.)
- [ ] **AC5.** The trust round-trip never blocks the whole pool or leaves a controller half-built: the wait
      runs inside the controller's lifecycle serializer (`runExclusive`) like other build ops, honors the
      `disposed` flag, and a cancelled/closed trust prompt resolves to *untrusted* (fail-safe) rather than
      hanging.
- [ ] **AC6.** Renderer stays pi-free: no `@earendil-works/pi-*` import added under `src/renderer/**`
      (new capability = new `ipc.ts` DTOs + channels only). `npm run typecheck && npm run lint &&
      npm run test && npm run build` all green.

## Design hints (for the later design.md)

- **R1 (S):**
  - Add a `mode: PermissionMode` field to `SessionController`, initialized from the pool's current mode at
    `createController` time; add a `setMode(mode)` method; change `ControllerDeps.getMode` to read the
    controller's own field (drop the shared `getMode: () => this.mode` closure in `sessionPool.ts:87`, or
    keep it as the *default-on-create* seed only). `requestApproval` (`sessionController.ts:110-115`) then
    reads the local field.
  - `setMode` IPC gains an optional/required `sessionId`: `ipc.ts` const `setMode` channel + `PiApi.setMode`
    signature (`ipc.ts:302`), preload (`preload/index.ts:46`), bridge handler (`bridge.ts:79-81`), pool
    passthrough `setMode(sessionId, mode)` to `controllers.get(sessionId)`.
  - Add `mode` to `SessionSummaryDto` (`ipc.ts:240-251`) and return it from `SessionController.summary()`
    (`sessionController.ts:454-467`); `AppStateDto.mode` (`ipc.ts:256`) can stay as the pool default for new
    sessions.
  - Renderer: derive the displayed/cycled mode from `activeSummary` (like `model`/`thinking`,
    `App.tsx:96-98`); `applyMode`/`cycleMode` (`App.tsx:266-275`) call `window.pi.setMode(activeId, m)`;
    optional per-row mode badge in the sidebar.
- **R2 (L):**
  - Model a **trust** IPC round-trip on the existing approval channel
    (`ipc.ts:46-47`; `bridge.ts:22-24,45-47`; renderer `onApproval`/`resolveApproval`,
    `App.tsx:106-124`): a `trustRequest` push (`{ sessionId, cwd, options }`) and a `resolveTrust`
    (`sessionId`, decision) reply; new DTOs in `ipc.ts`, wired in preload + bridge.
  - In `SessionController`, **before** building the resource loader / `SettingsManager` for a `cwd`
    (`sessionController.ts:106` constructor, `:143-151` `buildSession`, `:258` resume), check
    `hasTrustRequiringProjectResources(cwd)` + `ProjectTrustStore.get(cwd)`. If trust-requiring and
    undecided, emit a trust request, `await` the renderer's choice (inside `runExclusive`, honoring
    `disposed`), persist with `ProjectTrustStore.set(cwd, decision)` / `getProjectTrustOptions`, then build
    with `SettingsManager.create(cwd, getAgentDir(), { projectTrusted })` and pass the same `projectTrusted`
    so the resource loader's own `SettingsManager` (`resource-loader.ts:213`) isn't a trusting fallback —
    or pass a shared `settingsManager` into `DefaultResourceLoader` (it accepts one, `resource-loader.ts:122`)
    and/or drive `resourceLoader.reload({ resolveProjectTrust })` (`resource-loader.ts:335-338`).
  - Reuse SDK symbols from `@earendil-works/pi-coding-agent` (already main-only): `ProjectTrustStore`,
    `hasTrustRequiringProjectResources`, `getProjectTrustOptions` (`index.ts:291-297`). Mirror the TUI flow
    (`interactive-mode.ts:3296-3299,4252-4258`) for option semantics (Trust / parent / session-only / not).
  - Renderer: a small trust dialog (parchment styling per `DESIGN.md`) shown for the active session, queued
    like approvals; cancelling resolves to untrusted.

## Dependencies / sequencing

None — both findings are self-contained in `apps/desktop` main + the IPC/renderer wiring and depend only on
already-shipped SDK symbols. R1 (S) is a good warm-up before R2 (L); they touch overlapping files
(`ipc.ts`, `bridge.ts`, `preload`, `sessionController.ts`, `App.tsx`) so do them in one branch to avoid
merge churn. This is a child of `06-27-desktop-roadmap`; sequence against siblings per the roadmap.

## Out of scope

- Changing any upstream pi package (`packages/**`) — consume the SDK trust API as-is.
- Per-tool / per-command allowlists beyond the existing session `always`-allow set
  (`sessionController.ts:129`); per-session mode is the only new permission axis here.
- A global "trust settings" management UI (listing/revoking trusted folders, editing
  `defaultProjectTrust`) — only the first-open gate + persisted decision are in scope.
- The `project_trust` extension event path (`project-trust.ts:53-69`) and parent-folder / session-only
  nuances beyond a basic Trust / Do-not-trust prompt (may be a fast-follow, not required for the gate).
- Re-architecting the session pool / serializer (the concurrency design is sound).

## Notes

- State: **planning-only.** This is a child of `06-27-desktop-roadmap`. Do not write `design.md` /
  `implement.md` and do not change any code until the user gives the go-ahead.
- The two findings are independent ACs but share the "make concurrent code-execution safe" theme.
- Verification is token-free: typecheck/lint/test/build, unit tests on the mode-gating and trust-gate
  predicates, and the dev screenshot hooks (`PI_SHOT`/`PI_JS`, main `index.ts`) for the badges/dialog.
- Windows/CN dev norms: no emoji to the GBK console; commit messages ASCII-only.
