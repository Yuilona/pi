import type { IpcMessage } from "@shared/ipc";
import { memo } from "react";
import { SkillInvocation } from "@/components/SkillCard";
import { parseSkillInvocation } from "@/components/toolText";
import { useImageViewer } from "@/state/imageViewer";

export const UserBubble = memo(function UserBubble({ message }: { message: IpcMessage }) {
	const openImage = useImageViewer();
	const text = message.content
		.filter((b) => b.kind === "text")
		.map((b) => (b as { text: string }).text)
		.join("\n");
	const images = message.content.filter((b) => b.kind === "image") as Array<{ dataUrl: string }>;

	// A sent `/skill:…` command reaches us as an expanded skill block; render it as the same collapsed,
	// animated skill card (not the raw block text), with any real trailing prompt shown as a normal bubble.
	const invocation = images.length === 0 ? parseSkillInvocation(text) : null;
	if (invocation) {
		return (
			<>
				<div className="row assistant">
					<div className="assistant-body">
						<SkillInvocation name={invocation.name} content={invocation.content} />
					</div>
				</div>
				{invocation.userMessage && (
					<div className="row user">
						<div className="bubble-user selectable">{invocation.userMessage}</div>
					</div>
				)}
			</>
		);
	}

	return (
		<div className="row user">
			{images.length > 0 && (
				<div className="bubble-images">
					{images.map((img) => (
						<button
							type="button"
							className="bubble-img"
							key={img.dataUrl.slice(0, 48)}
							onClick={() => openImage(img.dataUrl)}
							aria-label="View image full size"
						>
							<img src={img.dataUrl} alt="attachment" />
						</button>
					))}
				</div>
			)}
			{text && <div className="bubble-user selectable">{text}</div>}
		</div>
	);
});
