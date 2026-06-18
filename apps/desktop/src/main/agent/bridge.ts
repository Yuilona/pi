import { type BrowserWindow, dialog, ipcMain, Notification } from "electron";
import {
	type ApprovalDecision,
	type ApprovalRequest,
	type CustomProviderInput,
	type ImageAttachmentDto,
	IPC,
	type IpcAgentEvent,
	type PermissionMode,
	type ThinkingLevelDto,
} from "../../shared/ipc.js";
import { detectEnvProxy, loadProxyConfig, setProxyConfig } from "./proxy.js";
import { SessionPool } from "./sessionPool.js";

/** Wire the SessionPool to ipcMain and forward each session's events to the renderer, tagged by sessionId. */
export function registerAgentBridge(getWindow: () => BrowserWindow | null, cwd: string, appDir: string): SessionPool {
	const pool = new SessionPool(
		{
			forward: (sessionId: string, event: IpcAgentEvent) => {
				getWindow()?.webContents.send(IPC.event, { sessionId, event });
			},
			forwardApproval: (sessionId: string, request: ApprovalRequest) => {
				getWindow()?.webContents.send(IPC.approvalRequest, { sessionId, request });
			},
			// A background (non-focused) session finished or needs approval — surface it via the OS.
			notify: (_sessionId: string, kind: "done" | "approval", title: string) => {
				const win = getWindow();
				if (!Notification.isSupported()) return;
				const n = new Notification({
					title: kind === "approval" ? "pi — approval needed" : "pi",
					body: kind === "approval" ? `${title} needs approval` : `${title} — response ready`,
				});
				n.on("click", () => {
					win?.show();
					win?.focus();
				});
				n.show();
			},
		},
		cwd,
		appDir,
	);
	void pool.init();

	ipcMain.on(IPC.approvalResolve, (_e, sessionId: string, id: string, decision: ApprovalDecision) =>
		pool.resolveApproval(sessionId, id, decision),
	);

	// session-scoped
	ipcMain.handle(IPC.send, (_e, sessionId: string, text: string, images?: ImageAttachmentDto[]) =>
		pool.prompt(sessionId, text, images),
	);
	ipcMain.handle(IPC.abort, (_e, sessionId: string) => pool.abort(sessionId));
	ipcMain.handle(IPC.getStats, (_e, sessionId: string) => pool.getStats(sessionId));
	ipcMain.handle(IPC.getTranscript, (_e, sessionId: string) => pool.getTranscript(sessionId));
	ipcMain.handle(IPC.setModel, (_e, sessionId: string, provider: string, id: string) =>
		pool.setModel(sessionId, provider, id),
	);
	ipcMain.handle(IPC.setThinking, (_e, sessionId: string, level: ThinkingLevelDto) =>
		pool.setThinking(sessionId, level),
	);
	ipcMain.handle(IPC.compact, (_e, sessionId: string) => pool.compact(sessionId));
	ipcMain.handle(IPC.listCommands, (_e, sessionId: string) => pool.listCommands(sessionId));
	ipcMain.handle(IPC.editLastMessage, (_e, sessionId: string) => pool.editLastMessage(sessionId));

	// lifecycle
	ipcMain.handle(IPC.openSession, (_e, path: string) => pool.openSession(path));
	ipcMain.handle(IPC.newChatInCwd, (_e, dir: string) => pool.newChatInCwd(dir));
	ipcMain.handle(IPC.closeSession, (_e, sessionId: string) => pool.closeSession(sessionId));
	ipcMain.handle(IPC.deleteSession, (_e, sessionId: string) => pool.deleteSession(sessionId));
	ipcMain.handle(IPC.deleteSessionFile, (_e, path: string) => pool.deleteSessionByPath(path));
	ipcMain.handle(IPC.setActive, (_e, sessionId: string | null) => {
		pool.setActive(sessionId);
	});

	// app-global
	ipcMain.handle(IPC.setApiKey, (_e, provider: string, key: string) => pool.setApiKey(provider, key));
	ipcMain.handle(IPC.removeApiKey, (_e, provider: string) => {
		pool.removeApiKey(provider);
	});
	ipcMain.handle(IPC.setMode, (_e, mode: PermissionMode) => {
		pool.setMode(mode);
	});
	ipcMain.handle(IPC.setShowThinking, (_e, show: boolean) => {
		pool.setShowThinking(show);
	});
	ipcMain.handle(IPC.hasApiKey, (_e, provider: string) => pool.hasApiKey(provider));
	ipcMain.handle(IPC.listModels, () => pool.listModels());
	ipcMain.handle(IPC.listProviders, () => pool.listProviders());
	ipcMain.handle(IPC.addCustomProvider, (_e, config: CustomProviderInput) => pool.addCustomProvider(config));
	ipcMain.handle(IPC.listSessions, () => pool.listSessions());
	ipcMain.handle(IPC.getState, () => pool.getState());
	ipcMain.handle(IPC.getProxyConfig, () => ({ ...loadProxyConfig(), envProxy: detectEnvProxy() }));
	ipcMain.handle(IPC.setProxyConfig, (_e, cfg: { enabled: boolean; url: string }) => {
		setProxyConfig(cfg);
	});
	ipcMain.handle(IPC.chooseCwd, async () => {
		const win = getWindow();
		const result = win
			? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
			: await dialog.showOpenDialog({ properties: ["openDirectory"] });
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});

	return pool;
}
