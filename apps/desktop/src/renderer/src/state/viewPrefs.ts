import { createContext, useContext } from "react";

export interface ViewPrefs {
	/** Show assistant thinking blocks (synced to pi's hideThinkingBlock setting). */
	showThinking: boolean;
	/** Expand tool/command output cards by default. */
	expandTools: boolean;
	setShowThinking: (b: boolean) => void;
	setExpandTools: (b: boolean) => void;
}

export const ViewContext = createContext<ViewPrefs>({
	showThinking: true,
	expandTools: false,
	setShowThinking: () => {},
	setExpandTools: () => {},
});

export const useView = () => useContext(ViewContext);
