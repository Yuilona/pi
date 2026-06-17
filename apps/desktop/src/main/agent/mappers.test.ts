import { describe, expect, it } from "vitest";
import { makeIdFactory, mapTranscript } from "./mappers.js";

describe("makeIdFactory", () => {
	it("keeps one id across a message's start -> update -> end, then a fresh id for the next message", () => {
		const id = makeIdFactory();
		const a1 = id("assistant", "start");
		expect(id("assistant", "update")).toBe(a1);
		expect(id("assistant", "end")).toBe(a1);
		expect(id("assistant", "start")).not.toBe(a1);
	});

	it("tracks ids per role independently", () => {
		const id = makeIdFactory();
		const a = id("assistant", "start");
		const u = id("user", "start");
		expect(u).not.toBe(a);
	});
});

describe("mapTranscript", () => {
	it("folds toolResult rows into tool snapshots and keeps user/assistant bubbles", () => {
		const t = mapTranscript([
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "ok" },
					{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
				],
			},
			{
				role: "toolResult",
				toolCallId: "t1",
				toolName: "read",
				content: [{ type: "text", text: "data" }],
				isError: false,
			},
		]);
		expect(t.messages).toHaveLength(2);
		expect(t.messages[0]).toMatchObject({ role: "user" });
		expect(t.messages[1]).toMatchObject({ role: "assistant" });
		expect(t.tools).toHaveLength(1);
		expect(t.tools[0]).toMatchObject({ toolCallId: "t1", name: "read", status: "success" });
	});

	it("marks a tool call with no result as pending", () => {
		const t = mapTranscript([
			{ role: "assistant", content: [{ type: "toolCall", id: "t9", name: "bash", arguments: {} }] },
		]);
		expect(t.tools[0]).toMatchObject({ toolCallId: "t9", status: "pending" });
	});
});
