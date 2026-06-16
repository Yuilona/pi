import { type BrowserWindow, dialog, ipcMain, Notification } from "electron";
import {
	type ApprovalDecision,
	type CustomProviderInput,
	type ImageAttachmentDto,
	IPC,
	type PermissionMode,
	type ThinkingLevelDto,
} from "../../shared/ipc.js";
import { AgentManager } from "./manager.js";
import { detectEnvProxy, loadProxyConfig, setProxyConfig } from "./proxy.js";

/** Wire the AgentManager to ipcMain and forward its events to the renderer window. */
export function registerAgentBridge(getWindow: () => BrowserWindow | null, cwd: string, appDir: string): AgentManager {
	// OS notification when work finishes or needs you — only when the window isn't already focused.
	const notify = (title: string, body: string) => {
		const win = getWindow();
		if (win && !win.isFocused() && Notification.isSupported()) {
			const n = new Notification({ title, body });
			n.on("click", () => {
				win.show();
				win.focus();
			});
			n.show();
		}
	};
	const manager = new AgentManager(
		(e) => {
			getWindow()?.webContents.send(IPC.event, e);
			if (e.type === "agent_end" && !e.willRetry) notify("pi", "Response ready");
		},
		(req) => {
			getWindow()?.webContents.send(IPC.approvalRequest, req);
			notify("pi — approval needed", `Allow ${req.toolName}?`);
		},
		cwd,
		appDir,
	);
	void manager.init();

	ipcMain.on(IPC.approvalResolve, (_e, id: string, decision: ApprovalDecision) =>
		manager.resolveApproval(id, decision),
	);

	ipcMain.handle(IPC.send, (_e, text: string, images?: ImageAttachmentDto[]) => manager.prompt(text, images));
	ipcMain.handle(IPC.getStats, () => manager.getStats());
	ipcMain.handle(IPC.newChatInCwd, (_e, dir: string) => manager.setCwd(dir));
	ipcMain.handle(IPC.abort, () => manager.abort());
	ipcMain.handle(IPC.newSession, () => manager.newSession());
	ipcMain.handle(IPC.setModel, (_e, provider: string, id: string) => manager.setModel(provider, id));
	ipcMain.handle(IPC.setThinking, (_e, level: ThinkingLevelDto) => manager.setThinking(level));
	ipcMain.handle(IPC.setApiKey, (_e, provider: string, key: string) => manager.setApiKey(provider, key));
	ipcMain.handle(IPC.removeApiKey, (_e, provider: string) => manager.removeApiKey(provider));
	ipcMain.handle(IPC.setMode, (_e, mode: PermissionMode) => manager.setMode(mode));
	ipcMain.handle(IPC.setShowThinking, (_e, show: boolean) => manager.setShowThinking(show));
	ipcMain.handle(IPC.hasApiKey, (_e, provider: string) => manager.hasApiKey(provider));
	ipcMain.handle(IPC.listModels, () => manager.listModels());
	ipcMain.handle(IPC.listProviders, () => manager.listProviders());
	ipcMain.handle(IPC.addCustomProvider, (_e, config: CustomProviderInput) => manager.addCustomProvider(config));
	ipcMain.handle(IPC.listSessions, () => manager.listSessions());
	ipcMain.handle(IPC.switchSession, (_e, path: string) => manager.switchSession(path));
	ipcMain.handle(IPC.deleteSession, (_e, path: string) => manager.deleteSession(path));
	ipcMain.handle(IPC.getTranscript, () => manager.getTranscript());
	ipcMain.handle(IPC.getState, () => manager.getState());
	ipcMain.handle(IPC.listCommands, () => manager.listCommands());
	ipcMain.handle(IPC.compact, () => manager.compact());
	ipcMain.handle(IPC.getProxyConfig, () => ({ ...loadProxyConfig(), envProxy: detectEnvProxy() }));
	ipcMain.handle(IPC.setProxyConfig, (_e, cfg: { enabled: boolean; url: string }) => {
		setProxyConfig(cfg);
	});
	ipcMain.handle(IPC.chooseCwd, async () => {
		const win = getWindow();
		const result = win
			? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
			: await dialog.showOpenDialog({ properties: ["openDirectory"] });
		const dir = result.canceled ? undefined : result.filePaths[0];
		if (!dir) return null;
		await manager.setCwd(dir);
		return dir;
	});

	return manager;
}
