import type { IpcMessage } from "@shared/ipc";

export function UserBubble({ message }: { message: IpcMessage }) {
	const text = message.content
		.filter((b) => b.kind === "text")
		.map((b) => (b as { text: string }).text)
		.join("\n");
	return (
		<div className="row user">
			<div className="bubble-user selectable">{text}</div>
		</div>
	);
}
