import "@/styles/app.css";
import "@/styles/chat.css";
import "@/styles/tools.css";
import "@/styles/skill.css";
import type {
	ApprovalDecision,
	ApprovalRequest,
	CommandDto,
	ImageAttachmentDto,
	ModelInfoDto,
	PermissionMode,
	SessionInfoDto,
	SessionSummaryDto,
	UsageDto,
} from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiKeyGate } from "@/components/ApiKeyGate";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import { Composer } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
import { ImageViewer } from "@/components/ImageViewer";
import { MessageList } from "@/components/MessageList";
import { SessionSidebar } from "@/components/SessionSidebar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { StatusBanners } from "@/components/StatusBanners";
import { Titlebar } from "@/components/Titlebar";
import { ImageViewerContext } from "@/state/imageViewer";
import { useSessions } from "@/state/useSessions";
import { ViewContext } from "@/state/viewPrefs";

type Theme = "light" | "dark";

/** Per-session badges the sidebar overlays on each row, keyed by sessionId. */
export interface LiveInfo {
	running: boolean;
	unread: boolean;
	pendingApproval: boolean;
}

const MODE_ORDER: PermissionMode[] = ["ask", "acceptEdits", "yolo", "readonly"];

// Builtin slash commands wired to desktop UI actions (prompt templates + skills come from the backend).
const BUILTIN_COMMANDS: CommandDto[] = [
	{ name: "settings", description: "Open settings", kind: "builtin", takesArgs: false },
	{ name: "model", description: "Choose model (opens settings)", kind: "builtin", takesArgs: false },
	{ name: "new", description: "Start a new chat", kind: "builtin", takesArgs: false },
	{ name: "resume", description: "Open the chats sidebar", kind: "builtin", takesArgs: false },
	{ name: "compact", description: "Compact the conversation context", kind: "builtin", takesArgs: false },
	{ name: "copy", description: "Copy the last reply to the clipboard", kind: "builtin", takesArgs: false },
	{ name: "quit", description: "Quit the app", kind: "builtin", takesArgs: false },
];

function prettyCwd(p: string): string {
	const segments = p.split(/[\\/]/).filter(Boolean);
	if (segments.length <= 2) return p;
	return `…/${segments.slice(-2).join("/")}`;
}

