import "@/styles/settings.css";
import type {
	CustomProviderInput,
	ModelInfoDto,
	PermissionMode,
	ProviderInfoDto,
	ProxyConfigDto,
	ThinkingLevelDto,
} from "@shared/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	IconCheck,
	IconChevron,
	IconClose,
	IconFolder,
	IconMoon,
	IconSearch,
	IconSun,
	IconTrash,
} from "@/components/icons";
import { useModalFocus } from "@/state/useModalFocus";
import { useView } from "@/state/viewPrefs";

const THINKING: ThinkingLevelDto[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const MODES: { key: PermissionMode; label: string; desc: string }[] = [
	{ key: "ask", label: "Ask every time", desc: "Approve each bash / edit / write. Read-only tools auto-run." },
	{ key: "acceptEdits", label: "Auto-accept edits", desc: "Edits & writes run automatically; commands still ask." },
	{ key: "yolo", label: "Auto-run all", desc: "Everything runs without asking. Fast, but unsupervised." },
	{ key: "readonly", label: "Read-only", desc: "The agent can read and plan, but cannot modify anything." },
];

const EMPTY_CUSTOM: CustomProviderInput = {
	id: "",
	name: "",
	baseUrl: "",
	api: "openai-completions",
	apiKey: "",
	modelId: "",
	modelName: "",
	reasoning: false,
	contextWindow: 128000,
	maxTokens: 8192,
};

interface SettingsPanelProps {
	onClose: () => void;
	theme: "light" | "dark";
	onToggleTheme: () => void;
	cwdLabel: string;
	onChooseCwd: () => void;
	thinkingLevel: ThinkingLevelDto;
	mode: PermissionMode;
	onSetMode: (m: PermissionMode) => void;
	currentModel?: { provider: string; id: string };
	onChanged: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
	const {
		onClose,
		theme,
		onToggleTheme,
		cwdLabel,
		onChooseCwd,
		thinkingLevel,
		mode,
		onSetMode,
		currentModel,
		onChanged,
	} = props;
	const [models, setModels] = useState<ModelInfoDto[]>([]);
	const [providers, setProviders] = useState<ProviderInfoDto[]>([]);
	const [search, setSearch] = useState("");
	const [showAll, setShowAll] = useState(false);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
	const [thinking, setThinking] = useState<ThinkingLevelDto>(thinkingLevel);
	const [custom, setCustom] = useState<CustomProviderInput>(EMPTY_CUSTOM);
	const [busy, setBusy] = useState(false);
	const [proxy, setProxy] = useState<ProxyConfigDto>({ enabled: false, url: "", envProxy: "" });
	const view = useView();

	const load = useCallback(async () => {
		const [m, p] = await Promise.all([window.pi.listModels(), window.pi.listProviders()]);
		setModels(m);
		setProviders(p);
		setExpanded((prev) => {
			const next = new Set(prev);
			for (const x of p) if (x.ready) next.add(x.provider);
			if (currentModel) next.add(currentModel.provider);
			return next;
		});
	}, [currentModel]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		void window.pi.getProxyConfig().then(setProxy);
	}, []);

	// Persist + apply the proxy config. Enabling with an empty field falls back to the detected env proxy.
	const updateProxy = (next: Partial<Pick<ProxyConfigDto, "enabled" | "url">>) => {
		setProxy((prev) => {
			const merged = { ...prev, ...next };
			if (merged.enabled && !merged.url) merged.url = prev.envProxy;
			void window.pi.setProxyConfig({ enabled: merged.enabled, url: merged.url });
			return merged;
		});
	};

	const groups = useMemo(() => {
		const map = new Map<string, ModelInfoDto[]>();
		for (const m of models) {
			const list = map.get(m.provider);
			if (list) list.push(m);
			else map.set(m.provider, [m]);
		}
		return map;
	}, [models]);

	const q = search.trim().toLowerCase();
	const matches = (m: ModelInfoDto) =>
		!q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);

	const orderedProviders = useMemo(() => {
		const known = providers.map((p) => p.provider);
		const extra = [...groups.keys()].filter((p) => !known.includes(p));
		return [...known, ...extra];
	}, [providers, groups]);

	const infoFor = (provider: string) => providers.find((p) => p.provider === provider);

	const selectModel = async (m: ModelInfoDto) => {
		if (!m.available || busy) return;
		setBusy(true);
		await window.pi.setModel(m.provider, m.id);
		setBusy(false);
		onChanged();
	};

	const saveKey = async (provider: string) => {
		const key = (keyDrafts[provider] ?? "").trim();
		if (!key || busy) return;
		setBusy(true);
		await window.pi.setApiKey(provider, key);
		setBusy(false);
		setKeyDrafts((d) => ({ ...d, [provider]: "" }));
		await load();
		onChanged();
	};

	const removeKey = async (provider: string) => {
		setBusy(true);
		await window.pi.removeApiKey(provider);
		setBusy(false);
		await load();
		onChanged();
	};

	const addCustom = async () => {
		if (busy || !custom.id || !custom.baseUrl || !custom.modelId) return;
		setBusy(true);
		const ok = await window.pi.addCustomProvider(custom);
		setBusy(false);
		if (ok) {
			setCustom(EMPTY_CUSTOM);
			await load();
			onChanged();
		}
	};

	const pickThinking = (level: ThinkingLevelDto) => {
		setThinking(level);
		void window.pi.setThinking(level);
	};

	// API keys: only show providers that already have a key; fold the rest behind a toggle so the long
	// list of unconfigured providers doesn't clutter the panel. A fresh user (none ready) sees them all.
	const readyKeys = providers.filter((p) => p.ready);
	const lockedKeys = providers.filter((p) => !p.ready);
	const noneReady = readyKeys.length === 0;
	const visibleKeyProviders = showAllKeys || noneReady ? providers : readyKeys;

	const sheetRef = useRef<HTMLElement>(null);
	useModalFocus(sheetRef);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<>
			<button type="button" className="sheet-backdrop" onClick={onClose} aria-label="Close settings" />
			<aside className="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
				<div className="sheet-head">
					<h2>Settings</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Close" aria-label="Close settings">
						<IconClose />
					</button>
				</div>

				<div className="sheet-body">
					{/* ---- Model picker ---- */}
					<div className="section">
						<div className="label">
							Model{" "}
							<span className="count">
								· {models.filter((m) => m.available).length} ready · {models.length} total
							</span>
						</div>
						<div className="search">
							<IconSearch />
							<input
								type="text"
								placeholder="Search models or providers…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>
						<label className="row-toggle">
							<span>Show providers without a key</span>
							<input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
						</label>

						{orderedProviders.map((provider) => {
							const all = groups.get(provider) ?? [];
							const shown = all.filter(matches);
							const info = infoFor(provider);
							const ready = info?.ready ?? shown.some((m) => m.available);
							if (q ? shown.length === 0 : !(showAll || ready)) return null;
							const open = q ? true : expanded.has(provider);
							return (
								<div className="provider-group" key={provider}>
									<button
										type="button"
										className={`provider-head ${open ? "open" : ""}`}
										onClick={() =>
											setExpanded((prev) => {
												const next = new Set(prev);
												if (next.has(provider)) next.delete(provider);
												else next.add(provider);
												return next;
											})
										}
									>
										<IconChevron className="chev" />
										<span className="pname">{provider}</span>
										<span className="pmeta">{all.length} models</span>
										{info?.custom && <span className="badge custom">custom</span>}
										<span className={`badge ${ready ? "ready" : "locked"}`}>
											{ready ? "ready" : "no key"}
										</span>
									</button>
									{open &&
										shown.map((m) => {
											const isCurrent = currentModel?.provider === m.provider && currentModel?.id === m.id;
											return (
												<button
													type="button"
													key={m.id}
													className={`model-row ${isCurrent ? "current" : ""} ${m.available ? "" : "locked"}`}
													onClick={() => selectModel(m)}
												>
													<span className="mname">{m.label}</span>
													<span className="mid">{m.id}</span>
													{isCurrent && <IconCheck className="tick" />}
												</button>
											);
										})}
								</div>
							);
						})}
					</div>

					{/* ---- Provider API keys ---- */}
					<div className="section">
						<div className="label">
							API keys
							<span className="count"> · {readyKeys.length} configured</span>
						</div>
						{visibleKeyProviders.map((p) => (
							<div className="key-row" key={p.provider}>
								<div className="pinfo">
									<div className="n">{p.provider}</div>
									<div className="s">
										{p.ready
											? p.hasStoredKey
												? "key stored"
												: p.custom
													? "in models.json"
													: "from env"
											: "no key"}
									</div>
								</div>
								<input
									type="password"
									placeholder={p.ready ? "update key…" : "paste API key…"}
									value={keyDrafts[p.provider] ?? ""}
									onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.provider]: e.target.value }))}
									onKeyDown={(e) => {
										if (e.key === "Enter") void saveKey(p.provider);
									}}
								/>
								<button
									type="button"
									className="btn-sand"
									onClick={() => void saveKey(p.provider)}
									disabled={busy}
								>
									Save
								</button>
								{p.hasStoredKey && (
									<button
										type="button"
										className="icon-btn danger"
										onClick={() => void removeKey(p.provider)}
										title="Remove stored key"
										aria-label="Remove stored key"
									>
										<IconTrash />
									</button>
								)}
							</div>
						))}
						{readyKeys.length === 0 && visibleKeyProviders.length === 0 && (
							<div className="hint">No providers detected.</div>
						)}
						{!noneReady && lockedKeys.length > 0 && (
							<button type="button" className="key-more" onClick={() => setShowAllKeys((v) => !v)}>
								{showAllKeys ? "Show fewer" : `Add a key for another provider · ${lockedKeys.length}`}
							</button>
						)}
					</div>

					{/* ---- Custom endpoint ---- */}
					<div className="section">
						<div className="label">Custom OpenAI-compatible endpoint</div>
						<div className="field-row">
							<div className="field">
								<label htmlFor="cp-id">Provider id</label>
								<input
									id="cp-id"
									value={custom.id}
									placeholder="my-proxy"
									onChange={(e) => setCustom((c) => ({ ...c, id: e.target.value.trim() }))}
								/>
							</div>
							<div className="field">
								<label htmlFor="cp-api">API</label>
								<select
									id="cp-api"
									value={custom.api}
									onChange={(e) =>
										setCustom((c) => ({ ...c, api: e.target.value as CustomProviderInput["api"] }))
									}
								>
									<option value="openai-completions">openai-completions</option>
									<option value="openai-responses">openai-responses</option>
								</select>
							</div>
						</div>
						<div className="field">
							<label htmlFor="cp-url">Base URL</label>
							<input
								id="cp-url"
								value={custom.baseUrl}
								placeholder="https://api.example.com/v1"
								onChange={(e) => setCustom((c) => ({ ...c, baseUrl: e.target.value.trim() }))}
							/>
						</div>
						<div className="field">
							<label htmlFor="cp-key">API key</label>
							<input
								id="cp-key"
								type="password"
								value={custom.apiKey}
								placeholder="sk-…"
								onChange={(e) => setCustom((c) => ({ ...c, apiKey: e.target.value }))}
							/>
						</div>
						<div className="field-row">
							<div className="field">
								<label htmlFor="cp-mid">Model id</label>
								<input
									id="cp-mid"
									value={custom.modelId}
									placeholder="gpt-4o-mini"
									onChange={(e) => setCustom((c) => ({ ...c, modelId: e.target.value.trim() }))}
								/>
							</div>
							<div className="field">
								<label htmlFor="cp-mname">Model name</label>
								<input
									id="cp-mname"
									value={custom.modelName}
									placeholder="My Model"
									onChange={(e) => setCustom((c) => ({ ...c, modelName: e.target.value }))}
								/>
							</div>
						</div>
						<div className="field-row">
							<div className="field">
								<label htmlFor="cp-ctx">Context window</label>
								<input
									id="cp-ctx"
									type="number"
									value={custom.contextWindow}
									onChange={(e) => setCustom((c) => ({ ...c, contextWindow: Number(e.target.value) || 0 }))}
								/>
							</div>
							<div className="field">
								<label htmlFor="cp-max">Max tokens</label>
								<input
									id="cp-max"
									type="number"
									value={custom.maxTokens}
									onChange={(e) => setCustom((c) => ({ ...c, maxTokens: Number(e.target.value) || 0 }))}
								/>
							</div>
						</div>
						<label className="row-toggle">
							<span>Reasoning model (thinking)</span>
							<input
								type="checkbox"
								checked={custom.reasoning}
								onChange={(e) => setCustom((c) => ({ ...c, reasoning: e.target.checked }))}
							/>
						</label>
						<button
							type="button"
							className="btn btn-brand"
							onClick={() => void addCustom()}
							disabled={busy || !custom.id || !custom.baseUrl || !custom.modelId}
							style={{ marginTop: "var(--sp-5)" }}
						>
							Add endpoint
						</button>
						<div className="hint">Writes to ~/.pi/agent/models.json and refreshes the model registry.</div>
					</div>

					{/* ---- Network proxy ---- */}
					<div className="section">
						<div className="label">Network proxy</div>
						<label className="row-toggle">
							<span>Route model requests through a proxy</span>
							<input
								type="checkbox"
								checked={proxy.enabled}
								onChange={(e) => updateProxy({ enabled: e.target.checked })}
							/>
						</label>
						<div className="field">
							<label htmlFor="proxy-url">Proxy URL</label>
							<input
								id="proxy-url"
								value={proxy.url}
								placeholder={proxy.envProxy || "http://127.0.0.1:10808"}
								onChange={(e) => setProxy((p) => ({ ...p, url: e.target.value }))}
								onBlur={() => updateProxy({ url: proxy.url.trim() })}
							/>
						</div>
						{proxy.enabled && !proxy.url && !proxy.envProxy && (
							<div className="hint hint-warn">
								Proxy is on but no URL is set — none was detected from your environment (GUI launches don't
								inherit your shell's HTTPS_PROXY). Type one above (e.g. http://127.0.0.1:10808); until then,
								requests still go direct.
							</div>
						)}
						<div className="hint">
							Sends the app's API requests through an HTTP proxy (e.g. your local 127.0.0.1:10808) — use this
							instead of TUN mode when an endpoint is only reachable through your proxy. Takes effect on your
							next message.
						</div>
					</div>

					{/* ---- Display / message visibility ---- */}
					<div className="section">
						<div className="label">Message visibility</div>
						<label className="row-toggle">
							<span>Show thinking process</span>
							<input
								type="checkbox"
								checked={view.showThinking}
								onChange={(e) => view.setShowThinking(e.target.checked)}
							/>
						</label>
						<label className="row-toggle">
							<span>Expand tool & command output by default</span>
							<input
								type="checkbox"
								checked={view.expandTools}
								onChange={(e) => view.setExpandTools(e.target.checked)}
							/>
						</label>
						<div className="hint">
							"Show thinking" maps to pi's hideThinkingBlock setting (shared with the CLI).
						</div>
					</div>

					{/* ---- Permissions ---- */}
					<div className="section">
						<div className="label">Permissions</div>
						<div className="mode-list">
							{MODES.map((m) => (
								<button
									type="button"
									key={m.key}
									className={`mode-opt ${m.key === mode ? "on" : ""}`}
									onClick={() => onSetMode(m.key)}
								>
									<div className="mode-opt-t">{m.label}</div>
									<div className="mode-opt-d">{m.desc}</div>
								</button>
							))}
						</div>
						<div className="hint">Tip: cycle modes anytime with Shift+Tab from the chat.</div>
					</div>

					{/* ---- Preferences ---- */}
					<div className="section">
						<div className="label">Thinking level</div>
						<div className="segmented">
							{THINKING.map((level) => (
								<button
									type="button"
									key={level}
									className={level === thinking ? "on" : ""}
									onClick={() => pickThinking(level)}
								>
									{level}
								</button>
							))}
						</div>
					</div>

					<div className="section">
						<div className="label">Working directory</div>
						<div className="cwd-row">
							<IconFolder />
							<span className="p">{cwdLabel}</span>
							<button type="button" className="btn-sand" onClick={onChooseCwd}>
								Change
							</button>
						</div>
						<div className="hint">
							The agent's tools operate in this folder. Changing it starts a fresh conversation.
						</div>
					</div>

					<div className="section">
						<div className="label">Appearance</div>
						<button type="button" className="btn-sand" onClick={onToggleTheme}>
							{theme === "light" ? <IconMoon /> : <IconSun />}
							{theme === "light" ? "Switch to dark" : "Switch to light"}
						</button>
					</div>
				</div>
			</aside>
		</>
	);
}
