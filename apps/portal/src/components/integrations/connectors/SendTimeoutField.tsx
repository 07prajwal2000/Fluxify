import { Input } from "@fluxify/components";
import type { ConnectorFormProps } from "./types";

const DEFAULT_SEND_TIMEOUT_MS = 30_000;

/** How long the Send Message block waits for the broker; shown with its default, like the DB query timeout. */
export function SendTimeoutField({
	config,
	setField,
}: Pick<ConnectorFormProps, "config" | "setField">) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor="integration-send-timeout" className="text-xs font-medium text-foreground">
				Send timeout (seconds)
			</label>
			<Input
				id="integration-send-timeout"
				type="number"
				min={1}
				value={String(Number(config.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS) / 1000)}
				onChange={(e) => {
					const seconds = Math.max(1, Math.round(Number(e.currentTarget.value) || 0));
					setField("sendTimeoutMs", seconds * 1000);
				}}
			/>
			<p className="text-xs text-muted">
				How long the Send Message block waits for the broker to confirm. Default: 30 seconds.
			</p>
		</div>
	);
}
