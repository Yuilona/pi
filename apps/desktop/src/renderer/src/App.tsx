import "@/styles/app.css";
import "@/styles/chat.css";
import "@/styles/tools.css";
import "@/styles/skill.css";
import type {
	ApprovalDecision,
	ApprovalRequest,
	CommandDto,
	ModelInfoDto,
	PermissionMode,
	SessionInfoDto,
	ThinkingLevelDto,
} from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { ApiKeyGate } from "@/components/ApiKeyGate";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import { Composer } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
import { MessageList } from "@/components/MessageList";
import { SessionSidebar } from "@/components/SessionSidebar";
import { SettingsPanel } from "@/components/SettingsPanel";
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
	const [currentCwd, setCurrentCwd] = useState("");
	const [sessionFile, setSessionFile] = useState<string | undefined>();
	const [showThinking, setShowThinking] = useState(true);
	const [expandTools, setExpandTools] = useState(() => localStorage.getItem("pi.expandTools") === "1");
	const [commands, setCommands] = useState<CommandDto[]>(BUILTIN_COMMANDS);

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

	const openSession = useCallback(
		async (path: string) => {
			await window.pi.switchSession(path);
			await loadTranscript();
			await refreshState();
			await refreshSessions();
		},
		[loadTranscript, refreshState, refreshSessions],
	);

	const newChat = useCallback(async () => {
		await reset();
		await refreshState();
		await refreshSessions();
	}, [reset, refreshState, refreshSessions]);

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

	useEffect(() => {
		void refreshState();
	}, [refreshState]);

	// Refresh the session list when the sidebar is open and whenever a turn finishes (new/updated titles).
	// biome-ignore lint/correctness/useExhaustiveDependencies: state.streaming intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true && sidebarOpen) void refreshSessions();
	}, [ready, sidebarOpen, state.streaming, refreshSessions]);

	// Slash commands (prompt templates + skills) are project-scoped, so refresh them when the cwd changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentCwd intentionally re-triggers the refresh
	useEffect(() => {
		if (ready === true) void refreshCommands();
	}, [ready, currentCwd, refreshCommands]);

	const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

	const handleSend = useCallback(() => {
		const text = input.trim();
		if (!text || state.streaming) return;
		const builtin = commands.find((c) => c.kind === "builtin" && `/${c.name}` === text);
		if (builtin) {
			runCommand(builtin);
			return;
		}
		send(text);
		setInput("");
	}, [input, state.streaming, send, commands, runCommand]);

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
						currentCwd={currentCwd}
						onSelect={(p) => void openSession(p)}
						onNew={() => void newChat()}
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
