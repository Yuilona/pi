import { type SVGProps, useId } from "react";

/**
 * The pi brand mark: a refined serif-flavored π in the brand's warm terracotta→coral gradient.
 * Replaces the plain red dot. Used in the titlebar wordmark, the hero tile, and the setup gate.
 */
export function Logo({ size = 24, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
	// useId() can contain ":" which breaks url(#…) references in SVG, so strip it.
	const gid = `pi-mark-${useId().replace(/:/g, "")}`;
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
			<defs>
				<linearGradient id={gid} x1="5" y1="6" x2="19" y2="18" gradientUnits="userSpaceOnUse">
					<stop offset="0%" style={{ stopColor: "var(--brand)" }} />
					<stop offset="100%" style={{ stopColor: "var(--brand-coral)" }} />
				</linearGradient>
			</defs>
			<g stroke={`url(#${gid})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
				{/* top bar */}
				<path d="M6 8h12" />
				{/* left leg */}
				<path d="M8.3 8v9.6" />
				{/* right leg with a small calligraphic foot */}
				<path d="M15.7 8v7.8q0 1.8 1.8 1.8" />
			</g>
		</svg>
	);
}
