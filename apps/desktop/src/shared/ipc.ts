// IPC contract shared by main + renderer.
// IMPORTANT: this module is pi-free. It never imports @earendil-works/pi-*.
// Main maps pi's AgentSessionEvent -> these serializable DTOs; the renderer only knows these types.

export const IPC = {
	// window controls
	windowMinimize: "window:minimize",
	windowToggleMaximize: "window:toggleMaximize",
	windowClose: "window:close",
	windowIsMaximized: "window:isMaximized",
	windowMaximizeChanged: "window:maximizeChanged",
	// session-scoped agent control (renderer -> main): each takes a sessionId as its first argument
	send: "pi:send",
	abort: "pi:abort",
	editLastMessage: "pi:editLastMessage",
	setModel: "pi:setModel",
	setThinking: "pi:setThinking",
	getTranscript: "pi:getTranscript",
	getStats: "pi:getStats",
	listCommands: "pi:listCommands",
	compact: "pi:compact",
	// session lifecycle (renderer -> main)
	openSession: "pi:openSession", // ensure a live controller for an on-disk path -> returns sessionId
	newChatInCwd: "pi:newChatInCwd", // create a fresh live session in a cwd -> returns sessionId
	closeSession: "pi:closeSession", // park/dispose a live session without deleting its file
	deleteSession: "pi:deleteSession", // abort + dispose a live session + remove its file
	deleteSessionFile: "pi:deleteSessionFile", // remove an on-disk session by path (dispose it first if live)
	setActive: "pi:setActive", // tell main which session is focused (drives notification suppression)
	// app-global control (no sessionId)
	chooseCwd: "pi:chooseCwd",
	setApiKey: "pi:setApiKey",
	removeApiKey: "pi:removeApiKey",
	setMode: "pi:setMode",
	setShowThinking: "pi:setShowThinking",
	hasApiKey: "pi:hasApiKey",
	listModels: "pi:listModels",
	listProviders: "pi:listProviders",
	addCustomProvider: "pi:addCustomProvider",
	listSessions: "pi:listSessions",
	getState: "pi:getState",
	getProxyConfig: "pi:getProxyConfig",
	setProxyConfig: "pi:setProxyConfig",
	// agent stream (main -> renderer, send) — payload is { sessionId, event }
	event: "pi:event",
	// approvals — request payload is { sessionId, request }; resolve takes (sessionId, id, decision)
	approvalRequest: "pi:approval:request",
	approvalResolve: "pi:approval:resolve",
} as const;

export type ThinkingLevelDto = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Permission modes (Claude-Code-like):
 * - ask: bash/edit/write each prompt for approval (read-only tools auto-run)
 * - acceptEdits: edit/write auto-approved; bash still prompts
 * - yolo: every tool auto-runs (no prompts)
 * - readonly: mutating tools are blocked (agent can read & plan only)
 */
export type PermissionMode = "ask" | "acceptEdits" | "yolo" | "readonly";

/** Approval dialog outcome: deny, allow once, or always allow this tool for the session. */
export type ApprovalDecision = "deny" | "allow" | "always";

export interface ModelInfoDto {
	provider: string;
	id: string;
	label: string;
	available: boolean;
}

export interface ProviderInfoDto {
	provider: string;
	/** True when at least one of this provider's models has usable credentials. */
	ready: boolean;
	/** True when a key is stored in auth.json (so it can be removed); env/models.json keys are not. */
	hasStoredKey: boolean;
	/** True when this provider is defined by the user's models.json (custom endpoint). */
	custom: boolean;
	modelCount: number;
}

export interface CustomProviderInput {
	id: string;
	name: string;
	baseUrl: string;
	api: "openai-completions" | "openai-responses";
	apiKey: string;
	modelId: string;
	modelName: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
}

export type IpcContentBlock =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string; redacted?: boolean }
	| { kind: "toolCall"; id: string; name: string; args: unknown }
	| { kind: "image"; dataUrl: string };

/** An image attached to a user message, sent from renderer → main (base64, no data: prefix). */
export interface ImageAttachmentDto {
	data: string;
	mimeType: string;
}

/** Token usage + cost + context-window fill for the active session (the composer's usage readout). */
export interface UsageDto {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
	contextTokens: number | null;
	contextWindow: number;
	contextPercent: number | null;
}

