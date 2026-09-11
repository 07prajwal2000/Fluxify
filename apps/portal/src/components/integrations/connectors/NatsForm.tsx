import { useState } from "react";
import { Checkbox, Input, Label, ListBox, Select } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

const AUTH_MODES = {
	none: "None",
	user: "Username & password",
	token: "Token",
	creds: "Credentials file (JWT)",
	nkey: "NKey seed",
} as const;
type AuthMode = keyof typeof AUTH_MODES;
const AUTH_FIELDS = ["user", "pass", "token", "creds", "nkeySeed"] as const;

function authModeOf(config: Record<string, unknown>): AuthMode {
	if (config.creds) return "creds";
	if (config.nkeySeed) return "nkey";
	if (config.token) return "token";
	if (config.user) return "user";
	return "none";
}

// NATS: server list, one way to log in, optional TLS, and a dead-letter subject.
export function NatsForm({ projectId, name, onName, config, setField }: ConnectorFormProps) {
	const [mode, setMode] = useState<AuthMode>(() => authModeOf(config));
	const field = (key: string) => (config[key] as string) ?? "";

	// only one login is ever sent, so switching clears the others
	function chooseMode(next: AuthMode) {
		for (const key of AUTH_FIELDS) setField(key, "");
		setMode(next);
	}

	return (
		<div className="flex flex-col gap-3.5">
			<p className="text-xs text-muted">
				Connects to your own NATS cluster with JetStream turned on. This is separate from the NATS
				server Fluxify itself runs on.
			</p>

			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-foreground">
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder="NATS | Production" />
			</div>

			<AppConfigSelector
				projectId={projectId}
				value={field("servers")}
				onChange={(v) => setField("servers", v)}
				label="Servers"
				description="Comma-separated server URLs"
				placeholder="nats://nats-1:4222,nats://nats-2:4222"
			/>

			<Select
				fullWidth
				variant="secondary"
				selectedKey={mode}
				onSelectionChange={(key) => {
					if (key != null) chooseMode(String(key) as AuthMode);
				}}
			>
				<Label>Authentication</Label>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						{Object.entries(AUTH_MODES).map(([id, text]) => (
							<ListBox.Item key={id} id={id} textValue={text}>
								{text}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>

			{mode === "user" && (
				<div className="grid grid-cols-2 gap-3">
					<AppConfigSelector
						projectId={projectId}
						value={field("user")}
						onChange={(v) => setField("user", v)}
						label="Username"
						placeholder="username"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={field("pass")}
						onChange={(v) => setField("pass", v)}
						label="Password"
						placeholder="password"
					/>
				</div>
			)}
			{mode === "token" && (
				<AppConfigSelector
					projectId={projectId}
					value={field("token")}
					onChange={(v) => setField("token", v)}
					label="Token"
					placeholder="token"
				/>
			)}
			{mode === "creds" && (
				<AppConfigSelector
					projectId={projectId}
					value={field("creds")}
					onChange={(v) => setField("creds", v)}
					label="Credentials"
					description="The full contents of a .creds file. Keep it in App Config and pick its key here."
					placeholder="cfg:NATS_CREDS"
				/>
			)}
			{mode === "nkey" && (
				<AppConfigSelector
					projectId={projectId}
					value={field("nkeySeed")}
					onChange={(v) => setField("nkeySeed", v)}
					label="NKey seed"
					description="A user seed, starting with SU."
					placeholder="cfg:NATS_NKEY_SEED"
				/>
			)}

			<Checkbox isSelected={Boolean(config.tls)} onChange={(v) => setField("tls", v)}>
				Use TLS
			</Checkbox>

			<details className="rounded-lg border border-border px-3 py-2">
				<summary className="cursor-pointer text-xs font-medium text-foreground">Advanced</summary>
				<div className="pt-3">
					<AppConfigSelector
						projectId={projectId}
						value={field("dlqSubject")}
						onChange={(v) => setField("dlqSubject", v)}
						label="Dead-letter subject"
						description="Messages that keep failing are published here, then skipped. A stream must capture this subject. Leave empty to retry them until they succeed."
						placeholder="fluxify.dlq"
					/>
				</div>
			</details>
		</div>
	);
}
