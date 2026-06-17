import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
	IpcAgentEvent,
	IpcContentBlock,
	IpcMessage,
	IpcResultContent,
	IpcToolResult,
	ToolSnapshotDto,
	TranscriptDto,
} from "../../shared/ipc.js";

export type MessagePhase = "start" | "update" | "end";
export type MessageIdFn = (role: string, phase: MessagePhase) => string;

/**
 * pi messages have NO stable id, and each message_update delivers a NEW object (not the same
 * reference), so object identity can't key them. A logical message is a contiguous
 * start -> update* -> end sequence per role, so we track one "current" id per role: message_start
 * opens a fresh id, update/end reuse it, and end closes it. This collapses all streaming partials
 * of one assistant message into a single bubble that updates in place.
 */
export function makeIdFactory(): MessageIdFn {
	let n = 0;
	const current: Record<string, string | undefined> = {};
	return (role: string, phase: MessagePhase): string => {
		if (phase === "start" || !current[role]) {
			n += 1;
			current[role] = `${role[0] ?? "m"}${n}`;
		}
		const id = current[role] as string;
		if (phase === "end") current[role] = undefined;
		return id;
	};
}

type AnyBlock = {
	type: string;
	text?: string;
	thinking?: string;
	redacted?: boolean;
	id?: string;
	name?: string;
	arguments?: unknown;
	data?: string;
	mimeType?: string;
};

function mapContent(content: unknown): IpcContentBlock[] {
	if (typeof content === "string") return content ? [{ kind: "text", text: content }] : [];
	if (!Array.isArray(content)) return [];
	const out: IpcContentBlock[] = [];
	for (const raw of content as AnyBlock[]) {
		if (raw.type === "text" && raw.text !== undefined) out.push({ kind: "text", text: raw.text });
		else if (raw.type === "thinking")
			out.push({ kind: "thinking", text: raw.thinking ?? "", redacted: raw.redacted });
		else if (raw.type === "toolCall" && raw.id && raw.name)
			out.push({ kind: "toolCall", id: raw.id, name: raw.name, args: raw.arguments });
		else if (raw.type === "image" && raw.data)
			out.push({ kind: "image", dataUrl: `data:${raw.mimeType ?? "image/png"};base64,${raw.data}` });
	}
	return out;
}

function toIpcMessage(message: { role: string; content: unknown; timestamp?: number }, id: string): IpcMessage {
	return {
		id,
		role: message.role === "user" ? "user" : "assistant",
		content: mapContent(message.content),
		ts: message.timestamp ?? 0,
	};
}

function mapResultContent(content: unknown): IpcResultContent[] {
	if (!Array.isArray(content)) return [];
	const out: IpcResultContent[] = [];
	for (const c of content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>) {
		if (c.type === "image" && c.data)
			out.push({ kind: "image", dataUrl: `data:${c.mimeType ?? "image/png"};base64,${c.data}` });
		else if (c.text !== undefined) out.push({ kind: "text", text: c.text });
	}
	return out;
}

/**
 * A failed assistant turn arrives as an assistant message with stopReason "error" and the real reason in
 * errorMessage (pi sends the same object to message_start and message_end). Surface that text as an error
 * event instead of letting it render as a blank bubble. "aborted" is a normal user cancel — not an error.
 */
function assistantErrorText(message: unknown): string | null {
	const m = message as { role?: string; stopReason?: string; errorMessage?: string };
	if (m.role === "assistant" && m.stopReason === "error" && m.errorMessage) return m.errorMessage;
	return null;
}

