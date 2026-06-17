import type { IpcAgentEvent, IpcMessage, IpcToolResult, ToolSnapshotDto } from "@shared/ipc";

export interface ToolState {
	toolCallId: string;
	name: string;
	args: unknown;
	status: "pending" | "success" | "error";
	result?: IpcToolResult;
	/** Streaming partial output (e.g. live bash stdout) before the final result. */
	output?: string;
}

export interface ChatState {
	messages: IpcMessage[];
	tools: Record<string, ToolState>;
	streaming: boolean;
	error?: string;
	retry?: { attempt: number; maxAttempts: number; delayMs: number };
	compacting: boolean;
}

export const initialChatState: ChatState = {
	messages: [],
	tools: {},
	streaming: false,
	compacting: false,
};

export type ChatAction =
	| IpcAgentEvent
	| { type: "_reset" }
	| { type: "_load"; messages: IpcMessage[]; tools: ToolSnapshotDto[] };

function upsert(messages: IpcMessage[], message: IpcMessage): IpcMessage[] {
	const idx = messages.findIndex((m) => m.id === message.id);
	if (idx === -1) return [...messages, message];
	const next = messages.slice();
	next[idx] = message;
	return next;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case "_reset":
			return initialChatState;
		case "_load": {
			const tools: Record<string, ToolState> = {};
			for (const t of action.tools) {
				tools[t.toolCallId] = {
					toolCallId: t.toolCallId,
					name: t.name,
					args: t.args,
					status: t.status,
					result: t.result,
				};
			}
			return { ...initialChatState, messages: action.messages, tools };
		}
		case "agent_start":
			return { ...state, streaming: true, error: undefined };
		case "agent_end":
			return { ...state, streaming: action.willRetry ? state.streaming : false };
		case "message_start":
		case "message_update":
		case "message_end":
			return { ...state, messages: upsert(state.messages, action.message) };
		case "tool_execution_start":
			return {
				...state,
				tools: {
					...state.tools,
					[action.toolCallId]: {
						toolCallId: action.toolCallId,
						name: action.toolName,
						args: action.args,
						status: "pending",
					},
				},
			};
		case "tool_execution_update": {
			const prev = state.tools[action.toolCallId];
			if (!prev) return state;
			return { ...state, tools: { ...state.tools, [action.toolCallId]: { ...prev, output: action.partialText } } };
		}
		case "tool_execution_end": {
			const prev = state.tools[action.toolResult.toolCallId];
			return {
				...state,
				tools: {
					...state.tools,
					[action.toolResult.toolCallId]: {
						toolCallId: action.toolResult.toolCallId,
						name: action.toolResult.toolName,
						args: prev?.args,
						status: action.toolResult.isError ? "error" : "success",
						result: action.toolResult,
					},
				},
			};
		}
		case "auto_retry_start":
			return {
				...state,
				retry: { attempt: action.attempt, maxAttempts: action.maxAttempts, delayMs: action.delayMs },
			};
		case "auto_retry_end":
			return {
				...state,
				retry: undefined,
				error: !action.success && action.finalError ? action.finalError : state.error,
			};
		case "compaction_start":
			return { ...state, compacting: true };
		case "compaction_end":
			return {
				...state,
				compacting: false,
				error: action.errorMessage && !action.aborted ? action.errorMessage : state.error,
			};
		case "error":
			return { ...state, error: action.message, streaming: false };
		default:
			return state;
	}
}
