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

/**
 * Pi activates a skill by `read`ing its SKILL.md (see formatSkillsForPrompt in coding-agent). Detect
 * that and return the skill's name (its SKILL.md parent folder), or a markdown file under a skills/
 * dir. Returns null for ordinary reads so they keep the plain tool chip.
 */
export function skillActivation(tool: ToolState): string | null {
	if (tool.name !== "read" || !tool.args || typeof tool.args !== "object") return null;
	const a = tool.args as Record<string, unknown>;
	const raw = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : "";
	if (!raw) return null;
	const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
	const base = parts[parts.length - 1] ?? "";
	if (base.toUpperCase() === "SKILL.MD") return parts[parts.length - 2] ?? "skill";
	if (base.toLowerCase().endsWith(".md") && parts.includes("skills")) return base.replace(/\.md$/i, "");
	return null;
}
