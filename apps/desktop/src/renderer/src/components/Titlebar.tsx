import {
	IconClose,
	IconFolder,
	IconMax,
	IconMin,
	IconMoon,
	IconPlus,
	IconSettings,
	IconSidebar,
	IconSun,
} from "@/components/icons";
import { Logo } from "@/components/Logo";

interface TitlebarProps {
	theme: "light" | "dark";
	cwdLabel: string;
	onToggleTheme: () => void;
	onChooseCwd: () => void;
	onNewChat: () => void;
	onToggleSidebar: () => void;
	onOpenSettings: () => void;
}

export function Titlebar({
	theme,
	cwdLabel,
	onToggleTheme,
	onChooseCwd,
	onNewChat,
	onToggleSidebar,
	onOpenSettings,
}: TitlebarProps) {
	const win = window.pi?.window;

	return (
		<header className="titlebar">
			<button
				type="button"
				className="icon-btn"
				onClick={onToggleSidebar}
				title="Toggle chats"
				aria-label="Toggle chats"
			>
				<IconSidebar />
			</button>
			<div className="wordmark">
				<Logo size={17} />
				pi
			</div>

			<button type="button" className="chip" onClick={onChooseCwd} title="Working directory">
				<IconFolder width={14} height={14} />
				<span className="path">{cwdLabel}</span>
			</button>

			<div className="spacer" />

			<button
				type="button"
				className="icon-btn"
				onClick={onNewChat}
				title="New conversation"
				aria-label="New conversation"
			>
				<IconPlus />
			</button>
			<button
				type="button"
				className="icon-btn"
				onClick={onToggleTheme}
				title={theme === "light" ? "Dark theme" : "Light theme"}
				aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
			>
				{theme === "light" ? <IconMoon /> : <IconSun />}
			</button>
			<button type="button" className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
				<IconSettings />
			</button>

			<div className="winctl">
				<button
					type="button"
					className="icon-btn"
					onClick={() => win?.minimize()}
					title="Minimize"
					aria-label="Minimize"
				>
					<IconMin />
				</button>
				<button
					type="button"
					className="icon-btn"
					onClick={() => win?.toggleMaximize()}
					title="Maximize"
					aria-label="Maximize"
				>
					<IconMax />
				</button>
				<button
					type="button"
					className="icon-btn"
					onClick={() => win?.close()}
					title="Close"
					aria-label="Close window"
				>
					<IconClose />
				</button>
			</div>
		</header>
	);
}
