import type { SessionInfoDto } from "@shared/ipc";
import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconFolder, IconPlus, IconTrash } from "@/components/icons";

/** How many of a project's most-recent chats stay pinned; the rest fold under "show more". */
const PINNED = 4;

function relTime(ms: number): string {
	const diff = Date.now() - ms;
	const m = Math.floor(diff / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	return `${Math.floor(d / 30)}mo ago`;
}

interface SessionGroup {
	cwd: string;
	project: string;
	sessions: SessionInfoDto[];
}

interface SessionSidebarProps {
	sessions: SessionInfoDto[];
	activePath?: string;
	currentCwd: string;
	onSelect: (path: string) => void;
	onNew: () => void;
	onNewInProject: (cwd: string) => void;
	onDelete: (path: string) => void;
}

export function SessionSidebar({
	sessions,
	activePath,
	currentCwd,
	onSelect,
	onNew,
	onNewInProject,
	onDelete,
}: SessionSidebarProps) {
	// Remembered project order, so the list stays put across refreshes (deleting a chat must NOT reshuffle
	// projects — you should never have to hunt for where a project jumped to).
	const orderRef = useRef<string[]>([]);
	const groups = useMemo<SessionGroup[]>(() => {
		const map = new Map<string, SessionGroup>();
		for (const s of sessions) {
			const g = map.get(s.cwd) ?? { cwd: s.cwd, project: s.project, sessions: [] };
			g.sessions.push(s);
			map.set(s.cwd, g);
		}
		for (const g of map.values()) g.sessions.sort((a, b) => b.modified - a.modified);

		// Projects already shown keep their position; only brand-new projects are slotted in (at top, by
		// latest activity). A project drops out only when its last chat is deleted. Switching projects,
		// sending messages, or deleting a chat therefore never reorders the existing groups.
		const present = new Set(map.keys());
		const kept = orderRef.current.filter((cwd) => present.has(cwd));
		const keptSet = new Set(kept);
		const fresh = [...map.values()]
			.filter((g) => !keptSet.has(g.cwd))
			.sort((a, b) => (b.sessions[0]?.modified ?? 0) - (a.sessions[0]?.modified ?? 0))
			.map((g) => g.cwd);
		const order = [...fresh, ...kept];
		orderRef.current = order;
		return order.map((cwd) => map.get(cwd)).filter((g): g is SessionGroup => g !== undefined);
	}, [sessions]);

	// Delete is gated by a confirm dialog so a misclick on the trash icon can't silently drop a chat.
	const [pendingDelete, setPendingDelete] = useState<SessionInfoDto | null>(null);

	return (
		<aside className="sidebar">
			<div className="sidebar-head">
				<span className="sidebar-title">Chats</span>
				<button type="button" className="icon-btn" onClick={onNew} title="New conversation">
					<IconPlus />
				</button>
			</div>

			<div className="sidebar-list">
				{groups.length === 0 && <div className="sidebar-empty">No saved chats yet.</div>}
				{groups.map((g) => (
					<ProjectGroup
						key={g.cwd}
						group={g}
						isCurrent={g.cwd === currentCwd}
						activePath={activePath}
						onSelect={onSelect}
						onNewInProject={onNewInProject}
						onRequestDelete={setPendingDelete}
					/>
				))}
			</div>
			{pendingDelete && (
				<ConfirmDialog
					title="Delete this chat?"
					message={pendingDelete.title}
					confirmLabel="Delete"
					danger
					onConfirm={() => {
						onDelete(pendingDelete.path);
						setPendingDelete(null);
					}}
					onCancel={() => setPendingDelete(null)}
				/>
			)}
		</aside>
	);
}

interface ProjectGroupProps {
	group: SessionGroup;
	isCurrent: boolean;
	activePath?: string;
	onSelect: (path: string) => void;
	onNewInProject: (cwd: string) => void;
	onRequestDelete: (s: SessionInfoDto) => void;
}

function ProjectGroup({ group, isCurrent, activePath, onSelect, onNewInProject, onRequestDelete }: ProjectGroupProps) {
	const [expanded, setExpanded] = useState(false);
	const overflow = group.sessions.length - PINNED;
	const visible = expanded ? group.sessions : group.sessions.slice(0, PINNED);

	return (
		<section className={`sess-group ${isCurrent ? "current" : ""}`}>
			<header className="sess-group-head" title={group.cwd}>
				<IconFolder className="sess-group-icon" width={14} height={14} />
				<span className="sess-group-name">{group.project}</span>
				{isCurrent && <span className="sess-group-cur">current</span>}
				<span className="sess-group-count">{group.sessions.length}</span>
				<button
					type="button"
					className="sess-group-add"
					onClick={() => onNewInProject(group.cwd)}
					title="New chat in this project"
				>
					<IconPlus />
				</button>
			</header>

			{visible.map((s) => (
				<div key={s.path} className={`sess-wrap ${s.path === activePath ? "active" : ""}`}>
					<button type="button" className="sess" onClick={() => onSelect(s.path)}>
						<div className="sess-title">{s.title}</div>
						<div className="sess-meta">
							{relTime(s.modified)} · {s.messageCount} msgs
						</div>
					</button>
					<button
						type="button"
						className="icon-btn danger sess-del"
						onClick={() => onRequestDelete(s)}
						title="Delete chat"
					>
						<IconTrash />
					</button>
				</div>
			))}

			{overflow > 0 && (
				<button type="button" className="sess-more" onClick={() => setExpanded((v) => !v)}>
					{expanded ? "Show less" : `Show ${overflow} more…`}
				</button>
			)}
		</section>
	);
}
