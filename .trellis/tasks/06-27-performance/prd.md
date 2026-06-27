# Renderer performance pass (code-split, incremental markdown, virtualization)

## Goal

Make the desktop renderer stay fluid under the conditions that strain it today — a long streaming reply, a
many-message resumed session, several live sessions, and a chatty `bash` command — by splitting the
1.23 MB monolithic renderer bundle, cutting the markdown re-parse cost on the live bubble, and bounding the
work/memory that grows with transcript length and session count. Measure-then-optimize: each requirement
targets a specific hot path in real code.

## Background

The build emits a single ~1.23 MB renderer chunk: `electron.vite.config.ts` configures only one
`rollupOptions.input` for the renderer with no `manualChunks` and no lazy boundaries
(`electron.vite.config.ts:41-45`). Everything — KaTeX, the 582-line `SettingsPanel`, the 194-line
`ImageViewer`, react-markdown + remark/rehype — is eagerly imported through `App.tsx` (`App.tsx:21-24`) and
loaded before first paint. A grep confirms there is no `React.lazy`/`Suspense` anywhere under
`src/renderer/src/`.

The live streaming bubble re-runs the full markdown pipeline on every typewriter tick. `AssistantBubble`'s
`StreamingText` calls `useSmoothedText` (which paints at ~30fps, `useSmoothedText.ts:29` `PAINT_MS = 33`) and
feeds the growing string straight into `<Markdown>` (`AssistantBubble.tsx:14-17`). `Markdown` runs
`normalizeMathBlocks` + `remarkGfm` + `remarkMath` + `rehypeKatex` + `rehypeGroupImages` over the **entire**
accumulated text on each render (`Markdown.tsx:64-109`); the memo only skips when `text` is unchanged
(`Markdown.tsx:67-69`), which never holds while streaming. So a 5 KB reply re-parses ~150 times, each parse
over the full-and-growing string.

The transcript is never virtualized: `MessageList` maps every message in `state.messages`
(`MessageList.tsx:94-110`). A resumed session can hydrate hundreds of messages (`mapTranscript`,
`mappers.ts:173-205`) — all mounted, all in the DOM, all re-laid-out on each scroll-follow.

Renderer memory grows without bound across sessions. `metaReducer` keeps one `ChatState` slice per session id
in `slices` and only drops one on an explicit `remove` (`useSessions.ts:46-52`); main caps **live** sessions
at `MAX_LIVE = 6` (`sessionPool.ts:35,126`) and parks the rest, but the renderer keeps every slice it has ever
seen, including image content. Images are stored as base64 data URLs inline in message/result content
(`mappers.ts:59,78`) and in composer attachments (`Composer.tsx:203`); these are never evicted, so a long day
of image-heavy chats accumulates megabytes of strings the renderer can't reclaim.

The scroll-follow loop runs every animation frame for the whole turn. `MessageList` starts a `requestAnimationFrame`
loop on `state.streaming` that re-arms itself every frame and only acts every ~90ms via an internal time gate
(`MessageList.tsx:67-84`) — i.e. it wakes ~60×/sec to do nothing 5 of 6 times, for the entire duration of the
reply.

`App` is a god-component and the composer input lives in its state. `App.tsx` holds ~20 `useState` hooks
including `const [input, setInput] = useState("")` (`App.tsx:79`), passed to `<Composer value={input} onChange={setInput}>`
(`App.tsx:440-441`). Every keystroke calls `setInput`, re-rendering the entire `App` subtree (Titlebar,
SessionSidebar, MessageList, Composer) on each character.

Fonts are over-shipped. `main.tsx` imports the three `@fontsource-variable/*` default entry points
(`main.tsx:1-3`), whose default `index.css` pulls multiple subsets (Fraunces alone loads vietnamese +
latin-ext + latin `@font-face` blocks). KaTeX's `katex.min.css` (imported at `Markdown.tsx:1`) declares **20
woff2 + 20 woff + 20 ttf** faces; in Electron/Chromium only woff2 is ever used, so the woff/ttf URLs are dead
weight packaged into the app.

