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
 * Route the main process's outbound fetch through an HTTP proxy. pi's OpenAI SDK reads
 * globalThis.fetch and builds a fresh client per request, so swapping the global takes effect on the
 * next message with no session rebuild. We bind undici's OWN fetch to a ProxyAgent (both from the same
 * undici package) — feeding a standalone-undici ProxyAgent to Node's bundled fetch throws a dispatcher
 * version mismatch, so we route through undici end-to-end. Disabling restores the original fetch.
 */
export function applyProxy(cfg: ProxyConfig): void {
	currentAgent?.close().catch(() => {});
	currentAgent = undefined;
	if (cfg.enabled && cfg.url) {
		const agent = new ProxyAgent(cfg.url);
		currentAgent = agent;
		// Bridge undici's fetch types to the DOM fetch shape (noExplicitAny is off for this app).
		globalThis.fetch = ((input: any, init?: any) =>
			undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof fetch;
	} else {
		globalThis.fetch = originalFetch;
	}
}

/** Persist + apply (called from the Settings IPC handler). Returns the normalized config. */
export function setProxyConfig(cfg: ProxyConfig): ProxyConfig {
	const next: ProxyConfig = { enabled: !!cfg.enabled, url: (cfg.url || "").trim() };
	persist(next);
	applyProxy(next);
	return next;
}
