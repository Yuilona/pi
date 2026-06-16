import { useEffect, useRef } from "react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { UserBubble } from "@/components/UserBubble";
import type { ChatState } from "@/state/chatReducer";

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
		endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [state.messages, state.streaming, state.tools]);

	const last = state.messages[state.messages.length - 1];
	const awaitingFirstToken = state.streaming && (!last || last.role === "user");

	return (
		<div className="content thread">
			{state.messages.map((m) =>
				m.role === "user" ? (
					<UserBubble key={m.id} message={m} />
				) : (
					<AssistantBubble key={m.id} message={m} tools={state.tools} />
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
