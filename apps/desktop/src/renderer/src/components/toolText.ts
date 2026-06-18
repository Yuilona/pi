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

export interface SkillInvocationInfo {
	name: string;
	/** The SKILL.md body the command expanded to (shown only when expanded). */
	content?: string;
	/** Any real user text the user typed after the command (e.g. `/skill:foo do X`). */
	userMessage?: string;
}

/**
 * On send, pi expands a `/skill:name [args]` command into a `<skill name="..." location="...">…</skill>`
 * block that becomes the user message (mirrors parseSkillBlock in coding-agent). Detect it so a sent skill
 * command renders as a collapsed skill card instead of the raw block text. Also handles a bare `/skill:name`
 * in case expansion was skipped. Returns null for ordinary user messages.
 */
export function parseSkillInvocation(text: string): SkillInvocationInfo | null {
	const t = text.trim();
	const block = t.match(/^<skill name="([^"]+)" location="[^"]*">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
	if (block) {
		return { name: block[1], content: block[2]?.trim() || undefined, userMessage: block[3]?.trim() || undefined };
	}
	const cmd = t.match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]+))?$/i);
	if (cmd) return { name: cmd[1], userMessage: cmd[2]?.trim() || undefined };
	return null;
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
