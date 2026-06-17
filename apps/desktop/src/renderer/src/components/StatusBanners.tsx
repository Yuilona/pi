import type { ChatState } from "@/state/chatReducer";

/**
 * Transient status banners (error / retry / compaction). Rendered both inside the message thread AND in the
 * empty state, so a failure on the very first send — when no message bubble exists yet — is still visible
 * instead of vanishing with the (unmounted) message list.
 */
export function StatusBanners({ state }: { state: ChatState }) {
	return (
		<>
			{state.error && <div className="banner banner-error selectable">{state.error}</div>}
			{state.retry && (
				<div className="banner banner-retry">
					Retrying… attempt {state.retry.attempt}/{state.retry.maxAttempts}
				</div>
			)}
			{state.compacting && <div className="banner banner-info">Compacting context…</div>}
		</>
	);
}
