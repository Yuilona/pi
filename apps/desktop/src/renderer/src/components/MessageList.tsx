import type { IpcMessage } from "@shared/ipc";
import { useEffect, useRef } from "react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { UserBubble } from "@/components/UserBubble";
import type { ChatState } from "@/state/chatReducer";

/** Whether a message has anything the user can actually see yet (drives when "Thinking…" can hide). */
function hasVisibleContent(m: IpcMessage): boolean {
	return m.content.some(
		(b) =>
			(b.kind === "text" && b.text.trim() !== "") ||
			(b.kind === "thinking" && b.text.trim() !== "") ||
			b.kind === "toolCall",
	);
}

function Working() {
	return (
		<div className="working">
			<span className="dots">
				<i />
				<i />
				<i />
			</span>
			<span>Thinking…</span>
		</div>
	);
}

export function MessageList({ state }: { state: ChatState }) {
	const endRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any transcript/stream change
	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: state.streaming ? "auto" : "smooth", block: "end" });
	}, [state.messages, state.streaming, state.tools]);

	// While streaming, follow the smoothed reveal (content grows between token updates) — but only when the
	// user is already near the bottom, so scrolling up to read isn't fought.
	useEffect(() => {
		if (!state.streaming) return;
		const id = window.setInterval(() => {
			const end = endRef.current;
			const sc = end?.closest<HTMLElement>(".scroll");
			if (!end || !sc) return;
			if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120) end.scrollIntoView({ block: "end" });
		}, 90);
		return () => window.clearInterval(id);
	}, [state.streaming]);

	const last = state.messages[state.messages.length - 1];
	// Keep "Thinking…" until there's visible content — a reasoning model's assistant message can arrive
	// before any text/summary (e.g. an empty reasoning summary), which would otherwise leave a blank gap.
	const awaitingFirstToken = state.streaming && (!last || last.role === "user" || !hasVisibleContent(last));

	return (
		<div className="content thread">
			{state.messages.map((m) =>
				m.role === "user" ? (
					<UserBubble key={m.id} message={m} />
				) : (
					<AssistantBubble
						key={m.id}
						message={m}
						tools={state.tools}
						streaming={state.streaming && m.id === last?.id}
					/>
				),
			)}
			{awaitingFirstToken && <Working />}
			{state.error && <div className="banner banner-error selectable">{state.error}</div>}
			{state.retry && (
				<div className="banner banner-retry">
					Retrying… attempt {state.retry.attempt}/{state.retry.maxAttempts}
				</div>
			)}
			{state.compacting && <div className="banner banner-info">Compacting context…</div>}
			<div ref={endRef} />
		</div>
	);
}
