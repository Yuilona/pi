import { useState } from "react";
import { IconCheck, IconChevron, IconX } from "@/components/icons";
import { toolResultText } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";
import { useView } from "@/state/viewPrefs";

export function BashCard({ tool }: { tool: ToolState }) {
	const { expandTools } = useView();
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? expandTools;
	const command = (tool.args as { command?: string })?.command ?? "";
	const live = tool.status === "pending" ? (tool.output ?? "") : "";
	const final = toolResultText(tool);
	const output = (final || live).trim();

	return (
		<div className={`tool bash tool-${tool.status}`}>
			<button type="button" className="bash-head" onClick={() => output && setOverride(!open)}>
				<span className="bash-prompt">$</span>
				<code className="bash-cmd">{command}</code>
				<span className="tool-status">
					{tool.status === "pending" && <span className="dotpulse" />}
					{tool.status === "success" && <IconCheck />}
					{tool.status === "error" && <IconX />}
				</span>
				{output && <IconChevron className={`tool-chev ${open ? "open" : ""}`} />}
			</button>
			{open && output && <pre className="bash-out selectable">{output}</pre>}
		</div>
	);
}
