import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { IconClose } from "@/components/icons";
import { useModalFocus } from "@/state/useModalFocus";

/** How far past the contain-fit you can zoom in (multiples of the fitted size). */
const MAX_ZOOM = 8;
/** Wheel sensitivity: scale multiplies by exp(-deltaY * this) so zoom feels uniform across speeds. */
const WHEEL_SENS = 0.0015;
/** Pointer travel (px) before a press counts as a pan rather than a click. */
const DRAG_SLOP = 3;
/** Fraction of the viewport kept as breathing room around the image at the initial fit (per side). */
const FIT_MARGIN = 0.06;

interface Transform {
	s: number; // absolute scale applied to the natural-size image
	x: number; // translate (px), with transform-origin at the image's top-left
	y: number;
}

/**
 * Full-screen image preview (lightbox). The image is laid out at its natural size and positioned purely by
 * a `translate()/scale()` transform with the origin at its top-left, which makes two things exact:
 *  - it opens "contained" (whole image visible, centered) regardless of aspect ratio — no clipped bottom;
 *  - the mouse wheel zooms about the cursor (the pixel under the pointer stays put) and you can drag to pan.
 * Click the dim backdrop or the ✕, or press Escape, to close; double-click re-fits. Rendered once at the App
 * root and driven by the ImageViewer context.
 */
export function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const natural = useRef({ w: 0, h: 0 });
	const fit = useRef(1); // contain-fit scale for the current image + viewport (the zoom floor)
	const [t, setT] = useState<Transform>({ s: 1, x: 0, y: 0 });
	const tRef = useRef(t);
	tRef.current = t;
	const drag = useRef<{ moved: boolean; onBackdrop: boolean; px: number; py: number; ox: number; oy: number } | null>(
		null,
	);

	useModalFocus(containerRef);

	// Keep the image fully on-screen: center it on whichever axis it's smaller than the viewport, and clamp
	// panning to the edges (no empty gutters) on whichever axis it overflows.
	const clamp = useCallback((s: number, x: number, y: number): Transform => {
		const c = containerRef.current;
		if (!c) return { s, x, y };
		const W = c.clientWidth;
		const H = c.clientHeight;
		const iw = natural.current.w * s;
		const ih = natural.current.h * s;
		const nx = iw <= W ? (W - iw) / 2 : Math.min(0, Math.max(W - iw, x));
		const ny = ih <= H ? (H - ih) / 2 : Math.min(0, Math.max(H - ih, y));
		return { s, x: nx, y: ny };
	}, []);

	const fitToScreen = useCallback(() => {
		const c = containerRef.current;
		if (!c || !natural.current.w) return;
		// Fit within an inset viewport so the image never touches the screen edges at the initial zoom.
		const availW = c.clientWidth * (1 - 2 * FIT_MARGIN);
		const availH = c.clientHeight * (1 - 2 * FIT_MARGIN);
		fit.current = Math.min(availW / natural.current.w, availH / natural.current.h);
		setT(clamp(fit.current, 0, 0));
	}, [clamp]);

	const onImgLoad = useCallback(() => {
		const img = imgRef.current;
		if (!img?.naturalWidth) return;
		natural.current = { w: img.naturalWidth, h: img.naturalHeight };
		fitToScreen();
	}, [fitToScreen]);

	// Re-fit when the source changes — including cache hits where onLoad may not fire.
	useLayoutEffect(() => {
		if (!src) return;
		const img = imgRef.current;
		if (img?.complete && img.naturalWidth) onImgLoad();
	}, [src, onImgLoad]);

	useEffect(() => {
		if (!src) return;
		const onResize = () => fitToScreen();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [src, fitToScreen]);

	useEffect(() => {
		if (!src) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [src, onClose]);

	// Wheel zoom anchored at the cursor. Native non-passive listener so preventDefault stops page scroll.
	useEffect(() => {
		const c = containerRef.current;
		if (!c || !src) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = c.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			setT((p) => {
				const s2 = Math.min(Math.max(p.s * Math.exp(-e.deltaY * WHEEL_SENS), fit.current), fit.current * MAX_ZOOM);
				const k = s2 / p.s;
				// Keep the content point under the cursor fixed: t' = cursor - (cursor - t) * (s'/s).
				return clamp(s2, cx - (cx - p.x) * k, cy - (cy - p.y) * k);
			});
		};
		c.addEventListener("wheel", onWheel, { passive: false });
		return () => c.removeEventListener("wheel", onWheel);
	}, [src, clamp]);

	const onPointerDown = useCallback((e: ReactPointerEvent) => {
		if (e.button !== 0) return;
		drag.current = {
			moved: false,
			onBackdrop: e.target === containerRef.current,
			px: e.clientX,
			py: e.clientY,
			ox: tRef.current.x,
			oy: tRef.current.y,
		};
	}, []);

	const onPointerMove = useCallback(
		(e: ReactPointerEvent) => {
			const d = drag.current;
			if (!d) return;
			const dx = e.clientX - d.px;
			const dy = e.clientY - d.py;
			if (!d.moved && Math.hypot(dx, dy) > DRAG_SLOP) d.moved = true;
			if (d.moved) setT((p) => clamp(p.s, d.ox + dx, d.oy + dy));
		},
		[clamp],
	);

	const onPointerUp = useCallback(() => {
		const d = drag.current;
		drag.current = null;
		// A click (no drag) on the dim backdrop dismisses; a click on the image is ignored so it can be
		// double-clicked to re-fit and dragged to pan without closing.
		if (d && !d.moved && d.onBackdrop) onClose();
	}, [onClose]);

	if (!src) return null;

	const pannable = t.s > fit.current + 1e-3;
	return (
		<div
			ref={containerRef}
			className="lightbox"
			role="dialog"
			aria-modal="true"
			aria-label="Image preview"
			tabIndex={-1}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			style={{ cursor: pannable ? "grab" : "zoom-out" }}
		>
			<img
				ref={imgRef}
				src={src}
				alt="Enlarged attachment"
				draggable={false}
				onLoad={onImgLoad}
				onDoubleClick={fitToScreen}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
					transformOrigin: "0 0",
					willChange: "transform",
					opacity: natural.current.w ? 1 : 0,
					cursor: pannable ? "grab" : "default",
				}}
			/>
			<button type="button" className="lightbox-close" onClick={onClose} aria-label="Close image preview">
				<IconClose />
			</button>
		</div>
	);
}
