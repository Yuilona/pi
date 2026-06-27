# Advanced agent capabilities (subagents, elicitation, MCP)

## Goal

Bring three "big bet" agent powers to the desktop — delegating work to **subagents**, letting the
model **ask the user interactive questions** (elicitation), and managing **MCP servers** — by first
being honest about where each is blocked at the SDK layer, then specifying exactly the SDK
prerequisite and the desktop surface that unblocks it. This is the "requires upstream/SDK work" bucket
of the roadmap; each requirement names its blocker.

## Background

The desktop runs the pi SDK only in main (`SessionController.buildSession`,
`apps/desktop/src/main/agent/sessionController.ts:143`) and exposes capabilities to a pi-free renderer
through the typed contract in `apps/desktop/src/shared/ipc.ts`. Today that contract has channels for
chat, lifecycle, models/providers, modes, and approvals only (`ipc.ts:5`–`48`) — nothing for
subagents, elicitation, or MCP. Each of the three findings here sits on a different rung of
feasibility:

- **Subagents** already exist as an *installable extension* (a separate `pi` subprocess per
  delegation), not core SDK. The example lives at
  `packages/coding-agent/examples/extensions/subagent/index.ts:454` (`pi.registerTool({ name:
  "subagent", ... })`) with agent discovery in `subagent/agents.ts:97` (`discoverAgents` reads
  `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`). The desktop's `DefaultResourceLoader` already
  auto-discovers on-disk extensions in addition to its inline factories
  (`sessionController.ts:145`–`151`; resource-loader loads enabled extension paths,
  `packages/coding-agent/src/core/resource-loader.ts:365`/`490`). BUT the desktop hardcodes the active
  toolset to seven tools — `const TOOLS = ["read","grep","find","ls","bash","edit","write"]`
  (`sessionController.ts:32`) passed as `tools:` to `createAgentSession` (`sessionController.ts:158`)
  → `initialActiveToolNames` (`agent-session.ts:347`). So even when the subagent extension loads, its
  tool is never *active*. There is no UI to discover available agents or enable the extension. This is
  why surfacing subagents depends on a general tool-allowlist mechanism first.

- **Elicitation (question / questionnaire)** is gated to TUI mode at the SDK level. Both example tools
  short-circuit when not in a terminal:
  `packages/coding-agent/examples/extensions/question.ts:52` (`if (ctx.mode !== "tui") return …"UI
  not available (running in non-interactive mode)"`) and `questionnaire.ts:93` (same guard). When the
  guard passes they render via `ctx.ui.custom(...)`, which returns live **TUI `Component`** objects
  (`question.ts:72`; the `ExtensionUIContext.custom<T>` signature in
  `packages/coding-agent/src/core/extensions/types.ts:189` takes a factory that builds
  `@earendil-works/pi-tui` Components). The desktop never binds a UI context or mode, so its sessions
  default to `mode: "print"` with a `noOpUIContext` — `_extensionMode = "print"`
  (`agent-session.ts:305`), `runner.setUIContext(undefined, "print")` →
  `this.uiContext = noOpUIContext`, `hasUI()` false (`runner.ts:400`–`410`,
  `select/confirm/input/custom` all no-op at `runner.ts:230`–`244`). The SDK *does* expose the hook:
  `AgentSession.bindExtensions({ uiContext, mode, ... })` (`agent-session.ts:2071`,
  `ExtensionBindings` at `agent-session.ts:189`). So the desktop could supply `mode: "tui"` + a custom
  `ExtensionUIContext`, but `ui.custom` is fundamentally un-serializable across IPC (it hands back TUI
  widgets), so a faithful desktop bridge needs *structured/serializable* elicitation primitives that
  do not exist today. The structured primitives that *could* bridge — `select`/`confirm`/`input`
  (`types.ts:124`–`132`) — are not what `question`/`questionnaire` use.

