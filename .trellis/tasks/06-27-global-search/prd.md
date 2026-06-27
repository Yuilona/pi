# Global content search across all sessions

## Goal

Give the desktop app a Ctrl+K / Ctrl+F command palette that fuzzy-searches every on-disk session by
title **and** message body, ranks the hits, and jumps straight into the matched chat — so once a user
has dozens of chats they can find "the one where I debugged the proxy" instead of hunting the sidebar.

## Background

Today the only way to locate a past chat is the sidebar (`SessionSidebar.tsx`), which groups sessions by
project `cwd` and shows their titles + relative time; it does **not** filter or search at all (no input
box anywhere in the component — see `SessionSidebar.tsx:49-133`). The renderer loads the list via
`window.pi.listSessions()` (`App.tsx:149`) and opens a row through `openSession(row.path, row.sessionId)`
(`App.tsx:406` → `useSessions.openSession`/`setActive`, `useSessions.ts:85-102`). There is no global
search key handler — the only window-level keydown is the Shift+Tab permission-mode cycle
(`App.tsx:278-287`).

The capability is essentially already present in the pi SDK, just not surfaced:

- `SessionManager.listAll()` (`session-manager.ts:1516-1574`) already enumerates every project dir and
  returns `SessionInfo[]`, and each `SessionInfo` carries **both** `firstMessage` and `allMessagesText`
  — the full user+assistant text of the session joined into one string (`buildSessionInfo`,
  `session-manager.ts:589-666`, esp. `allMessagesText: allMessages.join(" ")` at line 662). So body
  search needs **no** extra per-file `getEntries()` pass for the common case; the body text already rides
  along with the list.
- But `SessionPool.listSessions()` (`sessionPool.ts:338-379`) deliberately **drops** `allMessagesText`
  when mapping `SessionInfo` → `SessionInfoDto`: the DTO (`ipc.ts:195-207`) only has `title`,
  `messageCount`, `modified`, `cwd`, `project`, `path`, `sessionId` — no body. So the renderer cannot
  search bodies with the data it has today, and shipping every session's full transcript text to the
  renderer on every `listSessions()` would bloat the pi-free IPC payload badly.
- The TUI already ships a complete search experience for parity: `fuzzyMatch` (a public export of
  `@earendil-works/pi-tui`, `packages/tui/src/index.ts:33`) and the richer
  `session-selector-search.ts` matcher (`parseSearchQuery`/`matchSession`/`filterAndSortSessions`,
  with quoted-phrase + `re:` regex + relevance scoring). The latter searches
  `${id} ${name} ${allMessagesText} ${cwd}` (`session-selector-search.ts:26-27`). That richer matcher is
  **not** a public package export, so it can't be imported directly; `fuzzyMatch` can.

Architecturally the search must run in **main** (where pi/pi-tui live), because the renderer is pi-free
and cannot import `@earendil-works/pi-*`, and because main already holds (or can cheaply re-fetch) the
`allMessagesText` that the renderer must never receive wholesale. The renderer's job is the overlay UI +
reusing the existing open-session path.

## Requirements

### R1 — Global search IPC + main-side matcher (UX-1)

A new `searchSessions(query, opts?)` IPC channel + `PiApi` method that runs entirely in the main process:
it scans `SessionManager.listAll()` and matches each session's **title** (name / firstMessage) and
**body** (`allMessagesText`) against the query, ranks by relevance, caps the result count, and returns a
list of lightweight, pi-free DTOs (the existing `SessionInfoDto` shape plus a per-hit `score` and an
optional short body **snippet** around the match — NOT the full transcript). The renderer keys results to
the existing open flow by `path` + `sessionId`.

- **Value (user):** finding a chat by what was said in it is table stakes vs Claude Desktop / ChatGPT;
  today it's impossible past a handful of chats.
- **Value (dev):** keeps the pi-free contract intact — the heavy `allMessagesText` stays in main; only a
  small snippet + score crosses IPC.
- **Evidence:** absent channel — `IPC`/`PiApi` have `listSessions` but no search (`ipc.ts:39`,
  `ipc.ts:308`); body text exists in main but is dropped at `sessionPool.ts:347-357`; full transcript
  already available via `SessionInfo.allMessagesText` (`session-manager.ts:662`).
