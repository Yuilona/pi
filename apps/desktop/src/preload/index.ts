import { contextBridge, ipcRenderer } from "electron";
import {
	type ApprovalDecision,
	type ApprovalRequest,
	type CommandDto,
	type CustomProviderInput,
	IPC,
	type IpcAgentEvent,
	type ModelInfoDto,
	type PermissionMode,
	type PiApi,
	type ProviderInfoDto,
	type SessionInfoDto,
	type ThinkingLevelDto,
	type TranscriptDto,
} from "../shared/ipc.js";

const api: PiApi = {
	send: (text: string) => ipcRenderer.invoke(IPC.send, text),
	abort: () => ipcRenderer.invoke(IPC.abort),
	newSession: () => ipcRenderer.invoke(IPC.newSession),
	setModel: (provider: string, id: string) => ipcRenderer.invoke(IPC.setModel, provider, id),
	setThinking: (level: ThinkingLevelDto) => ipcRenderer.invoke(IPC.setThinking, level),
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
	switchSession: (path: string) => ipcRenderer.invoke(IPC.switchSession, path),
	deleteSession: (path: string) => ipcRenderer.invoke(IPC.deleteSession, path),
	getTranscript: () => ipcRenderer.invoke(IPC.getTranscript) as Promise<TranscriptDto>,
	getState: () => ipcRenderer.invoke(IPC.getState),
	listCommands: () => ipcRenderer.invoke(IPC.listCommands) as Promise<CommandDto[]>,
	compact: () => ipcRenderer.invoke(IPC.compact),

	onEvent: (cb: (e: IpcAgentEvent) => void) => {
		const listener = (_e: unknown, ev: IpcAgentEvent) => cb(ev);
		ipcRenderer.on(IPC.event, listener);
		return () => ipcRenderer.removeListener(IPC.event, listener);
	},
	onApproval: (cb: (r: ApprovalRequest) => void) => {
		const listener = (_e: unknown, r: ApprovalRequest) => cb(r);
		ipcRenderer.on(IPC.approvalRequest, listener);
		return () => ipcRenderer.removeListener(IPC.approvalRequest, listener);
	},
	resolveApproval: (id: string, decision: ApprovalDecision) => ipcRenderer.send(IPC.approvalResolve, id, decision),

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
