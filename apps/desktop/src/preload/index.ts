import { contextBridge, ipcRenderer } from "electron";
import {
	type ApprovalDecision,
	type CommandDto,
	type CustomProviderInput,
	type ImageAttachmentDto,
	IPC,
	type ModelInfoDto,
	type PermissionMode,
	type PiApi,
	type ProviderInfoDto,
	type ProxyConfigDto,
	type SessionInfoDto,
	type ThinkingLevelDto,
	type TranscriptDto,
	type WrappedAgentEvent,
	type WrappedApprovalRequest,
} from "../shared/ipc.js";

const api: PiApi = {
	// session-scoped
	send: (sessionId: string, text: string, images?: ImageAttachmentDto[]) =>
		ipcRenderer.invoke(IPC.send, sessionId, text, images),
	abort: (sessionId: string) => ipcRenderer.invoke(IPC.abort, sessionId),
	getStats: (sessionId: string) => ipcRenderer.invoke(IPC.getStats, sessionId),
	getTranscript: (sessionId: string) => ipcRenderer.invoke(IPC.getTranscript, sessionId) as Promise<TranscriptDto>,
	setModel: (sessionId: string, provider: string, id: string) =>
		ipcRenderer.invoke(IPC.setModel, sessionId, provider, id),
	setThinking: (sessionId: string, level: ThinkingLevelDto) => ipcRenderer.invoke(IPC.setThinking, sessionId, level),
	compact: (sessionId: string) => ipcRenderer.invoke(IPC.compact, sessionId),
	listCommands: (sessionId: string) => ipcRenderer.invoke(IPC.listCommands, sessionId) as Promise<CommandDto[]>,
	editLastMessage: (sessionId: string) => ipcRenderer.invoke(IPC.editLastMessage, sessionId) as Promise<string | null>,

	// lifecycle
	openSession: (path: string) => ipcRenderer.invoke(IPC.openSession, path) as Promise<string>,
	newChatInCwd: (cwd: string) => ipcRenderer.invoke(IPC.newChatInCwd, cwd) as Promise<string>,
	closeSession: (sessionId: string) => ipcRenderer.invoke(IPC.closeSession, sessionId),
	deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC.deleteSession, sessionId),
	deleteSessionFile: (path: string) => ipcRenderer.invoke(IPC.deleteSessionFile, path),
	setActive: (sessionId: string | null) => ipcRenderer.invoke(IPC.setActive, sessionId),

	// app-global
	chooseCwd: () => ipcRenderer.invoke(IPC.chooseCwd),
	setApiKey: (provider: string, key: string) => ipcRenderer.invoke(IPC.setApiKey, provider, key),
	removeApiKey: (provider: string) => ipcRenderer.invoke(IPC.removeApiKey, provider),
	setMode: (mode: PermissionMode) => ipcRenderer.invoke(IPC.setMode, mode),
	setShowThinking: (show: boolean) => ipcRenderer.invoke(IPC.setShowThinking, show),
	hasApiKey: (provider: string) => ipcRenderer.invoke(IPC.hasApiKey, provider),
	listModels: () => ipcRenderer.invoke(IPC.listModels) as Promise<ModelInfoDto[]>,
	listProviders: () => ipcRenderer.invoke(IPC.listProviders) as Promise<ProviderInfoDto[]>,
	addCustomProvider: (config: CustomProviderInput) => ipcRenderer.invoke(IPC.addCustomProvider, config),
	listSessions: () => ipcRenderer.invoke(IPC.listSessions) as Promise<SessionInfoDto[]>,
	getState: () => ipcRenderer.invoke(IPC.getState),
	getProxyConfig: () => ipcRenderer.invoke(IPC.getProxyConfig) as Promise<ProxyConfigDto>,
	setProxyConfig: (cfg: { enabled: boolean; url: string }) => ipcRenderer.invoke(IPC.setProxyConfig, cfg),

	onEvent: (cb: (e: WrappedAgentEvent) => void) => {
		const listener = (_e: unknown, ev: WrappedAgentEvent) => cb(ev);
		ipcRenderer.on(IPC.event, listener);
		return () => ipcRenderer.removeListener(IPC.event, listener);
	},
	onApproval: (cb: (r: WrappedApprovalRequest) => void) => {
		const listener = (_e: unknown, r: WrappedApprovalRequest) => cb(r);
		ipcRenderer.on(IPC.approvalRequest, listener);
		return () => ipcRenderer.removeListener(IPC.approvalRequest, listener);
	},
	resolveApproval: (sessionId: string, id: string, decision: ApprovalDecision) =>
		ipcRenderer.send(IPC.approvalResolve, sessionId, id, decision),

	window: {
		minimize: () => ipcRenderer.send(IPC.windowMinimize),
		toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
		close: () => ipcRenderer.send(IPC.windowClose),
		isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
		onMaximizeChanged: (cb: (isMax: boolean) => void) => {
			const listener = (_e: unknown, isMax: boolean) => cb(isMax);
			ipcRenderer.on(IPC.windowMaximizeChanged, listener);
			return () => ipcRenderer.removeListener(IPC.windowMaximizeChanged, listener);
		},
	},
};

contextBridge.exposeInMainWorld("pi", api);
