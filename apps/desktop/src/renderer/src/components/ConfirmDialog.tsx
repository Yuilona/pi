import { useEffect } from "react";

interface ConfirmDialogProps {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Style the confirm button as a destructive (red) action. */
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

/** A small modal confirmation, styled like the tool-approval dialog. Enter confirms, Esc / backdrop cancels. */
export function ConfirmDialog({
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") onConfirm();
			else if (e.key === "Escape") onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onConfirm, onCancel]);

	return (
		<>
			<button type="button" className="approval-backdrop" aria-label={cancelLabel} onClick={onCancel} />
			<div className="approval">
				<div className="approval-card">
					<div className="approval-title">{title}</div>
					{message && <div className="approval-tool">{message}</div>}
					<div className="approval-actions">
						<div className="approval-spacer" />
						<button type="button" className="btn btn-sand" onClick={onCancel}>
							{cancelLabel} <span className="kbd-hint">Esc</span>
						</button>
						<button type="button" className={`btn ${danger ? "btn-danger" : "btn-brand"}`} onClick={onConfirm}>
							{confirmLabel} <span className="kbd-hint">Enter</span>
						</button>
					</div>
				</div>
			</div>
		</>
	);
}
