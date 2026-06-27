# Diff preview in the edit/write approval dialog

## Goal

When an `edit` or `write` tool is gated, show the user the REAL change as a red/green diff inside the
approval card — the same review surface pi's TUI and Claude Code present — so the user approves a concrete,
readable mutation instead of approving blind from raw `old_string`/`new_string`/`content` JSON.

## Background

Today the approval gate hands the renderer only the raw tool input, and the dialog dumps it verbatim:

- The gate forwards just `event.input`: `approval.ts:17` calls
  `requestApproval(event.toolName, (event.input ?? {}) as Record<string, unknown>)`. The `ApprovalRequest`
  DTO carries only `{ id, toolName, input }` (`ipc.ts:162-166`), so nothing diff-shaped crosses IPC at
  approval time.
- The dialog renders the raw args: for `write` it shows `input.content.slice(0, 600)` in a `<pre>`
  (`ApprovalDialog.tsx:35,63-68`); for `edit` it shows nothing but the path — `oldText`/`newText` aren't
  surfaced at all (`ApprovalDialog.tsx:31-36,56-60`). The user can't see what an `edit` will actually do.
- The diff already exists in the codebase, but only AFTER the tool runs. The edit tool's `execute`
  computes `details.diff` (display diff) and `details.patch` (unified patch) via `generateDiffString` /
  `generateUnifiedPatch` (`edit.ts:350-360`), and the desktop carries those through `tool_execution_end`
  into `IpcToolResult.details` (`mappers.ts:136-145`; DTO at `ipc.ts:129-140`). The renderer's
  `DiffView` then renders that patch string as red/green hunks for the completed tool card
  (`DiffView.tsx`, consumed by `ToolChip.tsx:13,34`). The gap is purely timing: the gate fires on
  `tool_call` BEFORE `execute`, so it never sees `details.diff` — the diff must be computed PRE-execution
  from the input args.
- The SDK already has the exact pre-execution helper the TUI uses for its preview:
  `computeEditsDiff(path, edits, cwd)` and `computeEditDiff` in `core/tools/edit-diff.ts:412-454`, which
  read the on-disk file and return `{ diff, firstChangedLine }` WITHOUT applying the edit (the TUI calls
  it from `edit.ts:380`). For `write`, the equivalent is a "whole file added" diff (no SDK helper today —
  `write.ts` has no pre-execution diff path).
- BLOCKER for the clean SDK reuse: those helpers are NOT in the public package surface. The desktop
  imports only from the barrel `@earendil-works/pi-coding-agent` (every main-process import does:
  `approval.ts:1`, `auth.ts:1`, `sessionController.ts:10`, `sessionPool.ts:3`), and the package `exports`
  expose ONLY `.` → `./dist/index.js` (`packages/coding-agent/package.json:14-18`). The barrel re-exports
  `renderDiff` (`index.ts:339`), `RenderDiffOptions` (`index.ts:337`) and `type EditToolDetails`
  (`index.ts:260`) — but NOT `computeEditsDiff` / `generateDiffString` / `generateUnifiedPatch`
  (confirmed: no `edit-diff` / `computeEditsDiff` match in `index.ts` or `core/tools/index.ts`). So to
  reuse the SDK helper we must add a one-line public re-export; otherwise the diff must be re-derived in
  main against the `diff` npm package directly.

## Requirements

### R1 (SDK-2) — Compute the real diff at approval time and render it as red/green hunks

- **What:** When a gated tool is `edit` or `write`, the main process computes the actual unified change the
  tool would make from `event.input` (PRE-execution) and ships it across IPC; the approval dialog renders
  it as red/green hunks (reusing the `DiffView` styling shape) instead of (or above) the raw JSON dump.
  - `edit`: read the target file and produce the same diff the tool itself would, using the input
    `edits[]` (handle the legacy single-`oldText`/`newText` and the JSON-string-`edits` shapes the tool
    normalizes — see `prepareEditArguments` `edit.ts:94-118`).
  - `write`: produce an "all-added" diff of the new content against the existing file (or against empty,
    for a brand-new file), so the user sees the file being created/overwritten as green lines rather than
    a truncated 600-char `<pre>`.
  - If the diff can't be computed (file missing for `edit`, fuzzy-match failure, read error), the dialog
    falls back gracefully to the current raw-args view rather than blocking approval — the gate still
    works exactly as today.
