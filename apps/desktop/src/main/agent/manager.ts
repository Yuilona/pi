import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AssistantMessage, complete } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	loadSkills,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	ApprovalDecision,
	ApprovalRequest,
	AppStateDto,
	CommandDto,
	CustomProviderInput,
	ImageAttachmentDto,
	IpcAgentEvent,
	ModelInfoDto,
	PermissionMode,
	ProviderInfoDto,
	SessionInfoDto,
	ThinkingLevelDto,
	TranscriptDto,
	UsageDto,
} from "../../shared/ipc.js";
import { createApprovalExtensionFactory } from "./approval.js";
import {
	type AuthBundle,
	createAuth,
	hasAnyModel,
	hasApiKey,
	listModels,
	persistApiKey,
	removeApiKey,
} from "./auth.js";
import { makeIdFactory, mapEvent, mapTranscript } from "./mappers.js";

// Full coding toolset. bash/edit/write are gated by the approval extension; read-only tools auto-run.
const TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];

// Coalesce streaming message_update events before they cross IPC. pi emits one full-message update per
// SSE delta (agent-loop.ts), so without this every token is a full re-map + structured-clone + send +
// reducer churn (O(n^2) over a reply) — the main amplifier of choppy streaming. ~33ms (≈30Hz) keeps the
// renderer's smoother fed without starving it; only INTERMEDIATE partials are ever dropped, never the
// latest, and non-update events flush the pending partial first so finality/ordering is preserved.
const STREAM_FLUSH_MS = 33;

/** Short label for a session's working directory (last path segment). */
function projectName(cwd: string): string {
	if (!cwd) return "—";
	const segs = cwd.split(/[\\/]/).filter(Boolean);
	return segs[segs.length - 1] || cwd;
}

const TITLE_SYSTEM_PROMPT =
	"You generate a short, specific title for a chat from the user's first message. " +
	"Reply with ONLY the title: 3-6 words, no surrounding quotes, no trailing punctuation, " +
	"in the same language as the user.";

/** First user message's text (handles both string and content-block forms; typed structurally so the
 *  session's broader AgentMessage[] is accepted). */
function firstUserText(messages: readonly unknown[]): string | undefined {
	for (const raw of messages) {
		const m = raw as { role?: string; content?: unknown };
		if (m.role !== "user") continue;
		if (typeof m.content === "string") return m.content.trim() || undefined;
		if (!Array.isArray(m.content)) return undefined;
		const text = m.content
			.filter((b) => (b as { type?: string }).type === "text")
			.map((b) => (b as { text?: string }).text ?? "")
			.join(" ")
			.trim();
		return text || undefined;
	}
	return undefined;
}

/** Concatenated text of an assistant reply. */
function assistantText(msg: AssistantMessage): string {
	return msg.content
		.filter((b) => b.type === "text")
		.map((b) => (b as { text: string }).text)
		.join(" ")
		.trim();
}

/** Normalize a model-generated title: single line, no wrapping quotes / trailing punctuation, capped. */
function cleanTitle(raw: string): string {
	return raw
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
		.replace(/[.。!！?？,，;；:：]+$/g, "")
		.trim()
		.slice(0, 60);
}

export class AgentManager {
	private auth: AuthBundle = createAuth();
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private cwd: string;
	private thinkingLevel: ThinkingLevelDto = "medium";
	private currentModel: ModelInfoDto | undefined;
	private currentSessionFile: string | undefined;
	private pendingApprovals = new Map<string, { toolName: string; resolve: (allow: boolean) => void }>();
	private approvalSeq = 0;
	private mode: PermissionMode = "ask";
	private sessionAllow = new Set<string>();
	private settings: SettingsManager;
	// Streaming message_update coalescer (latest-wins, ~30Hz). Owned by the active subscription; abort()
	// flushes the tail, teardown() drops it (a session switch reloads the transcript anyway).
	private updateTimer: ReturnType<typeof setTimeout> | undefined;
	private flushPendingUpdate: (() => void) | undefined;

