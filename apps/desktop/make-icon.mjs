// Dev-only: render the brand icon (terracotta serif π on a warm ivory→parchment rounded tile, matching
// DESIGN.md / the in-app `.mark`) to a multi-size Windows .ico, using Electron's renderer + nativeImage —
// no external image tooling. Run: npx electron make-icon.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { app, BrowserWindow } from "electron";

const SIZE = 512; // render large, downscale crisply
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#faf9f5"/>
      <stop offset="1" stop-color="#f1eae0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.62">
      <stop offset="0" stop-color="#c96442" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#c96442" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="6" y="6" width="244" height="244" rx="56" fill="url(#tile)"/>
  <rect x="6" y="6" width="244" height="244" rx="56" fill="url(#glow)"/>
  <rect x="7" y="7" width="242" height="242" rx="55" fill="none" stroke="#e7e3d8" stroke-width="2"/>
  <text x="128" y="150" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="170" font-weight="500" fill="#c96442">&#960;</text>
</svg>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head>
<body>${SVG}</body></html>`;

function buildIco(images) {
	const count = images.length;
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(count, 4);
	const dir = Buffer.alloc(16 * count);
	let offset = 6 + 16 * count;
	for (let i = 0; i < count; i++) {
		const { size, buf } = images[i];
		const b = i * 16;
		dir.writeUInt8(size >= 256 ? 0 : size, b + 0);
		dir.writeUInt8(size >= 256 ? 0 : size, b + 1);
		dir.writeUInt8(0, b + 2);
		dir.writeUInt8(0, b + 3);
		dir.writeUInt16LE(1, b + 4);
		dir.writeUInt16LE(32, b + 6);
		dir.writeUInt32LE(buf.length, b + 8);
		dir.writeUInt32LE(offset, b + 12);
		offset += buf.length;
	}
	return Buffer.concat([header, dir, ...images.map((i) => i.buf)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
	const win = new BrowserWindow({
		width: SIZE,
		height: SIZE,
		show: false,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		useContentSize: true,
	});
	await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
	await new Promise((r) => setTimeout(r, 400));
	const shot = await win.webContents.capturePage();
	mkdirSync("build", { recursive: true });
	// Preview (full render) for visual confirmation.
	writeFileSync("build/icon-preview.png", shot.toPNG());
	const sizes = [256, 128, 64, 48, 32, 16];
	const images = sizes.map((size) => ({
		size,
		buf: shot.resize({ width: size, height: size, quality: "best" }).toPNG(),
	}));
	writeFileSync("build/icon.ico", buildIco(images));
	console.log("WROTE build/icon.ico + build/icon-preview.png");
	app.quit();
});
