import { complete } from "@earendil-works/pi-ai";
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
	CommandDto,
	ImageAttachmentDto,
	IpcAgentEvent,
	ModelInfoDto,
	PermissionMode,
	SessionSummaryDto,
	ThinkingLevelDto,
	TranscriptDto,
	UsageDto,
} from "../../shared/ipc.js";
import { createApprovalExtensionFactory } from "./approval.js";
import type { AuthBundle } from "./auth.js";
import { hasAnyModel } from "./auth.js";
import { makeIdFactory, mapEvent, mapTranscript } from "./mappers.js";
import { createSerializer } from "./serialize.js";
import { assistantText, cleanTitle, firstUserText, isRefusalTitle } from "./titleUtils.js";

// Full coding toolset. bash/edit/write are gated by the approval extension; read-only tools auto-run.
const TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];

// Coalesce streaming message_update events before they cross IPC (~30Hz, latest-wins). Per controller, so
// concurrent sessions never share a timer (the concrete fix for the old single-coalescer limitation).
const STREAM_FLUSH_MS = 33;

const TITLE_SYSTEM_PROMPT =
	"You generate a short, specific title for a chat from the user's first message. " +
	"Reply with ONLY the title: 3-6 words, no surrounding quotes, no trailing punctuation, " +
	"in the same language as the user. " +
	"This is a labeling task, NOT a request to fulfill: never answer, explain, refuse, or apologize, and " +
	"never say you cannot see an image or file. If the message refers to an image or attachment you cannot " +
	"access, title it from the available text or as a short generic topic label.";

// Appended to pi's base system prompt so images the model shares actually render (and group into a gallery).
const IMAGE_OUTPUT_INSTRUCTION =
	"Showing images: when you want to show the user a picture, ALWAYS use Markdown image syntax so it renders " +
	"inline — ![short alt](https://direct-image-url). Use a real, directly-loadable image URL (typically " +
	"ending in .jpg/.png/.gif/.webp); never paste a bare URL or an <img> HTML tag. When showing several " +
	"images, put each on its own line (or all on one line) so they group into a gallery.";

/** Short label for a session's working directory (last path segment). */
export function projectName(cwd: string): string {
	if (!cwd) return "—";
	const segs = cwd.split(/[\\/]/).filter(Boolean);
	return segs[segs.length - 1] || cwd;
}

export interface ControllerDeps {
	/** Forward a mapped agent event for THIS session (the pool tags it with the session id). */
	onEvent: (e: IpcAgentEvent) => void;
	/** Surface a tool-approval request for THIS session (the pool tags it with the session id). */
	onApproval: (req: ApprovalRequest) => void;
	/** The global permission mode (lives on the pool; read fresh on each approval). */
	getMode: () => PermissionMode;
}

/**
 * Owns exactly one live pi session and everything tied to it — the per-session half of the old AgentManager:
 * the AgentSession + subscription, the streaming coalescer, the per-session op-lock, approvals/allowlist,
 * cwd + settings, and the current model/thinking. It can be PARKED (its AgentSession disposed to free memory
 * while the controller remembers `sessionFile`) and rebuilt from JSONL on demand.
 */
export class SessionController {
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private settings: SettingsManager;
	private currentSessionFile: string | undefined;
	private currentModel: ModelInfoDto | undefined;
	private thinkingLevel: ThinkingLevelDto = "medium";
	// True once the user has explicitly picked a thinking level (so it's pushed onto a rebuilt session
	// instead of being overwritten by the persisted session's level).
	private thinkingExplicit = false;
	private parked = false;
	// True once the controller is disposed: a post-dispose build/ensure becomes a no-op so a queued rebuild
	// can never resurrect a removed controller. (park() must NOT set this — a parked controller is revivable.)
	private disposed = false;

	private pendingApprovals = new Map<string, { toolName: string; resolve: (allow: boolean) => void }>();
	private approvalSeq = 0;
	private sessionAllow = new Set<string>();

	private updateTimer: ReturnType<typeof setTimeout> | undefined;
	private flushPendingUpdate: (() => void) | undefined;
	// Serializes lifecycle mutations for THIS session (build/teardown/prompt-setup/edit) so they can't
	// interleave; the turn itself runs OUTSIDE the lock so a long stream never blocks the session.
	private runExclusive = createSerializer();

	constructor(
		readonly id: string,
		private readonly auth: AuthBundle,
		private cwd: string,
		private readonly deps: ControllerDeps,
	) {
		this.settings = SettingsManager.create(cwd);
	}

