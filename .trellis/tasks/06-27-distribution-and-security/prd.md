# Distribution and security (signing, auto-update, cross-platform, safeStorage)

## Goal

Turn the desktop app from an unsigned, hand-built `--win` artifact into a trustworthy, self-updating
product across Windows / macOS / Linux, with API keys encrypted at rest and a tightened, privacy-explicit
security posture — so improvements actually reach users without a SmartScreen "unknown publisher" wall and
without users re-downloading installers by hand.

## Background

The packaging story is minimal and security has gaps that block real distribution:

- **No code signing, no publish target.** `apps/desktop/electron-builder.yml:16-27` defines only a
  `win → nsis (x64)` target with `oneClick:false`; there is no `win.certificateFile`/`certificateSubjectName`/
  Azure Trusted Signing block and **no top-level `publish:` key**. Unsigned NSIS installers trigger a first-run
  SmartScreen "Windows protected your PC / unknown publisher" block.
- **No auto-update.** `apps/desktop/package.json:22-28` has no `electron-updater` dependency, and
  `apps/desktop/src/main/index.ts` never imports `autoUpdater` nor calls `checkForUpdatesAndNotify`. Without a
  `publish:` block, electron-builder emits no `latest.yml` channel manifest, so even a manual updater would have
  nothing to read. Today shipping a fix means every user re-downloads and re-runs the installer.
- **Windows-only packaging.** `electron-builder.yml:16-20` only builds `win/nsis`; `package.json:20` hardcodes
  `"package": "electron-vite build && electron-builder --win"`. No mac `dmg`/notarization, no linux `AppImage`.
- **API keys are plaintext on disk.** Keys flow `setApiKey` IPC → `persistApiKey` (`apps/desktop/src/main/agent/auth.ts:17-20`) →
  `AuthStorage.set(provider,{type:"api_key",key})`, which writes `~/.pi/agent/auth.json` as pretty JSON with
  `mode:0o600` + `chmodSync(0o600)` (`packages/coding-agent/src/core/auth-storage.ts:48,113-114,158-160`). On
  Windows `0o600` is effectively a no-op (NTFS ACLs ignore POSIX perms), so keys sit in cleartext readable by
  any process running as the user. The SDK already exposes the seam to fix this: it exports `AuthStorageBackend`
  (the interface), `FileAuthStorageBackend`, and `AuthStorage.fromStorage(backend)`
  (`packages/coding-agent/src/index.ts:23-26`, `core/auth-storage.ts:50-53,215-217`).
- **Sandbox off; CSP allows `'unsafe-inline'` styles.** The window sets `webPreferences.sandbox:false`
  (`src/main/index.ts:38`), and the production CSP injected at `src/main/index.ts:124-135` uses
  `style-src 'self' 'unsafe-inline'` (the comment notes this is "to keep KaTeX/inline styles working").
  `'unsafe-inline'` styles are an XSS-mitigation hole worth closing.
- **No privacy statement, no notification-content control.** A repo-wide search finds zero occurrences of
  `telemetry`/`privacy`/`analytics` in `apps/desktop/src` or `README.md`. Background-session OS notifications
  put the **chat title** (model-generated, derived from conversation content) into the notification body:
  `bridge.ts:26-37` builds `body: `${title} — response ready`` / `${title} needs approval``, where `title`
  comes from `controller.summary().title` (`sessionPool.ts:98,107`). On a shared/locked screen that leaks
  conversation content with no way to suppress it.

This child owns distribution + security hardening for the desktop app; **signing + auto-update come first**
because they are the gate through which every other improvement (this roadmap and future) reaches users.

## Requirements

- **R1 (DIST-1 — code signing).** Sign the Windows build so the installer/app no longer trips SmartScreen
  "unknown publisher". Add a Windows signing configuration to `electron-builder.yml` (EV/OV cert via
  `win.certificateFile` + `CSC_KEY_PASSWORD`, or `win.certificateSubjectName`, or Azure Trusted Signing),
  driven entirely from env/secrets so no key material is committed; the build must still succeed unsigned when
  signing inputs are absent (local dev). **Value:** first-run trust — the difference between users running the
  app and Windows blocking it. **Evidence:** `electron-builder.yml:16-27` (win/nsis block, no signing keys).
  **sdkSupport:** n/a (build config; electron-builder native). **Effort:** M.

- **R2 (DIST-2 — auto-update).** Ship in-app auto-update. Add `electron-updater` to `package.json`
  dependencies, add a `publish:` target to `electron-builder.yml` (GitHub Releases) so the build emits the
  channel manifest (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`), and in `src/main/index.ts` (after
  `app.whenReady`, packaged-only) call `autoUpdater.checkForUpdatesAndNotify()` and wire an
  `update-downloaded → "Update ready — Restart"` affordance (a new IPC event + a small renderer banner, or a
  native dialog). **Value:** users get fixes/features without manually re-downloading installers; the prereq
  for treating later roadmap work as continuously deliverable. **Evidence:** `package.json:22-28` (no
  electron-updater), `electron-builder.yml` (no `publish:`), `src/main/index.ts:119-147` (no autoUpdater).
  **sdkSupport:** n/a (electron-updater + electron-builder publish). **Effort:** M.

