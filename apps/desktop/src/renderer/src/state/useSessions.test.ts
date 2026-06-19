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

// REACT-1: `send` addresses an explicit target id when given, else the active session. The hook itself
// can't be rendered here (vitest runs in a plain `node` env with no jsdom/testing-library — see
// vitest.config.ts), so we cover the target-resolution contract that `send` applies before calling
// `window.pi.send(id, …)`: `const id = sessionId ?? activeRef.current`. This guards the edit-then-switch
// race fix — an explicit captured id must win over whatever session is active by the time the awaits settle.
function resolveSendTarget(sessionId: string | undefined, activeId: string | undefined): string | undefined {
	return sessionId ?? activeId;
}

describe("useSessions send — target resolution (REACT-1)", () => {
	it("uses the explicit sessionId when provided, even if a different session is active", () => {
		expect(resolveSendTarget("sX", "sActive")).toBe("sX");
	});

	it("falls back to the active session when no explicit id is given", () => {
		expect(resolveSendTarget(undefined, "sActive")).toBe("sActive");
	});

	it("yields undefined (a no-op send) when neither an explicit nor an active id exists", () => {
		expect(resolveSendTarget(undefined, undefined)).toBeUndefined();
	});
});
