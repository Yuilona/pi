import type { SessionInfoDto } from "@shared/ipc";
import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconFolder, IconPlus, IconTrash } from "@/components/icons";

/** How many of a project's most-recent chats stay pinned; the rest fold under "show more". */
const PINNED = 4;

/** Per-session live badges, keyed by sessionId (running spinner / unread dot / pending-approval marker). */
export interface SessionLiveInfo {
	running: boolean;
	unread: boolean;
	pendingApproval: boolean;
}

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
	/** Focused session id (renderer-driven). A row is active when its live sessionId matches. */
	activeId?: string;
	/** Live badges keyed by sessionId. */
	liveInfo: Record<string, SessionLiveInfo>;
	/** Path of a session that was just auto-titled; that row plays a one-time reveal sweep. */
	retitledPath?: string;
	currentCwd: string;
	onSelect: (row: SessionInfoDto) => void;
	onNew: () => void;
	onNewInProject: (cwd: string) => void;
	onDelete: (row: SessionInfoDto) => void;
}

export function SessionSidebar({
	sessions,
	activeId,
	liveInfo,
	retitledPath,
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
				<button
					type="button"
					className="icon-btn"
					onClick={onNew}
					title="New conversation"
					aria-label="New conversation"
				>
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
						activeId={activeId}
						liveInfo={liveInfo}
						retitledPath={retitledPath}
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
						onDelete(pendingDelete);
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
	activeId?: string;
	liveInfo: Record<string, SessionLiveInfo>;
	retitledPath?: string;
	onSelect: (row: SessionInfoDto) => void;
	onNewInProject: (cwd: string) => void;
	onRequestDelete: (s: SessionInfoDto) => void;
}

function ProjectGroup({
	group,
	isCurrent,
	activeId,
	liveInfo,
	retitledPath,
	onSelect,
	onNewInProject,
	onRequestDelete,
}: ProjectGroupProps) {
	const [expanded, setExpanded] = useState(false);
	// One-shot reveal for the rows uncovered by "Show more". Gated to the toggle moment (a brief flag) so the
	// per-streaming-tick sidebar refresh doesn't re-animate the already-visible rows (which would flicker).
	const [justExpanded, setJustExpanded] = useState(false);
	const overflow = group.sessions.length - PINNED;
	const visible = expanded ? group.sessions : group.sessions.slice(0, PINNED);
	const toggleMore = () => {
		const next = !expanded;
		setExpanded(next);
		if (next) {
			setJustExpanded(true);
			window.setTimeout(() => setJustExpanded(false), 400);
		}
	};

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
					aria-label="New chat in this project"
				>
					<IconPlus />
				</button>
			</header>

			{visible.map((s, i) => {
				const info = s.sessionId ? liveInfo[s.sessionId] : undefined;
				const active = !!s.sessionId && s.sessionId === activeId;
				return (
					<div
						key={s.path}
						className={`sess-wrap ${active ? "active" : ""} ${s.path === retitledPath ? "retitled" : ""} ${
							justExpanded && i >= PINNED ? "sess-reveal" : ""
						}`}
					>
						<button type="button" className="sess" onClick={() => onSelect(s)}>
							<div className="sess-title">
								{info?.running && <span className="sess-spin" title="Running" />}
								{!info?.running && info?.unread && <span className="sess-unread" title="New activity" />}
								{info?.pendingApproval && <span className="sess-approval" title="Approval needed" />}
								<span className="sess-title-text">{s.title}</span>
							</div>
							<div className="sess-meta">
								{relTime(s.modified)} · {s.messageCount} msgs
							</div>
						</button>
						<button
							type="button"
							className="icon-btn danger sess-del"
							onClick={() => onRequestDelete(s)}
							title="Delete chat"
							aria-label="Delete chat"
						>
							<IconTrash />
						</button>
					</div>
				);
			})}

			{overflow > 0 && (
				<button type="button" className="sess-more" onClick={toggleMore}>
					{expanded ? "Show less" : `Show ${overflow} more…`}
				</button>
			)}
		</section>
	);
}