- **R3 (DIST-6 — cross-platform packaging).** Extend packaging beyond Windows: add a macOS `dmg` target with
  hardened-runtime + notarization (`mac.notarize` via `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`
  or an API key), and a linux `AppImage` target; generalize the `package` script (or add `package:mac`/
  `package:linux`) instead of the hardcoded `--win` at `package.json:20`. **Value:** the app is installable by
  mac and linux users, not just Windows. **Evidence:** `electron-builder.yml:16-20` (win-only target),
  `package.json:20` (`electron-builder --win`). **sdkSupport:** n/a (electron-builder native).
  **Effort:** L (mac notarization + per-OS verification is the cost).

- **R4 (DIST-5 — encrypt API keys at rest).** Encrypt the persisted API keys using Electron `safeStorage`
  (OS keychain-backed: DPAPI on Windows, Keychain on macOS, libsecret on Linux) so `auth.json` no longer holds
  cleartext keys readable by any same-user process. Implement a desktop `AuthStorageBackend` that
  encrypts/decrypts the JSON blob via `safeStorage.encryptString`/`decryptString` and inject it through
  `AuthStorage.fromStorage(backend)` in `apps/desktop/src/main/agent/auth.ts` instead of the default
  `AuthStorage.create()`. Must handle: `safeStorage.isEncryptionAvailable()` false (fall back gracefully,
  e.g. keep plaintext + warn, never lose the user's keys), and a one-time migration of an existing plaintext
  `auth.json`. Note the shared-with-CLI implication (pi CLI reads the same `auth.json`): the migration/format
  choice must not silently break the CLI's ability to read keys (decide and document: dual-read, or desktop
  uses a separate encrypted store). **Value:** keys at rest are protected by the OS, closing the `0o600`-is-a-
  no-op-on-Windows hole. **Evidence:** `auth.ts:17-20` (`persistApiKey`), `auth-storage.ts:48,113-114,158-160`
  (plaintext + `0o600`), `auth-storage.ts:50-53,215-217` + `coding-agent/src/index.ts:23-26` (the
  `AuthStorageBackend`/`fromStorage` injection seam). **sdkSupport:** strong — SDK exports the backend
  interface + `fromStorage`; `safeStorage` is a built-in Electron main API. **Effort:** M.

- **R5 (DIST-8 — sandbox + tighten CSP).** Attempt `webPreferences.sandbox:true` (currently `false` at
  `src/main/index.ts:38`) and verify the preload (`window.pi`) + IPC still work under a sandboxed renderer
  (the preload is already CJS and contextIsolation is on — sandbox restricts preload Node access, so confirm
  no preload code path needs full Node). Tighten the production CSP at `src/main/index.ts:130-131` to drop
  `style-src 'unsafe-inline'` by serving KaTeX/app styles via a hash- or nonce-allowlist (or bundled `<link>`
  styles) so inline-style injection is no longer trusted. If sandbox proves infeasible without regressions,
  record why and keep `sandbox:false` (CSP tightening can still land independently). **Value:** defense-in-
  depth — a sandboxed renderer + no `'unsafe-inline'` materially shrinks the XSS/RCE blast radius. **Evidence:**
  `src/main/index.ts:38` (`sandbox:false`), `src/main/index.ts:130-131` (CSP `style-src 'self' 'unsafe-inline'`).
  **sdkSupport:** n/a (Electron/CSP). **Effort:** M (sandbox-compat verification is the risk).

