import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface ProxyConfig {
	enabled: boolean;
	url: string;
}

// Capture the genuine Node fetch once, before anything swaps it, so disabling can restore it.
const originalFetch = globalThis.fetch;
let currentAgent: ProxyAgent | undefined;

function configPath(): string {
	return join(app.getPath("userData"), "proxy.json");
}

/** Best-effort proxy URL from the environment (e.g. HTTPS_PROXY), used to pre-fill the Settings field. */
export function detectEnvProxy(): string {
	return (
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		""
	).trim();
}

export function loadProxyConfig(): ProxyConfig {
	try {
		const path = configPath();
		if (!existsSync(path)) return { enabled: false, url: "" };
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<ProxyConfig>;
		return { enabled: !!raw.enabled, url: typeof raw.url === "string" ? raw.url : "" };
	} catch {
		return { enabled: false, url: "" };
	}
}

function persist(cfg: ProxyConfig): void {
	try {
		writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf-8");
	} catch {
		// best-effort: a read-only userData dir shouldn't crash the app.
	}
}

/**
 * Some OpenAI-compatible gateways (e.g. new-api / duckcoding) strict-validate tool JSON Schemas and
 * reject a function whose `parameters` omits `required` — they read the missing field as null and fail
 * with `null is not of type "array"`. pi omits `required` for all-optional tools (e.g. `ls`). Normalize
 * the outgoing chat/responses payload so every object-typed tool schema carries a `required` array.
 */
function normalizeToolSchemas(init: any): any {
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

/**
 * Install the global fetch the pi/OpenAI SDK will use. It always normalizes tool schemas (so strict
 * gateways accept pi's tools) and, when a proxy is configured, routes through it via undici's ProxyAgent.
 * pi builds a fresh client per request and reads globalThis.fetch then, so this takes effect on the next
 * message with no session rebuild.
 */
function installFetch(transport: (input: any, init: any) => Promise<any>): void {
	globalThis.fetch = ((input: any, init?: any) =>
		transport(input, normalizeToolSchemas(init))) as unknown as typeof fetch;
}

export function applyProxy(cfg: ProxyConfig): void {
	currentAgent?.close().catch(() => {});
	currentAgent = undefined;
	// Enabling without an explicit URL falls back to the env proxy (works only if the app process
	// actually inherited HTTPS_PROXY — GUI launches usually don't, so the URL must be set in Settings).
	const url = cfg.url || (cfg.enabled ? detectEnvProxy() : "");
	if (cfg.enabled && url) {
		const agent = new ProxyAgent(url);
		currentAgent = agent;
		installFetch((input, init) => undiciFetch(input, { ...init, dispatcher: agent }));
	} else {
		installFetch((input, init) => originalFetch(input, init));
	}
}

/** Persist + apply (called from the Settings IPC handler). Returns the normalized config. */
export function setProxyConfig(cfg: ProxyConfig): ProxyConfig {
	const next: ProxyConfig = { enabled: !!cfg.enabled, url: (cfg.url || "").trim() };
	persist(next);
	applyProxy(next);
	return next;
}
