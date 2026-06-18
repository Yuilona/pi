import type { IpcMessage } from "@shared/ipc";
import { memo } from "react";
import { BashCard } from "@/components/BashCard";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { SkillCard } from "@/components/SkillCard";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolChip } from "@/components/ToolChip";
import { messageText, skillActivation } from "@/components/toolText";
import type { ToolState } from "@/state/chatReducer";
import { useSmoothedText } from "@/state/useSmoothedText";

/** Markdown text that reveals smoothly (typewriter) while its message is the one actively streaming. */
function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
	const shown = useSmoothedText(text, streaming);
	return <Markdown text={shown} />;
}

interface AssistantBubbleProps {
	message: IpcMessage;
	tools: Record<string, ToolState>;
	streaming?: boolean;
}

// The whole `tools` map is passed in but its reference changes on every tool/message action; comparing
// only the tool states THIS message actually references keeps historical bubbles from re-rendering on
// every streaming tick (the live bubble still re-renders because its `message` reference changes).
function sameBubble(prev: AssistantBubbleProps, next: AssistantBubbleProps): boolean {
	if (prev.message !== next.message || prev.streaming !== next.streaming) return false;
	for (const b of next.message.content) {
		if (b.kind === "toolCall" && prev.tools[b.id] !== next.tools[b.id]) return false;
	}
	return true;
}

export const AssistantBubble = memo(function AssistantBubble({
	message,
	tools,
	streaming = false,
}: AssistantBubbleProps) {
	// Only offer "copy message" once the reply has settled and has prose — copying a half-streamed or
	// tool-only message is noise. (memo via sameBubble keeps this out of historical re-renders.)
	const copyText = streaming ? "" : messageText(message);
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
				{copyText && (
					<div className="msg-actions">
						<CopyButton getText={() => copyText} label="Copy message" />
					</div>
				)}
			</div>
		</div>
	);
}, sameBubble);