- **R6 (DIST-9 — privacy note + notification-content toggle).** Add an explicit zero-telemetry privacy
  statement (the app sends nothing anywhere except the user-configured model provider / proxy) to the README
  and/or an in-app Settings note, and add a user toggle that suppresses chat-title (conversation-derived)
  content from OS notifications — e.g. when on, the notification body becomes a generic "Response ready" /
  "Approval needed" instead of `${title} — response ready` (`bridge.ts:26-37`, fed by `summary().title`
  at `sessionPool.ts:98,107`). The toggle is a new persisted app-global preference surfaced over IPC (new
  channel + DTO field), wired in preload/bridge and consumed in the `notify` builder. **Value:** users on
  shared/locked screens don't leak conversation content; a clear privacy stance builds trust.
  **Evidence:** no `telemetry`/`privacy` strings in `apps/desktop/src` or `README.md` (repo grep); chat title
  in notification body at `bridge.ts:30-32`, `sessionPool.ts:98,107`. **sdkSupport:** n/a (uses the existing
  Electron `Notification` path + the app's own settings persistence pattern, cf. `proxy.ts` config store).
  **Effort:** S.

## Acceptance Criteria

- [ ] **AC1 (R1).** `electron-builder.yml` carries a Windows signing config that reads cert material from
      env/secrets only (no key committed); the build still produces an installer when signing inputs are absent
      (local dev path unbroken). Verified by inspecting the config + a dry `electron-vite build` (no token spend).
- [ ] **AC2 (R2).** `electron-updater` is a dependency; `electron-builder.yml` has a `publish:` target that
      emits `latest*.yml`; `src/main/index.ts` calls `autoUpdater.checkForUpdatesAndNotify()` packaged-only and
      an "Update ready — Restart" affordance exists (IPC event + renderer banner or native dialog). The updater
      path is gated so dev (`!app.isPackaged`) does not attempt updates.
- [ ] **AC3 (R3).** macOS `dmg` (hardened runtime + notarize config) and linux `AppImage` targets exist; the
      `package` script(s) can build per-OS without the hardcoded `--win`. (Cross-OS builds verified where the
      CI/host allows; otherwise config-reviewed and documented in implement.md.)
- [ ] **AC4 (R4).** A `safeStorage`-backed `AuthStorageBackend` is injected via `AuthStorage.fromStorage` in
      `auth.ts`; after `setApiKey`, the on-disk credential blob is not the cleartext key when
      `safeStorage.isEncryptionAvailable()` is true; an existing plaintext `auth.json` is migrated without key
      loss; the no-encryption fallback degrades gracefully; the CLI-shared-`auth.json` interop decision is
      documented. A unit test covers encrypt → persist → reload round-trip and the plaintext-migration path.
- [ ] **AC5 (R5).** `sandbox:true` is attempted and either landed (preload + IPC + screenshot smoke pass) or
      explicitly deferred with a recorded reason; the production CSP no longer contains `'unsafe-inline'` in
      `style-src` (KaTeX/app styles render via hash/nonce/`<link>`), verified by reading the emitted CSP and a
      KaTeX render screenshot (token-free).
- [ ] **AC6 (R6).** A zero-telemetry privacy statement is present (README and/or Settings); a persisted toggle
      suppresses chat-title content in OS notifications (generic body when on), wired through a new IPC
      channel/DTO; default behavior is documented.
- [ ] **AC7 (global).** `npm run typecheck && npm run lint && npm run test && npm run build` all green.
- [ ] **AC8 (boundary).** Any renderer change (R2 update banner, R6 toggle UI) stays pi-free: `grep` confirms
      no `@earendil-works/pi-*` import under `apps/desktop/src/renderer/**`; new capabilities go through
      `ipc.ts` DTOs + preload + bridge.

## Design hints (for the later design.md)

- **Signing/update/cross-platform (R1/R2/R3) — config-led:**
  - `electron-builder.yml`: add `win.certificateSubjectName`/`certificateFile` (or `azureSignOptions`); add a
    `publish:` block (`provider: github`, `owner`/`repo`); add `mac` (`target: dmg`, `hardenedRuntime: true`,
    `notarize`) and `linux` (`target: AppImage`). Keep `appId`/`asar`/`files` as-is.
  - `package.json`: add `electron-updater` to `dependencies` (it must resolve at runtime in the asar — confirm
    it isn't externalized away by `externalizeDepsPlugin`); generalize the `package` script and/or add
    `package:mac` / `package:linux`.
  - `src/main/index.ts`: inside the `app.whenReady().then(...)` block, packaged-only (`app.isPackaged`),
    `import { autoUpdater } from "electron-updater"`, call `autoUpdater.checkForUpdatesAndNotify()`, listen for
    `update-downloaded`, and notify the renderer via a new `IPC.updateReady` event (mappers/bridge) or show a
    native dialog offering `autoUpdater.quitAndInstall()`.
- **safeStorage (R4):** new `src/main/agent/safeAuthStore.ts` implementing `AuthStorageBackend`
  (`withLock`/`withLockAsync`) — read file → `safeStorage.decryptString` → hand JSON string to the SDK; on
  write, `safeStorage.encryptString` the `next` blob before persisting. Inject in `auth.ts:10-14` via
  `AuthStorage.fromStorage(new SafeStorageBackend(authPath))` instead of `AuthStorage.create()`; reuse the
  SDK's lockfile/dir-creation semantics or wrap `FileAuthStorageBackend`. Handle `isEncryptionAvailable()`
  false and the one-time plaintext→encrypted migration; settle the CLI interop (the CLI uses
  `FileAuthStorageBackend` plaintext — decide dual-read vs. separate store and document it).
- **Sandbox + CSP (R5):** flip `src/main/index.ts:38` to `sandbox:true` and run the screenshot hooks
  (`PI_SHOT`) to confirm the renderer + `window.pi` still function; for CSP, generate per-style hashes or a
  nonce for KaTeX (`rehype-katex` injects styles via the bundled stylesheet — prefer a bundled `<link>`/
  imported CSS so no inline style is needed) and rewrite the CSP string at `src/main/index.ts:130-131`.
- **Privacy/notification toggle (R6):** add a `suppressNotificationContent` (name TBD) field to `AppStateDto`
  + a `setNotificationPrivacy`-style IPC channel in `ipc.ts`, persist it like `proxy.ts` does its config
  (a small JSON in `app.getPath("userData")`), read it in the `notify` builder at `bridge.ts:26-37` to choose
  generic vs. titled body. Renderer: a Settings checkbox + a short privacy paragraph. README: a "Privacy"
  section stating zero telemetry.

## Dependencies / sequencing

- **R1 (signing) and R2 (auto-update) first** and together — auto-update without signing still trips
  SmartScreen, and signing without a `publish:`/updater doesn't deliver fixes; they are the gate for the rest.
- **R3 (cross-platform)** builds on the R1/R2 config (publish + signing generalize per-OS), so sequence it
  after R1/R2.
- **R4 (safeStorage), R5 (sandbox/CSP), R6 (privacy/notify)** are independent of each other and of R1–R3 and
  can land in any order.
- Sibling children of `06-27-desktop-roadmap`: **none blocking**; this child is otherwise self-contained.

## Out of scope

- Telemetry/analytics/crash-reporting infrastructure (this task asserts *zero* telemetry, not adding any).
- Delta/differential updates, multiple release channels (stable/beta), staged rollouts — basic
  `electron-updater` full-installer updates only.
- Any change to upstream pi packages (`packages/**`) — R4 uses only the already-exported `AuthStorageBackend`/
  `fromStorage` seam; it must not modify the SDK.
- Re-architecting the IPC/session layer; OAuth credential encryption beyond what reusing the same encrypted
  backend gives for free.
- CI pipeline authoring (GitHub Actions release workflow) beyond the `publish:` config electron-builder needs;
  CI wiring can be a follow-up.

## Notes

- State: **planning-only**. This is the `prd.md` for one child of the parent roadmap task
  **06-27-desktop-roadmap**; do **not** write `design.md`/`implement.md` or change any code yet.
- Implement only on the user's explicit go-ahead.
- Verification is token-free: typecheck/lint/test/build, config review, unit tests (safeStorage round-trip,
  notify-body predicate), and the `PI_SHOT` screenshot hooks (KaTeX render under tightened CSP, sandbox smoke).
- Architecture hard rules hold: pi SDK stays in main; the renderer stays pi-free and speaks only `ipc.ts`
  DTOs; pi-citizen config (`AuthStorage`/`~/.pi/agent`) is preserved (R4 swaps the backend, not the config).
