import { useState } from "react";
import { IconChevron, IconSparkle, IconX } from "@/components/icons";
import { toolArgSummary, toolResultText } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";
import { useView } from "@/state/viewPrefs";

/**
 * Pi is skill-driven, so a skill activation gets its own vivid, animated card — visibly louder than
 * the quiet tool chips. A skill is invoked when the model `read`s a SKILL.md; see skillActivation().
 */
export function SkillCard({ tool, skill }: { tool: ToolState; skill: string }) {
	const { expandTools } = useView();
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? expandTools;

	const text = toolResultText(tool);
	const path = toolArgSummary(tool.args);
	const hasBody = Boolean(text);
	const label =
		tool.status === "pending" ? "Activating skill" : tool.status === "error" ? "Skill failed" : "Skill activated";

	return (
		<div className={`skill-card skill-${tool.status}`}>
			<svg className="skill-ring" aria-hidden="true">
				<rect pathLength={100} />
			</svg>
			<button type="button" className="skill-head" onClick={() => hasBody && setOverride(!open)}>
				<span className="skill-spark">
					<IconSparkle />
				</span>
				<span className="skill-meta">
					<span className="skill-overline">{label}</span>
					<span className="skill-name">{skill}</span>
				</span>
				<span className="skill-status">
					{tool.status === "pending" && <span className="dotpulse" />}
					{tool.status === "error" && <IconX />}
				</span>
				{hasBody && <IconChevron className={`skill-chev ${open ? "open" : ""}`} />}
			</button>
			{!open && path && <div className="skill-peek">{path}</div>}
			{open && hasBody && <pre className="skill-body selectable">{text}</pre>}
		</div>
	);
}

/**
 * The user side of a skill: a sent `/skill:name` command expands to a skill block, which we render as the
 * same collapsed, animated card (rather than the raw block text). Collapsed by default, like SkillCard.
 */
export function SkillInvocation({ name, content }: { name: string; content?: string }) {
	const { expandTools } = useView();
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? expandTools;
	const hasBody = Boolean(content?.trim());

	return (
		<div className="skill-card skill-success">
			<svg className="skill-ring" aria-hidden="true">
				<rect pathLength={100} />
			</svg>
			<button type="button" className="skill-head" onClick={() => hasBody && setOverride(!open)}>
				<span className="skill-spark">
					<IconSparkle />
				</span>
				<span className="skill-meta">
					<span className="skill-overline">Skill</span>
					<span className="skill-name">{name}</span>
				</span>
				{hasBody && <IconChevron className={`skill-chev ${open ? "open" : ""}`} />}
			</button>
			{open && hasBody && <pre className="skill-body selectable">{content}</pre>}
		</div>
	);
}
