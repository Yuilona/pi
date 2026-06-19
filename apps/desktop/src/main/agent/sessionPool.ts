import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { getAgentDir, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
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
	SessionSummaryDto,
	ThinkingLevelDto,
	TranscriptDto,
	UsageDto,
} from "../../shared/ipc.js";
import {
	type AuthBundle,
	createAuth,
	hasAnyModel,
	hasApiKey,
	listModels,
	persistApiKey,
	removeApiKey,
} from "./auth.js";
import { createSerializer } from "./serialize.js";
import { projectName, SessionController } from "./sessionController.js";

/** Max concurrently-LIVE sessions (each = a model context + subscription in memory). Beyond this the pool
 * parks the least-recently-used IDLE session; a running session is never parked. */
const MAX_LIVE = 6;

/** True iff `p` resolves to `root` itself or a path nested inside it. Confines renderer-supplied paths to
 * pi's sessions dir before any destructive `rmSync` / open. Exported for unit testing. */
export function isInSessionsDir(p: string, root: string): boolean {
	const base = resolve(root);
	const r = resolve(p);
	return r === base || r.startsWith(base + sep);
}

export interface PoolDeps {
	/** Forward an agent event to the renderer, tagged with its session id. */
	forward: (sessionId: string, e: IpcAgentEvent) => void;
	/** Forward a tool-approval request to the renderer, tagged with its session id. */
	forwardApproval: (sessionId: string, req: ApprovalRequest) => void;
	/** A background (non-focused) session finished a turn or needs an approval — fire an OS notification. */
	notify: (sessionId: string, kind: "done" | "approval", title: string) => void;
}

/**
 * Owns the pool of live `SessionController`s and the process-wide shared resources (auth/model registry,
 * global permission mode + show-thinking, the models.json editor). Replaces the single-session ownership the
 * old `AgentManager` had: it threads a `sessionId` through every session-scoped call and forwards each
 * controller's events to the renderer tagged with that id.
 */
export class SessionPool {
	private auth: AuthBundle = createAuth();
	private controllers = new Map<string, SessionController>();
	private seq = 0;
	private tick = 0;
	private lastActive = new Map<string, number>();
	private activeId: string | undefined;
	private mode: PermissionMode = "ask";
	private globalSettings: SettingsManager;
	// Serializes pool map mutations (create/open/park/delete) so concurrent ones can't race the map.
	private runExclusive = createSerializer();

	constructor(
		private readonly deps: PoolDeps,
		private readonly defaultCwd: string,
		private readonly appDir: string = defaultCwd,
	) {
		this.globalSettings = SettingsManager.create(appDir);
	}

	// ---- controller factory + event routing ----
	private createController(cwd: string): SessionController {
		this.seq += 1;
		const id = `s${this.seq}`;
		const c = new SessionController(id, this.auth, cwd, {
			onEvent: (e) => this.onControllerEvent(id, e),
			onApproval: (req) => this.onControllerApproval(id, req),
			getMode: () => this.mode,
		});
		this.controllers.set(id, c);
		this.lastActive.set(id, ++this.tick);
		return c;
	}

	private onControllerEvent(id: string, e: IpcAgentEvent): void {
		this.deps.forward(id, e);
		// A background session finishing a turn earns an OS notification (AC2).
		if (e.type === "agent_end" && !e.willRetry && id !== this.activeId) {
			this.deps.notify(id, "done", this.controllers.get(id)?.summary().title ?? "Chat");
		}
	}

	private onControllerApproval(id: string, req: ApprovalRequest): void {
		this.deps.forwardApproval(id, req);
		// A background session hitting an approval gate fires an OS notification (the active session keeps its
		// inline ApprovalDialog with no duplicate toast).
		if (id !== this.activeId) {
			this.deps.notify(id, "approval", this.controllers.get(id)?.summary().title ?? "Chat");
		}
	}

	private touch(id: string): void {
		this.lastActive.set(id, ++this.tick);
	}

	/** pi's sessions dir (the dir SessionManager.listAll() enumerates) — the only tree destructive IPC paths
	 * may touch. */
	private sessionsRoot(): string {
		return join(getAgentDir(), "sessions");
	}

	/** Park the least-recently-used idle, non-running, non-active controller when at the live cap. Never parks
	 * a running session; if every live session is running, allow exceeding the cap (logged) rather than drop a
	 * run (AC5). */
	private parkForCapacity(): void {
		const live = [...this.controllers.values()].filter((c) => !c.isParked());
		if (live.length < MAX_LIVE) return;
		const candidates = live
			.filter((c) => c.id !== this.activeId && !c.isRunning())
			.sort((a, b) => (this.lastActive.get(a.id) ?? 0) - (this.lastActive.get(b.id) ?? 0));
		const victim = candidates[0];
		if (victim) {
			victim.park();
			console.log(`[pool] parked idle session ${victim.id} (live cap ${MAX_LIVE} reached)`);
		} else {
			console.log(`[pool] live cap ${MAX_LIVE} reached but all sessions are running — staying over cap`);
		}
	}

