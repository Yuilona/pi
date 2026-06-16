import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Tools that mutate the machine and therefore require explicit user approval. */
const MUTATING = new Set(["bash", "edit", "write"]);

export type RequestApproval = (toolName: string, input: Record<string, unknown>) => Promise<boolean>;

/**
 * In-process pi extension that gates mutating tools through the user's UI — the native
 * `on("tool_call")` mechanism (same pattern as examples/extensions/permission-gate.ts), with our
 * IPC Allow/Deny dialog standing in for the TUI's `ctx.ui`. Read-only tools auto-run.
 */
export function createApprovalExtensionFactory(requestApproval: RequestApproval) {
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event) => {
			if (!MUTATING.has(event.toolName)) return undefined;
			const ok = await requestApproval(event.toolName, (event.input ?? {}) as Record<string, unknown>);
			return ok ? undefined : { block: true, reason: "Denied by user" };
		});
	};
}
