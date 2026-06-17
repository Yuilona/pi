// Pure tool-schema normalizer, extracted from proxy.ts so it can be unit-tested without Electron/undici.

/**
 * Some OpenAI-compatible gateways (e.g. new-api / duckcoding) strict-validate tool JSON Schemas and
 * reject a function whose `parameters` omits `required` — they read the missing field as null and fail
 * with `null is not of type "array"`. pi omits `required` for all-optional tools (e.g. `ls`). Normalize
 * the outgoing chat/responses payload so every object-typed tool schema carries a `required` array.
 *
 * Returns `init` unchanged unless its `body` is a JSON string with a `tools` array containing an
 * object-typed schema missing `required` — then a NEW init with a patched body is returned. Any parse
 * issue (or a non-tools body) leaves it untouched.
 */
export function normalizeToolSchemas(init: any): any {
	if (!init || typeof init.body !== "string" || !init.body.includes('"tools"')) return init;
	try {
		const payload = JSON.parse(init.body);
		if (!Array.isArray(payload.tools)) return init;
		let changed = false;
		for (const tool of payload.tools) {
			const params = tool?.function?.parameters ?? tool?.parameters;
			if (params && params.type === "object" && !Array.isArray(params.required)) {
				params.required = [];
				changed = true;
			}
		}
		if (changed) return { ...init, body: JSON.stringify(payload) };
	} catch {
		// leave the body untouched on any parse issue
	}
	return init;
}
