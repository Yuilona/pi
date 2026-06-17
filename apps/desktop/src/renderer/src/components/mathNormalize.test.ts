import { describe, expect, it } from "vitest";
import { convertLatexDelimiters, fixMultilineDisplay, normalizeMathBlocks } from "./mathNormalize";

describe("convertLatexDelimiters", () => {
	it("rewrites \\[ ... \\] display delimiters to $$ on their own lines", () => {
		expect(convertLatexDelimiters("a \\[ x+1 \\] b")).toBe("a \n\n$$\nx+1\n$$\n\n b");
	});

	it("rewrites \\( ... \\) inline delimiters to $...$", () => {
		expect(convertLatexDelimiters("see \\( y \\) here")).toBe("see $y$ here");
	});

	it("leaves an empty \\(\\) pair untouched", () => {
		expect(convertLatexDelimiters("\\(\\)")).toBe("\\(\\)");
	});

	it("leaves prose and unmatched delimiters alone", () => {
		expect(convertLatexDelimiters("array a[0] and (paren)")).toBe("array a[0] and (paren)");
	});
});

describe("fixMultilineDisplay", () => {
	it("puts each delimiter of a glued multi-line $$ block on its own line", () => {
		expect(fixMultilineDisplay("$$a\nb$$")).toBe("$$\na\nb\n$$");
	});

	it("leaves single-line $$...$$ untouched (works in tables already)", () => {
		expect(fixMultilineDisplay("x $$a=b$$ y")).toBe("x $$a=b$$ y");
	});
});

describe("normalizeMathBlocks", () => {
	it("normalizes a glued multi-line block outside code", () => {
		expect(normalizeMathBlocks("$$a\nb$$")).toBe("$$\na\nb\n$$");
	});

	it("never rewrites $$ inside a fenced code block", () => {
		const fenced = "```\n$$a\nb$$\n```";
		expect(normalizeMathBlocks(fenced)).toBe(fenced);
	});

	it("never rewrites inside an inline code span", () => {
		expect(normalizeMathBlocks("use `$x$` literally")).toBe("use `$x$` literally");
	});
});