	constructor(
		private readonly onEvent: (e: IpcAgentEvent) => void,
		private readonly onApprovalRequest: (req: ApprovalRequest) => void,
		cwd: string,
		private readonly appDir: string = cwd,
	) {
		this.cwd = cwd;
		this.settings = SettingsManager.create(cwd);
	}

	/**
	 * Approval decision for a mutating tool, applying the active permission mode and the per-session
	 * allowlist before falling back to an interactive Allow/Deny prompt in the renderer.
	 */
	private requestApproval = (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
		if (this.mode === "yolo") return Promise.resolve(true);
		if (this.mode === "readonly") return Promise.resolve(false);
		if (this.sessionAllow.has(toolName)) return Promise.resolve(true);
		if (this.mode === "acceptEdits" && (toolName === "edit" || toolName === "write")) return Promise.resolve(true);

		this.approvalSeq += 1;
		const id = `ap${this.approvalSeq}`;
		return new Promise<boolean>((resolve) => {
			this.pendingApprovals.set(id, { toolName, resolve });
			this.onApprovalRequest({ id, toolName, input });
		});
	};

	resolveApproval(id: string, decision: ApprovalDecision): void {
		const pending = this.pendingApprovals.get(id);
		if (!pending) return;
		this.pendingApprovals.delete(id);
		if (decision === "always") this.sessionAllow.add(pending.toolName);
		pending.resolve(decision !== "deny");
	}

	private clearPendingApprovals(): void {
		for (const { resolve } of this.pendingApprovals.values()) resolve(false);
		this.pendingApprovals.clear();
	}

	setMode(mode: PermissionMode): void {
		this.mode = mode;
	}