export interface IpcMessage {
	id: string;
	role: "user" | "assistant";
	content: IpcContentBlock[];
	ts: number;
}

export type IpcResultContent = { kind: "text"; text: string } | { kind: "image"; dataUrl: string };

export interface IpcToolResult {
	toolCallId: string;
	toolName: string;
	content: IpcResultContent[];
	details?: {
		diff?: string;
		patch?: string;
		exitCode?: number;
		[k: string]: unknown;
	};
	isError: boolean;
}

export type IpcAgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; willRetry: boolean }
	| { type: "turn_start" }
	| { type: "turn_end" }
	| { type: "message_start"; message: IpcMessage }
	| { type: "message_update"; message: IpcMessage } // FULL partial -> replace
	| { type: "message_end"; message: IpcMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; partialText: string }
	| { type: "tool_execution_end"; toolResult: IpcToolResult }
	| { type: "queue_update"; steering: string[]; followUp: string[] }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number }
	| { type: "auto_retry_end"; success: boolean; finalError?: string }
	| { type: "compaction_start" }
	| { type: "compaction_end"; errorMessage?: string; aborted?: boolean }
	/** A brand-new chat was auto-titled; carries the session path so the sidebar can reveal-animate that row. */
	| { type: "session_renamed"; path: string; title: string }
	| { type: "error"; message: string };

export interface ApprovalRequest {
	id: string;
	toolName: string;
	input: unknown;
}

/** Every agent event crosses IPC tagged with the session it came from, so the renderer can route it to the
 * right per-session slice even when that session isn't the focused one. */
export interface WrappedAgentEvent {
	sessionId: string;
	event: IpcAgentEvent;
}

/** A tool-approval request tagged with its originating session (it may be a background session). */
export interface WrappedApprovalRequest {
	sessionId: string;
	request: ApprovalRequest;
}

/**
 * A slash command offered in the composer's "/" menu.
 * - builtin: a desktop UI action (settings/model/new/resume/compact/copy/quit), run client-side.
 * - prompt: a pi prompt template (.pi/prompts/*.md), expanded by the SDK on send.
 * - skill:  a "/skill:name" command, expanded by the SDK on send.
 * `takesArgs` → selecting it inserts "/name " so the user can add arguments before sending.
 */
export interface CommandDto {
	name: string;
	description: string;
	kind: "builtin" | "prompt" | "skill";
	takesArgs: boolean;
}

export interface SessionInfoDto {
	path: string;
	title: string;
	messageCount: number;
	modified: number;
	/** Working directory the session belongs to. */
	cwd: string;
	/** Short project label (basename of cwd) for cross-project listing. */
	project: string;
	/** Set when this on-disk (or just-sent, not-yet-persisted) session is currently a live controller, so the
	 * renderer can act on it by id (setActive) and overlay its running/approval badges. */
	sessionId?: string;
}

export interface ToolSnapshotDto {
	toolCallId: string;
	name: string;
	args: unknown;
	status: "pending" | "success" | "error";
	result?: IpcToolResult;
}

/** A full conversation snapshot used to hydrate the UI when opening a saved session. */
export interface TranscriptDto {
	messages: IpcMessage[];
	tools: ToolSnapshotDto[];
}

/**
 * Desktop-only outbound proxy. When enabled, the main process routes the pi/OpenAI SDK's requests
 * through `url` (an HTTP proxy, e.g. a local `http://127.0.0.1:10808`) so endpoints only reachable via
 * a proxy work without TUN mode. `envProxy` is the detected HTTP(S)_PROXY, offered as a pre-fill.
 */
export interface ProxyConfigDto {
	enabled: boolean;
	url: string;
	envProxy: string;
}

/**
 * A live (in-memory) session in the pool. The renderer keys everything by `sessionId` (NOT by file path,
 * which is late-bound — pi writes the JSONL only on the first message_end). Per-session model/thinking/cwd
 * travel here so the composer can reflect the active session; `running`/`hasPendingApproval` drive sidebar
 * badges; `parked` marks a controller whose AgentSession was evicted under the cap but is resumable.
 */
