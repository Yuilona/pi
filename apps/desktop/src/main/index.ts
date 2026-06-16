import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IPC } from "../shared/ipc.js";
import { registerAgentBridge } from "./agent/bridge.js";
import type { AgentManager } from "./agent/manager.js";
import { applyProxy, loadProxyConfig } from "./agent/proxy.js";

const isDev = !!process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let manager: AgentManager | null = null;

function createWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1180,
		height: 800,
		minWidth: 720,
		minHeight: 520,
		show: false,
		frame: false,
		titleBarStyle: "hidden",
		backgroundColor: "#f5f4ed",
		trafficLightPosition: { x: 14, y: 14 },
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.on("ready-to-show", () => win.show());

	const emitMaximize = () => win.webContents.send(IPC.windowMaximizeChanged, win.isMaximized());
	win.on("maximize", emitMaximize);
	win.on("unmaximize", emitMaximize);

	win.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		win.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}

	// Dev-only: capture a screenshot then quit (set PI_SHOT=<path>).
	if (process.env.PI_SHOT) {
		win.webContents.once("did-finish-load", () => {
			setTimeout(async () => {
				try {
					if (process.env.PI_THEME) {
						await win.webContents.executeJavaScript(
							`document.documentElement.dataset.theme=${JSON.stringify(process.env.PI_THEME)}`,
						);
						await new Promise((r) => setTimeout(r, 250));
					}
					const js =
						process.env.PI_JS ??
						(process.env.PI_JS_FILE
							? (await import("node:fs")).readFileSync(process.env.PI_JS_FILE, "utf8")
							: undefined);
					if (js) {
						await win.webContents.executeJavaScript(js);
						await new Promise((r) => setTimeout(r, Number(process.env.PI_WAIT) || 700));
					}
					const img = await win.webContents.capturePage();
					const { writeFileSync } = await import("node:fs");
					writeFileSync(process.env.PI_SHOT as string, img.toPNG());
				} catch (err) {
					console.error("[shot] failed:", err);
				}
				app.quit();
			}, 1800);
		});
	}

	return win;
}

function registerWindowControls(): void {
	const senderWin = (e: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender);
	ipcMain.on(IPC.windowMinimize, (e) => senderWin(e)?.minimize());
	ipcMain.on(IPC.windowToggleMaximize, (e) => {
		const w = senderWin(e);
		if (!w) return;
		if (w.isMaximized()) w.unmaximize();
		else w.maximize();
	});
	ipcMain.on(IPC.windowClose, (e) => senderWin(e)?.close());
	ipcMain.handle(IPC.windowIsMaximized, (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);
}

app.whenReady().then(() => {
	// Route outbound fetch through the saved proxy (if enabled) before the agent makes any request.
	applyProxy(loadProxyConfig());
	registerWindowControls();
	manager = registerAgentBridge(() => mainWindow, app.getPath("home"));
	mainWindow = createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	manager?.dispose();
});

if (isDev) {
	process.on("unhandledRejection", (reason) => console.error("[main] unhandledRejection:", reason));
}