- **MCP (Model Context Protocol) servers** — HONEST FINDING: **there is no MCP support anywhere in the
  pi SDK.** A full-text search for `mcp` across `packages/coding-agent/src` returns only a vendored
  highlight.js hit (`core/export-html/vendor/highlight.min.js`); there is no MCP client, no
  stdio/SSE transport, no `ToolDefinition` bridge from MCP tools. The SDK's tool surface is
  `ExtensionAPI.registerTool` / `customTools` only (`types.ts:1170`, `agent-session.ts:167`). A
  desktop "add/manage MCP server" UI is therefore premature: the MCP client + a ToolDefinition bridge
  must be built at the SDK layer first. This requirement documents that prerequisite rather than
  scoping a desktop-only feature.

New capabilities, per the hard architecture rule, mean new channels + DTOs in
`shared/ipc.ts`, wired in preload + bridge (`apps/desktop/src/main/agent/bridge.ts:16`), and mapped in
`mappers.ts`; the renderer must stay pi-free.

## Requirements

- (AGENT-7) **Surface subagent delegation in the desktop.** Ship/enable the subagent extension and add
  a discovered-agents browser so the user can see which agents exist (`~/.pi/agent/agents/*.md`,
  `.pi/agents/*.md`), enable the `subagent` tool, and watch delegated runs stream as a tool card.
  Value: parallel/chained delegation with isolated context windows is the single biggest capability
  jump for real work; it already exists in the CLI and should not be desktop-invisible.
  *Evidence:* `examples/extensions/subagent/index.ts:454` (the tool), `subagent/agents.ts:97`
  (`discoverAgents`); blocked by `sessionController.ts:32` hardcoded `TOOLS` allowlist →
  `agent-session.ts:347` `initialActiveToolNames`.
  *sdkSupport:* present as an installable extension (subprocess-based, not core SDK); needs the desktop
  to (a) load/enable it and (b) include `subagent` in the active toolset. **Blocker: depends on the
  tool-allowlist work in the extensibility task (AGENT-1) landing first** — without per-session active-
  tool control there is no clean way to turn the subagent tool on.
  *Effort:* L.

- (AGENT-8) **Interactive question / elicitation bridge.** Make the `question` and `questionnaire`
  tools usable in the desktop so the model can ask the user to pick an option or fill a short form
  mid-turn, with the choice fed back into the same turn. Value: clarifying questions are a core agent
  affordance the desktop currently silently drops (the tools just return "UI not available").
  *Evidence:* `examples/extensions/question.ts:52` and `questionnaire.ts:93` (`ctx.mode !== "tui"`
  guard); `ExtensionUIContext.custom` returns TUI Components (`types.ts:189`); the desktop never binds
  a UI context, so `mode` defaults to `"print"` + `noOpUIContext` (`agent-session.ts:305`,
  `runner.ts:230`–`244`/`400`–`410`); the binding hook is `AgentSession.bindExtensions({ uiContext,
  mode })` (`agent-session.ts:2071`, `ExtensionBindings` at `agent-session.ts:189`).
  *sdkSupport:* **needs-sdk-work.** The existing tools cannot be bridged as-is because `ui.custom`
  hands back un-serializable TUI widgets. The SDK needs a *structured, serializable* elicitation path
  (a question/answer schema crossing the runner the way `tool_call` approvals already do), OR the
  desktop ships its own structured `question`/`questionnaire` tools that emit a serializable
  elicitation request and resolve on an answer DTO — mirroring the existing approval round-trip
  (`approval.ts:13`, `requestApproval` → IPC → `resolveApproval`, `sessionController.ts:110`–`131`).
  Either way, main must `bindExtensions({ mode: "tui" | <desktop mode>, uiContext: <IPC-backed
  structured impl> })` so `hasUI()` is true for the structured primitives.
  **Blocker: SDK-side mode/elicitation work (a serializable elicitation channel) is the prerequisite;
  the desktop half is an approval-style IPC round-trip.**
  *Effort:* L (desktop bridge) + the SDK elicitation work (sizing owned upstream).

