import type { ImageAttachmentDto, IpcAgentEvent, IpcMessage, ToolSnapshotDto } from "@shared/ipc";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { type ChatState, chatReducer, initialChatState } from "@/state/chatReducer";

export interface SessionsState {
	/** One ChatState per live session id; events route here even when the session isn't focused. */
	slices: Record<string, ChatState>;
	activeId?: string;
	/** Session ids that produced new content while not focused (drives the sidebar "unread" dot). */
	unread: Record<string, true>;
}

export const emptySessionsState: SessionsState = { slices: {}, unread: {} };

export type Meta =
	| { type: "event"; sessionId: string; event: IpcAgentEvent }
	| { type: "setActive"; sessionId?: string }
	| { type: "load"; sessionId: string; messages: IpcMessage[]; tools: ToolSnapshotDto[] }
	| { type: "reset"; sessionId: string }
	| { type: "remove"; sessionId: string };

/** A content-bearing event marks a background session as "unread". Lifecycle-only events (agent_start, etc.)
 * don't, so merely opening a session in the background doesn't light the dot. */
function isContentEvent(e: IpcAgentEvent): boolean {
	return e.type.startsWith("message_") || e.type.startsWith("tool_");
}

export function metaReducer(state: SessionsState, action: Meta): SessionsState {
	switch (action.type) {
		case "setActive": {
			const unread = { ...state.unread };
			if (action.sessionId) delete unread[action.sessionId];
			const slices =
				action.sessionId && !state.slices[action.sessionId]
					? { ...state.slices, [action.sessionId]: initialChatState }
					: state.slices;
			return { ...state, activeId: action.sessionId, slices, unread };
		}
		case "load": {
			const prev = state.slices[action.sessionId] ?? initialChatState;
			const next = chatReducer(prev, { type: "_load", messages: action.messages, tools: action.tools });
			return { ...state, slices: { ...state.slices, [action.sessionId]: next } };
		}
		case "reset":
			return { ...state, slices: { ...state.slices, [action.sessionId]: initialChatState } };
		case "remove": {
			const slices = { ...state.slices };
			delete slices[action.sessionId];
			const unread = { ...state.unread };
			delete unread[action.sessionId];
			return { ...state, slices, unread };
		}
		case "event": {
			const prev = state.slices[action.sessionId] ?? initialChatState;
			const next = chatReducer(prev, action.event);
			if (next === prev) return state; // e.g. session_renamed is ignored by chatReducer
			const slices = { ...state.slices, [action.sessionId]: next };
			let unread = state.unread;
			if (action.sessionId !== state.activeId && isContentEvent(action.event) && !unread[action.sessionId]) {
				unread = { ...unread, [action.sessionId]: true };
			}
			return { ...state, slices, unread };
		}
	}
}

/**
 * Registry of per-session chat slices. A single `onEvent` subscription routes each `{sessionId, event}` to
 * its slice — even for background sessions — so switching the active view shows that session's current state.
 * `send`/`abort` target the active session. The pi-free renderer never imports pi types; it speaks only DTOs.
 */
export function useSessions() {
	const [state, dispatch] = useReducer(metaReducer, emptySessionsState);
	const activeRef = useRef<string | undefined>(undefined);
	activeRef.current = state.activeId;

	useEffect(() => window.pi.onEvent((w) => dispatch({ type: "event", sessionId: w.sessionId, event: w.event })), []);

	const loadTranscript = useCallback(async (id: string) => {
		const t = await window.pi.getTranscript(id);
		dispatch({ type: "load", sessionId: id, messages: t.messages, tools: t.tools });
	}, []);

	/** Focus a live session (by id): tell main, then resync its transcript (main is authoritative). */
	const setActive = useCallback(
		async (id?: string) => {
			dispatch({ type: "setActive", sessionId: id });
			await window.pi.setActive(id ?? null);
			if (id) await loadTranscript(id);
		},
		[loadTranscript],
	);

	/** Ensure an on-disk session is live, then focus it. */
	const openSession = useCallback(
		async (path: string) => {
			const id = await window.pi.openSession(path);
			await setActive(id);
			return id;
		},
		[setActive],
	);

	/** Start a fresh chat in a cwd and focus it. */
	const newChatInCwd = useCallback(
		async (cwd: string) => {
			const id = await window.pi.newChatInCwd(cwd);
			await setActive(id);
			return id;
		},
		[setActive],
	);

	const send = useCallback((text: string, images?: ImageAttachmentDto[]) => {
		const id = activeRef.current;
		if (!id) return;
		void window.pi.send(id, text, images);
	}, []);

	const abort = useCallback(() => {
		const id = activeRef.current;
		if (id) void window.pi.abort(id);
	}, []);

	const removeSlice = useCallback((id: string) => dispatch({ type: "remove", sessionId: id }), []);

	const activeState: ChatState = (state.activeId && state.slices[state.activeId]) || initialChatState;

	return {
		slices: state.slices,
		unread: state.unread,
		activeId: state.activeId,
		activeState,
		setActive,
		openSession,
		newChatInCwd,
		send,
		abort,
		loadTranscript,
		removeSlice,
	};
}
