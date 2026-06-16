import { type BrowserWindow, dialog, ipcMain } from "electron";
import {
	type ApprovalDecision,
	type CustomProviderInput,
	IPC,
	type PermissionMode,
	type ThinkingLevelDto,
} from "../../shared/ipc.js";
import { AgentManager } from "./manager.js";
import { detectEnvProxy, loadProxyConfig, setProxyConfig } from "./proxy.js";

/** Wire the AgentManager to ipcMain and forward its events to the renderer window. */
export function registerAgentBridge(getWindow: () => BrowserWindow | null, cwd: string): AgentManager {
	const manager = new AgentManager(
		(e) => getWindow()?.webContents.send(IPC.event, e),
		(req) => getWindow()?.webContents.send(IPC.approvalRequest, req),
		cwd,
	);
	void manager.init();

	ipcMain.on(IPC.approvalResolve, (_e, id: string, decision: ApprovalDecision) =>
		manager.resolveApproval(id, decision),
	);

	ipcMain.handle(IPC.send, (_e, text: string) => manager.prompt(text));
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
