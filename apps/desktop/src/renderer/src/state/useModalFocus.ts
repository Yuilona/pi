import { type RefObject, useEffect } from "react";

const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal focus management for an overlay whose container `ref` carries `tabIndex={-1}`:
 * - focuses the container on open (so no destructive button is pre-activated),
 * - traps Tab / Shift+Tab within the dialog's focusable elements,
 * - restores focus to the previously-focused element on close.
 *
 * Keyboard-only concern — mouse users are unaffected. The Tab handler runs on `document` in the capture
 * phase and stops propagation, so a trapped Tab can't also reach app-level shortcuts (e.g. the Shift+Tab
 * permission-mode cycle) behind the modal.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const prev = document.activeElement as HTMLElement | null;
		const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

		(root.hasAttribute("tabindex") ? root : (focusables()[0] ?? root)).focus();

		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const f = focusables();
			if (f.length === 0) return;
			// Shield app-level Tab/Shift+Tab shortcuts while the modal is open.
			e.stopPropagation();
			const first = f[0];
			const last = f[f.length - 1];
			const active = document.activeElement;
			if (!root.contains(active) || active === root) {
				e.preventDefault();
				(e.shiftKey ? last : first).focus();
			} else if (e.shiftKey && active === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			prev?.focus?.();
		};
	}, [ref]);
}