- (AGENT-9) **MCP server add/manage.** A future Settings surface to add, list, enable/disable, and
  health-check MCP servers (stdio/SSE), whose tools then appear to the agent like built-in tools.
  Value: MCP is the emerging standard for plugging external tools/data into agents; supporting it
  makes the desktop interoperable with the wider ecosystem.
  *Evidence:* **no MCP anywhere in the SDK** — `grep -ri mcp packages/coding-agent/src` finds only
  `core/export-html/vendor/highlight.min.js`; the only tool-registration paths are
  `ExtensionAPI.registerTool` (`types.ts:1170`) and `createAgentSession({ customTools })`
  (`agent-session.ts:167`).
  *sdkSupport:* **none — XL, needs-sdk-work.** Prerequisite (NOT a desktop task): build at the SDK
  layer (1) an MCP client with stdio + SSE transports, (2) a bridge mapping MCP tool definitions →
  pi `ToolDefinition`/`customTools` so MCP tools register like any other tool, and (3) lifecycle
  (connect/disconnect/health). Only after that does a desktop "manage MCP servers" UI (new ipc.ts
  channels + a Settings panel) become meaningful.
  **Blocker: the entire MCP client + ToolDefinition bridge must exist in the SDK first. Document this
  as a prerequisite; do not build a desktop UI against a non-existent capability.**
  *Effort:* XL.

## Acceptance Criteria

> This is a planning-only PRD; the criteria below are what a future implementation (only on the user's
> go-ahead) must satisfy. They are deliberately conservative because two of three items are blocked
> upstream.

- [ ] AC1 (AGENT-7). When the subagent extension is installed and the tool-allowlist mechanism
      (AGENT-1) exists, the desktop can enable the `subagent` tool for a session, a delegated run
      streams as a tool card, and a discovered-agents view lists agents from `~/.pi/agent/agents` and
      `.pi/agents` with their source (user/project). Project-local agents follow the example's trust
      prompt model (no silent execution of repo-controlled prompts).
- [ ] AC2 (AGENT-8). The model can ask a structured question (single choice or short form) in the
      desktop and the user's answer returns into the same turn — via a serializable elicitation
      round-trip modeled on the approval flow, never by sending TUI `Component` objects over IPC. If
      the SDK elicitation prerequisite is not yet available, this item stays blocked and is not
      partially shipped (no half-working "UI not available" path).
- [ ] AC3 (AGENT-9). MCP remains documented as an SDK prerequisite, not a desktop deliverable, until
      an SDK MCP client + ToolDefinition bridge exists; no desktop MCP UI is built before then.
- [ ] AC4. Any code that lands keeps `npm run typecheck && npm run lint && npm run test && npm run
      build` green (run from `apps/desktop`).
- [ ] AC5. Any renderer-touching change stays pi-free: no `@earendil-works/pi-*` import under
      `apps/desktop/src/renderer/**`; all new capability flows through new `shared/ipc.ts` DTOs +
      channels, wired in preload + `bridge.ts` and mapped in `mappers.ts`.

## Design hints (for the later design.md)

- **AGENT-7 (subagent surface):**
  - The active-toolset gate is `sessionController.ts:32` (`TOOLS`) → `createAgentSession({ tools })`
    (`sessionController.ts:158`). Surfacing `subagent` means including it in the active tool names,
    which is exactly the per-session active-tool control the extensibility task (AGENT-1) introduces —
    sequence after it, then add `"subagent"` to the enabled set when present.
  - For the discovered-agents browser, reuse the example's discovery logic shape (`discoverAgents` in
    `subagent/agents.ts:97`, reading frontmatter `name/description/tools/model/source`). Expose it as
    a new read-only IPC channel (e.g. `listAgents(cwd)` → `AgentInfoDto[]`) in `shared/ipc.ts`, handled
    in `bridge.ts`, computed in main (do NOT import the example tool into the renderer).
  - The subagent tool already streams partials via `onUpdate` and renders rich `details`
    (`SubagentDetails`, `index.ts:157`); map those to an `IpcToolResult.details` shape in `mappers.ts`
    and render a dedicated subagent tool card in the renderer (status icons, per-task usage), mirroring
    the existing tool-card idiom.
  - Honor the project-agent trust prompt (`index.ts:499`–`522`, `ctx.ui.confirm`): in the desktop this
    is a confirm dialog over IPC (reuse the approval-dialog pattern), not silent execution.

