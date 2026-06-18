import type { AssistantMessage } from "@earendil-works/pi-ai";

// Pure helpers for the auto-title feature, extracted from manager.ts so they can be unit-tested without
// constructing an AgentSession. The pi-ai import is type-only (erased at runtime), so this module has no
// runtime dependency on the SDK.

/** First user message's text (handles both string and content-block forms; typed structurally so the
 *  session's broader AgentMessage[] is accepted). */
export function firstUserText(messages: readonly unknown[]): string | undefined {
	for (const raw of messages) {
		const m = raw as { role?: string; content?: unknown };
		if (m.role !== "user") continue;
		if (typeof m.content === "string") return m.content.trim() || undefined;
		if (!Array.isArray(m.content)) return undefined;
		const text = m.content
			.filter((b) => (b as { type?: string }).type === "text")
			.map((b) => (b as { text?: string }).text ?? "")
			.join(" ")
			.trim();
		return text || undefined;
	}
	return undefined;
}

/** Concatenated text of an assistant reply. */
export function assistantText(msg: AssistantMessage): string {
	return msg.content
		.filter((b) => b.type === "text")
		.map((b) => (b as { text: string }).text)
		.join(" ")
		.trim();
}

/** Normalize a model-generated title: single line, no wrapping quotes / trailing punctuation, capped. */
export function cleanTitle(raw: string): string {
	return raw
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
		.replace(/[.。!！?？,，;；:：]+$/g, "")
		.trim()
		.slice(0, 60);
}

/**
 * True when a "title" is actually a refusal/apology — e.g. a non-multimodal model, asked to title a first
 * message that references an image it can't see, replies "抱歉，我无法读取图片" / "Sorry, I can't read the
 * image" instead of producing a title. Such a reply must be discarded so the session falls back to its
 * first-message title. Targets apology/can't phrasing (not bare words like 无法) to avoid rejecting a real
 * title that merely contains them.
 */
export function isRefusalTitle(title: string): boolean {
	return /(^|[\s，,、])(抱歉|对不起|很抱歉)|我(无法|不能|看不到|没办法)|无法(读取|查看|识别|处理|访问|打开|显示)|\b(sorry|i\s*(?:can'?t|cannot|am\s+unable|'?m\s+unable))\b|unable\s+to\s+(?:read|see|view|access|process|open|display)/i.test(
		title,
	);
}
