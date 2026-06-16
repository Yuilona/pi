import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelInfoDto } from "../../shared/ipc.js";

export interface AuthBundle {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
}

/** Default paths: ~/.pi/agent/auth.json + ~/.pi/agent/models.json (shared with the pi CLI). */
export function createAuth(): AuthBundle {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	return { authStorage, modelRegistry };
}

/** Persist an API key to auth.json AND set it as a runtime override for the live session. */
export function persistApiKey(auth: AuthBundle, provider: string, key: string): void {
	auth.authStorage.setRuntimeApiKey(provider, key);
	auth.authStorage.set(provider, { type: "api_key", key });
}

/** Remove a provider's stored + runtime key. */
export function removeApiKey(auth: AuthBundle, provider: string): void {
	auth.authStorage.removeRuntimeApiKey(provider);
	if (auth.authStorage.has(provider)) auth.authStorage.remove(provider);
}

export function hasApiKey(auth: AuthBundle, provider: string): boolean {
	return auth.authStorage.hasAuth(provider);
}

/** Is any model usable across all providers (built-in + custom models.json)? */
export function hasAnyModel(auth: AuthBundle): boolean {
	return auth.modelRegistry.getAvailable().length > 0;
}

/** All models (built-in + custom), each flagged with whether its provider has credentials. */
export function listModels(auth: AuthBundle): ModelInfoDto[] {
	return auth.modelRegistry.getAll().map((m) => ({
		provider: m.provider,
		id: m.id,
		label: m.name,
		available: auth.modelRegistry.hasConfiguredAuth(m),
	}));
}