- **AGENT-8 (elicitation bridge):**
  - Bind a desktop UI context: in `buildSession` (`sessionController.ts:143`), after
    `createAgentSession`, call `session.bindExtensions({ mode: <"tui" or a desktop mode>, uiContext:
    <IPC-backed impl> })` (`agent-session.ts:2071`). The minimal serializable subset is
    `select`/`confirm`/`input` (`types.ts:124`–`132`); `custom` cannot be honored over IPC.
  - Preferred path: do NOT try to bridge the TUI `question`/`questionnaire` tools. Instead define
    desktop-side structured `question`/`questionnaire` tools (TypeBox params identical to the examples,
    `question.ts:39`/`questionnaire.ts:70`) whose `execute` emits a serializable elicitation request
    and awaits an answer — the exact shape of the approval flow (`approval.ts:13`,
    `requestApproval`/`resolveApproval` in `sessionController.ts:110`–`131`,
    `WrappedApprovalRequest`/`ApprovalDecision` in `ipc.ts:162`/`62`). Add parallel
    `elicitationRequest`/`elicitationResolve` channels + `ElicitationRequestDto`/`AnswerDto` to
    `ipc.ts`.
  - This requirement is **blocked on the SDK** providing the serializable elicitation primitive (or on
    a decision to ship desktop-local structured tools); the design.md should pick the path explicitly
    and confirm `mode`/`hasUI()` behavior (`runner.ts:400`–`410`).

- **AGENT-9 (MCP):** No desktop design until the SDK has an MCP client + ToolDefinition bridge. The
  design.md for this item is the SDK prerequisite spec (client + stdio/SSE transports + map MCP tools
  → `ToolDefinition`/`customTools`, `types.ts:435`/`agent-session.ts:167`), explicitly out of the
  desktop's scope. When/if that exists, the desktop surface is a Settings panel + new ipc.ts channels
  (`addMcpServer`/`listMcpServers`/`removeMcpServer`/health), mapped in `bridge.ts`/`mappers.ts`.

## Dependencies / sequencing

**Roadmap wave: Wave 4 (of 4)** — recommended execution slot ~#14 of 14 (last; depends on upstream/SDK work).

> The authoritative execution ordering lives here and in the parent **06-27-desktop-roadmap** prd's 4-wave plan. Trellis parent/child tree position is NOT a dependency; only the relations stated below are binding.

- **Do after (HARD):** 06-27-extensibility (AGENT-1, drop the tool allowlist) before AGENT-7 (subagent delegation).
- **External blockers:** AGENT-9 (MCP) is BLOCKED on upstream pi-SDK MCP support (an MCP client + ToolDefinition bridge must be built at the SDK layer first); AGENT-8 (elicitation/question bridge) needs SDK-side mode/elicitation work. These are not desktop-only tasks.
- **Why Wave 4:** the most SDK-coupled, highest-effort bucket; sequence it after the extensibility groundwork.

## Out of scope

- Building the tool-allowlist mechanism itself (owned by `06-27-extensibility` / AGENT-1).
- Authoring or curating agent definitions; we surface/enable existing `*.md` agents, not ship a
  library of them.
- Bridging TUI `ctx.ui.custom` rich components over IPC (un-serializable by construction) — only
  structured/serializable elicitation is in scope for AGENT-8.
- Building the SDK MCP client, transports, or ToolDefinition bridge (these are the upstream
  prerequisite for AGENT-9; this task only documents them as blockers).
- Any desktop MCP management UI before the SDK MCP capability exists.
- Per-session permission-mode changes or new permission modes (owned elsewhere).

## Notes

- State: **planning-only.** Child of `06-27-desktop-roadmap`. Do not `task.py start` or write any code
  until the user gives an explicit go-ahead; even then, AGENT-8 and AGENT-9 stay blocked until their
  SDK prerequisites land, and AGENT-7 stays blocked until the AGENT-1 tool allowlist lands.
- This is the roadmap's "requires upstream/SDK work" bucket: each requirement names its blocker so a
  future implementer knows the gating prerequisite before touching the desktop.
- Grounded against desktop v0.2.0 (`apps/desktop/package.json:3`) and the current pi SDK in
  `packages/coding-agent`.
- Architecture invariants to preserve: pi SDK stays in main; renderer stays pi-free; new capabilities
  = new `shared/ipc.ts` DTOs/channels wired through preload + `bridge.ts` + `mappers.ts`. Biome
  `noExplicitAny` is OFF (do not add `biome-ignore … noExplicitAny`).
