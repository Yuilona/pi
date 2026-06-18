# Polish quick-wins (round 2)

## Goal

Finish the lower-priority half of the visual/DESIGN + interaction polish catalog (a Workflow-orchestrated audit
of `apps/desktop` against DESIGN.md). The high-value items already shipped (dark-mode contrast fixes, empty-
state hero, tool-card hover, warm focus dot, image UX); this task collects the remaining **small, low-risk,
mostly-CSS** quick-wins so they aren't lost. Each item is a surgical change with a known file:line.

## Constraints
- Each change is minimal and on-brand (DESIGN.md "warm, unhurried"); no redesigns, no layout churn except the
  one item explicitly flagged as layout.
- Keep the pi-free renderer boundary; keep typecheck/lint/build/test green.
- Reminder: Biome `noExplicitAny` is OFF here — do NOT add `biome-ignore lint/suspicious/noExplicitAny`
  (flagged as an unused suppression). Run `npm run format` after CSS edits.
- Line numbers below are approximate (from the audit) — re-grep before editing; the code drifts.

## Requirements (the backlog, grouped)

### A. Token fidelity (snap off-scale values onto tokens)
- [ ] A1. Off-scale font-sizes → tokens. Add `--fs-mono-sm: 12.5px` and `--fs-micro: 9.6px` (DESIGN "Micro")
      to tokens.css; replace raw `12.5px` (base.css `.chip .path`, chat.css `.tool-arg`/`.tool-peek`, tools.css
      `.bash-cmd`/diff), `11px` (`.model-row .mid`, `.mode-cyc`) → `--fs-label`/`--fs-micro`, `10.5px`
      (`.badge`, `.key-row .s`) → `--fs-overline`, `9px` (`.sess-group-cur`, `.cmd-kind`) → `--fs-micro`.
- [ ] A2. Pure-white literals → `var(--on-brand)`: `.winctl` close-hover (base.css:198), `.btn-danger`
      (base.css:238), `.attach-x` (app.css ~652).
- [ ] A3. Hover-darken color-mix toward `#000` → toward warm near-black: define `--ink: #141413`, mix
      `color-mix(in srgb, var(--brand) 92%, var(--ink))` for `.btn-brand`/`.btn-danger`/`.send` hovers
      (base.css:228/244, app.css:390).
- [ ] A4. Tokenize the chromatic ring-elevation shadows: add `--shadow-ring-brand: 0 0 0 1px var(--brand)` and
      `--shadow-ring-error: 0 0 0 1px var(--error)`; reference them in `.btn-brand`/`.send`/`.mode-opt.on`/
      `.btn-danger`/`.banner-error` (base.css:225/241, app.css:383, settings.css:376, chat.css:349).
- [ ] A5. Tokenize modal scrims: add a `--scrim` token (light `rgba(20,20,19,0.4)`, dark `rgba(0,0,0,0.55)`)
      and use it for `.sheet-backdrop` (settings.css:7) and `.approval-backdrop` (tools.css:89); this also
      fixes the dark item below (backdrops barely darken the already-dark canvas). Also de-duplicate the
      `rgba(20,20,19,…)` in `.attach-x` (app.css) via `--ink`.

### B. Missing pressed / transition states (tactile feedback)
- [ ] B1. `.sess-wrap:active:not(.active) { background: var(--ring); }` (app.css ~48/53).
- [ ] B2. `.cmd-item:active, .model-opt:active { background: var(--ring); }` (app.css ~451/564).
- [ ] B3. `.model-row:active { background: var(--surface-2); }` and `.mode-opt:active { border-color:
      var(--ring-deep); }` (settings.css ~162/361).
- [ ] B4. Add `transition: color 0.14s var(--ease)` to `.thinking-toggle` (chat.css ~178) and the base `a`
      rule (base.css ~48) so their color changes don't snap.
- [ ] B5. Add `box-shadow 0.16s var(--ease)` to `.send`'s transition list so the ring fades in sync with the
      enabled/disabled background swap (app.css ~384).

### C. Dark-theme remainder
- [ ] C1. Modal backdrops barely darken in dark — resolved by A5's `--scrim` token (dark = pure-black, higher
      alpha). Verify after A5.
- [ ] C2. Optional: give `.md code` a `box-shadow: var(--shadow-ring)` hairline so inline code reads as a chip
      in both themes (chat.css ~113) — mostly already covered by the shipped `--surface-2` lift; confirm.

### D. Smooth collapse/expand — extend beyond tool cards
- [ ] D1. Apply the same `tool-reveal`-style smooth reveal (or a grid-template-rows `0fr→1fr` transition where
      content is small enough to stay mounted) to the **Settings provider sections** (expand/collapse) and the
      **sidebar "Show N more"** overflow. Caveat: the sidebar refreshes per streaming tick — animate the
      newly-revealed rows only, not on every refresh (otherwise it flickers). Tool cards are already done.

### E. Empty-state (layout — slightly bigger, do last)
- [ ] E1. Let the empty state breathe wider than the reading column (~860–900px) so the 3 suggestion cards
      aren't pinched, while keeping the message thread at `--reading-col`. Touches layout (App.tsx ~358 +
      app.css `.content`/`.suggestions`), so verify both empty and in-thread views.

## Acceptance Criteria
- [x] AC1. The enumerated off-scale font-sizes (12.5/11/10.5/9px), pure-white literals (winctl close,
      .btn-danger, .attach-x), black-mix hovers, and modal scrims now flow from tokens
      (--fs-mono-sm/--fs-micro, --on-brand, --ink, --scrim, --shadow-ring-brand/error). Deliberate
      exceptions kept: the always-dark image lightbox palette (post-audit component, fixed dark by design),
      `.banner-error`'s intentional 25%-alpha ring, and on-scale `12px` literals.
- [x] AC2. Added pressed states (.sess-wrap/.cmd-item/.model-opt/.model-row/.mode-opt :active) and color
      transitions on `a` and .thinking-toggle; .send now transitions box-shadow in sync with its bg.
- [x] AC3. Settings provider sections collapse via grid 0fr<->1fr (always-mounted inner, true bidirectional,
      collapsed rows out of tab order); the sidebar "Show more" rows get a one-shot reveal gated to the
      toggle (a 400ms flag), so the per-streaming-tick refresh doesn't re-animate them.
- [x] AC4. Light empty-state shot confirms E1 (wider 880px column, roomier suggestions); dark settings shot
      confirms A5 (darker scrim) + the provider collapse rendering. No API tokens spent.
- [x] AC5. `npm run typecheck && npm run lint && npm run test && npm run build` all green (25 tests).

## Notes
- Child of `06-15-desktop-app`. **Planned now, NOT to be implemented yet** — do not `task.py start` until the
  user asks. Lightweight task: this PRD's grouped checklist IS the spec; see implement.md for execution order.
- Source: the polish catalog (32 items / 29 quick-wins); the high-value half shipped in commits `34a68e9`
  (image/tool UX) and `86cc50a` (DESIGN fidelity). This is the remainder.
