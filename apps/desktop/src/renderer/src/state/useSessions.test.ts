import type { IpcMessage } from "@shared/ipc";
import { describe, expect, it } from "vitest";
import { emptySessionsState, metaReducer } from "@/state/useSessions";

const msg = (id: string, text: string): IpcMessage => ({
	id,
	role: "assistant",
	content: [{ kind: "text", text }],
	ts: 0,
});

describe("metaReducer — per-session slice routing", () => {
	it("routes an event to its own session's slice, leaving others untouched", () => {
		const base = { ...emptySessionsState, activeId: "s1" };
		const next = metaReducer(base, {
			type: "event",
			sessionId: "s2",
			event: { type: "message_start", message: msg("a1", "hi") },
		});
		expect(next.slices.s2?.messages).toHaveLength(1);
		expect(next.slices.s1).toBeUndefined();
	});

	it("marks a background session unread on a content event, but not the active one", () => {
		const base = { ...emptySessionsState, activeId: "s1" };
		const bg = metaReducer(base, {
			type: "event",
			sessionId: "s2",
			event: { type: "message_end", message: msg("a1", "done") },
		});
		expect(bg.unread.s2).toBe(true);

		const fg = metaReducer(base, {
			type: "event",
			sessionId: "s1",
			event: { type: "message_end", message: msg("a1", "done") },
		});
		expect(fg.unread.s1).toBeUndefined();
	});

	it("does NOT mark unread on a lifecycle-only event (agent_start)", () => {
		const base = { ...emptySessionsState, activeId: "s1" };
		const next = metaReducer(base, { type: "event", sessionId: "s2", event: { type: "agent_start" } });
		expect(next.unread.s2).toBeUndefined();
		expect(next.slices.s2?.streaming).toBe(true);
	});

	it("clears a session's unread flag when it becomes active", () => {
		const withUnread = { slices: {}, unread: { s2: true as const } };
		const next = metaReducer(withUnread, { type: "setActive", sessionId: "s2" });
		expect(next.activeId).toBe("s2");
		expect(next.unread.s2).toBeUndefined();
	});

	it("remove drops a session's slice and unread flag", () => {
		const state = {
			slices: { s2: { messages: [msg("a1", "x")], tools: {}, streaming: false, compacting: false } },
			unread: { s2: true as const },
			activeId: "s1",
		};
		const next = metaReducer(state, { type: "remove", sessionId: "s2" });
		expect(next.slices.s2).toBeUndefined();
		expect(next.unread.s2).toBeUndefined();
	});
});