- **sdkSupport:** yes-already-in-sdk. `SessionManager.listAll()` (returns `allMessagesText`+`firstMessage`)
  + `fuzzyMatch` from `@earendil-works/pi-tui` (`packages/tui/src/index.ts:33`). The TUI's
  `session-selector-search.ts` is a ready reference for ranking/quoting/regex (not importable; re-implement
  the small slice we need in main, or just use `fuzzyMatch` on `title` and on `allMessagesText`).
- **Effort:** M (new IPC + DTO + preload + bridge wiring + a small matcher in `SessionPool`).

### R2 — Search overlay UI (Ctrl+K / Ctrl+F) (UX-1)

A renderer command-palette overlay, opened by **Ctrl+K** (and **Ctrl+F**), with a single text input, a
live, debounced results list, full keyboard nav (↑/↓ to move, Enter to open, Esc to close), and a click
target per row. Each row reuses the sidebar row visuals (title, project label, relative time) and, when
the hit was in the body, shows the returned snippet with the matched substring emphasized. Selecting a row
opens that chat via the existing `openSession(path, sessionId)` path and closes the overlay.

- **Value (user):** one keystroke from anywhere to "find that chat", matching the muscle memory of every
  other desktop chat/editor app.
- **Evidence:** no search input exists in the sidebar (`SessionSidebar.tsx:49-133`); the open-on-select
  flow already exists (`App.tsx:406`, `useSessions.ts:95-102`); the only global keydown today is Shift+Tab
  (`App.tsx:278-287`) — Ctrl+K/Ctrl+F are free.
- **sdkSupport:** n/a (pure renderer + the R1 IPC). Renderer stays pi-free — it calls `window.pi.searchSessions`
  and renders DTOs only.
- **Effort:** M (new overlay component + global key handler + debounce + result rendering + focus mgmt;
  reuse `useModalFocus` from `state/useModalFocus.ts` for trap/restore).

### R3 — Responsive, bounded scanning (UX-1)

Search must stay responsive with many large sessions: the query input is **debounced** (~150–250ms), the
main-side scan **caps** returned hits (e.g. top ~50 by score) and **bounds** snippet length, an empty
query returns the recents (no scan), and a newer query supersedes an in-flight one so stale results never
overwrite the visible list. Title matching is the fast path; body (`allMessagesText`) matching is the
deeper pass — both already in-memory from one `listAll()` call, so no extra disk reads are needed for the
common case (optionally cache the `listAll()` result briefly between keystrokes to avoid re-reading every
file per keystroke).

- **Value (user/dev):** the box feels instant and never janks the UI even with hundreds of sessions; no
  unbounded payloads cross IPC.
- **Evidence:** `listAll()` already reads files with bounded concurrency
  (`MAX_CONCURRENT_SESSION_INFO_LOADS = 10`, `session-manager.ts:671`) and returns body text in one pass
  (`session-manager.ts:662`); the sidebar refreshes per streaming tick (`App.tsx:293-299`), so a naive
  re-scan-per-keystroke would be wasteful — debounce + a short-lived cache is the fix.
- **sdkSupport:** yes-already-in-sdk (the bounded `listAll` concurrency); the cap/debounce/snippet logic is ours.
- **Effort:** S (tuning on top of R1/R2).

## Acceptance Criteria

- [ ] AC1. A `searchSessions` channel exists in `ipc.ts` (in `IPC` + `PiApi`), is wired in
      `preload/index.ts` and `bridge.ts`, and implemented in `SessionPool`; it returns ranked, pi-free
      DTOs (existing `SessionInfoDto` fields + `score` + optional bounded `snippet`) — never the full
      `allMessagesText`.
- [ ] AC2. Ctrl+K and Ctrl+F open the search overlay from anywhere in the chat view (not captured inside a
      TEXTAREA in a way that breaks normal typing); Esc closes it; ↑/↓ move the selection; Enter opens the
      highlighted result.
- [ ] AC3. Typing a query that appears only in a message **body** (not the title) surfaces the right
      session, and selecting it opens that chat (verified via a fabricated session + a screenshot hook —
      no API tokens).
