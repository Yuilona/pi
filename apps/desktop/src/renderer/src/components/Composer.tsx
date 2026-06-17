import type { CommandDto, ImageAttachmentDto, ModelInfoDto, PermissionMode, UsageDto } from "@shared/ipc";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconArrowUp, IconChevron, IconImage, IconStop, IconX } from "@/components/icons";

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

/** Read an image File into the base64 ImageAttachmentDto pi wants (no data: prefix). */
function fileToAttachment(file: File): Promise<ImageAttachmentDto | null> {
	return new Promise((resolve) => {
		if (!file.type.startsWith("image/")) {
			resolve(null);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result);
			const comma = result.indexOf(",");
			resolve({ data: comma >= 0 ? result.slice(comma + 1) : result, mimeType: file.type });
		};
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

function fmtTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
	return String(n);
}

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
	onRunCommand?: (cmd: CommandDto) => void;
	attachments?: ImageAttachmentDto[];
	onAddImages?: (imgs: ImageAttachmentDto[]) => void;
	onRemoveImage?: (index: number) => void;
	models?: ModelInfoDto[];
	model?: ModelInfoDto;
	onPickModel?: (provider: string, id: string) => void;
	usage?: UsageDto;
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
	attachments,
	onAddImages,
	onRemoveImage,
	models,
	model,
	onPickModel,
	usage,
}: ComposerProps) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const selRef = useRef<HTMLButtonElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const pickRef = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [modelMenu, setModelMenu] = useState(false);

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

	// Close the model dropdown on an outside click or Escape.
	useEffect(() => {
		if (!modelMenu) return;
		const onDown = (e: MouseEvent) => {
			if (!pickRef.current?.contains(e.target as Node)) setModelMenu(false);
		};
		const onEsc = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") setModelMenu(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onEsc);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onEsc);
		};
	}, [modelMenu]);

	const accept = (cmd: CommandDto | undefined) => {
		if (!cmd) return;
		if (cmd.kind === "builtin") {
			onRunCommand?.(cmd);
			return;
		}
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
			if (!streaming) onSubmit();
		}
	};

	const ingest = async (files: FileList | File[]) => {
		const dtos = (await Promise.all(Array.from(files).map(fileToAttachment))).filter(
			(x): x is ImageAttachmentDto => x !== null,
		);
		if (dtos.length) onAddImages?.(dtos);
	};

	const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.clipboardData?.items ?? [])
			.filter((it) => it.type.startsWith("image/"))
			.map((it) => it.getAsFile())
			.filter((f): f is File => f !== null);
		if (files.length) {
			e.preventDefault();
			void ingest(files);
		}
	};

	const hasAttachments = (attachments?.length ?? 0) > 0;
	const canSend = !streaming && (value.trim().length > 0 || hasAttachments);

	return (
		<div className="composer-wrap">
			<div className="content">
				<div className="composer-bar">
					{mode && (
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
					)}
					{model && (
						<div className="model-pick" ref={pickRef}>
							<button
								type="button"
								className="model-pill"
								onClick={() => setModelMenu((v) => !v)}
								title="Switch model"
							>
								<span className="model-pill-name">{model.label || model.id}</span>
								<IconChevron className={`mp-chev ${modelMenu ? "open" : ""}`} />
							</button>
							{modelMenu && (
								<div className="model-menu" role="listbox">
									<div className="cmd-menu-head">Model</div>
									{(models ?? []).map((m) => (
										<button
											key={`${m.provider}/${m.id}`}
											type="button"
											className={`model-opt ${m.provider === model.provider && m.id === model.id ? "on" : ""}`}
											onMouseDown={(e) => e.preventDefault()}
											onClick={() => {
												onPickModel?.(m.provider, m.id);
												setModelMenu(false);
											}}
										>
											<span className="mo-id">{m.id}</span>
											<span className="mo-prov">{m.provider}</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}
					<div className="bar-spacer" />
					{usage && usage.total > 0 && (
						<div
							className="usage"
							title={`in ${usage.input} · out ${usage.output} · cache ${usage.cacheRead}${usage.cost > 0 ? ` · $${usage.cost.toFixed(4)}` : ""}`}
						>
							{usage.contextPercent != null && <span>{Math.round(usage.contextPercent)}% ctx</span>}
							<span>
								↑{fmtTokens(usage.input)} ↓{fmtTokens(usage.output)}
							</span>
							{usage.cost > 0 && <span>${usage.cost.toFixed(3)}</span>}
						</div>
					)}
				</div>

				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone for image attachments */}
				<div
					className={`composer-anchor ${dragging ? "dragging" : ""}`}
					onDragOver={(e) => {
						if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
							e.preventDefault();
							setDragging(true);
						}
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragging(false);
						if (e.dataTransfer?.files?.length) void ingest(e.dataTransfer.files);
					}}
				>
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

					{hasAttachments && (
						<div className="attach-row">
							{(attachments ?? []).map((a, i) => (
								<div className="attach" key={a.data.slice(0, 32)}>
									<img src={`data:${a.mimeType};base64,${a.data}`} alt="attachment" />
									<button
										type="button"
										className="attach-x"
										onClick={() => onRemoveImage?.(i)}
										title="Remove"
										aria-label="Remove image"
									>
										<IconX />
									</button>
								</div>
							))}
						</div>
					)}

					<div className="composer">
						<button
							type="button"
							className="attach-btn"
							onClick={() => fileRef.current?.click()}
							title="Attach image"
							aria-label="Attach image"
						>
							<IconImage />
						</button>
						<input
							ref={fileRef}
							type="file"
							accept="image/*"
							multiple
							hidden
							onChange={(e) => {
								if (e.target.files) void ingest(e.target.files);
								e.target.value = "";
							}}
						/>
						<textarea
							ref={ref}
							value={value}
							rows={1}
							placeholder={placeholder ?? "Message pi…  (type / for commands)"}
							onChange={(e) => onChange(e.target.value)}
							onKeyDown={onKeyDown}
							onPaste={onPaste}
							// biome-ignore lint/a11y/noAutofocus: primary input of the app
							autoFocus
						/>
						{streaming ? (
							<button type="button" className="send" onClick={onStop} title="Stop" aria-label="Stop generating">
								<IconStop />
							</button>
						) : (
							<button
								type="button"
								className="send"
								disabled={!canSend}
								onClick={onSubmit}
								title="Send (Enter)"
								aria-label="Send message"
							>
								<IconArrowUp />
							</button>
						)}
					</div>

					{dragging && <div className="drop-hint">Drop images to attach</div>}
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
