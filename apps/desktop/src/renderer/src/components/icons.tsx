import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
	width: 16,
	height: 16,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.7,
	strokeLinecap: "round",
	strokeLinejoin: "round",
};

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
	</svg>
);

export const IconSun = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	</svg>
);

export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
	</svg>
);

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
	</svg>
);

export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<path d="M12 19V5M5 12l7-7 7 7" />
	</svg>
);

export const IconMin = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M5 12h14" />
	</svg>
);

export const IconMax = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={13} height={13} {...p} aria-hidden="true">
		<rect x="5" y="5" width="14" height="14" rx="2" />
	</svg>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M6 6l12 12M18 6L6 18" />
	</svg>
);

export const IconSidebar = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M9 4v16" />
	</svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<path d="M12 5v14M5 12h14" />
	</svg>
);

export const IconStop = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} {...p} aria-hidden="true">
		<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
	</svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M4 12l5 5L20 6" />
	</svg>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M6 6l12 12M18 6L6 18" />
	</svg>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M9 6l6 6-6 6" />
	</svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={15} height={15} {...p} aria-hidden="true">
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.3-4.3" />
	</svg>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={15} height={15} {...p} aria-hidden="true">
		<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
	</svg>
);

export const IconTool = (p: SVGProps<SVGSVGElement>) => (
	<svg {...base} width={14} height={14} {...p} aria-hidden="true">
		<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3Z" />
	</svg>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
	<svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" {...p} aria-hidden="true">
		<path d="M12 2.4c.45 4 2.1 5.65 6.1 6.1-4 .45-5.65 2.1-6.1 6.1-.45-4-2.1-5.65-6.1-6.1 4-.45 5.65-2.1 6.1-6.1Z" />
		<path d="M18.6 13.4c.22 1.9 1.1 2.78 3 3-1.9.22-2.78 1.1-3 3-.22-1.9-1.1-2.78-3-3 1.9-.22 2.78-1.1 3-3Z" />
	</svg>
);
