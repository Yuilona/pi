# Implementation plan — Polish quick-wins (round 2)

> Status: **planned, not started.** Lightweight task — the grouped checklist in `prd.md` is the spec. Do not
> `task.py start` until the user asks. All items are small, low-risk CSS (one tiny TSX touch in E1).

## Execution order (cheapest/safest first; commit in logical groups)

1. **Tokens first** (so later swaps can reference them): add `--fs-mono-sm`, `--fs-micro`, `--ink`, `--scrim`,
   `--shadow-ring-brand`, `--shadow-ring-error` to `tokens.css` (light + dark blocks where they differ).
2. **A. Token fidelity swaps** (A1–A5): re-grep each raw value, swap to the token. Pure refactor — same pixels
   (except A5 dark scrim, which intentionally darkens more). `npm run format` after.
3. **B. Pressed/transition states** (B1–B5): additive `:active` rules + two transition-list additions.
4. **C. Dark remainder**: verify C1 after A5; apply optional C2 if inline code still reads flat in dark.
5. **D. Collapse animations**: Settings sections + sidebar overflow. For Settings (small, low-frequency),
   prefer the grid-template-rows `0fr→1fr` technique (always-mounted inner, true bidirectional). For the
   sidebar overflow, gate the entrance animation to the newly-revealed rows only (a one-shot class on toggle),
   never on every sidebar refresh — confirm no per-streaming-tick flicker.
6. **E. Empty-state width** (E1, last): the only layout change — widen the empty state to ~860–900px without
   widening the thread; screenshot both empty and in-thread.

## Validation (run from apps/desktop)
- `npm run typecheck && npm run lint && npm run test && npm run build` — all green.
- `PI_SHOT=<png>` and `PI_SHOT=<png> PI_THEME=dark` (via `npx electron .` on the built app) for light/dark
  visual confirmation — no API tokens spent.
- Grep the listed files to confirm no raw off-scale font-size / `#fff` / `#000`-mix / `rgba(20,20,19…)`
  scrim remains.

## Rollback
- Each group (tokens, A, B, D, E) is an independent commit; revert any group without affecting the others.
- Purely additive/CSS — no behavior or data risk; reverting the branch fully restores the current look.

## Reminders
- Biome `noExplicitAny` is OFF — never add `biome-ignore lint/suspicious/noExplicitAny` (unused-suppression
  lint error).
- Re-grep line numbers before editing; the audit's numbers drift as the code changes.