export interface SessionSummaryDto {
	sessionId: string;
	title: string;
	cwd: string;
	project: string;
	running: boolean;
	hasPendingApproval: boolean;
	parked: boolean;
	sessionFile?: string;
	model?: ModelInfoDto;
	thinkingLevel: ThinkingLevelDto;
}

export interface AppStateDto {
	/** The app's own directory (Electron userData) — the "no specific project" home for general chats. */
	appDir: string;
	mode: PermissionMode;
	/** Show assistant thinking blocks (mapped to pi's hideThinkingBlock setting, shared with the CLI). */
	showThinking: boolean;
	/** True when at least one model is usable (any provider). Drives whether the setup gate shows. */
	hasModel: boolean;
	/** The live sessions in the pool (running/idle/parked) and which one is focused. */
	sessions: SessionSummaryDto[];
	activeId?: string;
}

export interface PiApi {
	// ---- session-scoped agent control (all take a sessionId) ----
	send(sessionId: string, text: string, images?: ImageAttachmentDto[]): Promise<void>;
	abort(sessionId: string): Promise<void>;
	getStats(sessionId: string): Promise<UsageDto>;
	getTranscript(sessionId: string): Promise<TranscriptDto>;
	setModel(sessionId: string, provider: string, id: string): Promise<void>;
	setThinking(sessionId: string, level: ThinkingLevelDto): Promise<void>;
	compact(sessionId: string): Promise<void>;
	/** Dynamic slash commands (prompt templates + skill commands) for this session's cwd. */
	listCommands(sessionId: string): Promise<CommandDto[]>;
	/**
	 * Rewind this session to before its last user message (in-place, same file) and return that message's
	 * original text. Returns null when there's no editable last user message or a turn is in flight. The
	 * caller must re-fetch the transcript afterward (the thread truncates; navigateTree emits no events).
	 */
	editLastMessage(sessionId: string): Promise<string | null>;

	// ---- session lifecycle ----
	/** Ensure a live controller for an on-disk session path; returns its (existing or new) sessionId. */
	openSession(path: string): Promise<string>;
	/** Start a fresh live chat in a directory (a project's cwd, or the app dir for a general chat). */
	newChatInCwd(cwd: string): Promise<string>;
	/** Park/dispose a live session without deleting its file (resumable from JSONL). */
	closeSession(sessionId: string): Promise<void>;
	/** Abort + dispose + remove the session file. */
	deleteSession(sessionId: string): Promise<void>;
	/** Remove an on-disk session by path (used for history rows that aren't currently live). */
	deleteSessionFile(path: string): Promise<void>;
	/** Tell main which session the user is viewing (suppresses its own notifications, drives LRU). */
	setActive(sessionId: string | null): Promise<void>;

	// ---- app-global ----
	chooseCwd(): Promise<string | null>;
	setApiKey(provider: string, key: string): Promise<boolean>;
	removeApiKey(provider: string): Promise<void>;
	setMode(mode: PermissionMode): Promise<void>;
	setShowThinking(show: boolean): Promise<void>;
	hasApiKey(provider: string): Promise<boolean>;
	listModels(): Promise<ModelInfoDto[]>;
	listProviders(): Promise<ProviderInfoDto[]>;
	addCustomProvider(config: CustomProviderInput): Promise<boolean>;
	listSessions(): Promise<SessionInfoDto[]>;
	getState(): Promise<AppStateDto>;
	/** Read the saved outbound-proxy config plus the detected env proxy (for pre-filling the field). */
	getProxyConfig(): Promise<ProxyConfigDto>;
	/** Persist + apply the outbound-proxy config; takes effect on the next message. */
	setProxyConfig(cfg: { enabled: boolean; url: string }): Promise<void>;

	// ---- streams (main -> renderer), each tagged with its sessionId ----
	onEvent(cb: (e: WrappedAgentEvent) => void): () => void;
	onApproval(cb: (r: WrappedApprovalRequest) => void): () => void;
	resolveApproval(sessionId: string, id: string, decision: ApprovalDecision): void;

	// ---- window ----
	window: {
		minimize(): void;
		toggleMaximize(): void;
		close(): void;
		isMaximized(): Promise<boolean>;
		onMaximizeChanged(cb: (isMax: boolean) => void): () => void;
	};
}