/** Map a pi AgentSessionEvent to a serializable IpcAgentEvent. Returns null for events the UI ignores. */
export function mapEvent(ev: AgentSessionEvent, id: MessageIdFn): IpcAgentEvent | null {
	switch (ev.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end":
			return { type: "agent_end", willRetry: ev.willRetry };
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return { type: "turn_end" };
		case "message_start": {
			const role = (ev.message as { role: string }).role;
			if (role === "toolResult") return null;
			// A turn that failed before producing any content would otherwise open an empty bubble; the
			// matching message_end raises the error banner instead.
			if (assistantErrorText(ev.message)) return null;
			return { type: "message_start", message: toIpcMessage(ev.message as never, id(role, "start")) };
		}
		case "message_update": {
			const role = (ev.message as { role: string }).role;
			return { type: "message_update", message: toIpcMessage(ev.message as never, id(role, "update")) };
		}
		case "message_end": {
			const role = (ev.message as { role: string }).role;
			if (role === "toolResult") return null;
			// Surface a failed turn's real error text (otherwise it lands as an empty assistant message).
			const errText = assistantErrorText(ev.message);
			if (errText) return { type: "error", message: errText };
			return { type: "message_end", message: toIpcMessage(ev.message as never, id(role, "end")) };
		}
		case "tool_execution_start":
			return { type: "tool_execution_start", toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args };
		case "tool_execution_update": {
			const partial = ev.partialResult as { content?: unknown } | undefined;
			const partialText = mapResultContent(partial?.content)
				.filter((c) => c.kind === "text")
				.map((c) => (c as { text: string }).text)
				.join("\n");
			return { type: "tool_execution_update", toolCallId: ev.toolCallId, partialText };
		}
		case "tool_execution_end": {
			const result = ev.result as { content?: unknown; details?: IpcToolResult["details"] } | undefined;
			const toolResult: IpcToolResult = {
				toolCallId: ev.toolCallId,
				toolName: ev.toolName,
				content: mapResultContent(result?.content),
				details: result?.details,
				isError: ev.isError,
			};
			return { type: "tool_execution_end", toolResult };
		}
		case "queue_update":
			return { type: "queue_update", steering: [...ev.steering], followUp: [...ev.followUp] };
		case "auto_retry_start":
			return { type: "auto_retry_start", attempt: ev.attempt, maxAttempts: ev.maxAttempts, delayMs: ev.delayMs };
		case "auto_retry_end":
			return { type: "auto_retry_end", success: ev.success, finalError: ev.finalError };
		case "compaction_start":
			return { type: "compaction_start" };
		case "compaction_end":
			return { type: "compaction_end", errorMessage: ev.errorMessage, aborted: ev.aborted };
		default:
			return null;
	}
}

type RawMessage = {
	role: string;
	content: unknown;
	toolCallId?: string;
	toolName?: string;
	details?: IpcToolResult["details"];
	isError?: boolean;
	timestamp?: number;
};

/** Hydrate a saved session's messages into UI bubbles + tool snapshots (no live events available). */
export function mapTranscript(messages: unknown[]): TranscriptDto {
	let n = 0;
	const out: IpcMessage[] = [];
	const toolArgs = new Map<string, { name: string; args: unknown }>();
	const toolResults = new Map<string, IpcToolResult>();

	for (const raw of messages) {
		const m = raw as RawMessage;
		if (m.role === "toolResult") {
			if (m.toolCallId) {
				toolResults.set(m.toolCallId, {
					toolCallId: m.toolCallId,
					toolName: m.toolName ?? "",
					content: mapResultContent(m.content),
					details: m.details,
					isError: m.isError ?? false,
				});
			}
			continue;
		}
		const content = mapContent(m.content);
		for (const b of content) if (b.kind === "toolCall") toolArgs.set(b.id, { name: b.name, args: b.args });
		n += 1;
		out.push({ id: `h${n}`, role: m.role === "user" ? "user" : "assistant", content, ts: m.timestamp ?? 0 });
	}

	const tools: ToolSnapshotDto[] = [...toolArgs.entries()].map(([toolCallId, { name, args }]) => {
		const result = toolResults.get(toolCallId);
		return { toolCallId, name, args, status: result ? (result.isError ? "error" : "success") : "pending", result };
	});

	return { messages: out, tools };
}