	/**
	 * Build a session as a pi citizen: pi's SettingsManager resolves the default provider/model/
	 * thinking level from ~/.pi/agent/settings.json, ModelRegistry reads ~/.pi/agent/models.json
	 * (custom providers). No provider is hardcoded.
	 */
	private async buildSession(sessionManager?: SessionManager): Promise<void> {
		// Discover ~/.pi extensions/skills/prompts AND inject our approval gate (native on("tool_call")).
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: getAgentDir(),
			extensionFactories: [createApprovalExtensionFactory(this.requestApproval)],
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage: this.auth.authStorage,
			modelRegistry: this.auth.modelRegistry,
			// pi's own settings (global ~/.pi/agent/settings.json + project .pi/settings.json).
			settingsManager: this.settings,
			resourceLoader,
			tools: TOOLS,
			// Persistent session (JSONL under ~/.pi/agent/sessions), shared with the pi CLI. The file is
			// written lazily on the first message. Pass an opened SessionManager to resume history.
			sessionManager: sessionManager ?? SessionManager.create(this.cwd),
		});

		this.session = session;
		this.currentSessionFile = session.sessionFile;
		const model = session.model;
		this.currentModel = model
			? { provider: model.provider, id: model.id, label: model.name, available: true }
			: undefined;
		this.thinkingLevel = (session.thinkingLevel as ThinkingLevelDto) ?? this.thinkingLevel;

		const id = makeIdFactory();
		// Latest-wins throttle for message_update; every other event passes through immediately, flushing
		// the pending partial first so message_end/tool/ordering events never land before the text they follow.
		let pendingUpdate: IpcAgentEvent | null = null;
		const flush = () => {
			if (this.updateTimer) {
				clearTimeout(this.updateTimer);
				this.updateTimer = undefined;
			}
			if (pendingUpdate) {
				const ev = pendingUpdate;
				pendingUpdate = null;
				this.onEvent(ev);
			}
		};
		this.flushPendingUpdate = flush;
		this.unsubscribe = session.subscribe((ev) => {
			const mapped = mapEvent(ev, id);
			if (ev.type === "message_update") {
				if (mapped) {
					pendingUpdate = mapped;
					if (!this.updateTimer) {
						this.updateTimer = setTimeout(() => {
							this.updateTimer = undefined;
							flush();
						}, STREAM_FLUSH_MS);
					}
				}
				return;
			}
			flush();
			if (mapped) this.onEvent(mapped);
			if (ev.type === "message_end") this.currentSessionFile = session.sessionFile;
		});
	}

	private teardown(): void {
		this.clearPendingApprovals();
		this.sessionAllow.clear();
		// Drop any pending streaming partial: a teardown means a session switch/rebuild, after which the
		// renderer reloads the transcript wholesale (a stale partial must not paint into the new session).
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = undefined;
		}
		this.flushPendingUpdate = undefined;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session?.dispose();
		this.session = undefined;
	}

	private async ensureSession(): Promise<void> {
		if (this.session) return;
		if (!hasAnyModel(this.auth)) throw new Error("No model configured. Add a provider API key in Settings.");
		await this.buildSession();
	}

	/** Warm up on startup so the resolved default model is known immediately (no-op if no model). */
	async init(): Promise<void> {
		try {
			if (hasAnyModel(this.auth)) await this.ensureSession();
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}

	async prompt(text: string, images?: ImageAttachmentDto[]): Promise<void> {
		try {
			await this.ensureSession();
			const session = this.session;
			// A brand-new chat (no name yet, no messages yet) gets an auto-generated title after its first turn.
			const titleAfter = !!session && !session.sessionName && (session.messages?.length ?? 0) === 0;
			const imgs = images?.length
				? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
				: undefined;
			await session?.prompt(text, imgs ? { images: imgs } : undefined);
			if (titleAfter && session) void this.maybeTitleSession(session);
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}

	/**
	 * Auto-title a brand-new chat after its first turn. This is a SEPARATE one-shot `complete()` call —
	 * the conversation's own context is never touched (the chat AI stays focused on the chat), thinking is
	 * disabled via a reasoning:false model copy, and it runs at most once per session (guarded by the
	 * existing session name). On success the name is persisted and a `session_renamed` event lets the
	 * sidebar reveal-animate that row. Failures fall back silently to the first-message title.
	 */
	private async maybeTitleSession(target: AgentSession): Promise<void> {
		if (target.sessionName) return;
		const model = target.model;
		if (!model) return;
		const first = firstUserText(target.messages);
		if (!first) return;
		try {
			// Resolve key + headers the same way the session does — this covers custom providers whose
			// key lives in models.json (authStorage.getApiKey alone returns undefined for those).
			const auth = await this.auth.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;
			const reply = await complete(
				{ ...model, reasoning: false },
				{
					systemPrompt: TITLE_SYSTEM_PROMPT,
					messages: [{ role: "user", content: first.slice(0, 1500), timestamp: Date.now() }],
				},
				// Budget headroom: reasoning models (e.g. deepseek) think briefly before the title; too small a
				// cap and all tokens go to reasoning, leaving the text (the title) empty. We read only text blocks.
				{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 512, temperature: 0.3 },
			);
			const title = cleanTitle(assistantText(reply));
			// Apply only if the user hasn't moved on to / renamed another session in the meantime.
			if (title && this.session === target && !target.sessionName) {
				target.setSessionName(title);
				this.onEvent({ type: "session_renamed", path: target.sessionFile ?? "", title });
			}
		} catch {
			// Silent: keep the first-message fallback title.
		}
	}

	/** Token usage + cost + context-window fill for the active session (composer usage readout). */
	getStats(): UsageDto {
		const s = this.session?.getSessionStats();
		const ctx = s?.contextUsage;
		return {
			input: s?.tokens.input ?? 0,
			output: s?.tokens.output ?? 0,
			cacheRead: s?.tokens.cacheRead ?? 0,
			cacheWrite: s?.tokens.cacheWrite ?? 0,
			total: s?.tokens.total ?? 0,
			cost: s?.cost ?? 0,
			contextTokens: ctx?.tokens ?? null,
			contextWindow: ctx?.contextWindow ?? 0,
			contextPercent: ctx?.percent ?? null,
		};
	}

	async abort(): Promise<void> {
		this.clearPendingApprovals();
		// Deliver the last received partial before stopping, so an aborted reply shows everything that
		// arrived rather than freezing on a throttled-away frame.
		this.flushPendingUpdate?.();
		await this.session?.abort();
	}

	async newSession(): Promise<void> {
		this.teardown();
		if (hasAnyModel(this.auth)) await this.ensureSession();
	}

	/** Resume a saved session (adopts its cwd from the file header) and rebuild around its history. */
	async switchSession(path: string): Promise<void> {
		let sm: SessionManager;
		try {
			sm = SessionManager.open(path);
		} catch (err) {
			// A missing/corrupt session file must not reject unhandled or tear down the live session.
			this.onEvent({
				type: "error",
				message: `Couldn't open session: ${err instanceof Error ? err.message : String(err)}`,
			});
			return;
		}
		const cwd = sm.getCwd();
		// Don't adopt a stale/deleted project dir; keep the current cwd if the saved one no longer exists.
		const nextCwd = cwd && existsSync(cwd) ? cwd : this.cwd;
		if (nextCwd !== this.cwd) {
			this.cwd = nextCwd;
			this.settings = SettingsManager.create(nextCwd);
		}
		this.teardown();
		try {
			await this.buildSession(sm);
		} catch (err) {
			this.onEvent({
				type: "error",
				message: `Couldn't resume session: ${err instanceof Error ? err.message : String(err)}`,
			});
			// Rebuild a usable session so the app isn't left with none after a failed resume.
			if (hasAnyModel(this.auth)) await this.ensureSession();
		}
	}

	async deleteSession(path: string): Promise<void> {
		try {
			rmSync(path, { force: true });
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
		if (this.currentSessionFile === path) await this.newSession();
	}

	async listSessions(): Promise<SessionInfoDto[]> {
		const sessions = await SessionManager.listAll();
		const out = sessions
			.filter((s) => s.messageCount > 0)
			.map((s) => ({
				path: s.path,
				title: (s.name || s.firstMessage || "New chat").trim().slice(0, 80) || "New chat",
				messageCount: s.messageCount,
				modified: s.modified.getTime(),
				cwd: s.cwd,
				project: projectName(s.cwd),
			}));

		// pi persists the session file only on the first message_end, so a chat whose first message was just
		// sent isn't on disk yet. Surface the active in-memory session right away so its sidebar row appears
		// the moment you hit send; it's superseded by the real on-disk entry (same path) once it persists.
		const session = this.session;
		const messages = session?.messages ?? [];
		const file = session?.sessionFile;
		const onDisk = !!file && out.some((s) => s.path === file);
		if (session && !onDisk && messages.some((m) => (m as { role?: string }).role === "user")) {
			out.push({
				path: file ?? "__active__",
				title: (session.sessionName || firstUserText(messages) || "New chat").trim().slice(0, 80) || "New chat",
				messageCount: messages.length,
				modified: Date.now(),
				cwd: this.cwd,
				project: projectName(this.cwd),
			});
		}

		return out.sort((a, b) => b.modified - a.modified);
	}

	/** Snapshot of the active session's transcript, used to hydrate the UI when resuming. */
	getTranscript(): TranscriptDto {
		return mapTranscript(this.session?.messages ?? []);
	}

	/**
	 * Dynamic slash commands for the composer menu: pi prompt templates (`.pi/prompts/*.md`) and
	 * skill commands (`/skill:name`). The SDK's prompt() expands both automatically on send, so the
	 * renderer just sends the text. Builtin desktop commands are added on the renderer side.
	 */
	listCommands(): CommandDto[] {
		const out: CommandDto[] = [];
		for (const t of this.session?.promptTemplates ?? []) {
			out.push({ name: t.name, description: t.description ?? "Prompt template", kind: "prompt", takesArgs: true });
		}
		try {
			const { skills } = loadSkills({
				cwd: this.cwd,
				agentDir: getAgentDir(),
				skillPaths: [],
				includeDefaults: true,
			});
			for (const s of skills) {
				out.push({ name: `skill:${s.name}`, description: s.description, kind: "skill", takesArgs: true });
			}
		} catch {
			// skills are best-effort; a malformed skills dir shouldn't break the composer.
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Manually compact the session context (the /compact builtin). */
	async compact(): Promise<void> {
		try {
			await this.session?.compact();
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}

	/** Add/update a provider API key, refresh model availability, and rebuild the session. */
	async setApiKey(provider: string, key: string): Promise<boolean> {
		persistApiKey(this.auth, provider, key.trim());
		this.auth.modelRegistry.refresh();
		this.teardown();
		try {
			await this.ensureSession();
			return true;
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			return false;
		}
	}

	async removeApiKey(provider: string): Promise<void> {
		removeApiKey(this.auth, provider);
		this.auth.modelRegistry.refresh();
	}

	hasApiKey(provider: string): boolean {
		return hasApiKey(this.auth, provider);
	}

	listModels(): ModelInfoDto[] {
		return listModels(this.auth);
	}

	private modelsJsonPath(): string {
		return join(getAgentDir(), "models.json");
	}

	private readModelsJson(): { providers?: Record<string, unknown> } {
		const path = this.modelsJsonPath();
		if (!existsSync(path)) return {};
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as { providers?: Record<string, unknown> };
		} catch {
			return {};
		}
	}

	listProviders(): ProviderInfoDto[] {
		const models = listModels(this.auth);
		const custom = new Set(Object.keys(this.readModelsJson().providers ?? {}));
		const byProvider = new Map<string, { ready: boolean; count: number }>();
		for (const m of models) {
			const e = byProvider.get(m.provider) ?? { ready: false, count: 0 };
			e.count += 1;
			if (m.available) e.ready = true;
			byProvider.set(m.provider, e);
		}
		return [...byProvider.entries()]
			.map(([provider, e]) => ({
				provider,
				ready: e.ready,
				hasStoredKey: this.auth.authStorage.has(provider),
				custom: custom.has(provider),
				modelCount: e.count,
			}))
			.sort((a, b) => Number(b.ready) - Number(a.ready) || a.provider.localeCompare(b.provider));
	}

	/** Add a custom OpenAI-compatible endpoint by writing ~/.pi/agent/models.json, then refresh. */
	async addCustomProvider(cfg: CustomProviderInput): Promise<boolean> {
		try {
			const current = this.readModelsJson();
			const providers = (current.providers ?? {}) as Record<string, unknown>;
			providers[cfg.id] = {
				name: cfg.name || cfg.id,
				baseUrl: cfg.baseUrl,
				api: cfg.api,
				apiKey: cfg.apiKey,
				models: [
					{
						id: cfg.modelId,
						name: cfg.modelName || cfg.modelId,
						reasoning: cfg.reasoning,
						input: ["text"],
						contextWindow: cfg.contextWindow,
						maxTokens: cfg.maxTokens,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			};
			writeFileSync(this.modelsJsonPath(), JSON.stringify({ ...current, providers }, null, 2), "utf-8");
			this.auth.modelRegistry.refresh();
			if (!this.session && hasAnyModel(this.auth)) await this.ensureSession();
			return true;
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			return false;
		}
	}

	async setModel(provider: string, id: string): Promise<void> {
		const model = this.auth.modelRegistry.find(provider, id);
		if (!model) return;
		this.currentModel = { provider: model.provider, id: model.id, label: model.name, available: true };
		await this.ensureSession();
		await this.session?.setModel(model);
	}

	setThinking(level: ThinkingLevelDto): void {
		this.thinkingLevel = level;
		this.session?.setThinkingLevel(level);
	}

	async setCwd(cwd: string): Promise<void> {
		this.cwd = cwd;
		this.settings = SettingsManager.create(cwd);
		this.teardown();
		if (hasAnyModel(this.auth)) await this.ensureSession();
	}

	setShowThinking(show: boolean): void {
		this.settings.setHideThinkingBlock(!show);
		void this.settings.flush();
	}

	getState(): AppStateDto {
		return {
			cwd: this.cwd,
			appDir: this.appDir,
			model: this.currentModel,
			thinkingLevel: this.thinkingLevel,
			mode: this.mode,
			showThinking: !this.settings.getHideThinkingBlock(),
			hasModel: hasAnyModel(this.auth),
			isStreaming: this.session?.isStreaming ?? false,
			sessionFile: this.currentSessionFile,
		};
	}

	dispose(): void {
		this.teardown();
	}
}
