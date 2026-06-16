import type { ToolState } from "@/state/chatReducer";

export function toolResultText(tool: ToolState): string {
	return (tool.result?.content ?? [])
		.filter((c) => c.kind === "text")
		.map((c) => (c as { text: string }).text)
		.join("\n")
		.trim();
}

export function toolArgSummary(args: unknown): string {
	if (args && typeof args === "object") {
		const a = args as Record<string, unknown>;
		const first = a.path ?? a.file_path ?? a.pattern ?? a.command ?? a.query ?? a.cwd;
		if (typeof first === "string") return first;
	}
	return "";
}
