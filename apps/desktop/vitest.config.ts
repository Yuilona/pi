import { defineConfig } from "vitest/config";

// Unit tests cover the PURE helpers only (math/title/schema normalization, event id factory). They run in
// a plain Node env with no Electron/pi/React runtime — the tested modules deliberately avoid those imports.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
