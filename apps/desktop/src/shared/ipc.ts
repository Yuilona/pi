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
	// agent control (renderer -> main, invoke/handle)
	send: "pi:send",
	abort: "pi:abort",
	newSession: "pi:newSession",
	setModel: "pi:setModel",
	setThinking: "pi:setThinking",
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
	switchSession: "pi:switchSession",
	deleteSession: "pi:deleteSession",
	getTranscript: "pi:getTranscript",
	getState: "pi:getState",
	listCommands: "pi:listCommands",
	compact: "pi:compact",
	getProxyConfig: "pi:getProxyConfig",
	setProxyConfig: "pi:setProxyConfig",
	getStats: "pi:getStats",
	newChatInCwd: "pi:newChatInCwd",
	// agent stream (main -> renderer, send)
	event: "pi:event",
	// approvals
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
	| { type: "auto_retry_end"; success: boolean }
	| { type: "compaction_start" }
	| { type: "compaction_end" }
	| { type: "error"; message: string };

export interface ApprovalRequest {
	id: string;
	toolName: string;
	input: unknown;
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

export interface AppStateDto {
	cwd: string;
	/** The app's own directory (Electron userData) — the "no specific project" home for general chats. */
	appDir: string;
	model?: ModelInfoDto;
	thinkingLevel: ThinkingLevelDto;
	mode: PermissionMode;
	/** Show assistant thinking blocks (mapped to pi's hideThinkingBlock setting, shared with the CLI). */
	showThinking: boolean;
	/** True when at least one model is usable (any provider). Drives whether the setup gate shows. */
	hasModel: boolean;
	isStreaming: boolean;
	/** Path of the active saved session (undefined for a fresh, not-yet-persisted chat). */
	sessionFile?: string;
}

export interface PiApi {
	// agent control
	send(text: string, images?: ImageAttachmentDto[]): Promise<void>;
	getStats(): Promise<UsageDto>;
	/** Start a fresh chat in a specific directory (a project's cwd, or the app dir for a general chat). */
	newChatInCwd(cwd: string): Promise<void>;
	abort(): Promise<void>;
	newSession(): Promise<void>;
	setModel(provider: string, id: string): Promise<void>;
	setThinking(level: ThinkingLevelDto): Promise<void>;
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
	switchSession(path: string): Promise<void>;
	deleteSession(path: string): Promise<void>;
	getTranscript(): Promise<TranscriptDto>;
	getState(): Promise<AppStateDto>;
	/** Dynamic slash commands (prompt templates + skill commands) discovered from ~/.pi + the project. */
	listCommands(): Promise<CommandDto[]>;
	compact(): Promise<void>;
	/** Read the saved outbound-proxy config plus the detected env proxy (for pre-filling the field). */
	getProxyConfig(): Promise<ProxyConfigDto>;
	/** Persist + apply the outbound-proxy config; takes effect on the next message. */
	setProxyConfig(cfg: { enabled: boolean; url: string }): Promise<void>;
	// streams
	onEvent(cb: (e: IpcAgentEvent) => void): () => void;
	onApproval(cb: (r: ApprovalRequest) => void): () => void;
	resolveApproval(id: string, decision: ApprovalDecision): void;
	// window
	window: {
		minimize(): void;
		toggleMaximize(): void;
		close(): void;
		isMaximized(): Promise<boolean>;
		onMaximizeChanged(cb: (isMax: boolean) => void): () => void;
	};
}
