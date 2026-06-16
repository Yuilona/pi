import { type KeyboardEvent, useState } from "react";

export function ApiKeyGate({ onReady }: { onReady: () => void }) {
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | undefined>();

	const submit = async () => {
		const trimmed = key.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setErr(undefined);
		const ok = await window.pi.setApiKey("anthropic", trimmed);
		setBusy(false);
		if (ok) onReady();
		else setErr("That key didn't work. Check it and try again.");
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") submit();
	};

	return (
		<div className="gate">
			<div className="mark">
				<span className="glyph" />
			</div>
			<h1>Connect your agent</h1>
			<p className="sub">
				Paste an Anthropic API key to begin. It's stored locally in <code>~/.pi/agent/auth.json</code> and used only
				to talk to Anthropic.
			</p>
			<div className="gate-form">
				<input
					type="password"
					className="gate-input selectable"
					placeholder="sk-ant-…"
					value={key}
					onChange={(e) => setKey(e.target.value)}
					onKeyDown={onKeyDown}
					// biome-ignore lint/a11y/noAutofocus: gate is the sole focus target on first run
					autoFocus
				/>
				<button type="button" className="btn btn-brand" onClick={submit} disabled={busy || !key.trim()}>
					{busy ? "Connecting…" : "Save & start"}
				</button>
			</div>
			{err && <div className="gate-err">{err}</div>}
			<a className="gate-link" href="https://console.anthropic.com/settings/keys">
				Get an API key →
			</a>
		</div>
	);
}
