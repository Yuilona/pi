/// <reference types="vite/client" />

import type { PiApi } from "@shared/ipc";

declare global {
	interface Window {
		pi: PiApi;
	}
}

declare module "*.css";
