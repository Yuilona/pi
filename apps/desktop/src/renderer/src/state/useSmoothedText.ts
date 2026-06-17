import { useEffect, useRef, useState } from "react";

/**
 * Typewriter smoothing that decouples display speed from the (bursty) arrival speed.
 *
 * `target` is the full partial text, which grows as tokens arrive — unevenly, because the provider /
 * local proxy / network buffer SSE chunks and deliver them in bursts. Instead of painting each burst
 * the instant it lands, we reveal `target` a little at a time on a ~30fps cadence, catching up
 * proportionally so a big dump fans out smoothly but the display never lags far behind. When
 * `streaming` is false (a finished or restored message) the full text is shown immediately.
 *
 * The fixed reveal interval also bounds how often the (expensive) markdown re-parse runs.
 */
export function useSmoothedText(target: string, streaming: boolean): string {
	const [shown, setShown] = useState(target);
	const targetRef = useRef(target);
	targetRef.current = target;
	const lenRef = useRef(target.length);
	const rafRef = useRef<number | null>(null);
	const lastRef = useRef(0);

	useEffect(() => {
		if (!streaming) {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lenRef.current = targetRef.current.length;
			setShown(targetRef.current);
			return;
		}

		const INTERVAL = 32; // ms between reveals (~30fps): smooth, and caps the markdown re-parse rate
		const tick = (now: number) => {
			const full = targetRef.current;
			if (lenRef.current > full.length) lenRef.current = full.length; // target reset (new message)
			const gap = full.length - lenRef.current;
			if (gap > 0 && now - lastRef.current >= INTERVAL) {
				lastRef.current = now;
				// Reveal ~1/6 of what's outstanding (min a few chars) so bursts catch up fast yet smoothly.
				const step = Math.max(3, Math.ceil(gap / 6));
				lenRef.current = Math.min(full.length, lenRef.current + step);
				setShown(full.slice(0, lenRef.current));
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		};
	}, [streaming]);

	return shown;
}