	// ---- lifecycle ----
	/** Warm up on startup: create the initial controller (active), building it if a model is configured. */
	async init(): Promise<void> {
		const c = this.createController(this.defaultCwd);
		this.activeId = c.id;
		if (hasAnyModel(this.auth)) {
			try {
				await c.ensureLive();
			} catch (e) {
				this.deps.forward(c.id, { type: "error", message: e instanceof Error ? e.message : String(e) });
			}
		}
	}

	/** Create a fresh live session in a cwd; returns its id. */
	async newChatInCwd(cwd: string): Promise<string> {
		return this.runExclusive(async () => {
			this.parkForCapacity();
			const c = this.createController(cwd || this.defaultCwd);
			if (hasAnyModel(this.auth)) {
				try {
					await c.ensureLive();
				} catch (e) {
					this.deps.forward(c.id, { type: "error", message: e instanceof Error ? e.message : String(e) });
				}
			}
			return c.id;
		});
	}

	/** Ensure a live controller for an on-disk path (dedup by file); returns its id. */
	async openSession(path: string): Promise<string> {
		return this.runExclusive(async () => {
			const existing = [...this.controllers.values()].find((c) => c.sessionFile() === path);
			if (existing) {
				if (existing.isParked()) {
					try {
						await existing.ensureLive(path);
					} catch (e) {
						this.deps.forward(existing.id, {
							type: "error",
							message: `Couldn't resume session: ${e instanceof Error ? e.message : String(e)}`,
						});
					}
				}
				this.touch(existing.id);
				return existing.id;
			}
			this.parkForCapacity();
			const c = this.createController(this.defaultCwd);
			try {
				await c.ensureLive(path);
			} catch (e) {
				this.deps.forward(c.id, {
					type: "error",
					message: `Couldn't resume session: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
			return c.id;
		});
	}

	get(sessionId: string): SessionController | undefined {
		return this.controllers.get(sessionId);
	}

	async setActive(sessionId: string | null): Promise<void> {
		this.activeId = sessionId ?? undefined;
		if (!sessionId) return;
		this.touch(sessionId);
		const c = this.controllers.get(sessionId);
		if (!c?.isParked()) return;
		// Focusing a parked session brings it back to life (resumes from its file). Serialize on the pool lock
		// against close/delete, enforce the live cap first, await the rebuild so the renderer's getTranscript
		// sees it, and surface a failed resume as an error DTO instead of an unhandled rejection.
		await this.runExclusive(async () => {
			// Re-check under the lock: a concurrent close/delete may have removed it.
			const cur = this.controllers.get(sessionId);
			if (!cur?.isParked()) return;
			this.parkForCapacity();
			try {
				await cur.ensureLive(cur.sessionFile());
			} catch (e) {
				this.deps.forward(sessionId, {
					type: "error",
					message: `Couldn't resume session: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		});
	}

	async closeSession(sessionId: string): Promise<void> {
		return this.runExclusive(async () => {
			const c = this.controllers.get(sessionId);
			if (!c) return;
			await c.abort();
			c.dispose();
			this.controllers.delete(sessionId);
			this.lastActive.delete(sessionId);
			if (this.activeId === sessionId) this.activeId = this.fallbackActive();
		});
	}

	async deleteSession(sessionId: string): Promise<void> {
		return this.runExclusive(async () => {
			const c = this.controllers.get(sessionId);
			const file = c?.sessionFile();
			if (c) {
				await c.abort();
				c.dispose();
				this.controllers.delete(sessionId);
				this.lastActive.delete(sessionId);
			}
			if (file && isInSessionsDir(file, this.sessionsRoot())) {
				try {
					rmSync(file, { force: true });
				} catch (e) {
					this.deps.forward(sessionId, { type: "error", message: e instanceof Error ? e.message : String(e) });
				}
			}
			if (this.activeId === sessionId) this.activeId = this.fallbackActive();
		});
	}

	/** Delete an on-disk session that has no live controller (a history row never opened this run). */
	async deleteSessionByPath(path: string): Promise<void> {
		const live = [...this.controllers.values()].find((c) => c.sessionFile() === path);
		if (live) return this.deleteSession(live.id);
		// Confine the renderer-supplied path to pi's sessions dir before rm (SEC-2).
		if (!isInSessionsDir(path, this.sessionsRoot())) return;
		try {
			rmSync(path, { force: true });
		} catch {
			// best-effort
		}
	}

	private fallbackActive(): string | undefined {
		// Prefer an existing live controller; else leave undefined (the renderer can start a new chat).
		const next = [...this.controllers.values()][0];
		return next?.id;
	}

	resolveApproval(sessionId: string, id: string, decision: ApprovalDecision): void {
		this.controllers.get(sessionId)?.resolveApproval(id, decision);
	}

	// ---- session-scoped passthroughs ----
	async prompt(sessionId: string, text: string, images?: ImageAttachmentDto[]): Promise<void> {
		this.touch(sessionId);
		await this.controllers.get(sessionId)?.prompt(text, images);
	}
	async abort(sessionId: string): Promise<void> {
		await this.controllers.get(sessionId)?.abort();
	}
	async editLastMessage(sessionId: string): Promise<string | null> {
		return (await this.controllers.get(sessionId)?.editLastMessage()) ?? null;
	}
	getStats(sessionId: string): UsageDto {
		return (
			this.controllers.get(sessionId)?.getStats() ?? {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
				cost: 0,
				contextTokens: null,
				contextWindow: 0,
				contextPercent: null,
			}
		);
	}
	getTranscript(sessionId: string): TranscriptDto {
		return this.controllers.get(sessionId)?.getTranscript() ?? { messages: [], tools: [] };
	}
	listCommands(sessionId: string): CommandDto[] {
		return this.controllers.get(sessionId)?.listCommands() ?? [];
	}
	async compact(sessionId: string): Promise<void> {
		await this.controllers.get(sessionId)?.compact();
	}
	async setModel(sessionId: string, provider: string, id: string): Promise<void> {
		await this.controllers.get(sessionId)?.setModel(provider, id);
	}
	setThinking(sessionId: string, level: ThinkingLevelDto): void {
		this.controllers.get(sessionId)?.setThinking(level);
	}

	// ---- app-global ----
	setMode(mode: PermissionMode): void {
		this.mode = mode;
	}

	setShowThinking(show: boolean): void {
		this.globalSettings.setHideThinkingBlock(!show);
		void this.globalSettings.flush();
	}

	async listSessions(): Promise<SessionInfoDto[]> {
		const live = [...this.controllers.values()];
		const fileToId = new Map<string, string>();
		for (const c of live) {
			const f = c.sessionFile();
			if (f) fileToId.set(f, c.id);
		}

		const sessions = await SessionManager.listAll();
		const out: SessionInfoDto[] = sessions
			.filter((s) => s.messageCount > 0)
			.map((s) => ({
				path: s.path,
				title: (s.name || s.firstMessage || "New chat").trim().slice(0, 80) || "New chat",
				messageCount: s.messageCount,
				modified: s.modified.getTime(),
				cwd: s.cwd,
				project: projectName(s.cwd),
				sessionId: fileToId.get(s.path),
			}));

		// Surface live sessions whose JSONL isn't on disk yet (pi persists on first message_end) so their row
		// appears the moment you send. Keyed by sessionId.
		const onDiskFiles = new Set(out.map((s) => s.path));
		for (const c of live) {
			const file = c.sessionFile();
			if (file && onDiskFiles.has(file)) continue;
			if (!c.hasUserMessage()) continue;
			const s = c.summary();
			out.push({
				path: file ?? `__live__${c.id}`,
				title: s.title,
				messageCount: 1,
				modified: Date.now(),
				cwd: s.cwd,
				project: s.project,
				sessionId: c.id,
			});
		}

		return out.sort((a, b) => b.modified - a.modified);
	}

	getState(): AppStateDto {
		const sessions: SessionSummaryDto[] = [...this.controllers.values()].map((c) => c.summary());
		return {
			appDir: this.appDir,
			mode: this.mode,
			showThinking: !this.globalSettings.getHideThinkingBlock(),
			hasModel: hasAnyModel(this.auth),
			sessions,
			activeId: this.activeId,
		};
	}

	// ---- auth / providers (global) ----
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

	async setApiKey(provider: string, key: string): Promise<boolean> {
		try {
			persistApiKey(this.auth, provider, key.trim());
			this.auth.modelRegistry.refresh();
			await this.warmActiveIfNeeded();
			return true;
		} catch (e) {
			// Surface to the active session only (no fabricated "s0" id); the Settings UI also sees the false.
			if (this.activeId) {
				this.deps.forward(this.activeId, { type: "error", message: e instanceof Error ? e.message : String(e) });
			}
			return false;
		}
	}

	removeApiKey(provider: string): void {
		removeApiKey(this.auth, provider);
		this.auth.modelRegistry.refresh();
	}

	hasApiKey(provider: string): boolean {
		return hasApiKey(this.auth, provider);
	}

	listModels(): ModelInfoDto[] {
		return listModels(this.auth);
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
			await this.warmActiveIfNeeded();
			return true;
		} catch (e) {
			// Surface to the active session only (no fabricated "s0" id); the Settings UI also sees the false.
			if (this.activeId) {
				this.deps.forward(this.activeId, { type: "error", message: e instanceof Error ? e.message : String(e) });
			}
			return false;
		}
	}

	/** After credentials change, build the active controller if a model just became available, so the model
	 * pill/state reflect it immediately (mirrors the old single-session rebuild-on-key). */
	private async warmActiveIfNeeded(): Promise<void> {
		if (!hasAnyModel(this.auth) || !this.activeId) return;
		const c = this.controllers.get(this.activeId);
		if (c && c.isParked() === false && c.sessionFile() === undefined && !c.hasUserMessage()) {
			try {
				await c.ensureLive();
			} catch {
				// non-fatal; the next prompt will build it
			}
		}
	}

	dispose(): void {
		for (const c of this.controllers.values()) c.dispose();
		this.controllers.clear();
		this.lastActive.clear();
		this.activeId = undefined;
	}
}