	// ---- approvals ----
	private requestApproval = (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
		const mode = this.deps.getMode();
		if (mode === "yolo") return Promise.resolve(true);
		if (mode === "readonly") return Promise.resolve(false);
		if (this.sessionAllow.has(toolName)) return Promise.resolve(true);
		if (mode === "acceptEdits" && (toolName === "edit" || toolName === "write")) return Promise.resolve(true);

		this.approvalSeq += 1;
		const id = `${this.id}:ap${this.approvalSeq}`;
		return new Promise<boolean>((resolve) => {
			this.pendingApprovals.set(id, { toolName, resolve });
			this.deps.onApproval({ id, toolName, input });
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

	hasPendingApproval(): boolean {
		return this.pendingApprovals.size > 0;
	}

	// ---- build / teardown / park ----
	private async buildSession(sessionManager?: SessionManager): Promise<void> {
		if (this.disposed) return;
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: getAgentDir(),
			extensionFactories: [createApprovalExtensionFactory(this.requestApproval)],
			appendSystemPrompt: [IMAGE_OUTPUT_INSTRUCTION],
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage: this.auth.authStorage,
			modelRegistry: this.auth.modelRegistry,
			settingsManager: this.settings,
			resourceLoader,
			tools: TOOLS,
			sessionManager: sessionManager ?? SessionManager.create(this.cwd),
		});

		this.session = session;
		this.parked = false;
		this.currentSessionFile = session.sessionFile;
		const model = session.model;
		this.currentModel = model
			? { provider: model.provider, id: model.id, label: model.name, available: true }
			: undefined;
		if (this.thinkingExplicit) {
			// The user picked a level (possibly while parked) — push it onto the rebuilt session.
			session.setThinkingLevel(this.thinkingLevel);
		} else {
			this.thinkingLevel = (session.thinkingLevel as ThinkingLevelDto) ?? this.thinkingLevel;
		}

		const idFactory = makeIdFactory();
		let pendingUpdate: IpcAgentEvent | null = null;
		const flush = () => {
			if (this.updateTimer) {
				clearTimeout(this.updateTimer);
				this.updateTimer = undefined;
			}
			if (pendingUpdate) {
				const ev = pendingUpdate;
				pendingUpdate = null;
				this.deps.onEvent(ev);
			}
		};
		this.flushPendingUpdate = flush;
		this.unsubscribe = session.subscribe((ev) => {
			try {
				const mapped = mapEvent(ev, idFactory);
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
				if (mapped) this.deps.onEvent(mapped);
				if (ev.type === "message_end") this.currentSessionFile = session.sessionFile;
			} catch (err) {
				this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			}
		});
	}

	/** Tear down the live session's runtime resources (timer, subscription, AgentSession). Keeps cwd/settings
	 * and the last-known `sessionFile` so the controller can rebuild. */
	private teardownRuntime(): void {
		this.clearPendingApprovals();
		this.sessionAllow.clear();
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

	/** Ensure a live AgentSession exists, resuming from the remembered file when parked. */
	private async ensureSession(): Promise<void> {
		if (this.disposed) return;
		if (this.session) return;
		if (!hasAnyModel(this.auth)) throw new Error("No model configured. Add a provider API key in Settings.");
		if (this.parked && this.currentSessionFile) {
			try {
				await this.buildSession(SessionManager.open(this.currentSessionFile));
				return;
			} catch {
				// Fall through to a fresh session if the parked file can't be reopened.
			}
		}
		await this.buildSession();
	}

	/** Bring this controller live (used by the pool on create / unpark). Resumes from `file` if given. */
	async ensureLive(file?: string): Promise<void> {
		return this.runExclusive(async () => {
			if (this.disposed) return;
			if (this.session) return;
			if (file) {
				this.currentSessionFile = file;
				const sm = SessionManager.open(file);
				const cwd = sm.getCwd();
				if (cwd) {
					this.cwd = cwd;
					this.settings = SettingsManager.create(cwd);
				}
				await this.buildSession(sm);
			} else {
				await this.ensureSession();
			}
		});
	}

	isRunning(): boolean {
		return this.session?.isStreaming ?? false;
	}

	isParked(): boolean {
		return this.parked;
	}

	sessionFile(): string | undefined {
		return this.currentSessionFile;
	}

	/** Park: free the model context (dispose the AgentSession) but keep the file so it can resume. Never call
	 * on a running controller. */
	park(): void {
		if (!this.session) {
			this.parked = true;
			return;
		}
		this.teardownRuntime();
		this.parked = true;
	}

	// ---- turn ----
	async prompt(text: string, images?: ImageAttachmentDto[]): Promise<void> {
		let session: AgentSession | undefined;
		try {
			session = await this.runExclusive(async () => {
				await this.ensureSession();
				return this.session;
			});
		} catch (err) {
			this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			return;
		}
		if (!session) return;
		const titleAfter = !session.sessionName && (session.messages?.length ?? 0) === 0;
		const imgs = images?.length
			? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
			: undefined;
		try {
			await session.prompt(text, imgs ? { images: imgs } : undefined);
			if (titleAfter) void this.maybeTitleSession(session);
		} catch (err) {
			if (this.session === session) {
				this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			}
		}
	}

	private async maybeTitleSession(target: AgentSession): Promise<void> {
		if (target.sessionName) return;
		const model = target.model;
		if (!model) return;
		const first = firstUserText(target.messages);
		if (!first) return;
		try {
			const auth = await this.auth.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;
			const reply = await complete(
				{ ...model, reasoning: false },
				{
					systemPrompt: TITLE_SYSTEM_PROMPT,
					messages: [{ role: "user", content: first.slice(0, 1500), timestamp: Date.now() }],
				},
				{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 512, temperature: 0.3 },
			);
			const title = cleanTitle(assistantText(reply));
			// Drop a refusal/apology (e.g. a non-multimodal model titling an image-referencing message replies
			// "Sorry, I can't read the image") so the session keeps its first-message fallback title.
			if (title && !isRefusalTitle(title) && this.session === target && !target.sessionName) {
				target.setSessionName(title);
				this.deps.onEvent({ type: "session_renamed", path: target.sessionFile ?? "", title });
			}
		} catch {
			// Silent: keep the first-message fallback title.
		}
	}

	async abort(): Promise<void> {
		this.clearPendingApprovals();
		this.flushPendingUpdate?.();
		await this.session?.abort();
	}

	async editLastMessage(): Promise<string | null> {
		return this.runExclusive(async () => {
			const session = this.session;
			if (!session || session.isStreaming) return null;
			const target = session.getUserMessagesForForking().at(-1);
			if (!target) return null;
			try {
				const { editorText, cancelled } = await session.navigateTree(target.entryId, { summarize: false });
				if (cancelled) return null;
				return editorText ?? target.text ?? "";
			} catch (err) {
				this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
				return null;
			}
		});
	}

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

	getTranscript(): TranscriptDto {
		return mapTranscript(this.session?.messages ?? []);
	}

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

	async compact(): Promise<void> {
		try {
			await this.session?.compact();
		} catch (err) {
			this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}

	async setModel(provider: string, id: string): Promise<void> {
		return this.runExclusive(async () => {
			if (this.disposed) return;
			const model = this.auth.modelRegistry.find(provider, id);
			if (!model) return;
			try {
				await this.ensureSession();
				await this.session?.setModel(model);
				// Re-read what was actually applied (ensureSession may have rebuilt and overwritten currentModel).
				const m = this.session?.model;
				this.currentModel = m
					? { provider: m.provider, id: m.id, label: m.name, available: true }
					: { provider: model.provider, id: model.id, label: model.name, available: true };
			} catch (err) {
				this.deps.onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
			}
		});
	}

	setThinking(level: ThinkingLevelDto): void {
		this.thinkingExplicit = true;
		this.thinkingLevel = level;
		this.session?.setThinkingLevel(level);
	}

	private title(): string {
		const messages = this.session?.messages ?? [];
		const name = this.session?.sessionName;
		return (name || firstUserText(messages) || "New chat").trim().slice(0, 80) || "New chat";
	}

	/** True once the user has actually sent something (drives whether this session shows in the sidebar). */
	hasUserMessage(): boolean {
		return (this.session?.messages ?? []).some((m) => (m as { role?: string }).role === "user");
	}

	summary(): SessionSummaryDto {
		return {
			sessionId: this.id,
			title: this.title(),
			cwd: this.cwd,
			project: projectName(this.cwd),
			running: this.isRunning(),
			hasPendingApproval: this.hasPendingApproval(),
			parked: this.parked,
			sessionFile: this.currentSessionFile,
			model: this.currentModel,
			thinkingLevel: (this.session?.thinkingLevel as ThinkingLevelDto) ?? this.thinkingLevel,
		};
	}

	dispose(): void {
		this.disposed = true;
		this.teardownRuntime();
		this.currentSessionFile = undefined;
	}
}
