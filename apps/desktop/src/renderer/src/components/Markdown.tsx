import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
						<a {...props} target="_blank" rel="noreferrer">
							{props.children}
						</a>
					),
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
