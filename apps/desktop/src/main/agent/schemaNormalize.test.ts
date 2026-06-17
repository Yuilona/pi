import { describe, expect, it } from "vitest";
import { normalizeToolSchemas } from "./schemaNormalize.js";

const toolBody = (params: unknown) =>
	JSON.stringify({ model: "m", tools: [{ type: "function", function: { name: "ls", parameters: params } }] });

describe("normalizeToolSchemas", () => {
	it("adds required: [] to an object tool schema that omits it", () => {
		const init = { body: toolBody({ type: "object", properties: { path: { type: "string" } } }) };
		const out = normalizeToolSchemas(init);
		const params = JSON.parse(out.body).tools[0].function.parameters;
		expect(params.required).toEqual([]);
	});

	it("leaves a schema that already has required untouched (same object)", () => {
		const init = { body: toolBody({ type: "object", required: ["path"] }) };
		expect(normalizeToolSchemas(init)).toBe(init);
	});

	it("returns a non-tools body unchanged (same object)", () => {
		const init = { body: JSON.stringify({ messages: [] }) };
		expect(normalizeToolSchemas(init)).toBe(init);
	});

	it("returns an unparseable tools body unchanged (same object)", () => {
		const init = { body: 'garbage with "tools" but not json' };
		expect(normalizeToolSchemas(init)).toBe(init);
	});

	it("tolerates a missing/undefined init", () => {
		expect(normalizeToolSchemas(undefined)).toBeUndefined();
	});
});
