import { useState } from "react";
import { DiffView } from "@/components/DiffView";
import { IconCheck, IconChevron, IconTool, IconX } from "@/components/icons";
import { toolArgSummary, toolResultText } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";
import { useView } from "@/state/viewPrefs";

export function ToolChip({ tool }: { tool: ToolState }) {
	const { expandTools } = useView();
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? expandTools;
	const summary = toolArgSummary(tool.args);
	const patch = tool.result?.details?.patch ?? tool.result?.details?.diff;
	const text = toolResultText(tool);
	const live = tool.status === "pending" ? (tool.output ?? "") : "";
	const peek =
		tool.status === "pending" ? (live.split("\n").filter(Boolean).pop() ?? "") : (text.split("\n")[0] ?? "");
	const hasBody = Boolean(patch || text || live);

	return (
		<div className={`tool tool-${tool.status}`}>
			<button type="button" className="tool-head" onClick={() => hasBody && setOverride(!open)}>
				<IconTool className="tool-ic" />
				<span className="tool-name">{tool.name}</span>
				{summary && <span className="tool-arg">{summary}</span>}
				<span className="tool-status">
					{tool.status === "pending" && <span className="dotpulse" />}
					{tool.status === "success" && <IconCheck />}
					{tool.status === "error" && <IconX />}
				</span>
				{hasBody && <IconChevron className={`tool-chev ${open ? "open" : ""}`} />}
			</button>
			{!open && peek && <div className="tool-peek">{peek}</div>}
			{open && (patch ? <DiffView patch={patch} /> : <pre className="tool-body selectable">{text || live}</pre>)}
		</div>
	);
}
