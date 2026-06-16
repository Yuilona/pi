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
			<button type="button" className="icon-btn" onClick={onToggleSidebar} title="Toggle chats">
				<IconSidebar />
			</button>
			<div className="wordmark">
				<span className="dot" />
				pi
			</div>

			<button type="button" className="chip" onClick={onChooseCwd} title="Working directory">
				<IconFolder width={14} height={14} />
				<span className="path">{cwdLabel}</span>
			</button>

			<div className="spacer" />

			<button type="button" className="icon-btn" onClick={onNewChat} title="New conversation">
				<IconPlus />
			</button>
			<button
				type="button"
				className="icon-btn"
				onClick={onToggleTheme}
				title={theme === "light" ? "Dark theme" : "Light theme"}
			>
				{theme === "light" ? <IconMoon /> : <IconSun />}
			</button>
			<button type="button" className="icon-btn" onClick={onOpenSettings} title="Settings">
				<IconSettings />
			</button>

			<div className="winctl">
				<button type="button" className="icon-btn" onClick={() => win?.minimize()} title="Minimize">
					<IconMin />
				</button>
				<button type="button" className="icon-btn" onClick={() => win?.toggleMaximize()} title="Maximize">
					<IconMax />
				</button>
				<button type="button" className="icon-btn" onClick={() => win?.close()} title="Close">
					<IconClose />
				</button>
			</div>
		</header>
	);
}
