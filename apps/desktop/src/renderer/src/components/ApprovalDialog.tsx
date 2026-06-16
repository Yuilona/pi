import type { ApprovalDecision, ApprovalRequest } from "@shared/ipc";
import { useEffect } from "react";
import { IconTool } from "@/components/icons";

const VERBS: Record<string, string> = {
	bash: "run a command",
	edit: "edit a file",
	write: "write a file",
};

export function ApprovalDialog({
	request,
	onResolve,
}: {
	request: ApprovalRequest;
	onResolve: (decision: ApprovalDecision) => void;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") onResolve("allow");
			else if (e.key === "Escape") onResolve("deny");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onResolve]);

	const input = (request.input ?? {}) as Record<string, unknown>;
	const command = typeof input.command === "string" ? input.command : undefined;
	const pathVal = input.path ?? input.file_path;
	const path = typeof pathVal === "string" ? pathVal : undefined;
	const content = typeof input.content === "string" ? input.content : undefined;
	const verb = VERBS[request.toolName] ?? `use ${request.toolName}`;

	return (
		<>
			<div className="approval-backdrop" />
			<div className="approval">
				<div className="approval-card">
					<div className="approval-head">
						<span className="approval-ic">
							<IconTool />
						</span>
						<div>
							<div className="approval-title">Allow the agent to {verb}?</div>
							<div className="approval-tool">
								{request.toolName}
								{path ? ` · ${path}` : ""}
							</div>
						</div>
					</div>
					{command && <pre className="approval-pre selectable">{command}</pre>}
					{content !== undefined && (
						<pre className="approval-pre selectable">
							{content.slice(0, 600)}
							{content.length > 600 ? "\n…" : ""}
						</pre>
					)}
					<div className="approval-actions">
						<button type="button" className="btn btn-ghost" onClick={() => onResolve("always")}>
							Always allow {request.toolName}
						</button>
						<div className="approval-spacer" />
						<button type="button" className="btn btn-sand" onClick={() => onResolve("deny")}>
							Deny <span className="kbd-hint">Esc</span>
						</button>
						<button type="button" className="btn btn-brand" onClick={() => onResolve("allow")}>
							Allow <span className="kbd-hint">Enter</span>
						</button>
					</div>
				</div>
			</div>
		</>
	);
}
