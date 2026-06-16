import type { ImageAttachmentDto } from "@shared/ipc";
import { useCallback, useEffect, useReducer } from "react";
import { chatReducer, initialChatState } from "@/state/chatReducer";

export function useAgent() {
	const [state, dispatch] = useReducer(chatReducer, initialChatState);

	useEffect(() => window.pi.onEvent((e) => dispatch(e)), []);

	const send = useCallback((text: string, images?: ImageAttachmentDto[]) => {
		void window.pi.send(text, images);
	}, []);

	const abort = useCallback(() => {
		void window.pi.abort();
	}, []);

	const reset = useCallback(async () => {
		await window.pi.newSession();
		dispatch({ type: "_reset" });
	}, []);

	const loadTranscript = useCallback(async () => {
		const t = await window.pi.getTranscript();
		dispatch({ type: "_load", messages: t.messages, tools: t.tools });
	}, []);

	return { state, send, abort, reset, loadTranscript };
}