- **Value:** Turns the permission gate from a blind "Allow?" into a genuine review step. A user can spot a
  wrong file, a clobbering overwrite, or an unintended deletion before it touches disk — the single most
  load-bearing safety affordance for the `ask`/default mode.
- **Evidence:** gate forwards only input (`approval.ts:17`); DTO lacks a diff field
  (`ipc.ts:162-166`); dialog shows raw `content` / no edit body (`ApprovalDialog.tsx:31-36,56-68`);
  pre-execution helper `computeEditsDiff(path, edits, cwd)` exists (`edit-diff.ts:412-441`); display diff +
  unified patch already produced post-execution (`edit.ts:350-360`) and already plumbed via `details`
  (`mappers.ts:136-145`, `ipc.ts:129-140`); renderer already has a patch→hunks renderer (`DiffView.tsx`,
  `ToolChip.tsx:13,34`).
- **sdkSupport:** needs-sdk-work (small). The computation logic exists in the SDK
  (`computeEditsDiff` / `generateDiffString` / `generateUnifiedPatch`, `edit-diff.ts`) but is not in the
  public barrel — `exports` is `.`-only (`package.json:14-18`) and the barrel re-exports `renderDiff` /
  `EditToolDetails` but none of the diff *compute* helpers (`index.ts:260,337-339`). Pick one in design:
  **(a)** add a one-line public re-export of `computeEditsDiff` (and ideally `generateUnifiedPatch` for a
  write-style diff) from `packages/coding-agent/src/index.ts`, rebuild the monorepo `dist`, and call it
  from main — pi-citizen, zero duplicated logic; or **(b)** keep the SDK untouched and re-derive the diff
  in main using the `diff` npm dependency (the same lib `edit-diff.ts:6` uses). (a) is preferred; only one
  `write`-side helper is missing either way.
- **Effort:** M.

## Acceptance Criteria

- [ ] AC1. Gating an `edit` (in `ask` mode, on an existing file with a valid `oldText`) shows the change as
      red/green hunks in the approval card; Allow then applies exactly that change (the post-run tool card
      diff matches the previewed diff). Verified token-free via a fabricated/replayed approval request and a
      `PI_SHOT` light+dark screenshot.
- [ ] AC2. Gating a `write` shows the new file content as an added (green) diff against the existing file
      (or against empty for a new file), not a truncated raw `<pre>`.
- [ ] AC3. When the diff cannot be computed (missing file, fuzzy-match miss, read error), the dialog falls
      back to the existing raw-args view and approval still works — no thrown error, no blocked gate.
- [ ] AC4. Non-mutating tools and `bash` are unchanged (bash keeps showing its `command`; no diff field set
      for them). `acceptEdits` / `yolo` / session-`always` paths still auto-approve without computing a diff
      unnecessarily (the gate short-circuits before the dialog — `sessionController.ts:110-123`).
- [ ] AC5. The renderer stays pi-free: no new `@earendil-works/pi-*` import in `src/renderer/**`; the diff
      crosses as a plain string on the `ApprovalRequest` DTO in `src/shared/ipc.ts`, computed in main and
      wired through preload + bridge.
- [ ] AC6. `npm run typecheck && npm run lint && npm run test && npm run build` all green in
      `apps/desktop`. If R1 option (a) is taken, the monorepo `dist` is rebuilt and the desktop typechecks
      against the new public export.

## Design hints (for the later design.md)

