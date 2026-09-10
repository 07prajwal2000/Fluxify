import { Checkbox, Input, Label, ListBox, Select } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

const SASL_MECHANISMS = ["none", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"] as const;

// Kafka: broker list, optional TLS and SASL login, and a dead-letter topic.
export function KafkaForm({ projectId, name, onName, config, setField }: ConnectorFormProps) {
	const mechanism = (config.saslMechanism as string) || "none";

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-foreground">
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder="Kafka | Production" />
			</div>

			<AppConfigSelector
				projectId={projectId}
				value={(config.brokers as string) ?? ""}
				onChange={(v) => setField("brokers", v)}
				label="Brokers"
				description="Comma-separated host:port list"
				placeholder="kafka-1:9092,kafka-2:9092"
			/>

			<div className="grid grid-cols-2 gap-3">
				<AppConfigSelector
					projectId={projectId}
					value={(config.clientId as string) ?? ""}
					onChange={(v) => setField("clientId", v)}
					label="Client ID"
					placeholder="fluxify"
				/>
				<Select
					fullWidth
					variant="secondary"
					selectedKey={mechanism}
					onSelectionChange={(key) => {
						if (key != null) {
							setField("saslMechanism", String(key));
						}
					}}
				>
					<Label>Authentication</Label>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{SASL_MECHANISMS.map((m) => (
								<ListBox.Item key={m} id={m} textValue={m === "none" ? "None" : `SASL ${m}`}>
									{m === "none" ? "None" : `SASL ${m}`}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
				{mechanism !== "none" && (
					<>
						<AppConfigSelector
							projectId={projectId}
							value={(config.username as string) ?? ""}
							onChange={(v) => setField("username", v)}
							label="Username"
							placeholder="username"
						/>
						<AppConfigSelector
							projectId={projectId}
							value={(config.password as string) ?? ""}
							onChange={(v) => setField("password", v)}
							label="Password"
							placeholder="password"
						/>
					</>
				)}
			</div>

			<Checkbox isSelected={Boolean(config.ssl)} onChange={(v) => setField("ssl", v)}>
				Use TLS
			</Checkbox>

			<details className="rounded-lg border border-border px-3 py-2">
				<summary className="cursor-pointer text-xs font-medium text-foreground">Advanced</summary>
				<div className="pt-3">
					<AppConfigSelector
						projectId={projectId}
						value={(config.dlqTopic as string) ?? ""}
						onChange={(v) => setField("dlqTopic", v)}
						label="Dead-letter topic"
						description="Messages that keep failing are copied here, then skipped. Leave empty to retry them until they succeed."
						placeholder="fluxify.dlq"
					/>
				</div>
			</details>
		</div>
	);
}
