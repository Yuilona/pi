import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@/components/icons";

/**
 * A small copy-to-clipboard button used for whole messages and individual code blocks. `getText` is a lazy
 * getter so the (possibly large) text is only materialized on click, not on every render. On success the
 * icon swaps to a check for a beat; clipboard rejection (focus/permission) is swallowed — copy is
 * best-effort and never throws into the render tree.
 */
export function CopyButton({
	getText,
	label,
	className = "",
}: {
	getText: () => string;
	label: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => () => clearTimer(timer), []);

	const onClick = async () => {
		try {
			await navigator.clipboard.writeText(getText());
			setCopied(true);
			clearTimer(timer);
			timer.current = setTimeout(() => setCopied(false), 1200);
		} catch {
			// Best-effort: clipboard can reject on focus/permission. Stay silent.
		}
	};

	return (
		<button
			type="button"
			className={`icon-btn msg-act ${copied ? "is-copied" : ""} ${className}`.trim()}
			onClick={onClick}
			aria-label={copied ? "Copied" : label}
			title={label}
		>
			{copied ? <IconCheck /> : <IconCopy />}
		</button>
	);
}

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) {
	if (ref.current) {
		clearTimeout(ref.current);
		ref.current = null;
	}
}