Live `bash` stdout is delivered as a full snapshot, not a delta, and is not coalesced. `mapEvent` turns each
`tool_execution_update` into a `partialText` built from the partial result's full content
(`mappers.ts:128-134`); the reducer replaces `tool.output` with that full string each time
(`chatReducer.ts:80-84`); `BashCard` renders `tool.output` directly (`BashCard.tsx:13,28`). Assistant prose
gets the smoothing/paint-cap treatment via `useSmoothedText`, but bash output re-renders the whole `<pre>` on
every update with no throttle — a noisy command (e.g. a long build log) thrashes the transcript.

This whole child is **lower priority than capability/safety parity** (sibling roadmap children). It is a
measure-then-optimize pass: land the cheap structural wins (config + lazy) first, confirm with a fresh build's
chunk report and the dev screenshot hooks, then take the deeper refactors only where a measurement shows they
pay.

## Requirements

- **R1 (PERF-2) — vendor `manualChunks` split.** Add a `build.rollupOptions.output.manualChunks` to the
  renderer config so heavy vendor code (react-markdown/remark/rehype, KaTeX, react/react-dom) lands in
  separate chunks instead of one 1.23 MB file. Dev value: a one-line-ish config change that is the prerequisite
  for R2 actually shrinking the entry chunk (without it, lazy splits can still get hoisted into shared vendor).
  Evidence: `electron.vite.config.ts:41-45` (renderer has only an `input`, no `output.manualChunks`).
  sdkSupport: n/a (build config). Effort: S.

- **R2 (PERF-1) — code-split `SettingsPanel` / `ImageViewer` / KaTeX out of the entry chunk.** Wrap the
  rarely-mounted heavy components in `React.lazy` + `<Suspense>` so they (and the markdown/KaTeX they drag in)
  load on demand rather than before first paint. `SettingsPanel` (582 lines) only mounts when settings open
  (`App.tsx:463-481`); `ImageViewer` (194 lines) only when an image is opened (`App.tsx:486`); KaTeX CSS+JS
  loads via the always-imported `Markdown` (`Markdown.tsx:1`, `App.tsx:22`). User value: faster cold start,
  smaller initial parse/eval. Evidence: `App.tsx:21-24` eager imports; no `React.lazy`/`Suspense` exists in
  `src/renderer/src/`. sdkSupport: n/a (renderer-only, React feature). Effort: M.

- **R3 (PERF-3) — incremental/segmented markdown parse for the live bubble.** Split the streaming text into a
  stable "settled" prefix (rendered once, memoized) and only the trailing in-flight segment (re-parsed each
  tick), or otherwise avoid re-parsing the whole accumulated string ~30×/sec. Today `StreamingText` →
  `Markdown` re-runs remark+rehype+KaTeX over the full growing string on every paint
  (`AssistantBubble.tsx:14-17`, `Markdown.tsx:64-109`, paint cadence `useSmoothedText.ts:29`). User value:
  the live reply stays smooth on long replies and on slower machines; lowers CPU during a turn. Constraint:
  must not break the multi-line `$$` handling (`normalizeMathBlocks`, `Markdown.tsx:108`) or fenced-code copy
  buttons across the split boundary. Evidence: `Markdown.tsx:67-69` memo only skips on identical `text`.
  sdkSupport: n/a (renderer-only). Effort: L.

- **R4 (PERF-4) — virtualize the transcript for long sessions.** Window the message list so only on-screen
  bubbles (plus a buffer) are mounted, for resumed/long threads. `MessageList` currently maps all of
  `state.messages` (`MessageList.tsx:94-110`); a hydrated session can be hundreds of messages
  (`mappers.ts:196`). User value: opening a big session stays instant; scrolling stays smooth. Caveats to
  respect in design: the bottom-anchored scroll-follow (`MessageList.tsx:46-84`), the per-bubble hook state
  that motivated the `key={activeId}` remount (`App.tsx:428-431`), variable-height bubbles, and the
  `endRef` sentinel. No virtualization library is currently a dependency — design must choose
  (lib vs. lightweight custom). Evidence: `MessageList.tsx:94-110`. sdkSupport: n/a (renderer-only). Effort: L.

