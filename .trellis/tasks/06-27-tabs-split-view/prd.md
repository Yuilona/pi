# Tabs / split view over the concurrent session pool

## Goal

Surface the already-running concurrent sessions as a **tab strip** (and an optional **two-pane split
view**) inside the chat surface, so the user can keep several live chats in front of them and glance
between them — instead of today's single chat view that fully remounts the transcript on every switch.

## Background

The concurrency **engine** is already built; what is missing is a renderer composition that shows more
than one session at a time.

- The main process runs a real pool of live sessions: `SessionPool` owns a `Map<string, SessionController>`
  with `MAX_LIVE = 6` and parks the LRU idle controller beyond the cap
  (`apps/desktop/src/main/agent/sessionPool.ts:35`, `:124-137`). Each controller streams independently and
  is addressed by `sessionId`.
- The renderer already keeps **one `ChatState` slice per session** and routes the wrapped event stream to
  each slice even when it isn't focused: `useSessions()` holds `slices: Record<string, ChatState>` plus an
  `unread` map, fed by a single `window.pi.onEvent` subscription
  (`apps/desktop/src/renderer/src/state/useSessions.ts:5-13`, `:53-63`, `:77`). So all the per-session UI
  state for background sessions is *already in memory*.
- But the **view renders only the active session and remounts on switch.** `App.tsx` pulls a single
  `activeState`/`activeId` from `useSessions` and renders one `MessageList key={activeId ?? "none"}`
  (`apps/desktop/src/renderer/src/App.tsx:431`). The `key` is deliberate: message ids (`h1/h2…`) collide
  across sessions, so without a remount React would leak bubble hook state (smoothed text, thinking/tool
  expand) between sessions (comment at `App.tsx:428-430`). The cost is that switching back to a session
  tears down and rebuilds its whole transcript subtree, losing scroll position and per-bubble UI state, and
  re-running `MessageList`'s scroll/typewriter effects (`MessageList.tsx:46-84`).
- The sidebar already carries everything a tab strip needs: per-session `running` / `unread` /
  `pendingApproval` badges keyed by `sessionId` (the `liveInfo` map at `App.tsx:369-379`, consumed by
  `SessionSidebar.tsx:189-217`), and `AppStateDto.sessions: SessionSummaryDto[]` lists the live pool with
  `title` / `cwd` / `project` / `model` / `thinkingLevel` (`ipc.ts:240-264`).
- `setActive` is the focus signal that **drives notification suppression in main**: a background
  session's `agent_end` / approval fires an OS notification only when `id !== this.activeId`
  (`sessionPool.ts:97-99`, `:106-108`). So even with several panes visible, "active" must stay a single
  focused id — which the tab/split layout has to define explicitly.

So this child is a **renderer composition rework**, not new backend: bind a tab strip to the live pool,
keep visible sessions mounted instead of remount-on-switch, and add an optional split pane that shows two
slices side by side. No new pi capability is required (`sdkSupport: pure-ui`).

## Requirements

- **R1 (UX-3a — tab strip over the live pool).** A horizontal tab strip across the top of the chat
  surface, one tab per live session, bound to `AppStateDto.sessions` (`SessionSummaryDto`). Each tab shows
  the session title + project and overlays the existing `liveInfo` badges (running spinner / unread dot /
  pending-approval marker). Clicking a tab focuses that session; a close affordance parks/disposes it
  (reuse `closeSession`). New chats (`newChatInCwd`) and opening a history row (`openSession`) add/raise a
  tab. *Value:* the running background sessions the engine already maintains become directly visible and
  switchable, not hidden behind the sidebar.
  Evidence: `App.tsx:78` (`liveSessions: SessionSummaryDto[]`), `App.tsx:369-379` (`liveInfo`),
  `ipc.ts:240-264` (`SessionSummaryDto` / `AppStateDto`), `useSessions.ts:85-112`
  (`setActive`/`openSession`/`newChatInCwd`). sdkSupport: pure-ui. Effort: M.

