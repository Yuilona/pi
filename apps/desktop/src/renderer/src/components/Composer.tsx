import type { CommandDto, PermissionMode } from "@shared/ipc";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconArrowUp, IconStop } from "@/components/icons";

const MODE_LABEL: Record<PermissionMode, string> = {
	ask: "Ask every time",
	acceptEdits: "Auto-accept edits",
	yolo: "Auto-run all",
	readonly: "Read-only",
};

const KIND_LABEL: Record<CommandDto["kind"], string> = {
	builtin: "app",
	prompt: "prompt",
	skill: "skill",
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
	commands?: CommandDto[];
	/** Run a builtin command (settings/new/…); prompt & skill commands are inserted into the input instead. */
	onRunCommand?: (cmd: CommandDto) => void;
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
	commands,
	onRunCommand,
}: ComposerProps) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const selRef = useRef<HTMLButtonElement>(null);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState(false);

	// The "/" menu shows while the input is a single slash-token (no space yet): "/", "/mod", "/skill:tr"…
	const slash = value.match(/^\/(\S*)$/);
	const query = slash ? slash[1].toLowerCase() : null;
	const matches = query !== null ? (commands ?? []).filter((c) => c.name.toLowerCase().startsWith(query)) : [];
	const menuOpen = query !== null && !dismissed && matches.length > 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure textarea height whenever the text changes
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
	}, [value]);

	// Reset the menu selection/dismissal as the typed command changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the live slash query
	useEffect(() => {
		setSelected(0);
		setDismissed(false);
	}, [value]);

	useEffect(() => {
		if (menuOpen) selRef.current?.scrollIntoView({ block: "nearest" });
	}, [menuOpen]);

	const accept = (cmd: CommandDto | undefined) => {
		if (!cmd) return;
		if (cmd.kind === "builtin") {
			onRunCommand?.(cmd);
			return;
		}
		// prompt / skill: drop in "/name " so the user can add arguments, then Enter to send.
		onChange(`/${cmd.name} `);
		ref.current?.focus();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (menuOpen) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelected((i) => (i + 1) % matches.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelected((i) => (i - 1 + matches.length) % matches.length);
				return;
			}
			if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				accept(matches[selected]);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setDismissed(true);
				return;
			}
		}
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
				<div className="composer-anchor">
					{menuOpen && (
						<div className="cmd-menu" role="listbox">
							<div className="cmd-menu-head">Commands</div>
							{matches.map((cmd, i) => (
								<button
									key={`${cmd.kind}:${cmd.name}`}
									ref={i === selected ? selRef : undefined}
									type="button"
									role="option"
									aria-selected={i === selected}
									className={`cmd-item ${i === selected ? "sel" : ""}`}
									onMouseEnter={() => setSelected(i)}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => accept(cmd)}
								>
									<span className="cmd-name">/{cmd.name}</span>
									<span className="cmd-desc">{cmd.description}</span>
									<span className={`cmd-kind cmd-kind-${cmd.kind}`}>{KIND_LABEL[cmd.kind]}</span>
								</button>
							))}
						</div>
					)}
					<div className="composer">
						<textarea
							ref={ref}
							value={value}
							rows={1}
							placeholder={placeholder ?? "Message pi…  (type / for commands)"}
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
				</div>
				<div className="composer-hint">
					<span>
						<kbd>Enter</kbd> to send
					</span>
					<span>
						<kbd>Shift</kbd>+<kbd>Enter</kbd> for newline
					</span>
					<span>
						<kbd>/</kbd> for commands
					</span>
				</div>
			</div>
		</div>
	);
}
