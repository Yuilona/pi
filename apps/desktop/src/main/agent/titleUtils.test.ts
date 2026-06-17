import { describe, expect, it } from "vitest";
import { assistantText, cleanTitle, firstUserText } from "./titleUtils.js";

describe("cleanTitle", () => {
	it("strips wrapping quotes and trailing punctuation, collapses whitespace", () => {
		expect(cleanTitle('"Hello   World."')).toBe("Hello World");
		expect(cleanTitle("'Refactor the parser!'")).toBe("Refactor the parser");
		expect(cleanTitle("A multi\nline   title")).toBe("A multi line title");
	});

	it("caps the title at 60 characters", () => {
		expect(cleanTitle("x".repeat(80))).toHaveLength(60);
	});
});

describe("firstUserText", () => {
	it("reads a plain string user message", () => {
		expect(firstUserText([{ role: "user", content: "hi there" }])).toBe("hi there");
	});

	it("joins the text blocks of a content-array user message", () => {
		const msg = {
			role: "user",
			content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }],
		};
		expect(firstUserText([msg])).toBe("a b");
	});

	it("returns the FIRST user message, skipping a leading assistant message", () => {
		expect(
			firstUserText([
				{ role: "assistant", content: "x" },
				{ role: "user", content: "hello" },
			]),
		).toBe("hello");
	});

	it("returns undefined for no user message or whitespace-only content", () => {
		expect(firstUserText([])).toBeUndefined();
		expect(firstUserText([{ role: "user", content: "   " }])).toBeUndefined();
	});
});

describe("assistantText", () => {
	it("concatenates only the text blocks, skipping thinking/tool blocks", () => {
		const msg = {
			content: [
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "x" },
				{ type: "text", text: "world" },
			],
		};
		expect(assistantText(msg as unknown as Parameters<typeof assistantText>[0])).toBe("hello world");
	});
});