- **R2 (UX-3b — keep visible tabs mounted; no remount-on-switch).** Replace the single
  `MessageList key={activeId}` (`App.tsx:431`) with one mounted `MessageList` per *visible* session
  (the focused tab, plus the second pane in split view), each fed its own
  `slices[sessionId]` slice and hidden via CSS (e.g. `display:none`) rather than unmounted when not focused.
  Switching tabs must NOT tear down and rebuild the transcript subtree, so scroll position, per-bubble
  expand state, and the typewriter reveal survive a switch. The cross-session hook-state leak the current
  `key` guards against must be solved by **namespacing** the React keys per session (e.g.
  `${sessionId}:${message.id}`) so identical message ids across sessions can't collide while sessions stay
  mounted. *Value:* tabs feel instant and stateful; switching no longer flashes a rebuild or loses your
  place. *Dev value:* removes the per-switch remount cost of `MessageList`'s effects.
  Evidence: `App.tsx:426-438` + comment `:428-430`; `MessageList.tsx:35`, `:46-84`, `:94-110`
  (per-message `key={m.id}`, scroll/rAF effects keyed off `state`). sdkSupport: pure-ui. Effort: L.

- **R3 (UX-3c — bounded set of mounted views).** Mount only a small, bounded number of `MessageList`s at
  once (the visible tab(s) plus a short MRU of recently-viewed tabs), not all live sessions, so a pool at
  `MAX_LIVE = 6` doesn't keep six full transcript DOM subtrees live. A tab not in the mounted set hydrates
  on focus via the existing `loadTranscript` path. *Value:* tabs stay responsive without unbounded DOM /
  memory growth, mirroring the cap discipline the pool already enforces in main.
  Evidence: `sessionPool.ts:35` (`MAX_LIVE = 6`); `useSessions.ts:79-92` (`loadTranscript` + `setActive`
  resync). sdkSupport: pure-ui. Effort: M.

- **R4 (UX-3d — optional two-pane split view).** A toggle that splits the chat surface into two panes,
  each bound to a different live `sessionId`, each with its own mounted `MessageList`. Exactly one pane is
  the **focused** pane (drives `setActive`, so its tab gets keyboard focus and its background-notification
  suppression applies); the other pane is visible but not the notification-active one. Clicking into a pane
  or its tab makes it the focused pane. The split is a layout state in the renderer (no new IPC). *Value:*
  watch two long-running turns side by side (e.g. compare answers / monitor a background run) without
  flipping tabs. *Note:* keep "active" single — `setActive` semantics (one focused id) must not be
  broken by showing two panes.
  Evidence: `sessionPool.ts:97-99`, `:106-108` (notification keyed off the single `activeId`);
  `bridge.ts:72` (`setActive` -> `pool.setActive`); `useSessions.ts:85-92`. sdkSupport: pure-ui.
  Effort: L.

- **R5 (UX-3e — per-tab composer + status context).** The composer, model pill, usage readout, mode
  indicator, and approval dialog must reflect **the focused tab/pane's** session, not a globally-shared
  one. Today these already read the active session (`activeSummary`/`model`/`thinking`/`currentCwd` at
  `App.tsx:96-100`; usage at `App.tsx:158-161`; `activeApproval` at `App.tsx:115`), so this is making
  "active" mean "the focused pane" and re-deriving these from the focused `sessionId`. In split view, each
  pane shows its own running state / model / cwd label. *Value:* the controls always act on the chat you're
  looking at; in split view there's no ambiguity about which session a send targets.
  Evidence: `App.tsx:96-100`, `:115-125` (`activeApproval`/`resolveApproval` keyed by `activeIdRef`),
  `:439-456` (Composer props from active state). sdkSupport: pure-ui. Effort: M.

## Acceptance Criteria

- [ ] AC1. A tab strip renders one tab per live session from `AppStateDto.sessions`, with the existing
      running / unread / pending-approval badges; clicking a tab focuses that session (calls `setActive`)
      and a close control parks it (`closeSession`). New-chat and open-history both raise/add a tab.
- [ ] AC2. Switching between two tabs does NOT remount the transcript: scroll position and per-bubble
      expand state persist across a switch (verified via the dev screenshot hooks driving the real UI —
      open two sessions, scroll one, switch away and back, confirm the scroll/expand state is retained).
- [ ] AC3. No cross-session UI-state bleed with sessions mounted simultaneously: identical message ids in
      two sessions render independently (React keys namespaced by `sessionId`); switching tabs never shows
      another session's smoothed text / thinking-expand state.
- [ ] AC4. At most a bounded set of `MessageList`s is mounted at once (focused + a short MRU), not all
      `MAX_LIVE` sessions; a tab outside the set hydrates on focus via `loadTranscript`.