- **R5 (PERF-5) — cap/evict renderer chat slices to mirror `MAX_LIVE`.** Bound the number of `ChatState`
  slices the renderer retains (and free their base64 image strings) so it mirrors main's parked-session cap
  rather than growing forever. Main caps live sessions at `MAX_LIVE = 6` and parks the rest
  (`sessionPool.ts:35,126,124-137`), but `metaReducer.slices` only shrinks on explicit `remove`
  (`useSessions.ts:46-52`), and image data lives inline as base64 (`mappers.ts:59,78`). User value: bounded
  renderer memory over a long day of image-heavy chats. Caveat: must not evict the active slice or a slice
  with a pending approval; an evicted-then-refocused session reloads via the existing `loadTranscript`
  (`useSessions.ts:79-92`). Evidence: `useSessions.ts:46-52` (no eviction), `sessionPool.ts:126`.
  sdkSupport: SDK already re-serves transcripts via `getTranscript` (`useSessions.ts:80`). Effort: M.

- **R6 (PERF-6) — self-throttle the scroll-follow rAF loop.** Stop running a per-frame rAF for the entire
  turn; drive the near-bottom follow from a timer/throttled scheduler (or only while content actually grows),
  so the loop isn't waking ~60×/sec to no-op. Today the loop re-arms every frame and gates work to ~90ms
  internally (`MessageList.tsx:67-84`). User value: lower idle CPU during long replies (battery on laptops).
  Constraint: keep the "don't yank a user who scrolled up" near-bottom test (`MessageList.tsx:57-58,76`).
  Evidence: `MessageList.tsx:67-84`. sdkSupport: n/a (renderer-only). Effort: S.

