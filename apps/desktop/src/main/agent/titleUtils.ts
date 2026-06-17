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
