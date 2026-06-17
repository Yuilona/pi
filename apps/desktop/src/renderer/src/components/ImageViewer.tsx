import { useEffect } from "react";

/** Full-screen image preview (lightbox). Click anywhere or press Escape to dismiss. Rendered once at the App
 * root and driven by the ImageViewer context. */
export function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
	useEffect(() => {
		if (!src) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [src, onClose]);

	if (!src) return null;
	return (
		<button type="button" className="lightbox" onClick={onClose} aria-label="Close image preview">
			<img src={src} alt="Enlarged attachment" />
		</button>
	);
}
