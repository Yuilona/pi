# Desktop roadmap: post-0.2.0 opportunities (parent)

## Goal

Own the prioritized backlog of feature/optimization opportunities for the pi **desktop app** (`apps/desktop`)
discovered after the 0.2.0 audit-fix release, and coordinate them as independently shippable child tasks.
This parent holds the source catalog, the child map, the sequencing, and the cross-child acceptance criteria.
**Planning only for now** — no child is implemented until the user explicitly says "start fixing" for that child.

## Source

A grounded, adversarially-verified opportunity scan (Workflow `wf_3975fc94-beb`, 6 dimensions × find → verify →
synthesize, 64 sub-agents): **68 ideas surfaced, 4 dropped (already-exist/infeasible), 64 kept**, each cited to a
real SDK symbol or an `ipc.ts` gap. Headline: the desktop is a near-complete pi front-end; the biggest leverage is
**closing the gap to capabilities the pi SDK already ships and the TUI surfaces but the desktop hasn't wired across
IPC** — plus making concurrent code-execution safe and making releases actually reach users.

## Child tasks (14) — full catalog

> Every kept finding maps to exactly one child. IDs reference the scan (SDK-/UX-/PERF-/REL-/DIST-/AGENT-n).

| # | Child task | Findings | Impact | Effort |
|---|---|---|:--:|:--:|
| 1 | `06-27-steer-followup` — steer/follow-up while streaming | SDK-1, REL-2, REL-3 (closes CONC-5) | high | M |
| 2 | `06-27-session-safety` — per-session permission mode + project-trust gate | UX-9, DIST-3 | high | S+L |
| 3 | `06-27-approval-diff` — diff preview in the edit/write approval dialog | SDK-2 | high | M |
| 4 | `06-27-branch-fork-tree` — branch/fork/rewind from any message | SDK-3, UX-6 | high | L |
| 5 | `06-27-global-search` — global content search across sessions | UX-1 | high | M |
| 6 | `06-27-tabs-split-view` — tabs/split view over the concurrent pool | UX-3 | high | L |
| 7 | `06-27-reliability-quickwins` — retry, draft, single-instance, recovery | REL-1, REL-5, REL-6, REL-7, REL-8, REL-9, REL-10, REL-11, REL-12, DIST-10 | high (sum) | S each |
| 8 | `06-27-ux-enhancements` — rename/pin, cost, palette, themes, tray, DnD, onboarding | SDK-9, SDK-12, UX-2, UX-4, UX-7, UX-8, UX-10, UX-11, UX-12 | med | S–M |
| 9 | `06-27-extensibility` — drop tool allowlist, managers, todo/plan | AGENT-1, AGENT-2, AGENT-3, AGENT-4, AGENT-10 | high | M–L |
| 10 | `06-27-sdk-surfacing` — export/share, OAuth, memory editor, tool toggles, bash console, scoped models, compact opts, per-project defaults | SDK-5, SDK-7, SDK-8, SDK-10, SDK-11, UX-5, DIST-7, AGENT-5, AGENT-6 | med–high | M |
| 11 | `06-27-performance` — code-split, incremental markdown, virtualization, slices, fonts | PERF-1..8, PERF-11 | med | M–L |
| 12 | `06-27-test-devex` — jsdom hooks + pool lifecycle integration test | PERF-9, PERF-10 | med (debt) | M |
| 13 | `06-27-distribution-and-security` — signing, auto-update, cross-platform, safeStorage, sandbox/CSP, telemetry | DIST-1, DIST-2, DIST-5, DIST-6, DIST-8, DIST-9 | high | M–L |
| 14 | `06-27-agent-bigbets` — subagents, elicitation, MCP (SDK-level) | AGENT-7, AGENT-8, AGENT-9 | high | L–XL |

Each child's `prd.md` enumerates its findings with real evidence (file:line / SDK symbol), ACs, and design hints.

## Suggested sequencing (waves)

Parent/child is **not** a dependency system; ordering is advisory and lives here + in child artifacts. Recommended:

