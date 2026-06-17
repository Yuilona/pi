import type { IpcMessage } from "@shared/ipc";
import { useEffect, useRef } from "react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { UserBubble } from "@/components/UserBubble";
import type { ChatState } from "@/state/chatReducer";
import { useView } from "@/state/viewPrefs";

/** Whether a message has anything the user can actually see yet (drives when "Thinking…" can hide).
 * Thinking text only counts when thinking display is ON — with it off, ThinkingBlock renders nothing, so a
 * reasoning model that streams thinking before any text must keep "Thinking…" up rather than flash a blank
 * bubble (counting hidden thinking as "visible" reintroduces exactly the gap this indicator removes). */
function hasVisibleContent(m: IpcMessage, showThinking: boolean): boolean {
	return m.content.some(
		(b) =>
			(b.kind === "text" && b.text.trim() !== "") ||
			(showThinking && b.kind === "thinking" && b.text.trim() !== "") ||
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
	const prevCount = useRef(0);
	const { showThinking } = useView();

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any transcript/stream change
	useEffect(() => {
		const end = endRef.current;
		if (!end) return;
		const grew = state.messages.length > prevCount.current;
		prevCount.current = state.messages.length;
		const justSent = grew && state.messages[state.messages.length - 1]?.role === "user";
		// During a stream, follow the growing reply ONLY when the reader is already near the bottom — don't
		// yank back someone who scrolled up to re-read. A message the user just sent (always worth showing) or
		// a non-streaming transcript load still scrolls into view. The rAF effect below uses the same
		// near-bottom test to follow the typewriter reveal that happens between dispatches.
		if (state.streaming && !justSent) {
			const sc = end.closest<HTMLElement>(".scroll");
			if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight >= 120) return;
		}
		end.scrollIntoView({ behavior: state.streaming ? "auto" : "smooth", block: "end" });
	}, [state.messages, state.streaming, state.tools]);

	// While streaming, follow the smoothed reveal (content grows between message updates via the typewriter,
	// without a new dispatch) — but only when the user is already near the bottom, so scrolling up to read
	// isn't fought. Driven by rAF (throttled to ~90ms) rather than a free-running timer, so scrollIntoView
	// coincides with a paint frame instead of firing mid-markdown-parse and thrashing layout.
	useEffect(() => {
		if (!state.streaming) return;
		let raf = 0;
		let lastCheck = 0;
		const loop = (now: number) => {
			if (now - lastCheck >= 90) {
				lastCheck = now;
				const end = endRef.current;
				const sc = end?.closest<HTMLElement>(".scroll");
				if (end && sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120) {
					end.scrollIntoView({ block: "end" });
				}
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [state.streaming]);

	const last = state.messages[state.messages.length - 1];
	// Keep "Thinking…" until there's visible content — a reasoning model's assistant message can arrive
	// before any text/summary (e.g. an empty reasoning summary), which would otherwise leave a blank gap.
	const awaitingFirstToken =
		state.streaming && (!last || last.role === "user" || !hasVisibleContent(last, showThinking));

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
