import { useState } from "react";
import { IconChevron } from "@/components/icons";
import { useView } from "@/state/viewPrefs";

export function ThinkingBlock({ text, redacted }: { text: string; redacted?: boolean }) {
	const { showThinking } = useView();
	// Expanded by default when "show thinking" is on; collapsible per-block via override.
	const [override, setOverride] = useState<boolean | null>(null);
	if (!showThinking) return null;
	const open = override ?? true;
	return (
		<div className={`thinking ${open ? "open" : ""}`}>
			<button type="button" className="thinking-toggle" onClick={() => setOverride(!open)}>
				<IconChevron className="chev" />
				<span>{redacted ? "Redacted thinking" : "Thinking"}</span>
			</button>
			{open && !redacted && <div className="thinking-body selectable">{text}</div>}
		</div>
	);
}
