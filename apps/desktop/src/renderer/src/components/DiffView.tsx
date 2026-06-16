export function DiffView({ patch }: { patch: string }) {
	const lines = patch.replace(/\n$/, "").split("\n");
	return (
		<div className="diff selectable">
			{lines.map((line, i) => {
				const key = `${i}`;
				let cls = "ctx";
				if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
				else if (line.startsWith("@@")) cls = "hunk";
				else if (line.startsWith("\\")) cls = "meta";
				else if (line.startsWith("+")) cls = "add";
				else if (line.startsWith("-")) cls = "del";
				return (
					<div key={key} className={`dl ${cls}`}>
						{line || " "}
					</div>
				);
			})}
		</div>
	);
}
