import type { PermissionMode } from "@shared/ipc";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { IconArrowUp, IconStop } from "@/components/icons";

const MODE_LABEL: Record<PermissionMode, string> = {
	ask: "Ask every time",
	acceptEdits: "Auto-accept edits",
	yolo: "Auto-run all",
	readonly: "Read-only",
};

interface ComposerProps {
	value: string;
	onChange: (v: string) => void;
	onSubmit: () => void;
	streaming?: boolean;
	onStop?: () => void;
	placeholder?: string;
	mode?: PermissionMode;
	onCycleMode?: () => void;
}

export function Composer({
	value,
	onChange,
	onSubmit,
	streaming,
	onStop,
	placeholder,
	mode,
	onCycleMode,
}: ComposerProps) {
	const ref = useRef<HTMLTextAreaElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure textarea height whenever the text changes
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
	}, [value]);

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Tab" && e.shiftKey) {
			e.preventDefault();
			onCycleMode?.();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			if (!streaming && value.trim()) onSubmit();
		}
	};

	const canSend = !streaming && value.trim().length > 0;

	return (
		<div className="composer-wrap">
			<div className="content">
				{mode && (
					<div className="mode-row">
						<button
							type="button"
							className={`mode-pill mode-${mode}`}
							onClick={onCycleMode}
							title="Cycle permission mode (Shift+Tab)"
						>
							<span className="mode-dot" />
							{MODE_LABEL[mode]}
							<span className="mode-cyc">⇧⇥</span>
						</button>
					</div>
				)}
				<div className="composer">
					<textarea
						ref={ref}
						value={value}
						rows={1}
						placeholder={placeholder ?? "Message pi…"}
						onChange={(e) => onChange(e.target.value)}
						onKeyDown={onKeyDown}
						// biome-ignore lint/a11y/noAutofocus: primary input of the app
						autoFocus
					/>
					{streaming ? (
						<button type="button" className="send" onClick={onStop} title="Stop">
							<IconStop />
						</button>
					) : (
						<button type="button" className="send" disabled={!canSend} onClick={onSubmit} title="Send (Enter)">
							<IconArrowUp />
						</button>
					)}
				</div>
				<div className="composer-hint">
					<span>
						<kbd>Enter</kbd> to send
					</span>
					<span>
						<kbd>Shift</kbd>+<kbd>Enter</kbd> for newline
					</span>
				</div>
			</div>
		</div>
	);
}
