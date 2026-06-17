import "katex/dist/katex.min.css";
import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// remark-math parses $inline$ / $$display$$; rehype-katex renders them with KaTeX. remark-math does NOT
// understand LaTeX's own \( \) / \[ \] delimiters (and CommonMark even strips the leading backslash,
// \[ → [), so normalizeMathBlocks converts those to $…$ / $$…$$ first.
// throwOnError:false → malformed LaTeX shows in-place in error color instead of breaking the message.
const REMARK = [remarkGfm, remarkMath];
const REHYPE = [[rehypeKatex, { throwOnError: false, strict: false }]] as never;

/**
 * LLMs routinely emit multi-line display math with the `$$` glued to the content, e.g.
 *   $$J = \begin{bmatrix} ... \\ ... \end{bmatrix}$$
 * micromark's flow-math then reads the opening line's tail as "meta" and never sees a valid close
 * (a close must be `$$` alone on its line), so it swallows the rest of the document into one broken
 * block that KaTeX renders as a wall of red. Normalizing multi-line `$$` blocks so each delimiter sits
 * on its own line turns them into well-formed flow math. Single-line `$$…$$` (which already works, and
 * may live inside table cells) and inline `$…$` are left untouched; code spans/fences are protected.
 */
function normalizeMathBlocks(input: string): string {
	// Split out fenced code blocks and inline code so we never rewrite `$$` inside them.
	const protectedSpans = /(```[\s\S]*?```|`[^`\n]*`)/g;
	return input
		.split(protectedSpans)
		.map((segment, i) => (i % 2 === 1 ? segment : fixMultilineDisplay(convertLatexDelimiters(segment))))
		.join("");
}

/**
 * remark-math only understands `$…$` / `$$…$$`. LLMs (e.g. deepseek) also emit LaTeX's native
 * `\[ … \]` (display) and `\( … \)` (inline) delimiters, which remark-math ignores — and CommonMark
 * even strips the leading backslash (`\[` → `[`), leaving bare brackets. Convert those to `$$…$$` / `$…$`.
 * Only well-formed pairs are rewritten; unmatched/partial delimiters and ordinary prose are left intact,
 * and the caller has already split out code spans/fences so math inside code is never touched.
 */
function convertLatexDelimiters(text: string): string {
	return text
		.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => `\n\n$$\n${String(body).trim()}\n$$\n\n`)
		.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => {
			const inner = String(body).trim();
			return inner ? `$${inner}$` : _m;
		});
}

function fixMultilineDisplay(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		if (text[i] === "$" && text[i + 1] === "$") {
			const close = text.indexOf("$$", i + 2);
			if (close === -1) {
				out += text.slice(i);
				break;
			}
			const inner = text.slice(i + 2, close);
			if (inner.includes("\n")) {
				const before = out.replace(/[ \t]+$/, "");
				const lead = before === "" || before.endsWith("\n") ? "" : "\n";
				const body = inner.replace(/^[ \t]*\n?/, "").replace(/\n?[ \t]*$/, "");
				out = `${before}${lead}$$\n${body}\n$$`;
				i = close + 2;
				if (i < text.length && text[i] !== "\n") out += "\n";
			} else {
				out += text.slice(i, close + 2);
				i = close + 2;
			}
		} else {
			out += text[i];
			i += 1;
		}
	}
	return out;
}

export function Markdown({ text }: { text: string }) {
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
}
