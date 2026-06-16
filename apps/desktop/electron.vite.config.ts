import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = import.meta.dirname;

export default defineConfig({
	main: {
		// Keep pi (@earendil-works/*) and other node deps external so child_process,
		// fs and native modules resolve from node_modules at runtime.
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(root, "src/main/index.ts") },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(root, "src/preload/index.ts") },
				// Force CJS output (.cjs) so Electron loads the preload reliably even though the
				// package is ESM ("type":"module"). ESM preloads require a .mjs extension.
				output: {
					format: "cjs",
					entryFileNames: "[name].cjs",
				},
			},
		},
	},
	renderer: {
		root: resolve(root, "src/renderer"),
		resolve: {
			alias: {
				"@": resolve(root, "src/renderer/src"),
				"@shared": resolve(root, "src/shared"),
			},
		},
		plugins: [react()],
		build: {
			rollupOptions: {
				input: { index: resolve(root, "src/renderer/index.html") },
			},
		},
	},
});
