import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover the PURE helpers + framework-free reducers (math/title/schema normalization, the event
// id factory, the per-session slice reducer). They run in a plain Node env with no Electron/pi runtime — the
// tested modules deliberately avoid those. The `@`/`@shared` aliases mirror the app's tsconfig paths so a
// tested module's own imports resolve.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
			"@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
		},
	},
});