- **R7 (PERF-7) — decompose the `App.tsx` god-component / lift composer input out of `App` state.** Move
  `input`/`setInput` (and the composer's local concerns) out of `App` so a keystroke re-renders the composer,
  not the whole app; split the ~490-line `App` into smaller pieces and/or memoize the heavy children
  (MessageList, SessionSidebar). Today `input` is `App` state (`App.tsx:79`) passed to `<Composer value=...
  onChange={setInput}>` (`App.tsx:440-441`), so every character re-renders Titlebar + Sidebar + MessageList +
  Composer. User value: typing stays responsive even mid-stream; cleaner code for future work. Caveat:
  `handleSend` reads `input` to detect builtin slash-commands (`App.tsx:333-344`) and `runCommand` clears it
  (`App.tsx:230`) — the lift must preserve send/clear/`/command` behavior. Evidence: `App.tsx:79,333-344,440-441`.
  sdkSupport: n/a (renderer-only). Effort: M.

- **R8 (PERF-8) — self-host/subset fonts + drop redundant KaTeX font formats.** Import only the latin (and any
  actually-needed) subset of each `@fontsource-variable/*` family instead of the default multi-subset entry
  point, and strip KaTeX's woff/ttf faces so only woff2 ships. Today `main.tsx:1-3` imports the default
  entries (Fraunces' default `index.css` loads vietnamese + latin-ext + latin), and `katex.min.css` declares
  20×{woff2,woff,ttf} faces (`Markdown.tsx:1`) of which Chromium only uses woff2. User value: smaller package,
  faster font readiness. Caveat: keep the DESIGN.md serif/sans/mono identity exactly (DESIGN.md is the styling
  source of truth). Evidence: `main.tsx:1-3`; KaTeX css ships 20 woff2 + 20 woff + 20 ttf (verified in
  `node_modules/katex/dist/katex.min.css`). sdkSupport: n/a (build/asset). Effort: M.

- **R9 (PERF-11) — coalesce live `bash` stdout the way assistant text is coalesced.** Throttle/paint-cap the
  live `tool.output` render so a chatty command doesn't re-render the whole `<pre>` on every update, mirroring
  the smoothing already applied to assistant prose. Today each `tool_execution_update` carries the full partial
  text (`mappers.ts:128-134`), the reducer replaces `tool.output` wholesale (`chatReducer.ts:80-84`), and
  `BashCard` renders it directly with no throttle (`BashCard.tsx:13,28`), whereas assistant text goes through
  `useSmoothedText` (`AssistantBubble.tsx:14-16`). User value: a long build log streams smoothly instead of
  thrashing layout. Evidence: `mappers.ts:128-134`, `chatReducer.ts:80-84`, `BashCard.tsx:13,28`.
  sdkSupport: SDK already emits `tool_execution_update` partials (`mappers.ts:128`). Effort: S.

## Acceptance Criteria

- [ ] A fresh `npm run build` shows the renderer entry chunk materially smaller and split into multiple chunks
      (no longer one ~1.23 MB file); `SettingsPanel`, `ImageViewer`, and the KaTeX/markdown vendor code appear
      as separate on-demand chunks (R1, R2).
- [ ] Opening Settings and opening the image viewer still work (lazy-loaded behind `<Suspense>` with a fallback
      that doesn't flash); verified token-free via the dev screenshot hooks (`PI_SHOT`/`PI_JS`) (R2).
- [ ] The live streaming bubble no longer re-parses the full accumulated markdown string on every tick — the
      settled prefix is parsed once; multi-line `$$` math and fenced-code copy buttons still render correctly
      (R3).
- [ ] A long resumed session mounts only on-screen bubbles (windowed), and the bottom-anchored scroll-follow,
      the `key={activeId}` remount semantics, and per-bubble expand state still behave correctly (R4).
- [ ] Renderer-retained chat slices are bounded (mirroring `MAX_LIVE`); the active slice and slices with a
      pending approval are never evicted; a refocused, evicted session reloads its transcript via
      `loadTranscript` (R5).
- [ ] The scroll-follow no longer runs an unconditional per-frame rAF for the whole turn; the near-bottom
      "don't yank a scrolled-up reader" behavior is preserved (R6).
- [ ] Typing in the composer no longer re-renders the whole `App` subtree on every keystroke; send,
      input-clear, and `/command` detection still work (R7).
- [ ] Only the needed font subsets ship; KaTeX ships woff2 only (no woff/ttf faces in the build output); the
      DESIGN.md serif/sans/mono identity is visually unchanged (screenshot-verified) (R8).
- [ ] Live `bash` stdout is throttled/coalesced like assistant text; final output is unaffected (R9).
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` all green; the renderer stays
      pi-free — no `@earendil-works/pi-*` import under `src/renderer/**`.

## Design hints (for the later design.md)

- **R1**: add `renderer.build.rollupOptions.output.manualChunks` in `electron.vite.config.ts` (a function or
  id→group map: `react`/`react-dom` → `vendor-react`, `react-markdown`/`remark-*`/`rehype-*`/`micromark`/
  `mdast`/`hast`/`unified` → `vendor-markdown`, `katex` → `vendor-katex`). Pair with `manualChunks` so R2's
  splits don't re-merge.
- **R2**: `const SettingsPanel = lazy(() => import("@/components/SettingsPanel"))` and same for `ImageViewer`;
  wrap their mount sites (`App.tsx:463-481`, `App.tsx:486`) in `<Suspense fallback={…}>`. These need default
  exports or `.then(m => ({default: m.X}))`. To pull KaTeX off the critical path, lazy-load the math-rendering
  path inside `Markdown.tsx` (the `katex/dist/katex.min.css` import at `Markdown.tsx:1` and `rehypeKatex` are
  the heavy bits) — only when math is present.
- **R3**: parse a "settled" prefix once and only re-parse the trailing segment. Options: split on the last
  blank line / fenced-code boundary so an open ``` or open `$$` stays entirely in the live segment; memoize the
  settled `<Markdown>` by its text. Touch `AssistantBubble.tsx` (`StreamingText`) and possibly a new helper;
  keep `normalizeMathBlocks` semantics (`Markdown.tsx:108`).
- **R4**: window `state.messages` in `MessageList.tsx:94-110`. Decide lib vs. custom (no virtualization dep
  today). Must coexist with the `endRef` sentinel + scroll-follow (`MessageList.tsx:36,46-84,113`) and the
  outer `.scroll` container `App.tsx:426`. Variable heights → measure-on-mount or estimated-size windowing.
- **R5**: add eviction in `metaReducer` (`useSessions.ts:28-65`) — an LRU keyed off active/event order, never
  evicting `activeId` or a slice the app marks as having a pending approval; rely on `loadTranscript`
  (`useSessions.ts:79-82`) to rehydrate on refocus. Coordinate the cap with main's `MAX_LIVE`
  (`sessionPool.ts:35`); consider surfacing the value via state rather than hardcoding twice.
- **R6**: replace the self-re-arming rAF in `MessageList.tsx:67-84` with a `setInterval`(~90ms) gated on
  `state.streaming`, or schedule a single rAF only when `state.messages`/smoothed content actually changes;
  keep the `scrollHeight - scrollTop - clientHeight < 120` near-bottom test.
- **R7**: lift `input`/`setInput` into the `Composer` (uncontrolled-from-App) or a small dedicated context;
  expose an imperative `clear()`/`getValue()` or move `handleSend`'s slash-command detection
  (`App.tsx:333-344`) into the composer. Memoize `MessageList`/`SessionSidebar` so they don't re-render on
  composer typing. Consider extracting App into `<ChatView>` + `<Shell>` to shrink the hook surface.
- **R8**: change `main.tsx:1-3` to subset imports (e.g. `@fontsource-variable/inter/latin.css` style entries
  if available, or self-hosted woff2 + a local `@font-face`). For KaTeX, either post-process `katex.min.css`
  to drop woff/ttf `src` formats, or use a Vite/electron-builder asset filter to exclude `*.ttf`/`*.woff`
  under katex fonts. Verify against DESIGN.md.
- **R9**: smooth `tool.output` in `BashCard.tsx:13,28` (reuse/adapt `useSmoothedText` for monospace, or a
  simpler `requestAnimationFrame`/interval paint cap), since the partial arrives full-snapshot per update
  (`mappers.ts:128-134`, `chatReducer.ts:80-84`). No IPC/mapper change required — purely a render-rate fix.

All R's are renderer-only except R1 (build config) and R8 (build/asset); none require new IPC channels or
mapper changes, so the pi-free boundary and the `ipc.ts` DTO contract are untouched.

## Dependencies / sequencing

**Roadmap wave: Wave 3 (of 4)** — recommended execution slot ~#12 of 14.

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after:** nothing — can run anytime; measure-then-optimize.
- **Blocks / do before:** nothing.
- **Why Wave 3:** real but lower priority than capability/safety parity; PERF-2 (vendor split) is the one-line prerequisite for PERF-1 (code-split) within this task.

## Out of scope

- Main-process / SDK performance (session pool sizing, JSONL IO, proxy) — this child is the **renderer** pass.
- Any change to `packages/**` (upstream pi).
- New IPC channels or DTO changes in `ipc.ts` (none of these findings need them).
- Tabs / split-pane multi-view or other feature work.
- Raising `MAX_LIVE` or re-architecting the session pool (R5 only *mirrors* the existing cap in the renderer).

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap`. Implement only on the user's
  go-ahead (no `task.py start` until asked).
- Measure-then-optimize: before each deeper refactor (R3/R4/R5/R7), capture a baseline (build chunk report
  for R1/R2; a screenshot-hook driven profile for the render-rate items) so the win is verified, not assumed.
- Verification is token-free: `typecheck`/`lint`/`test`/`build` plus the dev screenshot hooks in
  `src/main/index.ts` (`PI_SHOT`/`PI_JS`/`PI_WAIT`/`PI_THEME`). No live API spend is required.
