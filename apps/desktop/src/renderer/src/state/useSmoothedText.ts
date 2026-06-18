import { useEffect, useRef, useState } from "react";

/**
 * Typewriter smoothing that decouples display speed from the (bursty) arrival speed.
 *
 * `target` is the full partial text, which grows as tokens arrive — unevenly, because the provider /
 * local proxy / network buffer SSE chunks and deliver them in clumps. Instead of painting each clump
 * the instant it lands, we reveal `target` at a near-CONSTANT velocity derived from how far behind we
 * are, integrated over real frame time. When `streaming` is false (a finished or restored message) the
 * full text is shown immediately.
 *
 * Why constant-velocity (and not the old `reveal 1/6 of the gap every 32ms`):
 *  - A proportional step makes velocity swing ~33x — thousands of cps right after a burst, then a
 *    ~90cps floor once caught up. The eye reads that swing as "fast then slow".
 *  - A fixed time gate freezes the display whenever the gap hits 0, so a brief upstream stall shows as
 *    a stop, then the next burst dumps a block. Reading `gap/HORIZON` every frame instead means the
 *    drain never waits on a clock: it keeps painting the already-received text at a steady rate, and the
 *    HORIZON look-ahead leaves a fraction of a second of reserve that transparently bridges short stalls.
 *
 * Velocity = clamp(gap / HORIZON, MIN_CPS, MAX_CPS): at normal arrival rates the display trails the
 * stream by ~HORIZON seconds of text (the reserve), so 100–300ms upstream stalls are painted through
 * instead of freezing; genuine bursts fan out over ~HORIZON instead of being dumped. Paint is capped to
 * ~30fps so the (expensive) markdown re-parse rate doesn't regress.
 */
const HORIZON_S = 0.5; // drain the current backlog over ~half a second (also the reserve depth)
const MIN_CPS = 60; // floor: a tiny trickle still finishes promptly, never crawls
const MAX_CPS = 240; // ceiling: a big burst spreads out instead of dumping as a block
const MAX_DT_MS = 48; // clamp per-frame dt so a backgrounded tab resuming can't mega-dump
const PAINT_MS = 33; // ~30fps paint cap → bounds markdown re-parse rate (velocity stays continuous)

export function useSmoothedText(target: string, streaming: boolean): string {
	const [shown, setShown] = useState(target);
	const targetRef = useRef(target);
	targetRef.current = target;
	const lenRef = useRef(target.length);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		if (!streaming) {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lenRef.current = targetRef.current.length;
			setShown(targetRef.current);
			return;
		}

		let last = 0; // timestamp of the previous frame (0 = first frame, no dt yet)
		let lastPaint = 0; // timestamp of the previous setShown
		let acc = 0; // fractional-character accumulator (carries sub-character progress across frames)

		const tick = (now: number) => {
			const dt = last === 0 ? 0 : Math.min(now - last, MAX_DT_MS);
			last = now;
			const full = targetRef.current;
			if (lenRef.current > full.length) {
				// Target shrank (new/replaced message) — never slice past the end, drop stale debt.
				lenRef.current = full.length;
				acc = 0;
			}
			const gap = full.length - lenRef.current;
			if (gap > 0) {
				const cps = Math.min(Math.max(gap / HORIZON_S, MIN_CPS), MAX_CPS);
				acc += (cps * dt) / 1000;
				// Paint at most ~30fps, but accumulate every frame so velocity stays smooth and constant.
				if (acc >= 1 && now - lastPaint >= PAINT_MS) {
					const advance = Math.min(Math.floor(acc), gap);
					acc -= advance;
					lenRef.current += advance;
					lastPaint = now;
					setShown(full.slice(0, lenRef.current));
				}
			} else {
				acc = 0; // caught up: idle (don't re-render/re-parse while there's nothing new)
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		};
	}, [streaming]);

	// When NOT streaming, return the live `target` directly rather than the internal `shown` state. `shown`
	// is only re-synced inside the effect above (gated on `[streaming]`), so a component instance REUSED
	// across a session switch — same React key `h1/h2…` for both sessions' messages — would keep showing the
	// previous session's text when its `target` prop changes without `streaming` toggling. Returning `target`
	// makes finished/restored messages always reflect their own text; smoothing applies only while streaming.
	return streaming ? shown : target;
}
