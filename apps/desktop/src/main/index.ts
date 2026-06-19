import { join } from "node:path";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { IPC } from "../shared/ipc.js";
import { registerAgentBridge } from "./agent/bridge.js";
import { applyProxy, loadProxyConfig } from "./agent/proxy.js";
import type { SessionPool } from "./agent/sessionPool.js";

const isDev = !!process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let pool: SessionPool | null = null;

/** Open a URL in the OS browser, but only safe web/mail schemes — never hand file:, smb:, ms-msdt:,
 * javascript:, etc. to the shell, where a crafted link could launch a local protocol handler. */
function openExternalSafe(url: string): void {
	try {
		const { protocol } = new URL(url);
		if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
	} catch {
		// ignore malformed URLs
	}
}

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
		openExternalSafe(url);
		return { action: "deny" };
	});

	// Pin the app document: never let the renderer itself be navigated away (a hijacked location would run
	// in the preload-privileged window). Real link clicks go through the window-open handler above.
	win.webContents.on("will-navigate", (e, url) => {
		const devUrl = process.env.ELECTRON_RENDERER_URL;
		const sameApp = devUrl ? url.startsWith(devUrl) : url.startsWith("file://");
		if (!sameApp) {
			e.preventDefault();
			openExternalSafe(url);
		}
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		win.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}

	// Dev-only: capture a screenshot then quit (set PI_SHOT=<path>). Gated on !app.isPackaged so the
	// arbitrary-JS / arbitrary-file-read capability is compiled out of any shipped production build.
	if (!app.isPackaged && process.env.PI_SHOT) {
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
	// Defense-in-depth Content-Security-Policy (production only — the dev path runs the Vite dev
	// server / HMR, which a strict CSP would break). connect-src 'self' is safe because pi runs in
	// the main process: the renderer never calls the model API directly. img-src allows the markdown
	// image gallery; style 'unsafe-inline' + font data: keep KaTeX/inline styles working.
	if (!isDev) {
		session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
			callback({
				responseHeaders: {
					...details.responseHeaders,
					"Content-Security-Policy": [
						"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
							"img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self'",
					],
				},
			});
		});
	}

	// Route outbound fetch through the saved proxy (if enabled) before the agent makes any request.
	applyProxy(loadProxyConfig());
	registerWindowControls();
	pool = registerAgentBridge(() => mainWindow, app.getPath("home"), app.getPath("userData"));
	mainWindow = createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	pool?.dispose();
});

if (isDev) {
	process.on("unhandledRejection", (reason) => console.error("[main] unhandledRejection:", reason));
}