- **DTO:** add an optional `diff?: string` to `ApprovalRequest` (`ipc.ts:162-166`); it rides through
  `WrappedApprovalRequest` (`ipc.ts:175-179`) and the existing `forwardApproval` path unchanged
  (`bridge.ts:22-24`, `sessionPool.ts:102-103`). No new IPC channel needed — it's a field on the existing
  approval request payload. Decide the string format to match `DiffView`: it keys off `+++`/`---`/`@@`/
  leading `+`/`-` (`DiffView.tsx:7-12`), so a unified patch (`generateUnifiedPatch`) renders cleanly;
  the display diff (`generateDiffString`, `+NN `/`-NN ` prefixes used by the post-run TUI/`renderDiff`)
  also classifies as add/del but carries line-number prefixes — choose one and keep it consistent with the
  post-run `ToolChip` view (which prefers `details.patch ?? details.diff`, `ToolChip.tsx:13`).
- **Compute site:** thread the diff in where the input is known and `cwd` is available — either compute in
  `approval.ts` (extend the `tool_call` handler: when `toolName === "edit"|"write"`, await the diff and
  pass it alongside the input) or compute in `sessionController.requestApproval` before
  `this.deps.onApproval({ id, toolName, input })` (`sessionController.ts:110-123`), which already holds
  `this.cwd` (`sessionController.ts:103`). The latter keeps `approval.ts` thin and gives a natural place
  for the try/catch fallback. Note `RequestApproval`'s signature (`approval.ts:6`) may need a third
  optional `diff` arg, or `requestApproval` builds the `ApprovalRequest` itself.
- **SDK reuse (preferred):** add `computeEditsDiff` (+ `generateUnifiedPatch`, and a write-side equivalent
  — a diff of new content vs. existing/empty file) to the public barrel `packages/coding-agent/src/index.ts`
  near the existing `renderDiff` / `EditToolDetails` exports; rebuild repo `dist`; import from
  `@earendil-works/pi-coding-agent` in main. For `edit`, normalize the input args the way the tool does
  (`prepareEditArguments`, `edit.ts:94-118`) so legacy single-edit and JSON-string `edits` inputs preview
  correctly. For `write`, there is no pre-execution SDK helper — derive an all-added diff from
  `input.content` vs. the current file (read via `fs`, or empty if absent).
- **Renderer:** in `ApprovalDialog.tsx`, when `request.diff` is present, render `<DiffView patch={request.diff} />`
  in place of the raw `content` `<pre>` (keep the raw fallback when `diff` is undefined). Reuse the existing
  `.diff` / `.dl.add` / `.dl.del` / `.dl.hunk` styles in `styles/tools.css:1-24` — no new CSS needed; cap
  very large diffs the way `content` is capped today (`ApprovalDialog.tsx:65-66`) to keep the card sane.
- **Mapping:** no `mappers.ts` change for the post-run path; this is the pre-run twin of what
  `mappers.ts:136-145` already does for `tool_execution_end`.

## Dependencies / sequencing

- None hard. This is self-contained (one DTO field + one compute call + one renderer branch). If a sibling
  child also touches `packages/coding-agent/src/index.ts` exports, coordinate the single barrel edit /
  `dist` rebuild to avoid a merge churn, but there is no ordering requirement.

## Out of scope

- Editing the proposed diff before approval (the user can only Allow/Deny/Always, as today).
- A diff preview for `bash` (it has no file diff; it keeps its `command` preview).
- Streaming/partial diff updates as the model emits args — the gate fires once with the complete input, so
  one computed diff per request is sufficient.
- Per-hunk approval, syntax highlighting inside the diff, or expand/collapse of long previews beyond a
  simple cap (revisit later if the cap feels tight).
- Changing approval *behavior* (modes, `always`, serialization) — only the *content shown* changes.

## Notes

- State: planning-only. This is a child of `06-27-desktop-roadmap` (parent roadmap task). Write `prd.md`
  only; do NOT write `design.md` / `implement.md` and do NOT change any code until the user gives the
  go-ahead.
- Pi-citizen reminder: prefer reusing the SDK's own diff computation (option (a)) over re-deriving diff
  logic in main, so the previewed diff is byte-identical to what the tool will actually produce.
- The "needs-sdk-work (small)" in the seed refers specifically to the missing public re-export of the
  diff-compute helpers (the logic already exists in `edit-diff.ts`); it is not new diff logic.