- [ ] AC5. Split view (if delivered this iteration): two panes each bound to a distinct live `sessionId`,
      each streaming independently; exactly one pane is the focused/notification-active session
      (`setActive` still carries a single id); clicking a pane refocuses it. If split view is deferred,
      it is noted explicitly in `implement.md` and the tab strip (R1–R3, R5) still lands.
- [ ] AC6. The composer / model pill / usage / mode / approval dialog reflect the focused pane's session;
      in split view each pane reflects its own session's state.
- [ ] AC7. `npm run typecheck && npm run lint && npm run test && npm run build` all green.
- [ ] AC8. Renderer stays pi-free: `grep` confirms no `@earendil-works/pi-*` import under
      `src/renderer/**`; no new IPC channel or DTO is required (this is a pure renderer composition).

## Design hints (for the later design.md)

- **Renderer-only; no new IPC/DTOs.** Everything needed already crosses the bridge: the live pool list
  (`AppStateDto.sessions` via `getState`), per-session slices + `unread` (`useSessions`), and
  `setActive`/`openSession`/`newChatInCwd`/`closeSession`/`loadTranscript`. Do not add channels in
  `ipc.ts` / preload / bridge for this feature.
- **Tab strip:** a new `components/TabStrip.tsx` (or fold into `App.tsx`) bound to `liveSessions`
  (`SessionSummaryDto[]`) + the existing `liveInfo` map. Reuse the sidebar's badge classes
  (`sess-spin` / `sess-unread` / `sess-approval`, `SessionSidebar.tsx:201-215`) and `relTime`/badge a11y
  text for parity. Close button -> `closeSession` + `removeSlice` (mirror the delete flow in
  `App.tsx:201-224` but parking, not deleting the file).
- **Mounted-views model:** lift the "which sessionId(s) are visible" + "which is focused" into a small
  renderer layout state (focusedId + optional secondId + an MRU list). Render a `MessageList` for each
  visible/mounted id from `slices[id]`, toggling visibility with CSS instead of unmounting. Drop the
  `key={activeId}` remount trick and instead namespace per-message keys (`MessageList.tsx:94-110`,
  `UserBubble`/`AssistantBubble` `key`) by `sessionId` so the hook-state-leak the comment at
  `App.tsx:428-430` describes can't happen with sessions co-mounted.
- **Split view:** a CSS-grid/flex two-pane container in `App.tsx`'s `.main`; each pane = a
  `MessageList` + (in split) its own slim composer or a shared composer bound to the focused pane. Keep
  `setActive` single-valued (one focused id) — only the focused pane suppresses its own OS notification
  (`sessionPool.ts:97-99`, `:106-108`); the other pane behaves like a "background" session for
  notifications. Style follows `DESIGN.md` (parchment/terracotta; a subtle divider between panes).
- **Per-pane context:** generalize `activeSummary`/`model`/`thinking`/`currentCwd`/`usage`/`activeApproval`
  (`App.tsx:96-100`, `:115`, `:158-161`) to be derived from the focused pane's `sessionId`; in split view
  derive a per-pane summary for each pane's header.
- **Verify token-free** via the `PI_SHOT` / `PI_JS` dev hooks (drive the real UI — click a `.sess` row /
  a tab by an ASCII substring; `window.pi` is a frozen contextBridge object and cannot be monkeypatched).

## Dependencies / sequencing

**Roadmap wave: Wave 3 (of 4)** — recommended execution slot ~#9 of 14.

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after (soft):** 06-27-session-safety (per-session permission mode) — so each tab can show its own mode badge.
- **Blocks / do before:** nothing.
- **Why Wave 3:** the concurrency engine already exists; this is a renderer composition rework (L), best after the per-session-mode safety net.

## Out of scope

- Any main-process / pi-SDK change (no new IPC channels or DTOs; the engine is reused as-is).
- More than two panes, draggable/resizable pane splitters beyond a basic divider, or detaching a session
  into a separate OS window.
- Raising `MAX_LIVE` or changing the park/evict policy (`sessionPool.ts:35`, `:124-137`).
- Cross-session shared context / hand-off between tabs (already out of scope for the concurrency line).
- Drag-to-reorder tabs and tab pinning (possible follow-up polish).

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap`. Implement only on the user's
  go-ahead; do not `task.py start` until asked.
- `sdkSupport: pure-ui` — the entire feature is renderer composition over capabilities that already exist;
  the value is unlocking the *already-running* concurrent pool, which is currently invisible behind a
  single-view UI.
