import "katex/dist/katex.min.css";
import { type AnchorHTMLAttributes, memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathBlocks } from "@/components/mathNormalize";

// remark-math parses $inline$ / $$display$$; rehype-katex renders them with KaTeX. remark-math does NOT
// understand LaTeX's own \( \) / \[ \] delimiters (and CommonMark strips the leading backslash), so
// normalizeMathBlocks (mathNormalize.ts) converts those to $…$ / $$…$$ and fixes glued multi-line $$ blocks.
// throwOnError:false → malformed LaTeX shows in-place in error color instead of breaking the message.
const REMARK = [remarkGfm, remarkMath];
const REHYPE = [[rehypeKatex, { throwOnError: false, strict: false }]] as never;

// Memoized: re-renders only when `text` changes, so historical messages aren't re-parsed on every
// streaming token (react-markdown + KaTeX parsing is the main per-update cost).
export const Markdown = memo(function Markdown({ text }: { text: string }) {
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={REMARK}
				rehypePlugins={REHYPE}
				components={{
					a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
						<a {...props} target="_blank" rel="noreferrer">
							{props.children}
						</a>
					),
				}}
			>
				{normalizeMathBlocks(text)}
			</ReactMarkdown>
		</div>
	);
});
