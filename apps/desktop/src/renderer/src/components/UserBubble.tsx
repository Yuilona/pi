import type { IpcMessage } from "@shared/ipc";

export function UserBubble({ message }: { message: IpcMessage }) {
	const text = message.content
		.filter((b) => b.kind === "text")
		.map((b) => (b as { text: string }).text)
		.join("\n");
	const images = message.content.filter((b) => b.kind === "image") as Array<{ dataUrl: string }>;
	return (
		<div className="row user">
			{images.length > 0 && (
				<div className="bubble-images">
					{images.map((img) => (
						<img key={img.dataUrl.slice(0, 48)} src={img.dataUrl} alt="attachment" />
					))}
				</div>
			)}
			{text && <div className="bubble-user selectable">{text}</div>}
		</div>
	);
}
