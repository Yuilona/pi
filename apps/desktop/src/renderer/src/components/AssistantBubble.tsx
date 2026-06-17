import type { IpcMessage } from "@shared/ipc";
import { memo } from "react";
import { BashCard } from "@/components/BashCard";
import { Markdown } from "@/components/Markdown";
import { SkillCard } from "@/components/SkillCard";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolChip } from "@/components/ToolChip";
import { skillActivation } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";
import { useSmoothedText } from "@/state/useSmoothedText";

/** Markdown text that reveals smoothly (typewriter) while its message is the one actively streaming. */
function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
	const shown = useSmoothedText(text, streaming);
	return <Markdown text={shown} />;
}

export const AssistantBubble = memo(function AssistantBubble({
	message,
	tools,
	streaming = false,
}: {
	message: IpcMessage;
	tools: Record<string, ToolState>;
	streaming?: boolean;
}) {
	return (
		<div className="row assistant">
			<div className="assistant-body">
				{message.content.map((b, i) => {
					const key = `${message.id}-${i}`;
					if (b.kind === "text") return <StreamingText key={key} text={b.text} streaming={streaming} />;
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
});