- **Wave 1 — high leverage, mostly plumbing:** #1 steer/follow-up · #2 per-session mode (the S half) ·
  #7 reliability quick wins · #13 signing + auto-update (DIST-1/2 only). *Rationale: biggest daily-feel wins +
  the distribution gate so everything after this can actually reach users.*
- **Wave 2 — safety & navigation:** #2 project-trust gate (the L half) · #3 approval diff · #5 global search ·
  #9 extensibility (AGENT-1 first, it unblocks AGENT-2/3).
- **Wave 3 — bigger UX & SDK surfacing:** #4 branch/fork tree · #6 tabs/split view · #8 UX enhancements ·
  #10 SDK surfacing · #11 performance · #12 test/devex.
- **Wave 4 — upstream/SDK-level:** #14 agent big bets (MCP needs an SDK MCP client built first; elicitation
  needs SDK mode work; subagents depend on #9).

Cross-child dependencies (write the binding ordering in the dependent child too):
- #9 AGENT-1 (drop tool allowlist) **before** #14 AGENT-7 (subagents) and #10 SDK-7 (per-tool toggles).
- #2 per-session mode **pairs with** #6 tabs (each tab shows its own mode).
- #13 DIST-1/2 (signing+auto-update) **before** broad distribution of any later child.
- #14 AGENT-9 (MCP) is **blocked** on upstream pi SDK MCP support — not a desktop-only task.

## Cross-child acceptance criteria (roadmap-level)

- [ ] AC-R1. Every kept scan finding (64) is owned by exactly one child PRD; the 4 dropped ideas are recorded
      as out-of-scope (already-exist/infeasible) and not re-proposed.
- [ ] AC-R2. Each child PRD is grounded: every requirement cites a real `file:line` or SDK symbol, and states
      sdkSupport honestly (yes-already-in-sdk / partial / needs-sdk-work / pure-ui).
- [ ] AC-R3. Each child is independently verifiable (its own ACs) and can be planned → implemented → checked →
      archived without the others.
- [ ] AC-R4. As children land, the hard architecture rule holds: pi SDK in main only; renderer stays pi-free
      (no `@earendil-works/pi-*` under `src/renderer/**`); new capabilities go through `ipc.ts` DTOs.
- [ ] AC-R5. No child regresses the audited 0.2.0 invariants (the concurrency/lifecycle fixes) or the
      concurrent-session acceptance criteria.

## Constraints

- **Architecture:** pi SDK runs only in the Electron main process; the React renderer is pi-free and speaks the
  `src/shared/ipc.ts` DTO contract. New features = new IPC channels + DTOs wired in preload + bridge + mappers.
- **Pi-citizen:** use pi's own config (AuthStorage / ModelRegistry / SettingsManager, `~/.pi/agent`); never
  hardcode a provider; JSONL session format stays compatible with the pi CLI.
- **Verification stays token-free** where possible: `typecheck` / `lint` / `test` / `build` + the dev screenshot
  hooks; live API-spending runs only with explicit user consent.
- **Windows/CN dev norms;** Biome `noExplicitAny` is OFF; commit messages ASCII-only.

## Out of scope

- The 4 dropped scan ideas: SDK-6 (extension loading — already works), PERF-12 (persist msg-id counter —
  infeasible), REL-4 (stop-cancels-retry — already done), DIST-4 (`!shell-command` config vector — infeasible).
- Building MCP support **in the pi SDK** is upstream work; this roadmap only tracks the desktop-facing need
  (AGENT-9) and its blocker.
- This parent task itself carries **no direct implementation** — work happens in the children.

## Notes

- **Status: planning only.** Children are created in `planning`; each gets its `design.md` + `implement.md`
  (it is a complex task) authored when the user says "start fixing `<child>`", then `task.py start <child>`.
- Do not `task.py start` the parent (it has no direct deliverable; start the child that owns the next wave item).
- Source roadmap + per-finding detail: the scan Workflow result (`wf_3975fc94-beb`) and each child `prd.md`.
