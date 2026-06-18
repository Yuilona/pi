import "katex/dist/katex.min.css";
import { type AnchorHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CopyButton } from "@/components/CopyButton";
import { normalizeMathBlocks } from "@/components/mathNormalize";
import { useImageViewer } from "@/state/imageViewer";

// hast nodes are loosely typed; keep a local structural shape.
type HastNode = {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
};

/** Collect the raw source text under a hast node — used to copy a fenced code block's contents verbatim
 * (pre → code → text), independent of the rendered React child shape. */
function hastText(node: HastNode): string {
	if (node.type === "text") return node.value ?? "";
	return (node.children ?? []).map(hastText).join("");
}

/**
 * Group runs of consecutive image-only paragraphs (and bare images) into one `.md-gallery` element, so the
 * renderer can lay them out as a uniform-height horizontal filmstrip instead of a ragged vertical stack.
 * Robust to the model emitting the images on one line or on separate lines. Mixed text+image paragraphs and
 * lone inline images are left untouched.
 */
function rehypeGroupImages() {
	const isImg = (n: HastNode) => n.type === "element" && n.tagName === "img";
	const isBlankText = (n: HastNode) => n.type === "text" && !(n.value ?? "").trim();
	const imageOnlyParagraph = (n: HastNode) =>
		n.type === "element" &&
		n.tagName === "p" &&
		(n.children?.length ?? 0) > 0 &&
		(n.children ?? []).every((c) => isImg(c) || isBlankText(c));

	return (tree: HastNode) => {
		const children = tree.children ?? [];
		const out: HastNode[] = [];
		let run: HastNode[] = [];
		const flush = () => {
			if (run.length === 0) return;
			const imgs = run.flatMap((node) => (isImg(node) ? [node] : (node.children ?? []).filter(isImg)));
			out.push({ type: "element", tagName: "div", properties: { className: ["md-gallery"] }, children: imgs });
			run = [];
		};
		for (const node of children) {
			if (isImg(node) || imageOnlyParagraph(node)) run.push(node);
			else {
				flush();
				out.push(node);
			}
		}
		flush();
		tree.children = out;
	};
}

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [rehypeGroupImages, [rehypeKatex, { throwOnError: false, strict: false }]] as never;

// Memoized: re-renders only when `text` changes, so historical messages aren't re-parsed on every
// streaming token (react-markdown + KaTeX parsing is the main per-update cost).
export const Markdown = memo(function Markdown({ text }: { text: string }) {
	const openImage = useImageViewer();
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
					img: (props: ImgHTMLAttributes<HTMLImageElement>) => {
						const src = typeof props.src === "string" ? props.src : undefined;
						return (
							<button
								type="button"
								className="md-img"
								onClick={() => src && openImage(src)}
								aria-label={props.alt ? `View image: ${props.alt}` : "View image full size"}
							>
								<img src={src} alt="" loading="lazy" />
							</button>
						);
					},
					pre: ({ node, children, ...rest }: HTMLAttributes<HTMLPreElement> & { node?: HastNode }) => {
						// One copy button per fenced block; strip a single trailing newline so paste doesn't gain a
						// blank line. Inline `code` is untouched (only `pre` wraps fenced blocks).
						const code = node ? hastText(node).replace(/\n$/, "") : "";
						return (
							<div className="code-wrap">
								{code && <CopyButton getText={() => code} label="Copy code" className="code-copy" />}
								<pre {...rest}>{children}</pre>
							</div>
						);
					},
				}}
			>
				{normalizeMathBlocks(text)}
			</ReactMarkdown>
		</div>
	);
});
