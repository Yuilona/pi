import { Logo } from "@/components/Logo";

interface Suggestion {
	t: string;
	d: string;
	prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
	{
		t: "Explore a codebase",
		d: "Map the architecture and explain how the pieces fit together.",
		prompt: "Give me a tour of this codebase: the architecture, key modules, and how data flows.",
	},
	{
		t: "Write something",
		d: "Draft a script, a function, or a small tool from a description.",
		prompt: "Write a small command-line tool that ",
	},
	{
		t: "Plan a change",
		d: "Turn a fuzzy idea into a concrete, ordered implementation plan.",
		prompt: "Help me plan how to implement ",
	},
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
	return (
		<div className="empty">
			<div className="mark">
				<Logo size={28} />
			</div>
			<h1>What shall we build?</h1>
			<p className="sub">
				A calm, capable agent — at home on your desktop. Point it at a folder, ask in plain words, and watch it
				think and work.
			</p>

			<div className="suggestions">
				{SUGGESTIONS.map((s) => (
					<button type="button" key={s.t} className="suggestion" onClick={() => onPick(s.prompt)}>
						<div className="t">{s.t}</div>
						<div className="d">{s.d}</div>
					</button>
				))}
			</div>
		</div>
	);
}
