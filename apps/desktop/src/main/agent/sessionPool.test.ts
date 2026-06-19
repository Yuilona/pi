import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInSessionsDir } from "./sessionPool.js";

// ---- isInSessionsDir: the pure path-confinement guard (no mocks needed) ----
describe("isInSessionsDir", () => {
	const root = resolve("/home/u/.pi/agent/sessions");

	it("accepts the root dir itself and nested paths", () => {
		expect(isInSessionsDir(root, root)).toBe(true);
		expect(isInSessionsDir(join(root, "a.jsonl"), root)).toBe(true);
		expect(isInSessionsDir(join(root, "sub", "b.jsonl"), root)).toBe(true);
	});

	it("rejects siblings, parents, and outside paths", () => {
		expect(isInSessionsDir(resolve("/home/u/.pi/agent/other.jsonl"), root)).toBe(false);
		expect(isInSessionsDir(resolve("/home/u/.pi/agent"), root)).toBe(false);
		expect(isInSessionsDir(resolve("/etc/passwd"), root)).toBe(false);
		// A sibling dir whose name is a prefix of "sessions" must not slip through the startsWith check.
		expect(isInSessionsDir(resolve("/home/u/.pi/agent/sessions-evil/x.jsonl"), root)).toBe(false);
	});
});

// ---- best-effort integration test: cap enforcement + revive-error forwarding on setActive ----
// We mock the heavy pi/auth deps and the SessionController so no real SDK/model/network is touched.
// FakeController + its shared mutable state live inside vi.hoisted() so the (hoisted) vi.mock factory below
// can reference the class without a "cannot access before initialization" TDZ error.

const MAX_LIVE = 6;

const h = vi.hoisted(() => {
	const failingFiles = new Set<string>();
	const state: { created: FakeCtl[]; failingFiles: Set<string> } = { created: [], failingFiles };

	class FakeCtl {
		parked = false;
		running = false;
		live = false;
		private file: string | undefined;

		constructor(
			readonly id: string,
			_auth: unknown,
			readonly cwd: string,
			_deps: unknown,
		) {
			state.created.push(this);
			// A deterministic on-disk file so dedup/sessionFile() behave like the real controller after a build.
			this.file = `/home/u/.pi/agent/sessions/${id}.jsonl`;
		}

		async ensureLive(file?: string): Promise<void> {
			const f = file ?? this.file;
			if (f && failingFiles.has(f)) throw new Error(`cannot open ${f}`);
			this.live = true;
			this.parked = false;
			if (file) this.file = file;
		}
		isParked(): boolean {
			return this.parked;
		}
		isRunning(): boolean {
			return this.running;
		}
		sessionFile(): string | undefined {
			return this.file;
		}
		park(): void {
			this.live = false;
			this.parked = true;
		}
		hasUserMessage(): boolean {
			return false;
		}
		summary() {
			return { title: `chat ${this.id}`, cwd: this.cwd, project: "p" };
		}
		async abort(): Promise<void> {}
		dispose(): void {
			this.live = false;
		}
	}

	return { FakeCtl, state };
});

vi.mock("./sessionController.js", () => ({
	SessionController: h.FakeCtl,
	projectName: (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
}));

vi.mock("./auth.js", () => ({
	createAuth: () => ({ authStorage: {}, modelRegistry: {} }),
	hasAnyModel: () => true,
	hasApiKey: () => false,
	listModels: () => [],
	persistApiKey: () => {},
	removeApiKey: () => {},
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => "/home/u/.pi/agent",
	SettingsManager: {
		create: () => ({
			getHideThinkingBlock: () => false,
			setHideThinkingBlock: () => {},
			flush: async () => {},
		}),
	},
	SessionManager: { listAll: async () => [] },
}));

describe("SessionPool setActive cap + revive errors", () => {
	beforeEach(() => {
		h.state.failingFiles.clear();
		h.state.created = [];
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	const liveCount = () => h.state.created.filter((c) => c.live).length;

	async function makeFullPool() {
		const forwarded: { id: string; type: string }[] = [];
		const { SessionPool } = await import("./sessionPool.js");
		const pool = new SessionPool(
			{
				forward: (id, e) => forwarded.push({ id, type: e.type }),
				forwardApproval: () => {},
				notify: () => {},
			},
			"/proj",
			"/proj",
		);
		await pool.init(); // s1 active + live
		// Create enough sessions to exceed the live cap, forcing at least one to be parked.
		for (let i = 0; i < MAX_LIVE + 1; i++) await pool.newChatInCwd("/proj");
		return { pool, forwarded };
	}

	it("keeps the live count <= MAX_LIVE and revives a parked session on focus", async () => {
		const { pool } = await makeFullPool();
		expect(liveCount()).toBeLessThanOrEqual(MAX_LIVE);

		const parked = h.state.created.find((c) => c.parked);
		expect(parked).toBeTruthy();
		if (!parked) return;

		await pool.setActive(parked.id);
		expect(parked.live).toBe(true);
		expect(parked.parked).toBe(false);
		// Reviving one parked controller must park another to stay within the cap.
		expect(liveCount()).toBeLessThanOrEqual(MAX_LIVE);
	});

	it("forwards an 'error' DTO (no unhandled rejection) when a revive fails", async () => {
		const { pool, forwarded } = await makeFullPool();
		const parked = h.state.created.find((c) => c.parked);
		expect(parked).toBeTruthy();
		if (!parked) return;

		const file = parked.sessionFile();
		expect(file).toBeTruthy();
		if (file) h.state.failingFiles.add(file);

		await expect(pool.setActive(parked.id)).resolves.toBeUndefined();
		expect(forwarded.some((f) => f.id === parked.id && f.type === "error")).toBe(true);
	});
});
