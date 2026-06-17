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
	ThinkingLevelDto,
	UsageDto,
} from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { ApiKeyGate } from "@/components/ApiKeyGate";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import { Composer } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
import { MessageList } from "@/components/MessageList";
import { SessionSidebar } from "@/components/SessionSidebar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { StatusBanners } from "@/components/StatusBanners";
import { Titlebar } from "@/components/Titlebar";
import { useAgent } from "@/state/useAgent";
import { ViewContext } from "@/state/viewPrefs";

type Theme = "light" | "dark";

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
	const { state, send, abort, reset, loadTranscript } = useAgent();
	const [theme, setTheme] = useState<Theme>("light");
	const [ready, setReady] = useState<boolean | null>(null);
	const [cwdLabel, setCwdLabel] = useState("~");
	const [model, setModel] = useState<ModelInfoDto | undefined>();
	const [thinking, setThinking] = useState<ThinkingLevelDto>("medium");
	const [mode, setMode] = useState<PermissionMode>("ask");
	const [input, setInput] = useState("");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sessions, setSessions] = useState<SessionInfoDto[]>([]);
	const [retitledPath, setRetitledPath] = useState<string | undefined>();
	const [currentCwd, setCurrentCwd] = useState("");
	const [appDir, setAppDir] = useState("");
	const [sessionFile, setSessionFile] = useState<string | undefined>();
	const [showThinking, setShowThinking] = useState(true);
	const [expandTools, setExpandTools] = useState(() => localStorage.getItem("pi.expandTools") === "1");
	const [commands, setCommands] = useState<CommandDto[]>(BUILTIN_COMMANDS);
	const [attachments, setAttachments] = useState<ImageAttachmentDto[]>([]);
	const [usage, setUsage] = useState<UsageDto | undefined>();
	const [models, setModels] = useState<ModelInfoDto[]>([]);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	useEffect(() => window.pi.onApproval((req) => setApprovals((q) => [...q, req])), []);

	const resolveApproval = useCallback((decision: ApprovalDecision) => {
		setApprovals((q) => {
			const [first, ...rest] = q;
			if (first) window.pi.resolveApproval(first.id, decision);
			return rest;
		});
	}, []);

	const refreshState = useCallback(async () => {
		const s = await window.pi.getState();
		setReady(s.hasModel);
		setCwdLabel(prettyCwd(s.cwd));
		setCurrentCwd(s.cwd);
		setAppDir(s.appDir);
		setModel(s.model);
		setThinking(s.thinkingLevel);
		setMode(s.mode);
		setSessionFile(s.sessionFile);
		setShowThinking(s.showThinking);
	}, []);

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
		const dynamic = await window.pi.listCommands();
		setCommands([...BUILTIN_COMMANDS, ...dynamic]);
	}, []);

	const refreshStats = useCallback(async () => {
		setUsage(await window.pi.getStats());
	}, []);

	const refreshModels = useCallback(async () => {
		const all = await window.pi.listModels();
		setModels(all.filter((m) => m.available));
	}, []);

	const pickModel = useCallback(
		async (provider: string, id: string) => {
			await window.pi.setModel(provider, id);
			await refreshState();
		},
		[refreshState],
	);

	const openSession = useCallback(
		async (path: string) => {
			setAttachments([]);
			await window.pi.switchSession(path);
			await loadTranscript();
			await refreshState();
			await refreshSessions();
		},
		[loadTranscript, refreshState, refreshSessions],
	);

	// Start a fresh chat in a given directory: a project's cwd (per-project "+"), or the app dir for a
	// general, no-project chat (the "Chats"/titlebar "+", Codex-style). Empty falls back to current cwd.
	const newChatInCwd = useCallback(
		async (cwd: string) => {
			setAttachments([]);
			if (cwd) await window.pi.newChatInCwd(cwd);
			else await reset();
			await loadTranscript();
			await refreshState();
			await refreshSessions();
		},
		[reset, loadTranscript, refreshState, refreshSessions],
	);
	const newChat = useCallback(() => newChatInCwd(appDir), [newChatInCwd, appDir]);

	const deleteSession = useCallback(
		async (path: string) => {
			const wasActive = path === sessionFile;
			await window.pi.deleteSession(path);
			if (wasActive) {
				await loadTranscript();
				await refreshState();
			}
			await refreshSessions();
		},
		[sessionFile, loadTranscript, refreshState, refreshSessions],
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
				case "compact":
					void window.pi.compact();
					break;
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

	// Cycle the permission mode with Shift+Tab from anywhere in the chat view — not only when the composer
	// textarea is focused (clicking the model pill / sidebar / "+" moves focus off it). Skipped while
	// Settings is open so its form fields keep normal Tab navigation, and when the composer textarea is
	// focused (it handles Shift+Tab itself) to avoid cycling twice.
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

	// Refresh the session list when the sidebar is open and whenever a turn finishes (new/updated titles).
	// biome-ignore lint/correctness/useExhaustiveDependencies: state.streaming intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true && sidebarOpen) void refreshSessions();
	}, [ready, sidebarOpen, state.streaming, refreshSessions]);

	// Auto-title: when the agent names a brand-new chat, refresh the list and flag that row so it plays the
	// reveal sweep. Separate onEvent subscription; the chat reducer ignores this event type.
	useEffect(() => {
		return window.pi.onEvent((e) => {
			if (e.type !== "session_renamed") return;
			void refreshSessions();
			setRetitledPath(e.path);
			// Hold the `retitled` class long enough for the full 2.5s CSS sweep to finish (a shorter timer cut
			// the light sweep off mid-stroke). Path-matched so a later retitle's highlight isn't cleared early.
			setTimeout(() => setRetitledPath((p) => (p === e.path ? undefined : p)), 2600);
		});
	}, [refreshSessions]);

	// Slash commands (prompt templates + skills) are project-scoped, so refresh them when the cwd changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentCwd intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true) void refreshCommands();
	}, [ready, currentCwd, refreshCommands]);

	// Ready models for the composer's quick model switcher (project-scoped credentials may change with cwd).
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentCwd intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true) void refreshModels();
	}, [ready, currentCwd, refreshModels]);

	// Token-usage readout: refresh when a turn ends (streaming flips) and when the active session changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: state.streaming intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true) void refreshStats();
	}, [ready, state.streaming, sessionFile, refreshStats]);

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

	const chooseCwd = useCallback(async () => {
		const dir = await window.pi.chooseCwd();
		if (dir) {
			setCwdLabel(prettyCwd(dir));
			await reset();
			await refreshState();
			await refreshSessions();
		}
	}, [reset, refreshState, refreshSessions]);

	const hasMessages = state.messages.length > 0;

	return (
		<ViewContext.Provider
			value={{ showThinking, expandTools, setShowThinking: applyShowThinking, setExpandTools: applyExpandTools }}
		>
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
						activePath={sessionFile}
						retitledPath={retitledPath}
						currentCwd={currentCwd}
						onSelect={(p) => void openSession(p)}
						onNew={() => void newChat()}
						onNewInProject={(p) => void newChatInCwd(p)}
						onDelete={(p) => void deleteSession(p)}
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
									<MessageList state={state} />
								) : (
									<div className="content" style={{ minHeight: "100%" }}>
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
						onChanged={refreshState}
					/>
				)}

				{approvals[0] && <ApprovalDialog request={approvals[0]} onResolve={resolveApproval} />}
			</div>
		</ViewContext.Provider>
	);
}
