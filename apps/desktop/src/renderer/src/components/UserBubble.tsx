import type { IpcMessage } from "@shared/ipc";
import { memo } from "react";
import { useImageViewer } from "@/state/imageViewer";

export const UserBubble = memo(function UserBubble({ message }: { message: IpcMessage }) {
	const openImage = useImageViewer();
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
