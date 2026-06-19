import type { IpcMessage } from "@shared/ipc";
import { memo, useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { IconEdit } from "@/components/icons";
import { SkillInvocation } from "@/components/SkillCard";
import { parseSkillInvocation } from "@/components/toolText";
import { useImageViewer } from "@/state/imageViewer";

export const UserBubble = memo(function UserBubble({
	message,
	editable = false,
	onSubmitEdit,
}: {
	message: IpcMessage;
	/** True only for the last user message when the session is idle — gates the edit affordance. */
	editable?: boolean;
	/** Commit an edit: rewind the session to before this message and resend the new text. */
	onSubmitEdit?: (text: string) => void;
}) {
	const openImage = useImageViewer();
	const text = message.content
		.filter((b) => b.kind === "text")
		.map((b) => (b as { text: string }).text)
		.join("\n");
	const images = message.content.filter((b) => b.kind === "image") as Array<{ dataUrl: string }>;
	// Editing restores the original text into an in-place editor; image attachments can't be reconstructed
	// there yet (C3), so a message with images is copy-only.
	const canEdit = editable && images.length === 0 && Boolean(onSubmitEdit);

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const taRef = useRef<HTMLTextAreaElement>(null);
	const editBtnRef = useRef<HTMLButtonElement>(null);
	// Was the editor open last render? Used to restore focus to the trigger only on a true open→close transition.
	const wasEditing = useRef(false);

	// Leave edit mode if this message stops being the editable one (a new turn started, streaming began…).
	useEffect(() => {
		if (!canEdit) setEditing(false);
	}, [canEdit]);

	// Restore focus to the "Edit and resend" trigger when the in-place editor closes, so keyboard focus
	// isn't dropped to the document body after Esc/Cancel/save.
	useEffect(() => {
		if (wasEditing.current && !editing) editBtnRef.current?.focus();
		wasEditing.current = editing;
	}, [editing]);

	// Grow the editor to fit its content, capped at half the viewport — beyond that it scrolls internally,
	// so even a very long message stays comfortable to read and edit in place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure as the draft text changes
	useEffect(() => {
		if (!editing) return;
		const el = taRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
	}, [editing, draft]);

	const openEditor = () => {
		setDraft(text);
		setEditing(true);
	};
	const save = () => {
		const t = draft.trim();
		if (!t) return;
		onSubmitEdit?.(t);
		setEditing(false);
	};

	// In-place editor: replaces the bubble at its original position with a roomy, scrollable edit field.
	if (editing) {
		return (
			<div className="row user">
				<div className="bubble-edit">
					<textarea
						ref={taRef}
						className="bubble-edit-area selectable"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								setEditing(false);
							} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								save();
							}
						}}
						// biome-ignore lint/a11y/noAutofocus: focus the field as the editor opens
						autoFocus
					/>
					<div className="bubble-edit-actions">
						<span className="bubble-edit-hint">Esc to cancel · ⌘/Ctrl+Enter to save</span>
						<button type="button" className="btn btn-ghost bubble-edit-btn" onClick={() => setEditing(false)}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-brand bubble-edit-btn"
							disabled={!draft.trim()}
							onClick={save}
						>
							Save & send
						</button>
					</div>
				</div>
			</div>
		);
	}

	// A sent `/skill:…` command reaches us as an expanded skill block; render it as the same collapsed,
	// animated skill card (not the raw block text), with any real trailing prompt shown as a normal bubble.
	const invocation = images.length === 0 ? parseSkillInvocation(text) : null;
	if (invocation) {
		return (
			<>
				<div className="row assistant">
					<div className="assistant-body">
						<SkillInvocation name={invocation.name} content={invocation.content} />
					</div>
				</div>
				{invocation.userMessage && (
					<div className="row user">
						<div className="bubble-user selectable">{invocation.userMessage}</div>
					</div>
				)}
			</>
		);
	}

	return (
		<div className="row user">
			{images.length > 0 && (
				<div className="bubble-images">
					{images.map((img) => (
						<button
							type="button"
							className="bubble-img"
							key={img.dataUrl.slice(0, 48)}
							onClick={() => openImage(img.dataUrl)}
							aria-label="View image full size"
						>
							<img src={img.dataUrl} alt="attachment" />
						</button>
					))}
				</div>
			)}
			{text && <div className="bubble-user selectable">{text}</div>}
			{(text || canEdit) && (
				<div className="msg-actions">
					{text && <CopyButton getText={() => text} label="Copy message" />}
					{canEdit && (
						<button
							ref={editBtnRef}
							type="button"
							className="icon-btn msg-act"
							onClick={openEditor}
							aria-label="Edit and resend"
							title="Edit and resend"
						>
							<IconEdit />
						</button>
					)}
				</div>
			)}
		</div>
	);
});