export function App() {
	const {
		slices,
		unread,
		activeId,
		activeState: state,
		setActive,
		openSession: openLive,
		newChatInCwd: newLive,
		send,
		abort,
		loadTranscript,
		removeSlice,
	} = useSessions();
	const [theme, setTheme] = useState<Theme>("light");
	const [ready, setReady] = useState<boolean | null>(null);
	const [appDir, setAppDir] = useState("");
	const [mode, setMode] = useState<PermissionMode>("ask");
	const [showThinking, setShowThinking] = useState(true);
	const [liveSessions, setLiveSessions] = useState<SessionSummaryDto[]>([]);
	const [input, setInput] = useState("");
	const [settingsOpen, setSettingsOpen] = useState(false);
	// Per-session approval queues: a background session's gate must not block the active view.
	const [approvals, setApprovals] = useState<Record<string, ApprovalRequest[]>>({});
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sessions, setSessions] = useState<SessionInfoDto[]>([]);
	const [retitledPath, setRetitledPath] = useState<string | undefined>();
	const [expandTools, setExpandTools] = useState(() => localStorage.getItem("pi.expandTools") === "1");
	const [commands, setCommands] = useState<CommandDto[]>(BUILTIN_COMMANDS);
	const [attachments, setAttachments] = useState<ImageAttachmentDto[]>([]);
	const [usage, setUsage] = useState<UsageDto | undefined>();
	const [models, setModels] = useState<ModelInfoDto[]>([]);
	const [viewerSrc, setViewerSrc] = useState<string | null>(null);

	const activeIdRef = useRef<string | undefined>(undefined);
	activeIdRef.current = activeId;

	const activeSummary = activeId ? liveSessions.find((s) => s.sessionId === activeId) : undefined;
	const model = activeSummary?.model;
	const thinking = activeSummary?.thinkingLevel ?? "medium";
	const currentCwd = activeSummary?.cwd ?? appDir;
	const cwdLabel = prettyCwd(currentCwd);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	useEffect(
		() =>
			window.pi.onApproval(({ sessionId, request }) => {
				setApprovals((q) => ({ ...q, [sessionId]: [...(q[sessionId] ?? []), request] }));
			}),
		[],
	);

	// The active session's first pending approval is shown inline; background ones wait (sidebar badge).
	const activeApproval = activeId ? approvals[activeId]?.[0] : undefined;
	const resolveApproval = useCallback((decision: ApprovalDecision) => {
		const id = activeIdRef.current;
		if (!id) return;
		setApprovals((q) => {
			const queue = q[id] ?? [];
			const [first, ...rest] = queue;
			if (first) window.pi.resolveApproval(id, first.id, decision);
			return { ...q, [id]: rest };
		});
	}, []);

	const refreshState = useCallback(async () => {
		const s = await window.pi.getState();
		setReady(s.hasModel);
		setAppDir(s.appDir);
		setMode(s.mode);
		setShowThinking(s.showThinking);
		setLiveSessions(s.sessions);
		// Adopt main's initial session on first load (the pool creates one at startup).
		if (!activeIdRef.current && s.activeId) void setActive(s.activeId);
	}, [setActive]);

	const applyShowThinking = useCallback((b: boolean) => {
		setShowThinking(b);
		void window.pi.setShowThinking(b);
	}, []);

	const applyExpandTools = useCallback((b: boolean) => {
		setExpandTools(b);
		localStorage.setItem("pi.expandTools", b ? "1" : "0");
	}, []);

	const refreshSessions = useCallback(async () => {
		setSessions(await window.pi.listSessions());
	}, []);

	const refreshCommands = useCallback(async () => {
		const id = activeIdRef.current;
		const dynamic = id ? await window.pi.listCommands(id) : [];
		setCommands([...BUILTIN_COMMANDS, ...dynamic]);
	}, []);

	const refreshStats = useCallback(async () => {
		const id = activeIdRef.current;
		setUsage(id ? await window.pi.getStats(id) : undefined);
	}, []);

	const refreshModels = useCallback(async () => {
		const all = await window.pi.listModels();
		setModels(all.filter((m) => m.available));
	}, []);

	const pickModel = useCallback(
		async (provider: string, id: string) => {
			const sid = activeIdRef.current;
			if (sid) await window.pi.setModel(sid, provider, id);
			await refreshState();
		},
		[refreshState],
	);

	const openSession = useCallback(
		async (path: string, sessionId?: string) => {
			setAttachments([]);
			if (sessionId) await setActive(sessionId);
			else await openLive(path);
			await refreshState();
			await refreshSessions();
		},
		[setActive, openLive, refreshState, refreshSessions],
	);

	// Start a fresh chat in a given directory: a project's cwd (per-project "+"), or the app dir for a
	// general, no-project chat (the titlebar "+"). Empty falls back to the app dir.
	const newChatInCwd = useCallback(
		async (cwd: string) => {
			setAttachments([]);
			await newLive(cwd || appDir);
			await refreshState();
			await refreshSessions();
		},
		[newLive, appDir, refreshState, refreshSessions],
	);
	const newChat = useCallback(() => newChatInCwd(appDir), [newChatInCwd, appDir]);

	const deleteSession = useCallback(
		async (row: SessionInfoDto) => {
			if (row.sessionId) {
				const id = row.sessionId;
				await window.pi.deleteSession(id);
				removeSlice(id);
				setApprovals((q) => {
					if (!q[id]) return q;
					const n = { ...q };
					delete n[id];
					return n;
				});
			} else {
				await window.pi.deleteSessionFile(row.path);
			}
			// If we deleted the active session, adopt main's fallback (refreshState re-adopts on null active).
			if (row.sessionId && row.sessionId === activeIdRef.current) {
				await setActive(undefined);
			}
			await refreshState();
			await refreshSessions();
		},
		[removeSlice, setActive, refreshState, refreshSessions],
	);

	// Builtin "/" commands map to desktop actions; prompt/skill commands are sent as text (the SDK expands them).
	const runCommand = useCallback(
		(cmd: CommandDto) => {
			if (cmd.kind !== "builtin") return;
			setInput("");
			switch (cmd.name) {
				case "settings":
				case "model":
					setSettingsOpen(true);
					break;
				case "new":
					void newChat();
					break;
				case "resume":
					setSidebarOpen(true);
					break;
				case "compact": {
					const id = activeIdRef.current;
					if (id) void window.pi.compact(id);
					break;
				}
				case "copy": {
					const reply = [...state.messages].reverse().find((m) => m.role === "assistant");
					const text = reply
						? reply.content
								.filter((b) => b.kind === "text")
								.map((b) => (b as { text: string }).text)
								.join("\n\n")
						: "";
					if (text) void navigator.clipboard.writeText(text);
					break;
				}
				case "quit":
					window.pi.window.close();
					break;
			}
		},
		[newChat, state.messages],
	);

	const applyMode = useCallback((m: PermissionMode) => {
		setMode(m);
		void window.pi.setMode(m);
	}, []);

	const cycleMode = useCallback(() => {
		setMode((prev) => {
			const next = MODE_ORDER[(MODE_ORDER.indexOf(prev) + 1) % MODE_ORDER.length];
			void window.pi.setMode(next);
			return next;
		});
	}, []);

	// Cycle the permission mode with Shift+Tab from anywhere in the chat view (not only the composer).
	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Tab" || !e.shiftKey || settingsOpen) return;
			if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
			e.preventDefault();
			cycleMode();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [settingsOpen, cycleMode]);

	useEffect(() => {
		void refreshState();
	}, [refreshState]);

	// Refresh the live-session list + history whenever any slice's streaming flips (a turn started/ended in
	// some session) or the active session changes — keeps the sidebar badges and history current.
	const anyStreaming = Object.values(slices).some((s) => s.streaming);
	// biome-ignore lint/correctness/useExhaustiveDependencies: anyStreaming/activeId intentionally re-trigger
	useEffect(() => {
		if (ready === true) void refreshState();
	}, [ready, anyStreaming, activeId, refreshState]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: anyStreaming intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true && sidebarOpen) void refreshSessions();
	}, [ready, sidebarOpen, anyStreaming, refreshSessions]);

	// Auto-title: when the agent names a brand-new chat, refresh the list and flag that row for the sweep.
	useEffect(() => {
		return window.pi.onEvent(({ event }) => {
			if (event.type !== "session_renamed") return;
			void refreshSessions();
			void refreshState();
			setRetitledPath(event.path);
			setTimeout(() => setRetitledPath((p) => (p === event.path ? undefined : p)), 2600);
		});
	}, [refreshSessions, refreshState]);

	// Slash commands + models are project-scoped — refresh when the active session (its cwd) changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentCwd/activeId intentionally re-trigger
	useEffect(() => {
		if (ready === true) {
			void refreshCommands();
			void refreshModels();
		}
	}, [ready, currentCwd, activeId, refreshCommands, refreshModels]);

	// Token-usage readout: refresh when a turn ends (active streaming flips) and when the active session changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: state.streaming intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true) void refreshStats();
	}, [ready, state.streaming, activeId, refreshStats]);

	const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

	const handleSend = useCallback(() => {
		const text = input.trim();
		if ((!text && attachments.length === 0) || state.streaming) return;
		const builtin = text ? commands.find((c) => c.kind === "builtin" && `/${c.name}` === text) : undefined;
		if (builtin) {
			runCommand(builtin);
			return;
		}
		send(text, attachments.length ? attachments : undefined);
		setInput("");
		setAttachments([]);
	}, [input, attachments, state.streaming, send, commands, runCommand]);

	// Commit an in-place edit of the active session's last user message: rewind to before it (same file), then
	// resend the new text as a fresh turn. No-op while streaming or when the text is empty.
	const submitEdit = useCallback(
		async (text: string) => {
			const id = activeIdRef.current;
			const trimmed = text.trim();
			if (!id || !trimmed || state.streaming) return;
			const original = await window.pi.editLastMessage(id);
			if (original == null) return;
			await loadTranscript(id);
			send(trimmed);
		},
		[state.streaming, loadTranscript, send],
	);

	const chooseCwd = useCallback(async () => {
		const dir = await window.pi.chooseCwd();
		if (dir) await newChatInCwd(dir);
	}, [newChatInCwd]);

	const hasMessages = state.messages.length > 0;

	// Per-session badge info for the sidebar (running from the live slice, unread/approval from state).
	const liveInfo = useMemo(() => {
		const out: Record<string, LiveInfo> = {};
		for (const s of liveSessions) {
			out[s.sessionId] = {
				running: slices[s.sessionId]?.streaming ?? s.running,
				unread: !!unread[s.sessionId],
				pendingApproval: s.hasPendingApproval || (approvals[s.sessionId]?.length ?? 0) > 0,
			};
		}
		return out;
	}, [liveSessions, slices, unread, approvals]);

	const viewValue = useMemo(
		() => ({ showThinking, expandTools, setShowThinking: applyShowThinking, setExpandTools: applyExpandTools }),
		[showThinking, expandTools, applyShowThinking, applyExpandTools],
	);

	return (
		<ViewContext.Provider value={viewValue}>
			<ImageViewerContext.Provider value={setViewerSrc}>
				<div className="app">
					<Titlebar
						theme={theme}
						cwdLabel={cwdLabel}
						onToggleTheme={toggleTheme}
						onChooseCwd={chooseCwd}
						onNewChat={() => void newChat()}
						onToggleSidebar={() => setSidebarOpen((o) => !o)}
						onOpenSettings={() => setSettingsOpen(true)}
					/>
					{ready === true && sidebarOpen && (
						<SessionSidebar
							sessions={sessions}
							activeId={activeId}
							liveInfo={liveInfo}
							retitledPath={retitledPath}
							currentCwd={currentCwd}
							onSelect={(row) => void openSession(row.path, row.sessionId)}
							onNew={() => void newChat()}
							onNewInProject={(p) => void newChatInCwd(p)}
							onDelete={(row) => void deleteSession(row)}
						/>
					)}
					<main className="main">
						{ready === false ? (
							<div className="scroll">
								<div className="content" style={{ minHeight: "100%" }}>
									<ApiKeyGate
										onReady={() => {
											setReady(true);
											void refreshState();
										}}
									/>
								</div>
							</div>
						) : ready === true ? (
							<>
								<div className="scroll">
									{hasMessages ? (
										// Key by the active session so switching cleanly REMOUNTS the thread: message ids
										// (h1/h2…) collide across sessions, so without this React reuses bubble instances and
										// their internal hook state (smoothed text, thinking/tool expand) leaks between sessions.
										<MessageList key={activeId ?? "none"} state={state} onSubmitEdit={submitEdit} />
									) : (
										<div className="content content-empty" style={{ minHeight: "100%" }}>
											<EmptyState onPick={setInput} />
											<StatusBanners state={state} />
										</div>
									)}
								</div>
								<Composer
									value={input}
									onChange={setInput}
									onSubmit={handleSend}
									streaming={state.streaming}
									onStop={abort}
									mode={mode}
									onCycleMode={cycleMode}
									commands={commands}
									onRunCommand={runCommand}
									attachments={attachments}
									onAddImages={(imgs) => setAttachments((a) => [...a, ...imgs])}
									onRemoveImage={(i) => setAttachments((a) => a.filter((_, idx) => idx !== i))}
									models={models}
									model={model}
									onPickModel={(p, id) => void pickModel(p, id)}
									usage={usage}
								/>
							</>
						) : (
							<div className="scroll" />
						)}
					</main>

					{settingsOpen && (
						<SettingsPanel
							onClose={() => setSettingsOpen(false)}
							theme={theme}
							onToggleTheme={toggleTheme}
							cwdLabel={cwdLabel}
							onChooseCwd={chooseCwd}
							thinkingLevel={thinking}
							mode={mode}
							onSetMode={applyMode}
							currentModel={model ? { provider: model.provider, id: model.id } : undefined}
							onPickModel={pickModel}
							onPickThinking={(level) => {
								const id = activeIdRef.current;
								if (id) void window.pi.setThinking(id, level);
							}}
							onChanged={refreshState}
						/>
					)}

					{activeApproval && <ApprovalDialog request={activeApproval} onResolve={resolveApproval} />}
					{viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
				</div>
			</ImageViewerContext.Provider>
		</ViewContext.Provider>
	);
}
