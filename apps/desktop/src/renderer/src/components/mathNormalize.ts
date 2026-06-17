// Pure string transforms that prepare model output for remark-math, extracted from Markdown.tsx so they
// can be unit-tested without pulling in react-markdown / KaTeX. No React/DOM imports on purpose.

/**
 * remark-math only understands `$…$` / `$$…$$`. LLMs (e.g. deepseek) also emit LaTeX's native
 * `\[ … \]` (display) and `\( … \)` (inline) delimiters, which remark-math ignores — and CommonMark
 * even strips the leading backslash (`\[` → `[`), leaving bare brackets. Convert those to `$$…$$` / `$…$`.
 * Only well-formed pairs are rewritten; unmatched/partial delimiters and ordinary prose are left intact,
 * and the caller has already split out code spans/fences so math inside code is never touched.
 */
export function convertLatexDelimiters(text: string): string {
	return text
		.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => `\n\n$$\n${String(body).trim()}\n$$\n\n`)
		.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => {
			const inner = String(body).trim();
			return inner ? `$${inner}$` : _m;
		});
}

/**
 * LLMs routinely emit multi-line display math with `$$` glued to the content, e.g.
 *   $$J = \begin{bmatrix} ... \\ ... \end{bmatrix}$$
 * micromark's flow-math then reads the opening line's tail as "meta" and never sees a valid close
 * (a close must be `$$` alone on its line), so it swallows the rest of the document into one broken
 * block that KaTeX renders as a wall of red. Putting each delimiter of a multi-line `$$` block on its own
 * line turns it into well-formed flow math. Single-line `$$…$$` (which already works, and may live inside
 * table cells) and inline `$…$` are left untouched.
 */
export function fixMultilineDisplay(text: string): string {
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

/**
 * Prepare a markdown string for remark-math: convert LaTeX bracket/paren delimiters to dollar math and put
 * multi-line `$$` delimiters on their own lines — but never touch fenced code blocks or inline code spans.
 */
export function normalizeMathBlocks(input: string): string {
	const protectedSpans = /(```[\s\S]*?```|`[^`\n]*`)/g;
	return input
		.split(protectedSpans)
		.map((segment, i) => (i % 2 === 1 ? segment : fixMultilineDisplay(convertLatexDelimiters(segment))))
		.join("");
}