- [ ] AC4. Title-only and body matches both rank sensibly (closer/word-boundary matches first), results
      are capped, snippets are bounded, the input is debounced, and a stale in-flight query cannot
      overwrite a newer result set.
- [ ] AC5. The renderer stays pi-free — no `@earendil-works/pi-*` import in `src/renderer/**`; all SDK /
      pi-tui usage (`SessionManager.listAll`, `fuzzyMatch`) lives in main; the contract change is in
      `src/shared/ipc.ts`.
- [ ] AC6. `npm run typecheck && npm run lint && npm run test && npm run build` all green; light + dark
      screenshots (via `PI_SHOT` / `PI_THEME=dark`) confirm the overlay matches DESIGN.md.

## Design hints (for the later design.md)

- **ipc.ts:** add `searchSessions: "pi:searchSessions"` to `IPC`; add
  `searchSessions(query: string, opts?: { limit?: number }): Promise<SearchHitDto[]>` to `PiApi`; define
  `SearchHitDto` = `SessionInfoDto` + `{ score: number; snippet?: string; matchedBody: boolean }` (keep it
  serializable; never carry `allMessagesText`).
- **preload/index.ts:** add the `searchSessions` passthrough alongside `listSessions`
  (`preload/index.ts:52`).
- **bridge.ts:** `ipcMain.handle(IPC.searchSessions, (_e, q, opts) => pool.searchSessions(q, opts))` next
  to the `listSessions` handler (`bridge.ts:89`).
- **sessionPool.ts:** add `async searchSessions(query, opts)` that calls `SessionManager.listAll()`
  (reuse/refactor the existing mapping in `listSessions`, `sessionPool.ts:338-379`, so the live-session
  overlay still applies), matches `name||firstMessage` (title) and `allMessagesText` (body) with
  `fuzzyMatch` from `@earendil-works/pi-tui`, sorts by score, slices to a cap, and builds a bounded
  snippet (substring around the first match index in `allMessagesText`). Consider a short-lived (~2s)
  in-memory cache of `listAll()` so per-keystroke scans don't re-read every file. The richer
  `session-selector-search.ts` matcher (quoted phrases / `re:` regex / relevance) is the reference if
  phrase/regex support is wanted — re-implement the slice needed (it isn't a public export).
- **Renderer:** new `components/SearchOverlay.tsx` (input + results list, reuse the sidebar row markup +
  `relTime`); a global keydown effect in `App.tsx` (mirror the Shift+Tab pattern, `App.tsx:278-287`) for
  Ctrl+K/Ctrl+F; debounce the query; on select call the existing `openSession(path, sessionId)`
  (`App.tsx:177-186`) then close. Use `state/useModalFocus.ts` for focus trap/restore and `styles/` for a
  DESIGN.md-faithful overlay (parchment panel, terracotta accents).

## Dependencies / sequencing

**Roadmap wave: Wave 2 (of 4)** — recommended execution slot ~#6 of 14.

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after:** nothing hard.
- **Blocks / do before:** nothing.
- **Why Wave 2:** navigation-at-scale; independent and fully SDK-supported (listAll already carries the body text).

## Out of scope

- Searching inside tool-call args / tool results / thinking blocks (only user+assistant text, which is
  what `allMessagesText` already captures).
- Full-text indexing / a persisted search index (the bounded `listAll()` + cache is enough at desktop
  scale; revisit only if it proves slow).
- Regex / quoted-phrase / field-scoped query syntax — optional stretch only; v1 is plain fuzzy over title
  + body. (The TUI reference supports them if desired later.)
- In-conversation "find in this chat" / scroll-to-match within the open transcript.
- Filtering by date/project facets in the overlay.

## Notes

- State: **planning-only**. This is a child of `06-27-desktop-roadmap`. Implement only on the user's
  explicit go-ahead (do not `task.py start` until the artifacts are reviewed).
- Grounding highlight: the body text the renderer needs is already computed by the SDK
  (`SessionInfo.allMessagesText`, `session-manager.ts:662`) and already loaded in main by
  `SessionPool.listSessions` — it's simply dropped at the DTO boundary (`sessionPool.ts:347-357`,
  `ipc.ts:195-207`). The hard rule this PRD respects: keep that heavy text in main and cross IPC with only
  a score + short snippet.
