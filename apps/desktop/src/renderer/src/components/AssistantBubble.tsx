import type { IpcMessage } from "@shared/ipc";
import { BashCard } from "@/components/BashCard";
import { Markdown } from "@/components/Markdown";
import { SkillCard } from "@/components/SkillCard";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolChip } from "@/components/ToolChip";
import { skillActivation } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";

export function AssistantBubble({ message, tools }: { message: IpcMessage; tools: Record<string, ToolState> }) {
	return (
		<div className="row assistant">
			<div className="assistant-body">
				{message.content.map((b, i) => {
					const key = `${message.id}-${i}`;
					if (b.kind === "text") return <Markdown key={key} text={b.text} />;
					if (b.kind === "thinking") return <ThinkingBlock key={key} text={b.text} redacted={b.redacted} />;
					if (b.kind === "toolCall") {
						const tool = tools[b.id] ?? {
							toolCallId: b.id,
							name: b.name,
							args: b.args,
							status: "pending" as const,
						};
						const skill = skillActivation(tool);
						if (skill) return <SkillCard key={b.id} tool={tool} skill={skill} />;
						return b.name === "bash" ? <BashCard key={b.id} tool={tool} /> : <ToolChip key={b.id} tool={tool} />;
					}
					return null;
				})}
			</div>
		</div>
	);
}
