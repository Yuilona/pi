import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** Short label for a session's working directory (last path segment). */
function projectName(cwd: string): string {
	if (!cwd) return "—";
	const segs = cwd.split(/[\\/]/).filter(Boolean);
	return segs[segs.length - 1] || cwd;
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

	constructor(
		private readonly onEvent: (e: IpcAgentEvent) => void,
		private readonly onApprovalRequest: (req: ApprovalRequest) => void,
		cwd: string,
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
		this.unsubscribe = session.subscribe((ev) => {
			const mapped = mapEvent(ev, id);
			if (mapped) this.onEvent(mapped);
			if (ev.type === "message_end") this.currentSessionFile = session.sessionFile;
		});
	}

	private teardown(): void {
		this.clearPendingApprovals();
		this.sessionAllow.clear();
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
			const imgs = images?.length
				? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
				: undefined;
			await this.session?.prompt(text, imgs ? { images: imgs } : undefined);
		} catch (err) {
			this.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
		await this.session?.abort();
	}

	async newSession(): Promise<void> {
		this.teardown();
		if (hasAnyModel(this.auth)) await this.ensureSession();
	}

	/** Resume a saved session (adopts its cwd from the file header) and rebuild around its history. */
	async switchSession(path: string): Promise<void> {
		const sm = SessionManager.open(path);
		const cwd = sm.getCwd();
		if (cwd) {
			this.cwd = cwd;
			this.settings = SettingsManager.create(cwd);
		}
		this.teardown();
		await this.buildSession(sm);
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
		return sessions
			.filter((s) => s.messageCount > 0)
			.map((s) => ({
				path: s.path,
				title: (s.name || s.firstMessage || "New chat").trim().slice(0, 80) || "New chat",
				messageCount: s.messageCount,
				modified: s.modified.getTime(),
				cwd: s.cwd,
				project: projectName(s.cwd),
			}))
			.sort((a, b) => b.modified - a.modified);
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
